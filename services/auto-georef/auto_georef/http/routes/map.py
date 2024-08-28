import copy
import logging
from enum import Enum
from logging import Logger
from typing import Any, List, Optional, Union

import httpx
import pyproj
from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.concurrency import run_in_threadpool
from PIL import Image
from pydantic import BaseModel, Field
from starlette.status import HTTP_200_OK

from auto_georef.common.generate_ids import generate_legend_id, generate_map_area_id
from auto_georef.common.map_utils import (
    clip_bbox_,
    clip_tiff_,
    cog_height,
    cog_height_not_in_memory,
    get_area_extractions,
    get_cdr_gcps,
    get_cog_meta,
    get_projections_from_cdr,
    get_projections_from_polymer,
    getMapUnit,
    inverse_bbox,
    inverse_geojson,
    ocr_bboxes,
    project_cog,
    query_gpt4,
    send_georef_to_cdr,
    send_new_legend_items_to_cdr,
)
from auto_georef.common.tiff_cache import get_cached_tiff
from auto_georef.es import (
    delete_by_id,
    document_exists,
    legend_by_cog_id_status,
    legend_categories_by_cog_id,
    polymer_system_cog_id,
    save_ES_data,
    search_by_cog_id,
    update_document_by_id,
)
from auto_georef.http.routes.cache import cache
from auto_georef.settings import app_settings

Image.MAX_IMAGE_PIXELS = None

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

router = APIRouter()

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


class Proj_Status(Enum):
    CREATED = "created"
    SUCCESS = "success"
    FAILED = "failed"
    VALIDATED = "validated"


########################### GETs ###########################
@router.get("/load_tiff_into_cache")
def load_tiff_into_cache(cog_id):
    with get_cached_tiff(cache, cog_id):
        logger.info(f"Loaded tiff in cache")

    return {"status": "Loaded image into disk cache", "cog_id": cog_id}


@router.get("/cog_in_cache")
def check_cog_in_cache(cog_id):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    if s3_key in list(cache.keys()):
        return True
    return False


@router.get("/clip-tiff")
def clip_tiff(cog_id: str, coll: int, rowb: int):
    try:
        resp = clip_tiff_(cache, rowb, coll, cog_id)
        return resp
    except Exception as e:
        logger.exception("Failed to clip image")
        return Response(content=str(e), media_type="text/plain", status_code=500)


@router.get("/clip-bbox")
def clip_bbox(cog_id: str, minx: int, miny: int, maxx: int, maxy: int):
    try:
        resp = clip_bbox_(cache, minx, miny, maxx, maxy, cog_id)
        return resp

    except Exception as e:
        logger.exception("Failed to clip image bbox")
        return Response(content=str(e), media_type="text/plain", status_code=500)


@router.get("/get_projection_name/{epsg_code}")
def get_projection_name(epsg_code: int):
    try:
        crs = pyproj.CRS.from_epsg(epsg_code)
        # Extracting the projection name
        projection_name = crs.name
        return {"projection_name": projection_name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/codes", status_code=HTTP_200_OK)
def codes():
    all_crs = pyproj.database.query_crs_info(
        auth_name="EPSG",
        area_of_interest=pyproj.aoi.AreaOfInterest(
            east_lon_degree=-66.885444,
            west_lon_degree=-124.848974,
            south_lat_degree=24.396308,
            north_lat_degree=49.384358,
        ),
    )

    return {"codes": [{"label": crs[0] + ":" + crs[1]} for crs in all_crs]}


@router.get("/downloads/{cog_id}")
def get_map_download_links(cog_id: str):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/projections/{cog_id}"
    s3_prefix = f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}"

    s3_download_products = f"{s3_prefix}/12/{cog_id}.zip"
    s3_download_cog = f"{s3_prefix}/cogs/{cog_id}.cog.tif"

    projections_response = None

    """
    mock start
    """
    # return {
    #     "cog": s3_download_cog,
    #     "projected": f"{s3_prefix}/12/{cog_id}.projected.cog.tif",
    #     "products": s3_download_products,
    # }
    """
    mock end
    """

    try:
        projections_response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status().json()
    except httpx.HTTPError as he:
        raise HTTPException(status_code=he.response.status_code, detail={"error": str(he)})

    if len(projections_response) > 0:
        if first_validated := next((prj for prj in projections_response if prj["status"] == "validated"), None):
            return {
                "cog": s3_download_cog,
                "projected": first_validated["download_url"],
                "products": s3_download_products,
            }

    raise HTTPException(status_code=404, detail={"error": "No downloads available because there are no validated projections."})


