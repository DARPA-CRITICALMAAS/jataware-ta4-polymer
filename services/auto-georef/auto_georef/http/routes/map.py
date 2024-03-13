import json
import logging
import os
import random
import tempfile
from logging import Logger
from time import perf_counter
from typing import Optional, List, Any
from elasticsearch import Elasticsearch, exceptions
from elasticsearch.helpers import bulk
import copy

import uuid
from datetime import datetime
from enum import Enum
from io import BytesIO
from logging import Logger
from time import perf_counter
from typing import Any, List, Optional

import pyproj
import pytesseract
import rasterio as rio
import rasterio.transform as riot
from elasticsearch import Elasticsearch, exceptions
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from io import BytesIO
import pyproj
from pyproj import Transformer
import rasterio.transform as riot
from rasterio.warp import Resampling, calculate_default_transform, reproject
from fastapi.responses import FileResponse
import tempfile
import json
import os
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely import to_geojson

from wand.image import Image as wandImage
import pytesseract
import fitz
from osgeo import gdal
from PIL import Image, ImageDraw
from pydantic import BaseModel
from pyproj import Transformer
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely import to_geojson
from shapely.geometry import mapping, shape
from shapely.ops import transform
from starlette.status import (
    HTTP_200_OK,
    HTTP_201_CREATED,
    HTTP_400_BAD_REQUEST,
    HTTP_404_NOT_FOUND,
)
from wand.image import Image as wandImage

Image.MAX_IMAGE_PIXELS = None
from cachetools import TTLCache

cache = TTLCache(maxsize=2, ttl=500)

from auto_georef.common.utils import (
    load_tiff_cache,
    s3_client,
    time_since,
    upload_s3_file,
    pdf_to_hd_tif,
)
from auto_georef.georef.autogeoreferencer import AutoGeoreferencer
from auto_georef.settings import app_settings
from auto_georef.common.map_utils import (
    compare_dicts,
    document_exists,
    extract_gcps_,
    es_search_map,
    prepare_gcps_for_es,
    update_documents,
    saveESData,
    updateGCPs,
    cps_to_transform,
    project_,
    query_gpt4,
    generateCrsListFromGCPs,
    filterCRSList,
    saveTifasCog,
    return_crs,
    hash_file_sha256,
    generate_map_id,
    project_vector_,
    calculateCentroid,
    boundsFromGCPS,
    create_boundary_polygon,
    calculate_centroid_as_geo_shape,
    updateChildFeatures
)
from starlette.background import BackgroundTasks

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

AGR = AutoGeoreferencer()

router = APIRouter()

es = Elasticsearch(
    [
        app_settings.es_endpoint_url,
    ]
)


class ExtractPointsRequest(BaseModel):
    map_id: str


class OCRRequest(BaseModel):
    map_id: str
    bboxes: Optional[list]


class GCP(BaseModel):
    map_id: str
    gcp_id: Optional[str]
    gcp_reference_id: Optional[str]
    provenance: str
    rowb: float
    coll: float
    x: Optional[float]
    y: Optional[float]
    crs: str


class ProjectMapRequest(BaseModel):
    map_id: str
    map_name: str
    crs: Optional[str]
    gcps: List[GCP]


class ProjectVectorRequest(BaseModel):
    feature: Any
    projection_id: str
    crs: Optional[str]


class SearchMapInBox(BaseModel):
    georeferenced: bool
    not_georeferenced: bool
    validated: bool
    bounding_box_polygon: Any
    scale_min: int
    scale_max: int
    search_text: Optional[str]
    page_number: int
    page_size: int

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
    category: str   # legend_swatch, legend_description, legend_area, 
    confidence: Optional[float]
    status:str
    notes: str

class SaveUpdateFeatures(BaseModel):
    map_id: str
    features: List[Feature]


class Proj_Status(Enum):
    CREATED = "created"
    SUCCESS = "success"
    FAILED = "failed"


class SaveProjInfo(BaseModel):
    map_id: str
    proj_id: str
    status: Proj_Status


class UpdateMapInfo(BaseModel):
    map_id: str
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
    map_item_id:Optional[str] = None
    return_all: Optional[bool] = False


class MapsFind(BaseModel):
    map_publication_id: str
    publisher: str


########################### GETs ###########################


