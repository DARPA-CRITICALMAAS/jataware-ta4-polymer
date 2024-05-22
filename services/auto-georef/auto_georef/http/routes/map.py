import copy
import glob
import json
import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from enum import Enum
from io import BytesIO
from logging import Logger
from pathlib import Path
from time import perf_counter
from typing import Any, List, Optional, Union
from fastapi.concurrency import run_in_threadpool


import httpx
import pyproj
import pytesseract
from cachetools import TTLCache
from fastapi import APIRouter, Form, HTTPException, Query, Response, UploadFile, status
from PIL import Image
from pydantic import BaseModel, Field
from shapely import Polygon
from starlette.status import HTTP_200_OK

from auto_georef.common.generate_ids import generate_legend_id, generate_map_area_id
from auto_georef.common.map_utils import (
    cps_to_transform,
    inverse_geojson,
    project_,
    query_gpt4,
    send_feature_results_to_cdr,
    send_georef_to_cdr,
)
from auto_georef.common.utils import download_file, load_tiff_cache, s3_client, time_since, upload_s3_file
from auto_georef.es import (
    cdr_GCP_by_id,
    delete_by_id,
    document_exists,
    es_bulk_process_actions,
    legend_by_cog_id_status,
    legend_categories_by_cog_id,
    save_ES_data,
    search_by_cog_id,
    update_document_by_id,
    update_GCPs,
)
from auto_georef.settings import app_settings

cache = TTLCache(maxsize=2, ttl=500)
downloaded_features_cache = TTLCache(maxsize=50, ttl=2000)


Image.MAX_IMAGE_PIXELS = None

cache = TTLCache(maxsize=2, ttl=500)

Image.MAX_IMAGE_PIXELS = None

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)


router = APIRouter()

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


class OCRRequest(BaseModel):
    cog_id: str
    bboxes: Optional[list]


class GCP(BaseModel):
    gcp_id: str
    rows_from_top: float
    columns_from_left: float
    longitude: Optional[float]
    latitude: Optional[float]
    crs: str
    system: str
    system_version: str
    reference_id: str = Field(
        default=None,
        description="""
            Reference id
        """,
    )
    registration_id: str = Field(
        default="",
        description="""
            Registration id
        """,
    )
    cog_id: str
    confidence: Optional[Union[float, int]] = Field(
        default=None,
        description="""
            Confidence
        """,
    )
    model_id: str = Field(
        default="",
        description="""
            Model id
        """,
    )
    model_version: str = Field(
        default="",
        description="""
            Model version
        """,
    )
    model: str = Field(
        default="",
        description="""
           Model name"
        """,
    )


class ProjectCogRequest(BaseModel):
    cog_id: str
    crs: Optional[str]
    gcps: List[GCP]