@router.get("/{cog_id}/legend_features_json")
def download_json(cog_id: str):
    legend_items = legend_by_cog_id_status(app_settings.polymer_legend_extractions, cog_id=cog_id, status="validated")
    return legend_items


@router.get("/{cog_id}/gcps", status_code=HTTP_200_OK)
async def cog_gcps(cog_id: str):
    cdr_gcps = await run_in_threadpool(get_cdr_gcps, cog_id)

    polymer_gcps = search_by_cog_id(app_settings.polymer_gcps_index, cog_id)

    return cdr_gcps + polymer_gcps


@router.get("/{cog_id}/proj_info", status_code=HTTP_200_OK)
async def cog_projs(cog_id: str):
    cdr_projections = await run_in_threadpool(get_projections_from_cdr, cog_id)

    polymer_projections = await run_in_threadpool(get_projections_from_polymer, cog_id)

    return cdr_projections + polymer_projections


@router.get("/{cog_id}/meta", status_code=HTTP_200_OK)
async def cog_info(cog_id: str):
    cog_meta = await run_in_threadpool(get_cog_meta, cog_id)
    return cog_meta


@router.get("/{cog_id}/area_extractions")
async def get_area_extraction(cog_id: str):
    map_areas = await get_area_extractions(cache, cog_id)
    return map_areas


def get_systems(cog_id, type):
    url = app_settings.cdr_endpoint_url + f"/v1/features/{cog_id}/system_versions?type={type}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data_ = response.json()
        for system in response_data_:
            response_data.append(f"{system[0]}_{system[1]}")

    if (
        app_settings.polymer_auto_georef_system + "_" + app_settings.polymer_auto_georef_system_version
    ) not in response_data:
        polymer_system = polymer_system_cog_id(app_settings.polymer_legend_extractions, cog_id=cog_id)
        if polymer_system:
            response_data.append(polymer_system)

    return response_data


@router.get("/{cog_id}/px_extraction_systems")
async def return_system_versions(cog_id: str):
    system_versions = await run_in_threadpool(get_systems, cog_id, "legend_item")
    return system_versions


def get_sgmc_ages():
    url = app_settings.cdr_endpoint_url + f"/v1/sgmc/sgmc_ages"
    response = httpx.get(url, headers=auth)
    names = []
    if response.status_code == 200:
        names = response.json()
    else:
        logger.error("Connection to CDR is down.")
    return names


@router.get("/sgmc/ages")
async def list_map_unit_name():
    names = await run_in_threadpool(get_sgmc_ages)

    return names


def return_polymer_legend_items(cog_id):
    height = cog_height(cache=cache, cog_id=cog_id)
    # legend swatches in polymer
    polymer_legend_items = search_by_cog_id(app_settings.polymer_legend_extractions, cog_id=cog_id)
    legend_ids_cached = []
    for legend in polymer_legend_items:
        legend_ids_cached.append(legend.get("legend_id", ""))
        legend["age_text"] = legend.get("age_text", "")
        legend["in_cdr"] = False

    # legend swatches in cdr
    url = app_settings.cdr_endpoint_url + f"/v1/features/{cog_id}/legend_items"
    response = httpx.get(url, headers=auth)
    cdr_legend_items = []
    if response.status_code == 200:
        cdr_legend_items = response.json()
        items_in_polymer_and_cdr = []
        for item in cdr_legend_items:
            if item.get("legend_id") not in legend_ids_cached:
                extent_from_bottom = []
                try:
                    if len(item.get("px_bbox")) > 0:
                        extent_from_bottom = [
                            item.get("px_bbox")[0],
                            height - item.get("px_bbox")[3],
                            item.get("px_bbox")[2],
                            height - item.get("px_bbox")[1],
                        ]
                except Exception:
                    pass
                polymer_legend_items.append(
                    {
                        "system": item.get("system"),
                        "system_version": item.get("system_version"),
                        "provenance": item.get("system") + "_" + item.get("system_version"),
                        "category": item.get("category"),
                        "abbreviation": item.get("abbreviation", ""),
                        "label": item.get("label", ""),
                        "coordinates_from_bottom": inverse_geojson(item.get("px_geojson"), height),
                        "color": item.get("color", ""),
                        "pattern": item.get("pattern", ""),
                        "descriptions": [],
                        "legend_id": item.get("legend_id"),
                        "status": "created",
                        "validated": item.get("validated", False),
                        "cog_id": item.get("cog_id"),
                        "polygon_features": [],
                        "map_unit_age_text": item.get("map_unit_age_text"),
                        "map_unit_lithology": item.get("map_unit_lithology"),
                        "map_unit_b_age": item.get("map_unit_b_age"),
                        "map_unit_t_age": item.get("map_unit_t_age"),
                        "reference_id": item.get("reference_id"),
                        "extent_from_bottom": extent_from_bottom,
                        "minimized": True,
                        "in_cdr": False,
                    }
                )
            else:
                items_in_polymer_and_cdr.append(item.get("legend_id"))

        # now if the same legend id is in cdr as well as polymer set in_cdr to true
        for legend in polymer_legend_items:
            if legend.get("legend_id") in items_in_polymer_and_cdr:
                legend["in_cdr"] = True
        return polymer_legend_items