@router.get("/clip-tiff")
async def clip_tiff(map_id: str, coll: int, rowb: int):
    try:
        size = 225
        s3_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}.cog.tif"

        img = await load_tiff_cache(cache, s3_key)

        y = img.height - rowb

        box = (coll - (size / 2), y - (size / 2), coll + (size / 2), y + (size / 2))
        clipped_img = img.crop(box)
        if clipped_img.mode != "RGB":
            clipped_img = clipped_img.convert("RGB")

        center_x, center_y = int(size / 2), int(size / 2)  # Center of a 200x200 image

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
async def clip_bbox(map_id: str, minx: int, miny: int, maxx: int, maxy: int):
    try:
        s3_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}.cog.tif"

        img = await load_tiff_cache(cache, s3_key)

        box = (minx, img.height-maxy, maxx, img.height-miny)

        clipped_img = img.crop(box)
        if clipped_img.mode != "RGB":
            clipped_img = clipped_img.convert("RGB")

        img_byte_arr = BytesIO()
        clipped_img.save(img_byte_arr, format="PNG")
        img_byte_arr = img_byte_arr.getvalue()

        return Response(content=img_byte_arr, media_type="image/png")
    except Exception as e:
        logging.error(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/maps", status_code=HTTP_200_OK)
def maps(georeferenced=True, validated=False, not_a_map=False, size=10000):
    maps_loading = perf_counter()
    search_body = {
        "_source": ["map_name", "map_id", "georeferenced", "validated", "not_a_map"],
        "query": {
            "bool": {
                "filter": [
                    {"term": {"georeferenced": georeferenced}},
                    {"term": {"validated": validated}},
                    {"term": {"not_a_map": not_a_map}},
                ]
            }
        },
    }
    response = es.search(index=app_settings.maps_index, body=search_body, size=size)
    maps = [
        {
            "map_name": hit["_source"]["map_name"],
            "map_id": hit["_source"]["map_id"],
            "validated": hit["_source"]["validated"],
            "georeferenced": hit["_source"]["georeferenced"],
            "not_a_map": hit["_source"]["not_a_map"],
        }
        for hit in response["hits"]["hits"]
    ]

    time_since(logger, "maps list loaded", maps_loading)
    return {"maps": maps}


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


def maps_scroll():
    data = {"georeferenced": 0, "validated": 0, "not_georeferenced": 0, "not_a_map": 0}
    search_query = {"query": {"match_all": {}}}
    # Initial search request with scroll parameter
    response = es.search(
        index=app_settings.maps_index, body=search_query, scroll="1m", size=1000
    )
    # Total number of documents matching the query
    total_docs = response["hits"]["total"]["value"]
    # Process the initial batch of results
    for hit in response["hits"]["hits"]:
        if hit["_source"].get("not_a_map", False) == True:
            data["not_a_map"] += 1
        else:
            if (
                hit["_source"]["validated"] == True
                and hit["_source"]["georeferenced"] == True
            ):
                data["validated"] += 1
            elif hit["_source"]["georeferenced"] == True:
                data["georeferenced"] += 1
            else:
                data["not_georeferenced"] += 1

    while len(response["hits"]["hits"]) > 0:
        scroll_id = response["_scroll_id"]
        response = es.scroll(scroll_id=scroll_id, scroll="1m")
        # Process the next batch of results
        for hit in response["hits"]["hits"]:
            if hit["_source"].get("not_a_map", False) == True:
                data["not_a_map"] += 1
            else:
                if (
                    hit["_source"]["validated"] == True
                    and hit["_source"]["georeferenced"] == True
                ):
                    data["validated"] += 1
                elif hit["_source"]["georeferenced"] == True:
                    data["georeferenced"] += 1
                else:
                    data["not_georeferenced"] += 1

    # stats_cache['stats']=data
    es.clear_scroll(scroll_id=scroll_id)
    return data


@router.get("/maps_stats", status_code=HTTP_200_OK)
def map_stats_():
    # todo needs a bit more testing.
    # if "stats" in stats_cache:
    #     return stats_cache['stats']

    return maps_scroll()

@router.get("/{map_id}/legend_features_json")
async def download_json(map_id: str):
    try:
        map_info = es.get(index=app_settings.maps_index, id=map_id)["_source"]
        response = es.search(index=app_settings.features_index, body={
            "query": {
                "bool": {
                    "must": [{"match": {"map_id": map_id}},{"match":{ "status":"validated"}}],
                    "filter": [{"terms": {"category": ["legend_swatch"]}}]
                }
            },
            "_source": ["feature_id","points_from_top", "text"]    
            }
        )
        shapes=[]
        for hit in response['hits']['hits']:
            data=hit['_source']
            shapes.append({
                "label":data['text'],
                "points":data['points_from_top']
            })
        filename = f"{map_id}_features_data.json"

        features_data = {
            "imagePath":map_info.get('cog_url',""),
            "imageData": None,
            "imageHeight": map_info['height'],
            "imageWidth": map_info['width'],
            "shapes": shapes,
            "download_file_name": filename
        }
        return features_data
      
    except Exception as e:
        logging.error(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{map_id}/gcps", status_code=HTTP_200_OK)
def map_gcps_(map_id: str):
    gcps = es_search_map(es, app_settings.gcps_index, map_id)
    return {"all_gcps": gcps}


@router.get("/{map_id}/proj_info", status_code=HTTP_200_OK)
def map_projs_(map_id: str):
    projs = es_search_map(es, app_settings.proj_files_index, map_id)
    return {"proj_info": projs}


@router.get("/{map_id}/meta", status_code=HTTP_200_OK)
def map_info_(map_id: str):
    map_info = es_search_map(es, app_settings.maps_index, map_id)[0]

    return {"map_info": map_info}

@router.get("/{map_id}/legend_features")
def get_legend_features(map_id: str ):
    try:
        # Perform the search query in Elasticsearch
        response = es.search(index=app_settings.features_index, body={
            "query": {
                "bool": {
                    "must": [{"match": {"map_id": map_id}}],
                    "must_not":[{"match": {"status": 'failed'}}],
                    "filter": [{"terms": {"category": ["legend_area", "legend_swatch"]}}]
                }
            }
        })

        # Initialize containers for the different categories
        legend_areas = []
        legend_swatches = []
        descriptions_dict = {}  # Temporary dictionary to hold descriptions keyed by parent_id

        # Process search results
        for hit in response['hits']['hits']:
            source = hit['_source']
            category = source['category']

            if category == "legend_area":
                legend_areas.append(source)
            elif category == "legend_swatch":
                legend_swatches.append(source)
                descriptions_dict[source['feature_id']]=[]
                
        descriptions = es.search(index=app_settings.features_index, body={
                    "query": {
                        "bool": {
                            "must": [{"match": {"map_id": map_id}}],
                            "must_not":[{"match": {"status": 'failed'}}],
                            "filter": [{"terms": {"category": ["legend_description"]}}]
                        }
                    }
                })
        
        for hit in descriptions['hits']['hits']:
            try:
                descriptions_dict[hit["_source"]['parent_id']].append(hit["_source"])
                logging.error(descriptions_dict)
            except Exception as e:
                logging.error(e)
            
        for legend in legend_swatches:
            legend['descriptions']=descriptions_dict[legend['feature_id']]

        return {
            "legend_areas": legend_areas,
            "legend_swatches": legend_swatches
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{map_id}", status_code=HTTP_200_OK)
def map_info_(map_id: str):
    map_info = es_search_map(es, app_settings.maps_index, map_id)[0]
    proj_info = es_search_map(es, app_settings.proj_files_index, map_id)
    gcps = es_search_map(es, app_settings.gcps_index, map_id)

    # convert to dict and set key. Saves additional looping
    gcps_ = {}
    for gcp in gcps:
        gcps_[gcp["gcp_id"]] = gcp

    # add used points that created projection file
    for proj in proj_info:
        proj["gcps"] = []
        for id in proj["gcps_ids"]:
            proj["gcps"].append(gcps_[id])

        del proj["gcps_ids"]

    return {"map_info": map_info, "proj_info": proj_info, "all_gcps": gcps}


########################### POSTs ###########################

@router.post("/save_features")
async def save_features(request: SaveUpdateFeatures):
    request_dict=request.dict()
    map_id = request_dict["map_id"]
    legend_areas = request_dict["features"]

    # Query ES to get existing features for the map_id
    try:
        response = es.search(index=app_settings.features_index, body={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"map_id": map_id}}
                    ],
                    "filter": [
                        {"terms": {"category": ["legend_area", "legend_swatch", "legend_description"]}},
                    ]
                }
            }
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


    existing_features = {}
    for hit in response['hits']['hits']:
        existing_features[hit["_source"]["feature_id"]]=hit["_source"]

    actions = []
    for feature in legend_areas:
        feature_id = feature['feature_id']
        
        # Prepare action based on whether the feature exists
        if feature_id in existing_features.keys():
            if compare_dicts(feature, existing_features[feature_id], ["text"]):
                action = {
                    "_op_type": "update",
                    "_index": app_settings.features_index,
                    "_id": feature_id,
                    "doc": feature
                }
                actions.append(action)
            else:

                new_feature = copy.deepcopy(feature)
                new_feature_id = f"{new_feature['map_id']}{ new_feature['extent_from_bottom']}{new_feature['text']}"
                new_feature['feature_id'] = new_feature_id
                new_feature['reference_id'] = feature['feature_id']
                
                childUpdates=updateChildFeatures(es, map_id, new_feature_id, feature['feature_id'])
                action1 = {
                    "_op_type": "index",
                    "_index": app_settings.features_index,
                    "_id": new_feature['feature_id'],
                    "_source": new_feature
                }
                actions.append(action1)
                for child in childUpdates:
                    actions.append(child)

                action2 = {
                    "_op_type": "update",
                    "_index": app_settings.features_index,
                    "_id": feature['feature_id'],
                    "doc": {"status":"failed"}
                }
                actions.append(action2)
        else:
            # Prepare index action for new feature
            action3 = {
                "_op_type": "index",
                "_index": app_settings.features_index,
                "_id": feature_id,
                "_source": feature
            }
        
            actions.append(action3)

    # Bulk update/add features to ES
    try:
        bulk(es, actions)
        es.indices.refresh(index=app_settings.features_index)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    return {"message": "Features updated successfully"}