class ProjectVectorRequest(BaseModel):
    feature: Any
    projection_id: str
    crs: Optional[str]


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
        default=None, ge=-90, le=90, description="Minimum latitude, only used if other bounding box info is provided"
    )
    max_lat: int = Field(
        default=None, ge=-90, le=90, description="Maximum latitude, only used if other bounding box info is provided"
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


class Feature(BaseModel):
    map_id: str
    parent_id: Optional[str]
    feature_id: str
    image_url: Optional[str]
    extent_from_bottom: Optional[List[float]]
    points_from_top: Optional[List[List[float]]]
    geom_pixel_from_bottom: dict
    text: Optional[str]
    provenance: str
    model: Optional[str]
    model_version: Optional[str]
    category: str  # legend_swatch, legend_description, legend_area,
    confidence: Optional[float]
    status: str
    notes: str


class Area_Extraction(BaseModel):
    cog_id: str
    area_id: Optional[str]
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


class DeleteExtraction(BaseModel):
    id: str


# class SaveUpdateFeatures(BaseModel):
#     map_id: str
#     features: List[Area_Extraction]


class Area_Extraction(BaseModel):
    cog_id: str
    area_id: Optional[str]
    coordinates: Any
    bbox: List[Union[float, int]]
    text: Optional[str]
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


class DeleteExtraction(BaseModel):
    id: str


class Proj_Status(Enum):
    CREATED = "created"
    SUCCESS = "success"
    FAILED = "failed"
    VALIDATED = "validated"


class SaveProjInfo(BaseModel):
    cog_id: str
    projection_id: str
    status: Proj_Status


class UpdateCogInfo(BaseModel):
    cog_id: str
    key: str
    value: Any


class PromptRequest(BaseModel):
    prompt: str


class SearchMapsReq(BaseModel):
    query: str
    page: int = 1
    size: int = 10
    georeferenced: bool = False
    validated: bool = False
    not_a_map: bool = False
    random: bool = False


class MapsLookup(BaseModel):
    map_publication_id: str
    map_item_id: Optional[str] = None
    return_all: Optional[bool] = False


class MapsFind(BaseModel):
    map_publication_id: str
    publisher: str


########################### GETs ###########################


@router.get("/clip-tiff")
async def clip_tiff(cog_id: str, coll: int, rowb: int):
    try:
        size = 225
        s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

        img = await load_tiff_cache(cache, s3_key)

        y = img.height - rowb

        box = (coll - (size / 2), y - (size / 2), coll + (size / 2), y + (size / 2))
        clipped_img = img.crop(box)
        if clipped_img.mode != "RGB":
            clipped_img = clipped_img.convert("RGB")

        # Center of a 200x200 image
        center_x, center_y = int(size / 2), int(size / 2)

        for i in range(center_y - 5, center_y + 5):
            for j in range(center_x - 5, center_x + 5):
                try:
                    clipped_img.putpixel((j, i), (255, 0, 0))  # Red
                except Exception as e:
                    logging.error(e)

        img_byte_arr = BytesIO()
        clipped_img.save(img_byte_arr, format="PNG")
        img_byte_arr = img_byte_arr.getvalue()

        return Response(content=img_byte_arr, media_type="image/png")
    except Exception as e:
        logging.error(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clip-bbox")
async def clip_bbox(cog_id: str, minx: int, miny: int, maxx: int, maxy: int):
    try:
        s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

        img = await load_tiff_cache(cache, s3_key)

        box = (minx, img.height - maxy, maxx, img.height - miny)

        clipped_img = img.crop(box)
        if clipped_img.mode != "RGB":
            clipped_img = clipped_img.convert("RGB")

        img_byte_arr = BytesIO()
        clipped_img.save(img_byte_arr, format="PNG")
        img_byte_arr = img_byte_arr.getvalue()

        return Response(content=img_byte_arr, media_type="image/png")
    except Exception:
        logging.exception("Error when clipping bbox")
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/maps_stats", status_code=HTTP_200_OK)
def map_stats_():
    # Hit cdr for this todo needs a bit more testing.
    # if "stats" in stats_cache:
    #     return stats_cache['stats']
    return {"validated": 1, "georeferenced": 2, "not_georeferenced": 10, "not_a_map": 2}


@router.get("/{cog_id}/legend_features_json")
async def download_json(cog_id: str):
    legend_items = legend_by_cog_id_status(app_settings.polymer_legend_extractions, cog_id=cog_id, status="validated")
    return legend_items


@router.get("/{cog_id}/gcps", status_code=HTTP_200_OK)
def cog_gcps(cog_id: str):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/gcps/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data = response.json()
        if response_data is None:
            response_data = []

    polymer_gcps = search_by_cog_id(app_settings.polymer_gcps_index, cog_id)

    return response_data + polymer_gcps


def add_gcps_to_projections(cog_id, polymer_projections):
    projections = []
    for projection in polymer_projections:
        projection["gcps"] = []
        for gcp_id in projection.get("gcps_ids"):
            projection["gcps"].append(cdr_GCP_by_id(cog_id, gcp_id))
        projections.append(projection)

    return projections


@router.get("/{cog_id}/proj_info", status_code=HTTP_200_OK)
def cog_projs(cog_id: str):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/projections/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data = response.json()

        if response_data is None:
            response_data = []
        for response in response_data:
            response["in_cdr"] = True

    polymer_projections = search_by_cog_id(app_settings.polymer_projections_index, cog_id)
    polymer_projections = add_gcps_to_projections(cog_id, polymer_projections)
    for proj in polymer_projections:
        proj["in_cdr"] = False

    return response_data + polymer_projections


@router.get("/{cog_id}/meta", status_code=HTTP_200_OK)
async def cog_info(cog_id: str):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/meta/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = {"cog_id": cog_id}
    if response.status_code == 200:
        response_data = response.json()
    if response_data is None:
        logging.error(response.text)
        return {}

    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    img = await load_tiff_cache(cache, s3_key)
    response_data["height"] = img.height
    response_data["width"] = img.width
    return response_data


@router.get("/{cog_id}/area_extractions")
async def get_area_extraction(cog_id: str):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    img = await load_tiff_cache(cache, s3_key)
    height = img.height
    map_areas = search_by_cog_id(app_settings.polymer_area_extractions, cog_id=cog_id)
    for area in map_areas:
        area["coordinates_from_bottom"] = inverse_geojson(area.get("coordinates"), height)
        area["extent_from_bottom"] = [
            area["bbox"][0],
            height - area["bbox"][1],
            area["bbox"][2],
            height - area["bbox"][3],
        ]

    return map_areas


def unzip_file(zip_file_path, extract_to):
    try:
        # Open the zip file
        with zipfile.ZipFile(zip_file_path, "r") as zip_ref:
            # Extract all contents to the specified directory
            zip_ref.extractall(extract_to)
        print(f"File '{zip_file_path}' successfully extracted to '{extract_to}'.")
    except Exception as e:
        print(f"Error extracting file '{zip_file_path}': {e}")


@router.get("/{cog_id}/load_cdr_legend_px_extractions")
async def load_px_extraction(cog_id: str, reload: bool = Query(default=False)):
    Path("/home/apps/auto-georef/auto_georef/px_results/").mkdir(parents=True, exist_ok=True)
    if cog_id in downloaded_features_cache and reload == False:
        logging.info("Using extraction from cache")
    else:
        logging.info("Downloading extractions from cdr")
        folder_path = f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}"
        if os.path.exists(folder_path) == True:
            shutil.rmtree(folder_path)
        s3_key = f"{app_settings.cdr_s3_px_extractions_prefix}/{cog_id}.zip"
        local_file_path = f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}.zip"
        await run_in_threadpool(lambda: download_file(s3_key=s3_key, local_file_path=local_file_path))
        unzip_file(local_file_path, f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}")
        downloaded_features_cache[cog_id] = True


