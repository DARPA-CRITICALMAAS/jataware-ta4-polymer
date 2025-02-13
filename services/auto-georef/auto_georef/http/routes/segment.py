import hashlib
import itertools
import logging
import operator
from logging import Logger
from typing import Any, Callable, Iterable, Literal, TypeAlias

import httpx
from cdr_schemas.cdr_responses.legend_items import LegendItemResponse
from cdr_schemas.features.polygon_features import (
    Polygon,
    PolygonFeature,
    PolygonFeatureCollection,
    PolygonLegendAndFeaturesResult,
    PolygonProperties,
)
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, PositiveInt, field_validator
from starlette.status import HTTP_204_NO_CONTENT

from auto_georef.common.segment_utils import CDRClient, quick_cog
from auto_georef.common.utils import timeit
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)
router = APIRouter()

# If python3.12, use type statements instead
PixelCoordinate: TypeAlias = tuple[float, float]
Color: TypeAlias = tuple[float, float, float]
POLYMER = "polymer"


class MultiPolygon(BaseModel):
    """
    GeoJSON MultiPolygon
    """

    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[list[float | int]]]]


class LineString(BaseModel):
    """
    GeoJSON LineString
    """

    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class LabelPoint(BaseModel):
    """
    Custom SAM label point
    """

    type: str
    coordinate: PixelCoordinate

    @field_validator("type")
    def validate_type(cls, value):
        if value not in ["positive", "negative"]:
            raise ValueError("Value must be either 'positive' or 'negative'")
        return value


@router.get("/segment_in_cache")
def check_segment_in_cache(cog_id):
    try:
        resp = httpx.get(app_settings.segment_api_endpoint_url + f"/segment/segment_in_cache?cog_id={cog_id}")

        resp.raise_for_status()
        logger.info(resp)
        return resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/lasso_in_cache")
def check_lasso_in_cache(cog_id):
    try:
        resp = httpx.get(app_settings.segment_api_endpoint_url + f"/segment/lasso_in_cache?cog_id={cog_id}")

        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/embeddings_to_s3")
def create_send_embeds(cog_id: str):
    """
    Create embeddings and send to S3
    """
    try:
        resp = httpx.post(
            app_settings.segment_api_endpoint_url + "/segment/embeddings_to_s3", params={"cog_id": cog_id}
        )
        info = resp.json()
        logger.info(info)
        if "time" in info:
            return info
        resp.raise_for_status()

        return
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/load_segment", status_code=HTTP_204_NO_CONTENT)
async def load_segment(cog_id: str):
    """
    Load the segment for the specified `cog_id`
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(app_settings.segment_api_endpoint_url + f"/segment/load_segment?cog_id={cog_id}")
            resp.raise_for_status()
            return
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/load_lasso", status_code=HTTP_204_NO_CONTENT)
async def load_lasso(cog_id: str):
    """
    Load the lasso tool for the specified `cog_id`
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(app_settings.segment_api_endpoint_url + f"/segment/load_lasso?cog_id={cog_id}")
            logger.info(resp.status_code)
            resp.raise_for_status()
            return
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/systems")
def get_systems(cog_id: str, type: str = "polygon"):
    """
    Get the systems and versions for the specified `cog_id` and `type`
    """

    # __import__("time").sleep(3) # Simulate slow response

    client = CDRClient(cog_id)
    response = client.get_system_versions(type)
    response = sorted(response, key=operator.itemgetter(0))
    systems = itertools.groupby(response, operator.itemgetter(0))
    systems: dict[str, list[str]] = {system: [v for _, v in sys_ver] for system, sys_ver in systems}
    return systems  # system: [versions]


class LayerLegendItemResponse(BaseModel):
    id: str
    bbox: list[float | int]
    name: str

    @field_validator("bbox")
    def validate_bbox(cls, value):
        if len(value) != 4:
            raise ValueError("Bounding box must have 4 elements")
        return value