@router.post("/maps_in_bbox")
def search_maps_in_box(query: SearchMapInBox):
    page_number = query.page_number + 1
    page_size = query.page_size
    offset = (page_number - 1) * page_size

    es_query = {"bool": {"should": [], "must": [], "filter": []}}

    if query.search_text and query.search_text != "":
        es_query["bool"]["should"].append(
            {
                "multi_match": {
                    "query": query.search_text,
                    "fields": [
                        "authors",
                        "category",
                        "organization",
                        "mapKurator_all_text",
                        "map_name",
                        "map_id",
                        "citation",
                    ],  # Replace with actual fields to search
                }
            }
        )

    def replace_single_quotes_with_double_quotes(data):
        if isinstance(data, str):
            return data.replace("'", '"')
        elif isinstance(data, list):
            return [replace_single_quotes_with_double_quotes(item) for item in data]
        elif isinstance(data, dict):
            return {
                replace_single_quotes_with_double_quotes(
                    key
                ): replace_single_quotes_with_double_quotes(value)
                for key, value in data.items()
            }
        else:
            return data  # R

    if query.bounding_box_polygon:

        if query.bounding_box_polygon["geometry"]["type"] == "Polygon":
            elasticsearch_geojson = {
                "type": "Polygon",
                "coordinates": query.bounding_box_polygon["geometry"]["coordinates"],
            }
        else:
            elasticsearch_geojson = {
                "type": "MultiPolygon",
                "coordinates": query.bounding_box_polygon["geometry"]["coordinates"],
            }

        es_query["bool"]["filter"].append(
            {
                "bool": {
                    "should": [
                        {
                            "geo_shape": {
                                "bounds": {
                                    "shape": elasticsearch_geojson,
                                    "relation": "intersects",
                                }
                            }
                        },
                        {
                            "geo_shape": {
                                "centroid": {  # Replace 'centroid' with your actual geo-shape field
                                    "shape": elasticsearch_geojson,
                                    "relation": "intersects",
                                }
                            }
                        },
                    ]
                }
            }
        )

    if query.validated and query.georeferenced and query.not_georeferenced:
        es_query["bool"]["filter"].append(
            {
                "bool": {
                    "should": [
                        {"term": {"validated": True}},
                        {"term": {"georeferenced": True}},
                        {"term": {"georeferenced": False}},
                    ]
                }
            }
        )
    elif query.validated and not query.georeferenced and not query.not_georeferenced:
        es_query["bool"]["filter"].append({"term": {"validated": True}})

    elif query.validated and query.not_georeferenced and not query.georeferenced:

        es_query["bool"]["filter"].append(
            {
                "bool": {
                    "should": [
                        {"term": {"validated": True}},
                        {"term": {"georeferenced": False}},
                    ]
                }
            }
        )
    elif query.validated and query.georeferenced and not query.not_georeferenced:
        es_query["bool"]["filter"].append(
            {
                "bool": {
                    "should": [
                        {"term": {"validated": True}},
                        {"term": {"georeferenced": True}},
                    ]
                }
            }
        )
    else:
        if query.georeferenced and query.not_georeferenced:
            es_query["bool"]["filter"].append({"term": {"validated": False}})

        elif query.georeferenced:
            es_query["bool"]["filter"].append({"term": {"validated": False}})
            es_query["bool"]["filter"].append({"term": {"georeferenced": True}})
        elif query.not_georeferenced:
            es_query["bool"]["filter"].append({"term": {"validated": False}})
            es_query["bool"]["filter"].append({"term": {"georeferenced": False}})
        else:
            pass

    es_query["bool"]["filter"].append(
        {
            "bool": {
                "should": [
                    {
                        "range": {
                            "scale": {"gte": query.scale_min, "lte": query.scale_max}
                        }
                    },
                    {"bool": {"must_not": {"exists": {"field": "scale"}}}},
                ],
                "minimum_should_match": 1,
            }
        }
    )

    if query.search_text and query.search_text != "":
        response = es.search(
            index=app_settings.maps_index,
            body={
                "query": es_query,
                "from": offset,
                "size": page_size,
                "min_score": 0.1,
            },
        )
    else:
        response = es.search(
            index=app_settings.maps_index,
            body={"query": es_query, "from": offset, "size": page_size},
        )

    maps = [x["_source"] for x in response["hits"]["hits"]]

    return {"maps": maps, "total_hits": response["hits"]["total"]["value"]}


