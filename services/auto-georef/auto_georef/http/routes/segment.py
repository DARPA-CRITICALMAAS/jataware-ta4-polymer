import hashlib
import itertools
import logging
import operator
from logging import Logger
from typing import Any, Callable, Iterable, Literal, TypeAlias

import cv2
import numpy as np
from cdr_schemas.cdr_responses.legend_items import LegendItemResponse
from cdr_schemas.features.polygon_features import (
    Polygon,
    PolygonFeature,
    PolygonFeatureCollection,
    PolygonLegendAndFeaturesResult,
    PolygonProperties,
)
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, PositiveInt, field_validator
from rasterio.features import rasterize
from rasterio.features import shapes as rio_shapes
from starlette.status import HTTP_204_NO_CONTENT

from auto_georef.common.segment_utils import CDRClient, LassoTool, SegmentFloodFill, ToolCache, quick_cog, rgb_to_hsl
from auto_georef.common.tiff_cache import get_cached_tiff
from auto_georef.common.utils import timeit
from auto_georef.http.routes.cache import cache
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
    return ToolCache(cog_id).segment is not None


@router.get("/lasso_in_cache")
def check_lasso_in_cache(cog_id):
    return ToolCache(cog_id).lasso is not None


@router.post("/embeddings_to_s3")
def create_send_embeds(background_tasks: BackgroundTasks, cog_id: str, overwrite: bool = False):
    """
    Create embeddings and send to S3
    """

    def save_embeds(segment: SegmentFloodFill):
        segment.upload_embeds(overwrite)
        ToolCache(cog_id).segment = segment

    try:
        with get_cached_tiff(cache, cog_id):
            logger.info(f"Loaded tiff in cache")
        segment = SegmentFloodFill(cog_id)

        # Save embeddings in the background
        background_tasks.add_task(save_embeds, segment)

        # Estimate time to completion
        millis_per_embed = app_settings.time_per_embedding
        time = len(segment.tiles) * millis_per_embed / 1000 / 60
        return {"time": time}
    except SegmentFloodFill.ModelWeightsNotFoundError:
        message = "Failed to load model weights"
        logger.exception(message)
        raise HTTPException(500, message)


@router.post("/load_segment", status_code=HTTP_204_NO_CONTENT)
def load_segment(cog_id: str):
    """
    Load the segment for the specified `cog_id`
    """
    try:
        with get_cached_tiff(cache, cog_id):
            logger.info(f"Loaded tiff in cache")
        segment = SegmentFloodFill(cog_id)
        segment.load_embeds()
        ToolCache(cog_id).segment = segment
    except SegmentFloodFill.EmbeddingsNotFoundError:
        message = f"Failed to load embeddings for {cog_id}"
        logger.exception(message)
        raise HTTPException(400, message)
    except SegmentFloodFill.ModelWeightsNotFoundError:
        message = "Failed to load model weights"
        logger.exception(message)
        raise HTTPException(500, message)


@router.post("/load_lasso", status_code=HTTP_204_NO_CONTENT)
def load_lasso(cog_id: str):
    """
    Load the lasso tool for the specified `cog_id`
    """
    with get_cached_tiff(cache, cog_id):
        logger.info(f"Loaded tiff in cache")
    ToolCache(cog_id).lasso = LassoTool(cog_id)


@router.get("/systems")
def get_systems(cog_id: str, type: str = "polygon"):
    """
    Get the systems and versions for the specified `cog_id` and `type`
    """
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


class SelectLegendItemPointRequest(BaseModel):
    cog_id: str
    point: PixelCoordinate


@router.post("/select_legend_item_point")
def select_legend_item_point(req: SelectLegendItemPointRequest):
    """
    Select a legend item based on a point.
    """

    legend_items = get_legend_items(req.cog_id)
    px, py = req.point

    for li in legend_items:
        x1, y1, x2, y2 = li.bbox
        if x1 <= px <= x2 and y1 <= py <= y2:
            return li

    raise HTTPException(400, "No legend item found for the specified point")


class SelectLegendItemBBoxRequest(BaseModel):
    cog_id: str
    bbox: list[float | int]

    @field_validator("bbox")
    def validate_bbox(cls, value):
        if len(value) != 4:
            raise ValueError("Bounding box must have 4 elements")
        return value