@router.get("/polymer_version")
def get_latest_version(cog_id: str, system: str):
    """
    Get the latest polymer version for the specified `cog_id`
    """

    systems = get_systems(cog_id, "legend_item")
    if system not in systems:
        return []

    polymer_versions = systems[system]
    semver_parse_key = lambda v: (int(n) for n in v.split("."))
    latest_version = max(polymer_versions, key=semver_parse_key)
    return latest_version


@router.get("/legend_items")
@timeit(logger)
def get_legend_items(cog_id: str):
    """
    Get the legend items for the specified `cog_id`
    """
    image = quick_cog(cog_id)
    height = image.shape[0]

    def flip_bbox(bbox, height):
        x1, y1, x2, y2 = bbox
        return [x1, height - y2, x2, height - y1]

    latest_version = get_latest_version(cog_id, POLYMER)

    client = CDRClient(cog_id)
    response = client.get_legend_items(POLYMER, latest_version)
    legend_items = [LegendItemResponse(**li) for li in response]
    legend_items = [
        LayerLegendItemResponse(id=li.legend_id, bbox=flip_bbox(li.px_bbox, height), name=li.abbreviation.strip())
        for li in legend_items
    ]

    logger.info(f"Found {len(legend_items)} legend items for {cog_id}")

    return legend_items


@router.get("/legend_items_from_system")
def get_legend_items_from_system(cog_id: str, legend_id: str):
    image = quick_cog(cog_id)
    height = image.shape[0]

    def flip_bbox(bbox, height):
        x1, y1, x2, y2 = bbox
        return [x1, height - y2, x2, height - y1]

    client = CDRClient("")
    item = client.legend_item_intersect(legend_id)

    item = LayerLegendItemResponse(
        id=item["legend_id"], bbox=flip_bbox(item["px_bbox"], height), name=item["abbreviation"].strip()
    )
    return item


class SelectLegendItemPointRequest(BaseModel):
    cog_id: str
    point: PixelCoordinate


@router.get("/check_polymer_legend_item")
def check_polymer_legend_item(cog_id: str, legend_id: str):
    """
    Check if a legend item is in the polymer legend
    """
    client = CDRClient(cog_id)
    latest_version = get_latest_version(cog_id, POLYMER)
    extractions = client.get_polygons(POLYMER, latest_version, 1 << 32)

    def create_legend_item(legend_item: Any | None):
        try:
            return LegendItemResponse(**legend_item)
        except Exception:
            return None

    validated_legend_ids = [create_legend_item(e.legend_item).legend_id for e in extractions]

    # logger.info(f"Found {len(validated_legend_ids)} validated legend items for {cog_id}")
    # logger.info(f"Checking if {legend_id} is in {validated_legend_ids}")

    return {"unique": legend_id not in validated_legend_ids}


@router.post("/select_legend_item_point")
def select_legend_item_point(req: SelectLegendItemPointRequest):
    """
    Select a legend item based on a point.
    """
    image = quick_cog(req.cog_id)
    height = image.shape[0]

    client = CDRClient(req.cog_id)
    x, y = req.point
    y = height - y

    def flip_bbox(bbox, height):
        x1, y1, x2, y2 = bbox
        return [x1, height - y2, x2, height - y1]

    item = client.legend_item_intersect_point(x, y)
    item = LayerLegendItemResponse(
        id=item["legend_id"], bbox=flip_bbox(item["px_bbox"], height), name=item["abbreviation"].strip()
    )
    return item


class PolygonResponse(BaseModel):
    polygon: MultiPolygon
    name: str
    is_validated: bool | None
    legend_item: LayerLegendItemResponse | None = None
    color: Color | None = None