@router.post("/extract_gcps")
async def extract_gcps(req: ExtractPointsRequest):
    # still works not need to maybe just return gcps that are created via AI.
    s3_key = f"{app_settings.s3_tiles_prefix_v2}/{req.map_id}/{req.map_id}.cog.tif"

    logger.debug("extract_gcps - loading: %s", s3_key)
    img = await load_tiff_cache(cache, s3_key)

    start_autogeoref = perf_counter()
    cps = extract_gcps_(AGR, img)

    time_since(logger, "autogeoref gcps", start_autogeoref)

    return cps


@router.post("/proj_info", status_code=HTTP_200_OK)
def save_proj_info(req: SaveProjInfo):
    map_id = req.map_id
    proj_id = req.proj_id
    status = req.status
    update_documents(
        es=es,
        index_name=app_settings.proj_files_index,
        search_dict={"proj_id": proj_id},
        update_body={"status": status.value},
    )
    if status == Proj_Status.SUCCESS:
        update_documents(
            es=es,
            index_name=app_settings.maps_index,
            search_dict={"map_id": map_id},
            update_body={
                "validated": True,
                "modified": datetime.now(),
                "finished": datetime.now(),
                "finished_proj_id": proj_id,
            },
        )
    if status == Proj_Status.FAILED:
        # maybe delete files on s3?
        pass

    # update stats
    maps_scroll()
    return {"message": "projection updated"}