@router.get("/{cog_id}/px_extractions")
def load_extractions(cog_id: str):
    polymer_legend_items = return_polymer_legend_items(cog_id)

    return {"legend_swatches": polymer_legend_items}


@router.get("/{cog_id}", status_code=HTTP_200_OK)
async def cog_all_info(cog_id: str):
    # get info from cdr

    meta = await cog_info(cog_id=cog_id)
    projections = await cog_projs(cog_id=cog_id)
    gcps = await cog_gcps(cog_id=cog_id)

    meta["height"] = cog_height_not_in_memory(cog_id)
    return {"cog_info": meta, "proj_info": projections, "all_gcps": gcps}


@router.get(
    "/search/random_cog",
    summary="Get cog info",
    description="Get cog info",
)
def cog_meta(
    georeferenced: bool = Query(default=False),
):
    url = app_settings.cdr_endpoint_url + "/v1/maps/cog/random?georeferenced=" + str(georeferenced)
    response = httpx.get(url, headers=auth)
    response_data = {}
    if response.status_code == 200:
        response_data = response.json()

    return response_data


########################### POSTs ###########################


class Area_Extraction(BaseModel):
    cog_id: str
    area_id: Optional[str]
    coordinates: Any
    coordinates_from_bottom: Any
    extent_from_bottom: List[Union[float, int]] = Field(
        default_factory=list,
        description="""The extracted bounding box of the area.
                    Format is expected to be [x1,y1,x2,y2] where the top left
                    is the origin (0,0).""",
    )
    text: str = Field(
        default="",
        description="""
            The text within the extraction area.
        """,
    )
    image_url: str = Field(
        default="",
        description="""
            Url
        """,
    )
    system: str
    system_version: str
    model: str
    model_version: str
    category: str
    confidence: Optional[float]
    status: str


class SaveAreaExtraction(BaseModel):
    cog_id: str
    cog_area_extractions: List[Area_Extraction]


@router.post("/save_area_extractions")
def post_area_extraction(request: SaveAreaExtraction):
    logger.info("Save area extraction")
    height = cog_height_not_in_memory(request.cog_id)

    for area_extraction in request.cog_area_extractions:
        if area_extraction.area_id is None:
            area_id = generate_map_area_id(request.cog_id, area_extraction.coordinates)
        else:
            area_id = area_extraction.area_id

        bbox = []
        if area_extraction.extent_from_bottom:
            bbox = [
                area_extraction.extent_from_bottom[0],
                height - area_extraction.extent_from_bottom[1],
                area_extraction.extent_from_bottom[2],
                height - area_extraction.extent_from_bottom[3],
            ]

        coords_from_bottom = copy.deepcopy(area_extraction.coordinates_from_bottom)

        save_ES_data(
            app_settings.polymer_area_extractions,
            id=area_id,
            info={
                "cog_id": request.cog_id,
                "area_id": area_id,
                "coordinates": inverse_geojson(area_extraction.coordinates_from_bottom, height),
                "coordinates_from_bottom": coords_from_bottom,
                "bbox": bbox,
                "extent_from_bottom": area_extraction.extent_from_bottom,
                "text": area_extraction.text,
                "system": area_extraction.system,
                "system_version": area_extraction.system_version,
                "model": area_extraction.model,
                "model_version": area_extraction.model_version,
                # map_area, legend_area, ...
                "category": area_extraction.category,
                "confidence": area_extraction.confidence,
                "status": area_extraction.status,
            },
        )
    return