@router.get("/import_polygons")
@timeit(logger)
def import_polygons(cog_id: str, system: str, version: str, max_polygons: int = 0):
    logging.info(f"Importing polygons for {cog_id} {system} {version}")

    image = quick_cog(cog_id)
    height = image.shape[0]

    client = CDRClient(cog_id)
    extractions = client.get_polygons(system, version, max_polygons or 1 << 32)

    logging.info(f"Retrieved polygons from CDR for {cog_id} {system} {version}")

    def fix_coordinates(coordinates):
        return [[[x, height - y] for (x, y) in linear_rings] for linear_rings in coordinates]

    def create_legend_item(legend_item: Any | None):
        try:
            return LegendItemResponse(**legend_item)
        except Exception:
            return None

    # TODO: Maybe use non-consecutive groupby without sorting for performance?
    TupleType: TypeAlias = tuple[Polygon, bool | None, LegendItemResponse | None]
    legend_id_key: Callable[[TupleType], str] = lambda x: x[2].legend_id
    it = (
        (
            Polygon(coordinates=fix_coordinates(e.px_geojson.coordinates)),
            e.validated,
            create_legend_item(e.legend_item),
        )
        for e in extractions
    )
    it = sorted(it, key=legend_id_key)
    it = itertools.groupby(it, key=legend_id_key)

    def generate_multipolygon(groups: Iterable[TupleType]):
        ps: list[Polygon]
        vs: list[bool | None]
        li: LegendItemResponse | None
        ps, vs, (li, *_) = zip(*groups)

        # Create a MultiPolygon from the polygons
        mp = MultiPolygon(coordinates=[p.coordinates for p in ps])

        # Get the name of the polygon
        name = "Unknown"
        if li is not None:
            name = li.abbreviation or li.label or name

        # Check if the polygon is validated
        is_validated = None
        if all(vs):
            is_validated = True
        if any(v == False for v in vs):
            is_validated = False

        # Check if there is a valid legend item for the polygon

        legend_item = None
        try:
            if li is None:
                raise ValueError("No legend item")

            legend_item = get_legend_items_from_system(cog_id, li.legend_id)
            # name = legend_item.name
        except (ValueError, HTTPException):
            pass

        # # Get a mean color for the polygon
        # color = None
        # try:
        #     req = MeanColorRequest(cog_id=cog_id, geometry=mp, layer_id="")
        #     color = mean_color(req).color
        # except HTTPException:
        #     pass

        return PolygonResponse(
            polygon=mp,
            name=name,
            is_validated=is_validated,
            legend_item=legend_item,
            #    color=color,
        )

    # This is parallelizable, and should be especially if the mean color is calculated
    # multipolygons = [generate_multipolygon(groups) for _, groups in it]
    # logging.info(f"Processed polygons for {cog_id} {system} {version}")
    # return multipolygons

    it = (generate_multipolygon(groups).model_dump_json() + "\n" for _, groups in it)
    return StreamingResponse(it, media_type="text/event-stream")


class UploadLayersRequestLayer(BaseModel):
    polygon: Polygon | MultiPolygon
    legend_id: str


class UploadLayersRequest(BaseModel):
    cog_id: str
    layers: list[UploadLayersRequestLayer]


@router.post("/upload_layers", status_code=HTTP_204_NO_CONTENT)
def upload_layers(req: UploadLayersRequest):
    """
    Upload the specified layers to the CDR
    """
    image = quick_cog(req.cog_id)
    height = image.shape[0]

    client = CDRClient(req.cog_id)

    latest_version = get_latest_version(req.cog_id, POLYMER)
    response = client.get_legend_items(POLYMER, latest_version)
    legend_items = [LegendItemResponse(**li) for li in response]
    legend_items = {li.legend_id: li for li in legend_items}

    polygon_legend_features: list[PolygonLegendAndFeaturesResult] = []
    for layer in req.layers:
        multipolygon = layer.polygon

        if isinstance(multipolygon, Polygon):
            multipolygon = MultiPolygon(coordinates=[multipolygon.coordinates])

        features: list[PolygonFeature] = []
        for polygon_coordinates in multipolygon.coordinates:
            coordinates = [[[x, height - y] for (x, y) in linear_rings] for linear_rings in polygon_coordinates]
            polygon = Polygon(coordinates=coordinates)
            polygon_id = hashlib.sha256(str(polygon).encode()).hexdigest()
            properties = PolygonProperties(
                model=POLYMER,
                model_version=latest_version,
                validated=True,
            )
            features.append(PolygonFeature(id=polygon_id, geometry=polygon, properties=properties))

        polygon_legend_features.append(
            PolygonLegendAndFeaturesResult(
                id=layer.legend_id,
                label=legend_items[layer.legend_id].label,
                abbreviation=legend_items[layer.legend_id].abbreviation,
                validated=True,
                polygon_features=PolygonFeatureCollection(features=features),
            )
        )

    client.publish_polygons(POLYMER, latest_version, polygon_legend_features)