@router.put("/map_info", status_code=HTTP_200_OK)
def update_map_info(req: UpdateMapInfo):
    map_id = req.map_id
    key = req.key
    value = req.value
    update_documents(
        es=es,
        index_name=app_settings.maps_index,
        search_dict={"map_id": map_id},
        update_body={key: value},
    )
    if key in ["not_a_map", "georeferenced", "validated"]:
        maps_scroll()

    return {"message": "Map updated"}


@router.post("/maps_lookup")
async def lookup_maps(req: MapsLookup):
    map_publication_id = req.map_publication_id
    map_item_id = req.map_item_id
    return_all = req.return_all
    if req.map_item_id is None:
        query = {
            "query": {
                "wildcard": {
                    "map_name": f"*_{map_publication_id}"  # Replace with the actual ID
                }
            }
        }
        response = es.search(index=app_settings.maps_index, body=query, size=6)
        if return_all:
            maps = []
            for doc in response["hits"]["hits"]:
                maps.append(doc["_source"])

            return maps
        else:
            if len(response["hits"]["hits"])>0:
                return response["hits"]["hits"][0]['_source']
            else:
                raise HTTPException(
                    status_code=400, detail="Didn't find any maps with that publication id"
                )
    else:
        query = {
            "query": {
                "wildcard": {
                    "map_name": f"{map_item_id}_{map_publication_id}"  # Replace with the actual ID
                }
            }
        }
        response = es.search(index=app_settings.maps_index, body=query, size=1)
        if len(response["hits"]["hits"])>0:
            return response["hits"]["hits"][0]['_source']
        else:
            raise HTTPException(
                    status_code=400, detail="Didn't find any maps with that publication and item id"
                )