@router.post("/send_to_cdr", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def send_validated_legend_items_to_cdr(cog_id: str = Query(default=None)):
    logger.info("Send to cdr")
    # build result
    height = cog_height_not_in_memory(cog_id=cog_id)
    legend_polygon_swatchs_items = legend_categories_by_cog_id(
        app_settings.polymer_legend_extractions, cog_id=cog_id, category="polygon"
    )
    legend_line_swatchs_items = legend_categories_by_cog_id(
        app_settings.polymer_legend_extractions, cog_id=cog_id, category="line"
    )
    legend_point_swatchs_items = legend_categories_by_cog_id(
        app_settings.polymer_legend_extractions, cog_id=cog_id, category="point"
    )
    feature_results = {
        "system": app_settings.polymer_auto_georef_system,
        "system_version": app_settings.polymer_auto_georef_system_version,
        "cog_id": cog_id,
        "polygon_feature_results": [],
        "line_feature_results": [],
        "point_feature_results": [],
        "cog_area_extractions": [],
        "cog_metadata_extractions": [],
    }

    for poly in legend_polygon_swatchs_items:
        poly_geom = validateCoords(poly["coordinates"].get("coordinates", []))
        add_poly = {
            "id": poly.get("legend_id"),
            "legend_provenance": {"model": "", "model_version": ""},
            "label": poly.get("label", ""),
            "abbreviation": poly.get("abbreviation", ""),
            "description": " ".join([desc.get("text", "") for desc in poly.get("descriptions", [])]),
            "legend_bbox": inverse_bbox(poly.get("extent_from_bottom"), height),
            "legend_contour": poly_geom,
            "color": poly.get("color", ""),
            "pattern": poly.get("pattern", ""),
            "map_unit": getMapUnit(poly.get("age_text", "")),
            "polygon_features": {},
            "reference_id": poly.get("reference_id", ""),
            "validated": True,
        }
        feature_results["polygon_feature_results"].append(add_poly)

    for line in legend_line_swatchs_items:
        line_geom = validateCoords(line["coordinates"].get("coordinates", []))
        add_line = {
            "id": line.get("legend_id"),
            "legend_provenance": {"model": "", "model_version": ""},
            "name": line.get("label", ""),
            "abbreviation": line.get("abbreviation", ""),
            "description": " ".join([desc.get("text", "") for desc in line.get("descriptions", [])]),
            "legend_bbox": inverse_bbox(line.get("extent_from_bottom"), height),
            "legend_contour": line_geom,
            "line_features": {},
            "reference_id": line.get("reference_id", ""),
            "validated": True,
        }
        feature_results["line_feature_results"].append(add_line)

    for point in legend_point_swatchs_items:
        point_geom = validateCoords(point["coordinates"].get("coordinates", []))
        add_point = {
            "id": point.get("legend_id"),
            "legend_provenance": {"model": "", "model_version": ""},
            "name": point.get("label", ""),
            "abbreviation": point.get("abbreviation", ""),
            "description": " ".join([desc.get("text", "") for desc in point.get("descriptions", [])]),
            "legend_bbox": inverse_bbox(point.get("extent_from_bottom"), height),
            "legend_contour": point_geom,
            "point_features": {},
            "reference_id": point.get("reference_id", ""),
            "validated": True,
        }
        feature_results["point_feature_results"].append(add_point)

    await send_new_legend_items_to_cdr(feature_results)
    logger.info("Finished sending legend items to cdr")


class SaveSwatch(BaseModel):
    cog_id: str
    legend_swatch: Any


def validateCoords(coords):
    geom = []
    if len(coords) > 0:
        geom = coords[0]
    return geom


def save_swatch_feature(request_dict):
    logger.info("Save swatch feature")
    cog_id = request_dict["cog_id"]

    height = cog_height_not_in_memory(cog_id)

    legend_swatch = request_dict["legend_swatch"]
    coords_from_bottom = copy.deepcopy(legend_swatch["coordinates_from_bottom"])

    legend_swatch["coordinates"] = inverse_geojson(legend_swatch["coordinates_from_bottom"], height)
    legend_swatch["coordinates_from_bottom"] = coords_from_bottom

    for child in legend_swatch["descriptions"]:
        coords_from_bottom = copy.deepcopy(child["coordinates_from_bottom"])
        if coords_from_bottom:
            child["coordinates"] = inverse_geojson(child["coordinates_from_bottom"], height)
            child["coordinates_from_bottom"] = coords_from_bottom

    geom = validateCoords(legend_swatch["coordinates"].get("coordinates", []))
    # build the legend_id on save
    legend_id = generate_legend_id(
        cog_id=cog_id,
        system=app_settings.polymer_auto_georef_system,
        system_version=app_settings.polymer_auto_georef_system_version,
        geometry=geom,
        label=legend_swatch["label"].replace(" ", ""),
    )
    # always update system and version to polymer if saving
    legend_swatch["system"] = app_settings.polymer_auto_georef_system
    legend_swatch["system_version"] = app_settings.polymer_auto_georef_system_version
    legend_swatch["provenance"] = legend_swatch["system"] + "_" + legend_swatch["system_version"]

    # check if new id exists
    if document_exists(app_settings.polymer_legend_extractions, legend_id):
        # if old id exists and it is not the same as the old id we can remove the old
        if (
            document_exists(app_settings.polymer_legend_extractions, legend_swatch["legend_id"])
            and legend_id != legend_swatch["legend_id"]
        ):
            delete_by_id(
                index=app_settings.polymer_legend_extractions,
                id=legend_swatch["legend_id"],
            )
        # update legend_item
        update_document_by_id(
            app_settings.polymer_legend_extractions,
            doc_id=legend_id,
            updates=legend_swatch,
        )
        return legend_swatch

    # check if old id exists and delete it
    if document_exists(app_settings.polymer_legend_extractions, legend_swatch["legend_id"]):
        delete_by_id(
            index=app_settings.polymer_legend_extractions,
            id=legend_swatch["legend_id"],
        )

    # old id doesn't exist and new id doesn't exist
    # save new item
    if legend_swatch.get("reference_id", "") == "":
        legend_swatch["reference_id"] = legend_swatch["legend_id"]

    legend_swatch["legend_id"] = legend_id
    save_ES_data(index=app_settings.polymer_legend_extractions, info=legend_swatch, id=legend_id)

    return legend_swatch


@router.post(
    "/save_legend_swatch",
)
async def save_features(request: SaveSwatch):
    logger.info("save legend swatch")
    request_dict = request.model_dump()
    legend_swatch = await run_in_threadpool(save_swatch_feature, request_dict)
    return legend_swatch


def get_random_cog_meta_from_cdr(georeferenced):
    url = app_settings.cdr_endpoint_url + "/v1/maps/cog/random?georeferenced=" + str(georeferenced)
    response = httpx.get(url, headers=auth)
    response_data = {}
    if response.status_code == 200:
        response_data = response.json()

    return response_data


@router.get(
    "/search/random_cog",
    summary="Get cog info",
    description="Get cog info",
)
async def cog_meta(
    georeferenced: bool = Query(default=False),
):
    response_data = await run_in_threadpool(get_random_cog_meta_from_cdr, georeferenced)
    return response_data


class MultiPolygon(BaseModel):
    """
    Individual polygon segmentation of a polygon feature.
    """

    coordinates: List[List[List[List[Union[float, int]]]]] = Field(
        description="""The coordinates of the multipolygon. Projection is expected to
                    be in EPSG:4326."""
    )
    type: str = "MultiPolygon"


class CogsSearch(BaseModel):
    georeferenced: bool = Field(default=True, description="Indicates if the items must be georeferenced")
    validated: bool = Field(default=True, description="Indicates if the items must be validated")
    min_lat: int = Field(
        default=None,
        ge=-90,
        le=90,
        description="Minimum latitude, only used if other bounding box info is provided",
    )
    max_lat: int = Field(
        default=None,
        ge=-90,
        le=90,
        description="Maximum latitude, only used if other bounding box info is provided",
    )
    min_lon: int = Field(
        default=None,
        ge=-180,
        le=180,
        description="Minimum longitude, only used if other bounding box info is provided",
    )
    max_lon: int = Field(
        default=None,
        ge=-180,
        le=180,
        description="Maximum longitude, only used if other bounding box info is provided",
    )
    scale_min: Optional[int] = Field(default=None, description="Minimum scale")
    scale_max: Optional[int] = Field(default=None, description="Maximum scale")
    search_text: str = Field(default="", description="Text to search for")
    publish_year_min: Optional[int] = Field(default=None, description="Minimum publish year")
    publish_year_max: Optional[int] = Field(default=None, description="Maximum publish year")
    page: int = Field(default=0, ge=0, description="Page number for pagination")
    size: int = Field(default=10, ge=0, description="Number of items per page")
    sgmc_geology_major_1: Optional[List] = Field(default=None, description="Filter by major geology category")
    multi_polygons_intersect: Optional[MultiPolygon] = Field(
        default=None, description="List of valid geojson polygons"
    )


def send_search_to_cdr():
    url = app_settings.cdr_endpoint_url + "/v1/maps/search/cogs"
    data = {
        "georeferenced": False,
        "validated": False,
        "min_lat": None,
        "max_lat": None,
        "min_lon": None,
        "max_lon": None,
        "scale_min": 0,
        "scale_max": None,
        "search_text": "",
        "publish_year_min": 0,
        "publish_year_max": None,
        "page": 0,
        "size": 10,
        "sgmc_geology_major_1": [],
        "multi_polygons_intersect": None,
    }
    response = httpx.post(url, json=data)
    if response.status_code == 200:
        response_data = response.json()
        return response_data
    return []


@router.post("/search/maps_in_bbox")
async def search_maps_in_box(query: CogsSearch):
    logger.info("search maps_in_bbox")
    # todo update for landing page
    response_data = await run_in_threadpool(send_search_to_cdr, query)

    return {"maps": response_data, "total_hits": len(response_data)}


class SaveProjInfo(BaseModel):
    cog_id: str
    projection_id: str
    status: Proj_Status


@router.post("/proj_update", status_code=HTTP_200_OK)
async def save_proj_info(req: SaveProjInfo):
    req.cog_id
    proj_id = req.projection_id
    status = req.status
    # es check if id exists
    if document_exists(app_settings.polymer_projections_index, proj_id):
        update_document_by_id(
            index_name=app_settings.polymer_projections_index,
            doc_id=proj_id,
            updates={"status": status.value},
        )
        if status.value == "validated":
            #  send as georef result to cdr
            await send_georef_to_cdr(proj_id)
            response_data = {"status": "validated"}

    else:
        #  just update the status in the cdr.
        url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/projection/{proj_id}"
        data = {"status": status.value}
        response = httpx.put(url, json=data, headers=auth)
        if response.status_code == 200:
            response_data = response.json()
            return {"message": "projection updated", "projection": response_data["projection"]}
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"projection not updated in cdr")