@router.get("/{cog_id}/px_extraction_systems")
async def load_extractions(cog_id: str, category="legend"):
    directory = f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}/original_pixel_space"

    # Define a regular expression pattern to extract information from filenames

    # Loop through files in the directory
    system_list = []
    for filename in glob.glob(f"{directory}/*.geojson"):
        basename = os.path.basename(filename)
        if category == "legend":
            if "_legend_contour" in filename:
                split_ = basename.split("__")
                system = split_[0]
                system_version = split_[1]
                if system + "_" + system_version not in system_list:
                    system_list.append(system + "_" + system_version)

    return system_list


@router.get("/macrostrat/map_units")
def list_map_unit_name():
    response = httpx.get("https://macrostrat.org/api/v2/defs/intervals?all") 
    names=[]
    if response.status_code == 200:
        names = [x['name'] for x in response.json()['success']['data']]
    else:
        logging.error("Connection to Macrostrat is down.")
    return {"map_units":names}


def getPolys(lookup, directory):
    poly_file=None
    if lookup is not None:
        for filename in glob.glob(f"{directory}/*.geojson"):
            basename = os.path.basename(filename)
            
            if lookup in basename and "legend_contour" not in basename:
                poly_file = filename
    poly_features = None

    if poly_file is not None:
        poly_features = {"type": "FeatureCollection", "features": []}
        with open(poly_file, "r") as f:
            data = json.loads(f.read())
            for i, d in enumerate(data["features"]):
                poly_features["features"].append(
                    {
                        "type": "feature",
                        "id": str(i),
                        "properties": {
                            "model": d.get("properties", {}).get("model", ""),
                            "model_version": d.get("properties", {}).get("model_version", ""),
                            "confidence": d.get("properties", {}).get("confidence", None),
                        },
                        "geometry": d.get("geometry"),
                    }
                )
    return poly_features