@router.post("/maps_search")
async def search_maps(req: SearchMapsReq):
    page = req.page + 1
    size = req.size
    q = req.query
    georeferenced = req.georeferenced
    validated = req.validated
    not_a_map = req.not_a_map
    random_ = req.random

    if page < 1:
        raise HTTPException(
            status_code=400, detail="Page number must be greater than or equal to 1"
        )

    # Calculate the "from" offset for pagination
    from_offset = (page - 1) * size

    if random_ == True:
        search_body = {
            "size": size,
            "query": {
                "function_score": {
                    "query": {
                        "bool": {
                            "filter": [
                                {"term": {"georeferenced": georeferenced}},
                                {"term": {"validated": validated}},
                                {"term": {"not_a_map": not_a_map}},
                            ]
                        }
                    },
                    "functions": [{"random_score": {}}],
                    "boost_mode": "replace",
                }
            },
        }
    else:
        search_body = {
            "query": {
                "multi_match": {
                    "query": q,
                    "type": "phrase_prefix",
                    "fields": ["map_name"],
                },
            },
            "from": from_offset,
            "size": size,
        }

    response = es.search(index=app_settings.maps_index, body=search_body, size=size)
    return {
        "total": response["hits"]["total"]["value"],
        "results": [x["_source"] for x in response["hits"]["hits"]],
        "page": page,
        "size": size,
    }


def convert_gcps_to_dict(gcp):
    gcp_ = gcp.dict()
    if gcp_["gcp_reference_id"] == "":
        gcp_["gcp_reference_id"] = None
    return gcp_


@router.post("/project_vector")
def project_vector(req: ProjectVectorRequest):
    return project_vector_(es, req.feature, req.projection_id, req.crs)


@router.post("/project")
def project(req: ProjectMapRequest):
    map_name = req.map_name
    map_id = req.map_id
    cps = [convert_gcps_to_dict(gcp) for gcp in req.gcps]
    gcps = [convert_gcps_to_dict(gcp) for gcp in req.gcps]

    crs = req.crs

    s3_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}.cog.tif"
    s3_pro_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}.pro.cog.tif"

    if len(cps) == 0:
        raise HTTPException(status_code=404, detail="No Control Points Found!")

    start_proj = perf_counter()

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = os.path.join(tmpdir, f"{map_id}.cog.tif")
        pro_cog_path = os.path.join(tmpdir, f"{map_id}.pro.cog.tif")

        start_s3_load = perf_counter()
        # I tried rasterio's awssession - it is broken
        s3 = s3_client()
        s3.download_file(app_settings.s3_tiles_bucket, s3_key, raw_path)

        time_since(logger, "proj file loaded", start_s3_load)

        start_transform = perf_counter()

        # Convert to canonical form
        __src = rio.open(raw_path, "r")

        geo_transform = cps_to_transform(cps, height=__src.height, to_crs=crs)

        time_since(logger, "geo_transform loaded", start_transform)

        start_reproj = perf_counter()

        project_(raw_path, pro_cog_path, geo_transform, crs)

        time_since(logger, "reprojection file created", start_reproj)

        upload_s3_file(s3_pro_key, pro_cog_path)

        epsg_id = uuid.uuid4()
        proj_id = uuid.uuid4()
        s3_pro_unique_key = (
            f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"
        )
        upload_s3_file(s3_pro_unique_key, pro_cog_path)

        # update ES
        gcp_ids = updateGCPs(es, map_id, gcps)

        # save projection code
        saveESData(
            es=es,
            index=app_settings.epsgs_index,
            info={
                "epsg_id": epsg_id,
                "map_id": map_id,
                "epsg_code": crs,
                "created": datetime.now(),
                "provenance": "api_endpoint",
                "extraction_model": None,
                "extraction_model_version": None,
            },
            id=None,
        )

        saveESData(
            es=es,
            index=app_settings.proj_files_index,
            info={
                "proj_id": proj_id,
                "map_id": map_id,  # map id
                "epsg_code": crs,  # epsg_code used for reprojection
                "epsg_id": epsg_id,
                "created": datetime.now(),
                "source": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{s3_pro_key}",
                "gcps_ids": gcp_ids,
                "status": "created",
                "provenance": "api_endpoint",
                "transformation": "polynomial_1",
            },
            id=None,
        )

        update_documents(
            es=es,
            index_name=app_settings.maps_index,
            search_dict={"map_id": map_id},
            update_body={"georeferenced": True, "modified": datetime.now()},
        )

    time_since(logger, "total projection took", start_proj)

    return {
        "pro_cog_path": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{s3_pro_key}"
    }


@router.post("/tif_ocr")
async def ocr(req: OCRRequest):
    bboxes = req.bboxes
    s3_key = f"{app_settings.s3_tiles_prefix_v2}/{req.map_id}/{req.map_id}.cog.tif"

    logger.debug("Crop Tiff for ocr - loading: %s", s3_key)
    img = await load_tiff_cache(cache, s3_key)
    all_texts = []
    for bbox in bboxes:
        cropped_img = img.crop(
            (bbox[0], img.size[1] - bbox[3], bbox[2], img.size[1] - bbox[1])
        )
        all_texts.append(pytesseract.image_to_string(cropped_img).replace("\n", " "))
        # all_text = all_text + " " + pytesseract.image_to_string(cropped_img)
    # all_text = all_text.replace("\n", " ")

    return {"extracted_text": all_texts}