@router.post("/select_legend_item_bbox")
def select_legend_item_bbox(req: SelectLegendItemBBoxRequest):
    """
    Select a legend item based on a point.
    """

    legend_items = get_legend_items(req.cog_id)
    x1, y1, x2, y2 = req.bbox

    max_iou = 0.0
    max_legend_item = None

    for li in legend_items:
        li_x1, li_y1, li_x2, li_y2 = li.bbox
        intersection_area = max(0, min(x2, li_x2) - max(x1, li_x1)) * max(0, min(y2, li_y2) - max(y1, li_y1))
        bbox_area = (x2 - x1) * (y2 - y1)
        li_bbox_area = (li_x2 - li_x1) * (li_y2 - li_y1)
        union_area = bbox_area + li_bbox_area - intersection_area
        iou = intersection_area / union_area

        if iou > max_iou:
            max_iou = iou
            max_legend_item = li

    if max_legend_item is not None:
        return max_legend_item

    raise HTTPException(400, "No legend item found for the specified bounding box")


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
            if len(li.px_bbox) != 4:
                raise ValueError("Invalid bounding box")

            x1, y1, x2, y2 = li.px_bbox
            bbox = [x1, height - y2, x2, height - y1]
            req = SelectLegendItemBBoxRequest(cog_id=cog_id, bbox=bbox)
            legend_item = select_legend_item_bbox(req)
            name = legend_item.name
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
def segment(req: SegmentRequest) -> SegmentResponse:
    """
    Segments the contiguous region based on the provided points and labels
    """

    segment = ToolCache(req.cog_id).segment
    if segment is None:
        raise HTTPException(400, "Segment not loaded in cache")

    points, labels = [], []
    for p in req.points:
        col_left, row_bottom = p.coordinate
        points.append([segment.nrow - row_bottom, col_left])
        labels.append({"positive": 1, "negative": 0}[p.type])

    # Filter out points outside image extent bounds
    filtered_points = []
    filtered_labs = []
    for point, lab in zip(points, labels):
        row, col = point
        if 0 <= row < segment.nrow and 0 <= col < segment.ncol:
            filtered_points.append(point)
            filtered_labs.append(lab)

    points = filtered_points
    labels = filtered_labs

    if len(labels) != len(points):
        raise HTTPException(500, "Points could not be filtered")

    if sum(labels) == 0:
        raise HTTPException(400, "Must include at least one valid positive label")

    _, mask_out = segment.flood_fill(points, labels)

    k = np.ones((2, 2), np.uint8)
    mask_out = cv2.morphologyEx(mask_out, cv2.MORPH_OPEN, k, iterations=3)

    contours, _ = cv2.findContours(mask_out.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        if cv2.contourArea(cnt) < 50:  # Adjust the area threshold as needed
            cv2.drawContours(mask_out, [cnt], -1, 0, -1)
    shapes = rio_shapes(mask_out.astype(np.int16), mask=None, connectivity=4)

    coordinates = []
    for shape, value in shapes:
        if value == 1:
            coords = []
            for cc in shape["coordinates"]:
                coords.append([[c[0], segment.nrow - c[1]] for c in cc])
            coordinates.append(coords)

    return SegmentResponse(geometry={"type": "MultiPolygon", "coordinates": coordinates}, layer_id=req.layer_id)


class LassoStartRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate
    layer_id: str
    crop_size: PositiveInt


class LassoStartResponse(BaseModel):
    layer_id: str


@router.post("/lasso-start")
def lasso_start(req: LassoStartRequest) -> LassoStartResponse:
    """
    Start the lasso tool with the specified coordinate and buffer size
    """

    lasso_tool = ToolCache(req.cog_id).lasso
    if lasso_tool is None:
        raise HTTPException(400, "Lasso tool not loaded in cache")

    lasso_tool.start_coordinate = lasso_tool.convert_coordinate(req.coordinate)
    lasso_tool.crop_size = req.crop_size

    lasso_tool.apply_image()
    lasso_tool.build_map()

    return LassoStartResponse(layer_id=req.layer_id)


class LassoStepRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate
    layer_id: str


class LassoStepResponse(BaseModel):
    geometry: LineString
    layer_id: str


@router.post("/lasso-step")
def lasso_step(req: LassoStepRequest) -> LassoStepResponse:
    """
    Perform a step in the lasso tool with the specified coordinate, getting a new contour
    """

    lasso_tool = ToolCache(req.cog_id).lasso
    if lasso_tool is None:
        raise HTTPException(400, "Lasso tool not loaded in cache")

    coordinate = req.coordinate
    coordinate = lasso_tool.convert_crop_coordinate(coordinate, interpolate=True)
    contour = lasso_tool.get_contour(coordinate)

    if contour is None:
        raise HTTPException(400, f"No contour found for {req.coordinate} (cropped: {coordinate})")

    # Convert contour to coordinates in the original image space
    contour = lasso_tool.convert_contour(contour)
    coordinates = contour.tolist()
    geometry = {"type": "LineString", "coordinates": coordinates}

    return LassoStepResponse(geometry=geometry, layer_id=req.layer_id)


class MeanColorRequest(BaseModel):
    cog_id: str
    geometry: Polygon | MultiPolygon
    layer_id: str


class MeanColorResponse(BaseModel):
    color: Color
    layer_id: str


@router.post("/mean-color")
def mean_color(req: MeanColorRequest) -> MeanColorResponse:
    """
    Get the mean color of the specified geometry
    """

    image = quick_cog(req.cog_id)

    try:
        result = rasterize([req.geometry.model_dump()], out_shape=image.shape[:2])
    except ValueError:
        raise HTTPException(400, "Invalid geometry")

    result = np.flipud(result)
    mask = image * np.expand_dims(result, -1)

    # Resize the masked image to a smaller size for faster processing
    scale = 0.25
    mask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    result = cv2.resize(result, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    # skip = 10
    # mask = mask[::skip, ::skip, :]
    # result = result[::skip, ::skip]

    color = np.sum(mask, axis=(0, 1)) / np.sum(result)
    color = color.astype(int).tolist()
    color = rgb_to_hsl(color)

    return MeanColorResponse(color=color, layer_id=req.layer_id)