def build_extraction_features(img, cog_id, system_version):
    directory = f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}/original_pixel_space"

    height = img.height
    # Define a regular expression pattern to extract information from filenames

    # Loop through files in the directory
    legend_swatches = []
    legend_items = search_by_cog_id(app_settings.polymer_legend_extractions, cog_id=cog_id)
    legend_ids_cached = []
    for legend in legend_items:
        legend_ids_cached.append(legend.get("legend_id", ""))
        legend['age_text']=legend.get('age_text',"")
        legend_swatches.append(legend)

    for filename in glob.glob(f"{directory}/*.geojson"):
        basename = os.path.basename(filename)
        if "poly_legend_contour" in filename:
            split_ = basename.split("__")
            system = split_[0]
            system_version = split_[1]
            lookup = split_[2].split("poly_legend_contour")[0]
            # ploys = getPolys(lookup, directory)

            with open(filename, "r") as f:
                data = json.loads(f.read())

                for feature in data.get("features"):
                    try:
                        feature["coordinates_from_bottom"] = inverse_geojson(feature.get("geometry"), height)
                        feature["extent_from_bottom"] = calculate_bounding_box(
                            feature["coordinates_from_bottom"].get("coordinates")
                        )

                        legend_id = generate_legend_id(
                            cog_id, system, system_version, feature.get("extent_from_bottom")
                        )
                        if legend_id not in legend_ids_cached:
                            abbr = feature.get("properties", {}).get("abbreviation", "")
                            label = feature.get("properties", {"label": ""}).get("label", "")
                            feature["extent_from_bottom"] = calculate_bounding_box(
                                feature["coordinates_from_bottom"].get("coordinates")
                            )
                            legend_swatches.append(
                                {
                                    **feature,
                                    "system": system,
                                    "system_version": system_version,
                                    "provenance": system + "_" + system_version,
                                    "type": feature.get("properties").get("type", ""),
                                    "abbreviation": abbr,
                                    "label": label,
                                    "label_coordinates_from_bottom": {"type": "Polygon", "coordinates": []},
                                    "color": feature.get("properties").get("color", ""),
                                    "pattern": feature.get("properties").get("pattern", ""),
                                    "descriptions": [],
                                    "legend_id": legend_id,
                                    "status": "created",
                                    "cog_id": cog_id,
                                    "category": "polygon",
                                    "polygon_features": [],
                                    "lookup":lookup,
                                    "age_text":""
                                }
                            )
                    except Exception:
                        logger.exception(f"Issue parsing swatch: {feature}")
    return legend_swatches


@router.get("/{cog_id}/px_extractions")
async def load_extraction(cog_id: str, system_version=""):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    img = await load_tiff_cache(cache, s3_key)
    legend_swatches = await run_in_threadpool(lambda: build_extraction_features(img, cog_id, system_version))
    return {"legend_swatches": legend_swatches}