@router.post("/send_prompt")
def send_prompt(req: PromptRequest):
    return query_gpt4(req.prompt)
    

def save_stripped_file(file_contents, output_path):
    with wandImage(blob=file_contents) as img:
        img.strip()
        img.save(filename=output_path)


def read_file_contents(file, file_ext):
    if file_ext ==".tif":
        map_name_ = file.filename.split(".tif")[0].replace(".", "_")

        # read uploaded file and save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tif") as temp_file:
            # Read and write to a temporary file
            file_contents = file.file.read()
            temp_file.write(file_contents)
            temp_file_path = temp_file.name
        
        return (file_contents, temp_file_path, map_name_)
    
    elif file_ext ==".pdf":

        map_name_ = file.filename.split(".pdf")[0].replace(".", "_")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_pdf:
            content = file.file.read()
            temp_pdf.write(content)
            temp_pdf_path = temp_pdf.name

        # Use another temporary file for the output TIFF
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tif") as temp_tif:
            # Translate to TIFF using the temporary file name
            pdf_to_hd_tif(temp_pdf_path, temp_tif)
            
            temp_file_path = temp_tif.name
        with open(temp_file_path, "rb") as f:
            file_contents = f.read()
                
        return (file_contents, temp_file_path, map_name_)

    else:
        logging.error("File type not supported")
        logging.error(f'File Type used {file_ext}')
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only TIFF or PDF files are allowed.",
        )

    