class SegmentRequest(BaseModel):
    cog_id: str
    layer_id: str
    points: list[LabelPoint]


class SegmentResponse(BaseModel):
    geometry: MultiPolygon
    layer_id: str


@router.post("/labels")
async def segment(req: SegmentRequest) -> SegmentResponse:
    """
    Segments the contiguous region based on the provided points and labels
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(
                app_settings.segment_api_endpoint_url + "/segment/labels",
                json=req.model_dump(mode="json"),
            )
            resp.raise_for_status()
            geometry = resp.json().get("geometry", None)
            return SegmentResponse(geometry=geometry, layer_id=req.layer_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class LassoStartRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate
    layer_id: str
    crop_size: PositiveInt


class LassoStartResponse(BaseModel):
    layer_id: str


@router.post("/lasso-start")
async def lasso_start(req: LassoStartRequest) -> LassoStartResponse:
    """
    Start the lasso tool with the specified coordinate and buffer size
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(
                app_settings.segment_api_endpoint_url + "/segment/lasso-start",
                json=req.model_dump(mode="json"),
            )
            resp.raise_for_status()
            return LassoStartResponse(layer_id=req.layer_id)

    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class LassoStepRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate
    layer_id: str
    timestamp: float


class LassoStepResponse(BaseModel):
    geometry: LineString
    layer_id: str
    timestamp: float


@router.post("/lasso-step")
async def lasso_step(req: LassoStepRequest) -> LassoStepResponse:
    """
    Perform a step in the lasso tool with the specified coordinate, getting a new contour
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            # Timing for out-of-order requests debugging
            # if __import__("random").random() < 0.1:
            #     logger.info("Sleeping")
            #     await __import__("asyncio").sleep(0.5)

            resp = await client.post(
                app_settings.segment_api_endpoint_url + "/segment/lasso-step",
                json=req.model_dump(mode="json"),
            )
            resp.raise_for_status()
            geometry = resp.json().get("geometry", None)

            return LassoStepResponse(geometry=geometry, layer_id=req.layer_id, timestamp=req.timestamp)
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class MeanColorRequest(BaseModel):
    cog_id: str
    geometry: Polygon | MultiPolygon
    layer_id: str


class MeanColorResponse(BaseModel):
    color: Color
    layer_id: str


@router.post("/mean-color")
async def mean_color(req: MeanColorRequest) -> MeanColorResponse:
    """
    Get the mean color of the specified geometry
    """
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.post(
                app_settings.segment_api_endpoint_url + "/segment/mean-color",
                json=req.model_dump(mode="json"),
            )
            resp.raise_for_status()
            color = resp.json().get("color", None)

            return MeanColorResponse(color=color, layer_id=req.layer_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.headers.get("Content-Type") == "application/json":
            try:
                detail = exc.response.json().get("detail", "Unknown error")
            except ValueError:
                detail = "Unknown error (invalid JSON)"
        else:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class S3CogUrlResponse(BaseModel):
    url: str


@router.get("/s3-cog-url")
async def s3_cog_url(cog_id: str) -> S3CogUrlResponse:
    """
    Get the S3 URL of a given COG ID
    """

    url = f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}/{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

    return S3CogUrlResponse(url=url)