@router.get("/{cog_id}/cog_legend_extractions")
async def get_area_extraction(cog_id: str):
    map_areas = search_by_cog_id(app_settings.polymer_area_extractions, cog_id=cog_id)
    # for when we get data from cdr
    # s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    # img = await load_tiff_cache(cache, s3_key)
    # height=img.height
    # for area in map_areas:
    #     area['coordinates_from_bottom']=inverse_geojson(area.get('coordinates'), height)
    #     area["extent_from_bottom"]=[area['bbox'][0], height - area['bbox'][1], area['bbox'][2], height-area['bbox'][3]]

    legend_swatches = legend_categories_by_cog_id(
        app_settings.polymer_legend_extractions, cog_id=cog_id, category="legend_swatch"
    )

    # test = copy.deepcopy(map_areas[0])
    # test['system']="test"
    # map_areas.append(test)

    all_items = {"area_extractions": map_areas, "legend_swatches": legend_swatches}
    return all_items


@router.get("/{cog_id}", status_code=HTTP_200_OK)
async def cog_all_info(cog_id: str):
    # get info from cdr

    meta = await cog_info(cog_id=cog_id)
    projections = cog_projs(cog_id=cog_id)
    gcps = cog_gcps(cog_id=cog_id)
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

    logger.debug("Crop Tiff for ocr - loading: %s", s3_key)
    img = await load_tiff_cache(cache, s3_key)
    meta["height"] = img.height
    meta["width"] = img.width
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


def calculate_bounding_box(coordinates: List[List[List[Union[float, int]]]]) -> List[Union[float, int]]:
    # Create a polygon from the coordinates
    polygon = Polygon(coordinates[0])

    # Get the bounding box
    min_x, min_y, max_x, max_y = polygon.bounds

    # Return the bounding box as [x1, y1, x2, y2]
    return [min_x, min_y, max_x, max_y]


@router.post("/save_area_extractions")
async def post_area_extraction(request: SaveAreaExtraction):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{request.cog_id}.cog.tif"
    img = await load_tiff_cache(cache, s3_key)
    height = img.height
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