def save_stripped_file(file_contents, output_path):
    with wandImage(blob=file_contents) as img:
        img.strip()
        img.save(filename=output_path)


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

    if (
        not file.filename.endswith(".tif")
        and not file.filename.endswith(".pdf")
        and not file.filename.endswith(".tiff")
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only TIFF or PDF files are allowed.",
        )
    
    if file.filename.endswith(".pdf"):
        file_contents, temp_file_path, map_name_ =  await run_in_threadpool(lambda: read_file_contents(file=file, file_ext=".pdf"))
        

    elif file.filename.endswith(".tif") or file.filename.endswith(".tiff"):
        file_contents, temp_file_path, map_name_ =  await run_in_threadpool(lambda:  read_file_contents(file=file, file_ext=".tif"))

    # Now open it with GDAL to save crs info
    original_crs = return_crs(temp_file_path)
    # save a version of the uploaded file with no crs info
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, map_name_ + ".tif")
        await run_in_threadpool(lambda:save_stripped_file(file_contents, output_path))
        cog_path = output_path.split(".tif")[0] + ".cog.tif"

        # convert tif to cog
        await run_in_threadpool(lambda: saveTifasCog(file_path=output_path, cog_path=cog_path))
        map_id = generate_map_id(cog_path)
        if document_exists(es, app_settings.maps_index, map_id):
            return {
                "message": "Map has already been uploaded.",
                "map_id": map_id,
                "georeferenced": False,
            }

        s3_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}" + ".cog.tif"

        # save cog file to s3
        await run_in_threadpool(lambda: upload_s3_file(s3_key, cog_path))

        # open local cog file to extract gcps and read height/width
        img = Image.open(output_path)
        # logging.info(img)
        width, height = img.size
        logging.info(img.size)
        try:
            gcps = extract_gcps_(AGR, img)
        except Exception as e:
            gcps=[]
        for gcp in gcps:
            # add unique id for gcps
            gcp["gcp_id"] = uuid.uuid4()

        # save gcps
        gcps_ = prepare_gcps_for_es(
            gcps=gcps,
            map_id=map_id,
            extraction_model="jataware_gcp_extractor",
            extraction_model_version="0.0.1",
            provenance="jataware_extraction",
        )
        try:
            for gcp_data in gcps_:
                saveESData(
                    es=es,
                    index=app_settings.gcps_index,
                    info=gcp_data,
                    id=gcp_data["gcp_id"],
                )
        except Exception as e:
            print(f"Error indexing gcp data: {e}")

        # if map_name is not supplied set to file name
        if map_name is None:
            map_name = map_name_

        # Check if the request had provided boundary coordinates
        provided_boundary = None
        if all(coord is not None for coord in [north, south, east, west]):
            provided_boundary = create_boundary_polygon(
                north=north, south=south, east=east, west=west
            )
            centroid = calculate_centroid_as_geo_shape(
                north=north, south=south, east=east, west=west
            )

        if len(gcps) < 4:
            logging.info("Failed to find enough gcps")
            map_es_info = {
                "map_id": map_id,
                "organization": organization,
                "map_name": map_name,
                "height": height,
                "width": width,
                "title": title,
                "finished_proj_id": None,
                "georeferenced": False,
                "validated": False,
                "modified": datetime.now(),
                "created": datetime.now(),
                "finished": None,
                "source": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{app_settings.s3_tiles_prefix}/{map_id}/{map_id}.cog.tif",
                "original_crs": original_crs,
                "scale": scale,
                "year": year,
                "authors": authors,
            }
            if provided_boundary:
                map_es_info["bounds"] = provided_boundary
                map_es_info["centroid"] = centroid
            await run_in_threadpool(lambda:saveESData(
                es=es,
                index=app_settings.maps_index,
                info=map_es_info,
                id=map_id,
            ))
            return {
                "message": "File uploaded successfully, unable to georeference due to lack of gcps",
                "map_id": map_id,
                "georeferenced": False,
            }
        CRSs = []
        all_crs = generateCrsListFromGCPs(gcps=gcps)
        CRSs = filterCRSList(all_crs)
        for crs_id in CRSs:
            epsg_id = uuid.uuid4()

            await run_in_threadpool(lambda: saveESData(
                es=es,
                index=app_settings.epsgs_index,
                info={
                    "epsg_id": epsg_id,
                    "map_id": map_id,
                    "epsg_code": crs_id,
                    "created": datetime.now(),
                    "provenance": "jataware_extraction",
                    "extraction_model": None,
                    "extraction_model_version": None,
                },
                id=epsg_id,
            ))
            ### create proj_id hash ###
            # if we want determistic ids add gcps ids to proj_id and proj_crs code
            # sorted_cps = sorted(gcps, key=lambda item: (item['rowb'], item['coll'], item['x'] ))
            # proj_id = hashlib.sha256((crs_id + concat_values(sorted_cps)).encode()).hexdigest()

            proj_id = uuid.uuid4()
            pro_cog_path = os.path.join(tmpdir, f"{map_id}_{proj_id}.pro.cog.tif")
            geo_transform = cps_to_transform(gcps, height=height, to_crs=crs_id)

            await run_in_threadpool(lambda:project_(cog_path, pro_cog_path, geo_transform, crs_id))

            s3_pro_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"

            await run_in_threadpool(lambda:upload_s3_file(s3_pro_key, pro_cog_path))

            await run_in_threadpool(lambda:saveESData(
                es=es,
                index=app_settings.proj_files_index,
                info={
                    "proj_id": proj_id,
                    "map_id": map_id,  # map id
                    "epsg_code": crs_id,  # epsg_code used for reprojection
                    "epsg_id": epsg_id,  # epsg_id used which is the internal id in the epsg index
                    "created": datetime.now(),
                    "source": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{s3_pro_key}",
                    "gcps_ids": [gcp["gcp_id"] for gcp in gcps],
                    "status": "created",
                    "provenance": "jataware_extraction",
                    "transformation": "polynomial_1",
                },
                id=proj_id,
            ))

        # Get map location data for map2 index.
        if provided_boundary:
            coordinates = provided_boundary
            centroid = calculate_centroid_as_geo_shape(
                north=north, south=south, east=east, west=west
            )
        else:
            coordinates = boundsFromGCPS(gcps)
            centroid_calc = calculateCentroid(gcps)
            centroid = {
                "coordinates": [centroid_calc.x, centroid_calc.y],
                "type": "Point",
            }

        map_es_info = {
            "map_id": map_id,
            "map_name": map_name,
            "height": height,
            "width": width,
            "finished_proj_id": None,
            "georeferenced": True,
            "validated": False,
            "modified": datetime.now(),
            "created": datetime.now(),
            "finished": None,
            "source": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}.cog.tif",
            "original_crs": original_crs,
            "centroid": centroid,
            "bounds": coordinates,
        }
        try:
            await run_in_threadpool(lambda:saveESData(
                es=es,
                index=app_settings.maps_index,
                info=map_es_info,
                id=map_id,
            ))
        except exceptions.RequestError as e:
            logger.error(
                f"Saving ESData failed: {e}, bounds may have failed to validate: {coordinates}, trying again without bounds."
            )
            map_es_info.pop("bounds")
            await run_in_threadpool(lambda:saveESData(
                es=es,
                index=app_settings.maps_index,
                info=map_es_info,
                id=map_id,
            ))

    return {
        "message": "File uploaded and georeferenced without errors",
        "map_id": map_id,
        "georeferenced": True,
    }