class SaveCogInfo(BaseModel):
    cog_id: str
    no_map: bool


@router.post("/update_cog_meta", status_code=HTTP_200_OK)
async def save_cog_info(req: SaveCogInfo):
    #  just update the status in the cdr.
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/update/meta/{req.cog_id}"
    data = {"no_map": req.no_map}
    response = httpx.put(url, json=data, headers=auth)
    if response.status_code == 200:
        response_data = response.json()
        return {"message": "Cog metadata updated", "meta": response_data}
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{req.cog_id} item not updated")


class GCP(BaseModel):
    gcp_id: str
    rows_from_top: float
    columns_from_left: float
    longitude: Optional[float]
    latitude: Optional[float]
    crs: str
    system: str
    system_version: str
    reference_id: str = Field(default=None)
    registration_id: str = Field(default="")
    cog_id: str
    confidence: Optional[Union[float, int]] = Field(default=None)
    model_id: str = Field(default="")
    model_version: str = Field(default="")
    model: str = Field(default="")


class ProjectCogRequest(BaseModel):
    cog_id: str
    crs: Optional[str]
    gcps: List[GCP]


@router.post("/cdr/fire/{cog_id}")
async def cdr_fire_map(cog_id: str):
    url = f"{app_settings.cdr_endpoint_url}/v1/maps/fire/{cog_id}"
    response = httpx.post(url, headers=auth)
    if response.status_code == 200:
        return response.json()


@router.post("/project")
async def project(req: ProjectCogRequest):
    proj_info = await run_in_threadpool(project_cog, cache, req)
    return proj_info


class OCRRequest(BaseModel):
    cog_id: str
    bboxes: Optional[list]


@router.post("/tif_ocr")
async def ocr(req: OCRRequest):
    extraction_data = await run_in_threadpool(ocr_bboxes, req)
    return extraction_data


class PromptRequest(BaseModel):
    prompt: str


@router.post("/send_prompt")
def send_prompt(req: PromptRequest):
    return query_gpt4(req.prompt)


class DeleteExtraction(BaseModel):
    id: str


@router.delete(
    "/delete_area_extractions",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_area_extraction(request: DeleteExtraction):
    delete_by_id(index=app_settings.polymer_area_extractions, id=request.id)
    return