@router.delete("/delete_area_extractions", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_area_extraction(request: DeleteExtraction):
    delete_by_id(index=app_settings.polymer_area_extractions, id=request.id)
    return


@router.delete("/delete_legend_extractions", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_area_extraction(request: DeleteExtraction):
    delete_by_id(index=app_settings.polymer_legend_extractions, id=request.id)
    return


def getMapUnit(age_text):
    if age_text == "":
        return None
    map_units = httpx.get("https://macrostrat.org/api/v2/defs/intervals?all")    
    mapper = {}
    for unit in map_units.json()['success']['data']:
        mapper['name']=unit

    if age_text not in mapper.keys():
        return None
    return {
        "age_text":mapper[age_text].get("name"),
        "t_age":mapper[age_text].get('t_age',None),
        "b_age":mapper[age_text].get('b_age',None)
    }
    
    names = [x['name'] for x in map_units.json()['success']['data']]

@router.post("/send_to_cdr", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def send_validated_legend_items_to_cdr(cog_id: str = Query(default=None)):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    img = await load_tiff_cache(cache, s3_key)
    img.height
    await load_px_extraction(cog_id=cog_id)
    directory = f"/home/apps/auto-georef/auto_georef/px_results/{cog_id}/original_pixel_space"

    # build result
    legend_polygon_swatchs_items = legend_categories_by_cog_id(
        app_settings.polymer_legend_extractions, cog_id=cog_id, category="polygon"
    )

    feature_results = {
        "system": app_settings.polymer_auto_georef_system,
        "system_version": app_settings.polymer_auto_georef_system_version,
        "cog_id": cog_id,
        "polygon_feature_results": [],
    }
    for poly in legend_polygon_swatchs_items:
        add_poly = {
            "id": poly.get("legend_id"),
            "legend_provenance": None,
            "label": poly.get("label", ""),
            "abbreviation": poly.get("abbreviation", ""),
            "description": " ".join([desc.get("text", "") for desc in poly.get("descriptions", [])]),
            "legend_bbox": None,
            "legend_contour": poly.get("coordinates", {}).get("coordinates", [])[0],
            "color": poly.get("color", ""),
            "pattern": poly.get("pattern", ""),
            "category": "polygon_legend_item",
            "map_unit": getMapUnit(poly.get('age_text',"")),
            "polygon_features": getPolys(poly.get("lookup"), directory),
        }
        feature_results["polygon_feature_results"].append(add_poly)
    await send_feature_results_to_cdr(feature_results)
    logging.info("finished sending to cdr")

    # remove from cache
    if cog_id in downloaded_features_cache:
        downloaded_features_cache.pop(cog_id)
        print(f"Key '{cog_id}' removed from cache.")
    else:
        print(f"Key '{cog_id}' not found in cache.")


class SaveSwatch(BaseModel):
    cog_id: str
    legend_swatch: Any


@router.post("/save_legend_swatch", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def save_features(request: SaveSwatch):
    request_dict = request.model_dump()
    cog_id = request_dict["cog_id"]
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

    img = await load_tiff_cache(cache, s3_key)
    height = img.height

    legend_swatch = request_dict["legend_swatch"]
    coords_from_bottom = copy.deepcopy(legend_swatch["coordinates_from_bottom"])
    legend_swatch["coordinates"] = inverse_geojson(legend_swatch["coordinates_from_bottom"], height)
    legend_swatch["coordinates_from_bottom"] = coords_from_bottom

    for child in legend_swatch["descriptions"]:
        coords_from_bottom = copy.deepcopy(child["coordinates_from_bottom"])
        child["coordinates"] = inverse_geojson(child["coordinates_from_bottom"], height)
        child["coordinates_from_bottom"] = coords_from_bottom

    legend_id = legend_swatch["legend_id"]
    actions = []

    if document_exists(app_settings.polymer_legend_extractions, legend_id):
        # in the database
        legend_swatch["edited"] = True
        action = {
            "_op_type": "update",
            "_index": app_settings.polymer_legend_extractions,
            "_id": legend_id,
            "doc": legend_swatch,
        }
        actions.append(action)
    else:
        # legend swatch isn't in es yet so newlly created or from cdr.
        legend_swatch["edited"] = True
        action1 = {
            "_op_type": "index",
            "_index": app_settings.polymer_legend_extractions,
            "_id": legend_id,
            "_source": legend_swatch,
        }
        actions.append(action1)

    es_bulk_process_actions(app_settings.polymer_legend_extractions, actions)
    return


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


@router.post("/maps_in_bbox")
def maps_in_box(query: CogsSearch):
    print(query.model_dump_json())
    query.min_lat = -90
    query.min_lon = -180
    query.max_lat = 90
    query.max_lon = 180
    url = app_settings.cdr_endpoint_url + "/v1/maps/search/cogs"
    response = httpx.post(url, data=query.model_dump_json())
    print(response.text)
    if response.status_code == 200:
        response_data = response.json()

    return {"maps": response_data, "total_hits": len(response_data)}


@router.post("/search/maps_in_bbox")
def search_maps_in_box(query: CogsSearch):
    print(query)
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

    return {"maps": response_data, "total_hits": len(response_data)}


@router.post("/proj_update", status_code=HTTP_200_OK)
async def save_proj_info(req: SaveProjInfo):
    req.cog_id
    proj_id = req.projection_id
    status = req.status
    # es check if id exists
    if document_exists(app_settings.polymer_projections_index, proj_id):
        update_document_by_id(
            index_name=app_settings.polymer_projections_index, doc_id=proj_id, updates={"status": status.value}
        )
        if status.value == "validated":
            #  send as georef result to cdr
            data = await send_georef_to_cdr(proj_id)
            response_data = {"status": "validated"}

    else:
        #  just update the status in the cdr.
        url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/projection/{proj_id}"
        data = {"status": status.value}
        response = httpx.put(url, json=data, headers=auth)
        if response.status_code == 200:
            response_data = response.json()

    return {"message": "projection updated", "projection": response_data}


@router.put("/map_info", status_code=HTTP_200_OK)
def update_map_info(req: UpdateCogInfo):
    req.cog_id
    req.key
    req.value

    return {"message": "Map updated"}


def convert_gcps_to_dict(gcp):
    return gcp.dict()


@router.post("/project")
def project(req: ProjectCogRequest):
    cog_id = req.cog_id
    cps = [convert_gcps_to_dict(gcp) for gcp in req.gcps]
    gcps = [convert_gcps_to_dict(gcp) for gcp in req.gcps]

    crs = req.crs

    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

    if len(cps) == 0:
        raise HTTPException(status_code=404, detail="No Control Points Found!")

    start_proj = perf_counter()

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = os.path.join(tmpdir, f"{cog_id}.cog.tif")
        pro_cog_path = os.path.join(tmpdir, f"{cog_id}.pro.cog.tif")

        start_s3_load = perf_counter()
        # I tried rasterio's awssession - it is broken
        s3 = s3_client()
        s3.download_file(app_settings.cdr_public_bucket, s3_key, raw_path)

        time_since(logger, "proj file loaded", start_s3_load)

        start_transform = perf_counter()

        geo_transform = cps_to_transform(cps, to_crs=crs)

        time_since(logger, "geo_transform loaded", start_transform)

        start_reproj = perf_counter()

        project_(raw_path, pro_cog_path, geo_transform, crs)

        time_since(logger, "reprojection file created", start_reproj)

        proj_id = "polymer_" + str(cog_id) + str(uuid.uuid4()) + ".pro.cog.tif"
        s3_pro_unique_key = f"{app_settings.polymer_s3_cog_projections_prefix}/{cog_id}/{proj_id}"
        upload_s3_file(s3_pro_unique_key, app_settings.polymer_public_bucket, pro_cog_path)

        # update ES
        gcp_ids = update_GCPs(cog_id, gcps)

        # save projection code

        save_ES_data(
            index=app_settings.polymer_projections_index,
            info={
                "cog_id": cog_id,
                "projection_id": proj_id,
                "crs": crs,  # epsg_code used for reprojection
                "gcps_ids": gcp_ids,  # gcps used in reprojection
                "created": datetime.now(),  # when file was created
                "status": "created",  # (created, failed, validated)
                "download_url": f"{app_settings.polymer_s3_endpoint_url}/{app_settings.polymer_public_bucket}/{s3_pro_unique_key}",
                "map_area_id": "",
                "system": "polymer",
                "system_version": "0.1.0",
            },
            id=proj_id,
        )

    time_since(logger, "total projection took", start_proj)

    return {"pro_cog_path": f"{app_settings.polymer_s3_endpoint_url}/{s3_pro_unique_key}"}


@router.post("/tif_ocr")
async def ocr(req: OCRRequest):
    bboxes = req.bboxes
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{req.cog_id}.cog.tif"

    logger.debug("Crop Tiff for ocr - loading: %s", s3_key)
    img = await load_tiff_cache(cache, s3_key)
    all_texts = []
    for bbox in bboxes:
        cropped_img = img.crop((bbox[0], img.size[1] - bbox[3], bbox[2], img.size[1] - bbox[1]))
        all_texts.append(pytesseract.image_to_string(cropped_img).replace("\n", " "))

    return {"extracted_text": all_texts}


@router.post("/send_prompt")
def send_prompt(req: PromptRequest):
    return query_gpt4(req.prompt)


@router.post("/processMap")
async def upload_file(
    file: UploadFile,
    map_name: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    organization: Optional[str] = Form(None),
    scale: Optional[int] = Form(None),
    year: Optional[int] = Form(None),
    authors: Optional[str] = Form(None),
    north: Optional[float] = Form(None),
    south: Optional[float] = Form(None),
    east: Optional[float] = Form(None),
    west: Optional[float] = Form(None),
):
    pass
