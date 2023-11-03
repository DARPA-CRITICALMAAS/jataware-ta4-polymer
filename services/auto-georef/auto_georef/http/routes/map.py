import io
import json
import logging
import os
import random
import tempfile
from logging import Logger
from pathlib import Path
from time import perf_counter
from typing import Optional
from elasticsearch import Elasticsearch, helpers
import copy
import uuid
from datetime import datetime
from enum import Enum

import requests
import re
import boto3
import pyproj
import rasterio as rio
import rasterio.transform as riot
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image
import pytesseract
from PIL import Image
from pydantic import BaseModel
from pyproj import Transformer
from rasterio.warp import Resampling, calculate_default_transform, reproject
from starlette.status import HTTP_201_CREATED

from auto_georef.common.utils import time_since, timeit
from auto_georef.georef.autogeoreferencer import AutoGeoreferencer
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)

# load model once
AGR = AutoGeoreferencer()

router = APIRouter()


es = Elasticsearch([app_settings.es_endpoint_url,])


class ExtractPointsRequest(BaseModel):
    map_name: str


class ProjectMapRequest(BaseModel):
    map_id: str
    map_name: str
    crs: Optional[str]
    gcps: Optional[list]


class Proj_Status(Enum):
    CREATED ="created"
    SUCCESS = "success"
    FAILED = "failed"


class SaveProjInfo(BaseModel):
    map_id: str
    proj_id: str
    status: Proj_Status  


class EPSGLookupRequest(BaseModel):
    map_name: str
    bboxes: Optional[list]


class PromptRequest(BaseModel):
    prompt:str

class SearchMapsReq(BaseModel):
    query: str
    page: int = 1
    size: int = 10
    georeferenced: bool= False
    validated: bool= False
    random:bool = False


# s3 client builder
def s3_client():
    s3 = boto3.client(
        "s3",
        endpoint_url=app_settings.s3_endpoint_url,
        verify=False
    )
    return s3


# Metadata
@router.get("/maps")
def maps(georeferenced=True, validated=False, size=10000):
    print(georeferenced, validated)
    maps_loading = perf_counter()
    search_body = {
        "_source": ["map_name", "map_id", "georeferenced","validated"], 
        "query": {
            "bool": {
                "filter": [
                    {
                    "term": {
                        "georeferenced": georeferenced
                    }
                    },{"term":{
                        "validated": validated
                    }}
                ]
            }
        }
    }
    response = es.search(index="maps", body=search_body, size=size) 
    
    maps = [{"map_name":hit["_source"]["map_name"],
            "map_id":hit["_source"]["map_id"],
            "validated": hit['_source']['validated'],
            "georeferenced":hit["_source"]["georeferenced"]}
        for hit in response["hits"]["hits"] ]
    
    time_since(logger, "maps list loaded", maps_loading)
    return {"maps": maps}


@router.get("/random")
def map_random(georeferenced:bool = False):
    opts = maps(georeferenced)
    choice = random.choice(opts.get("maps"))
    logger.debug("select random: %s", choice)
    return {"map": choice['map_id']}


@router.post("/codes")
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


@timeit(logger)
def load_tiff(s3_key):
    s3 = s3_client()
    img = s3.get_object(Bucket=app_settings.s3_tiles_bucket, Key=s3_key)
    img_data = img.get("Body").read()
    return Image.open(io.BytesIO(img_data))


@timeit(logger)
def upload_s3_file(s3_key, fp):
    s3 = s3_client()
    s3.upload_file(fp, app_settings.s3_tiles_bucket, s3_key)


@timeit(logger)
def upload_s3_bytes(s3_key, xs: bytes):
    s3 = s3_client()
    s3.put_object(Body=xs, Bucket=app_settings.s3_tiles_bucket, Key=s3_key)


@timeit(logger)
def upload_s3_str(s3_key, sz):
    buff = io.BytesIO()
    buff.write(sz.encode())
    upload_s3_bytes(s3_key, buff.getvalue())


@timeit(logger)
def read_s3_contents(s3_key):
    s3 = s3_client()
    try:
        data = s3.get_object(Bucket=app_settings.s3_tiles_bucket, Key=s3_key)
        contents = data["Body"].read()
        return contents
    except s3.exceptions.NoSuchKey:
        logger.warning("NoSuchKey - %s", s3_key)
        return ""


@timeit(logger)
def s3_key_exists(s3_key):
    s3 = s3_client()
    try:
        s3.head_object(Bucket=app_settings.s3_tiles_bucket, Key=s3_key)
        return True
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            logger.warning("404 not found - %s ", s3_key)
        elif e.response["Error"]["Code"] == "403":
            logger.warning("403 unauthorized not found - %s", s3_key)
        else:
            raise
    return False



def es_search_map(index, map_id):
    query = {
        "query": {
            "match": {
                "map_id": map_id
            }
        }
    }
    response = es.search(index=index, body=query, size=100)
    if not response["hits"]["hits"]:
        return []
    return [x['_source'] for x in response['hits']['hits']]


@router.post("/maps/proj_info")
def save_proj_info(req: SaveProjInfo):
    map_id = req.map_id
    proj_id = req.proj_id
    status = req.status
    update_documents(index_name="proj_files", search_dict={"proj_id":proj_id}, update_body={
                "status":status.value
                })
    if status == Proj_Status.SUCCESS:
        update_documents(index_name="maps", search_dict={"map_id":map_id}, update_body={
                    "validated":True,
                    "modified": datetime.now(),
                    "finished": datetime.now(),
                    "finished_proj_id": proj_id
                    })
    if status == Proj_Status.FAILED:
        # maybe delete files on s3?
        pass


@router.get("/maps/gcps/{map_id}")
def map_gcps_(map_id: str):
    gcps = es_search_map("gcps", map_id)
    print(gcps, 'slkdfjslkdfjlksjfdsjk')
    return {'all_gcps': gcps}


@router.get("/maps/proj_info/{map_id}")
def map_projs_(map_id: str):
    projs = es_search_map("proj_files", map_id)
    return {'proj_info': projs}


@router.get("/maps/meta/{map_id}")
def map_info_(map_id: str):
    map_info = es_search_map("maps", map_id)[0]

    return {'map_info': map_info}

@router.post("/maps_search")
async def search_maps(req: SearchMapsReq ):
    page = req.page +1
    size = req.size
    q = req.query
    georeferenced = req.georeferenced
    validated = req.validated
    random_ = req.random

    if page < 1:
        raise HTTPException(status_code=400, detail="Page number must be greater than or equal to 1")

    # Calculate the "from" offset for pagination
    from_offset = (page - 1) * size
    
    if random_ == True:
        search_body={
            "size": size,
            "query": {
                "function_score": {
                    "query": {
                        "bool": {
                            "filter": [
                                {
                                "term": {
                                    "georeferenced": georeferenced
                                }
                                },
                                 {
                                "term": {
                                    "validated": validated
                                }
                                }
                            ]
                            }
                    },
                    "functions": [
                        {
                        "random_score": {}
                        }
                    ],
                    "boost_mode":"replace"
                }
            }
        }
    else:
        search_body = {
        "query": {
            "multi_match": {
                "query": q,
                "type":"phrase_prefix",
                "fields": ["map_name"] 
            },
        },
        "from": from_offset,
        "size": size
    }

    response = es.search(index='maps', body=search_body, size=size)
    return {
        "total": response["hits"]["total"]["value"],
        "results": [x['_source'] for x in response["hits"]["hits"]],
        "page": page,
        "size": size
    }

@router.get("/maps_stats")
def map_stats_():
    georeferenced= len(maps(georeferenced=True, validated=False)['maps'])
    validated = len(maps(georeferenced=True, validated=True)['maps'])
    not_georeferenced = len(maps(georeferenced=False, validated=False)['maps'])
    return {"georeferenced": georeferenced, "validated":validated, "not_georeferenced": not_georeferenced}

@router.get("/maps/{map_id}")
def map_info_(map_id: str):
    map_info = es_search_map("maps", map_id)[0]
    proj_info = es_search_map("proj_files", map_id)
    gcps = es_search_map("gcps", map_id)
    
    # convert to dict and set key. Saves additional looping
    gcps_={}
    for gcp in gcps:
        gcps_[gcp['gcp_id']]=gcp

    # add used points that created projection file
    for proj in proj_info:
        proj["gcps"]=[]
        for id in proj['gcps_ids']:
            proj["gcps"].append(gcps_[id])
            
        del proj['gcps_ids']

    return {"map_info":map_info, "proj_info":proj_info, "all_gcps":gcps}


# HACK for raw request
async def get_body(request: Request):
    return await request.body()


@router.post("/extract_gcps")
def extract_gcps(req: ExtractPointsRequest):
    # still works not need to maybe just return gcps that are created via AI.
    s3_key = f"{app_settings.s3_tiles_prefix}/{req.map_name}/{req.map_name}.cog.tif"

    logger.debug("extract_gcps - loading: %s", s3_key)
    img = load_tiff(s3_key)

    width, height = img.size
    logger.debug("w: %s, h: %s", width, height)

    start_autogeoref = perf_counter()

    cps = AGR.extract_control_points(img)

    for cp in cps:

        cp["rowb"] = height - cp["row"]
        cp["coll"] = cp["col"]

        del cp["row"]
        del cp["col"]
        del cp["crop_r"]
        del cp["crop_c"]
        logger.debug(cp)

    time_since(logger, "autogeoref gcps", start_autogeoref)

    return cps


@router.post("/project")
def project(req: ProjectMapRequest):
    map_name = req.map_name
    map_id = req.map_id
    cps = req.gcps
    gcps = req.gcps
    crs = req.crs


    s3_key = f"{app_settings.s3_tiles_prefix}/{map_name}/{map_name}.cog.tif"
    s3_pro_key = f"{app_settings.s3_tiles_prefix}/{map_name}/{map_name}.pro.cog.tif"

    if len(cps) == 0:
        raise HTTPException(status_code=404, detail="No Control Points Found!")

    start_proj = perf_counter()

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = os.path.join(tmpdir, f"{map_name}.cog.tif")
        pro_cog_path = os.path.join(tmpdir, f"{map_name}.pro.cog.tif")

        start_s3_load = perf_counter()
        # I tried rasterio's awssession - it is broken
        s3 = s3_client()
        s3.download_file(app_settings.s3_tiles_bucket, s3_key, raw_path)

        time_since(logger, "proj file loaded", start_s3_load)

        start_transform = perf_counter()

        # Convert to canonical form
        __src = rio.open(raw_path, "r")

        cps = [
            {
                "row": __src.height - float(cp["rowb"]),
                "col": float(cp["coll"]),
                "x": float(cp["x"]),
                "y": float(cp["y"]),
                "crs": cp["crs"],
            }
            for cp in cps
        ]

        cps_p = []
        for cp in cps:
            proj = Transformer.from_crs(cp["crs"], crs, always_xy=True)
            x_p, y_p = proj.transform(xx=cp["x"], yy=cp["y"])
            cps_p.append(riot.GroundControlPoint(row=cp["row"], col=cp["col"], x=x_p, y=y_p))

        geo_transform = riot.from_gcps(cps_p)

        time_since(logger, "geo_transform loaded", start_transform)

        start_reproj = perf_counter()

        with rio.open(raw_path) as raw:
            bounds = riot.array_bounds(raw.height, raw.width, geo_transform)
            pro_transform, pro_width, pro_height = calculate_default_transform(
                crs, crs, raw.width, raw.height, *tuple(bounds)
            )

            pro_kwargs = raw.profile.copy()
            pro_kwargs.update(
                {
                    "driver": "COG",
                    "crs": {"init": crs},
                    "transform": pro_transform,
                    "width": pro_width,
                    "height": pro_height,
                }
            )

            _raw_data = raw.read()
            with rio.open(pro_cog_path, "w", **pro_kwargs) as pro:
                for i in range(raw.count):
                    _ = reproject(
                        source=_raw_data[i],
                        destination=rio.band(pro, i + 1),
                        src_transform=geo_transform,
                        src_crs=crs,
                        dst_transform=pro_transform,
                        dst_crs=crs,
                        resampling=Resampling.bilinear,
                        num_threads=8,
                        warp_mem_limit=256,
                    )

        time_since(logger, "reprojection file created", start_reproj)

        upload_s3_file(s3_pro_key, pro_cog_path)

        crs_id = uuid.uuid4()
        proj_id = uuid.uuid4()
        s3_pro_unique_key = f"{app_settings.s3_tiles_prefix}/{map_name}/{map_name}_{proj_id}.pro.cog.tif"
        upload_s3_file(s3_pro_unique_key, pro_cog_path)

        # update ES 
        gcp_ids = updateGCPs(map_id, gcps)
        
        # save projection code
        saveESData("epsgs",{
                "epsg_id": crs_id ,
                "map_id": map_id,                   
                "epsg_code": crs,               
                "created": datetime.now(),                  
                "provenance":"UI",                 
                "extraction_model":None,          
                "extraction_model_version":None   
            })

        saveESData("proj_files",{
                    "proj_id":   proj_id,
                    "map_id":    map_id,            # map id
                    "epsg_code": crs,               # epsg_code used for reprojection
                    "epsg_id":   crs_id,            # epsg_id used which is the internal id in the epsg index
                    "created":   datetime.now(),
                    "source":    f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{s3_pro_key}",
                    "gcps_ids":  gcp_ids,
                    "status":    "created"
                })
        
        update_documents(index_name="maps", search_dict={"map_id":map_id}, update_body={
                "georeferenced":True,
                "modified":datetime.now()
            })

    time_since(logger, "total projection took", start_proj)

    return {"pro_cog_path": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{s3_pro_key}"}


def save_gcps_in_es(gcps, map_id):
    for gcp in gcps:
        gcp_data={
            "gcp_id": gcp['gcp_id'],             
            "map_id": map_id,                  
            "modified": datetime.now(),            
            "created": datetime.now(),                 
            "provenance":"UI",           
            "extraction_model":None,           
            "extraction_model_version":None,
            "rowb": gcp['rowb'],
            "coll": gcp['coll'],
            "x": gcp['x'],
            "y": gcp['y'],
            "crs": gcp['crs']  
        }
        try:
            response = es.index(index='gcps', document=gcp_data, refresh=True)
            print(f"save_gcps_gcps, {map_id}", gcp_data)
        except Exception as e:
            print(f"Error indexing map data: {e}")



def update_documents(index_name, search_dict, update_body):
    """
    Update documents in an Elasticsearch index based on matching key-value pairs.

    :param index_name: Name of the Elasticsearch index.
    :param search_dict: Dictionary with key-value pairs to match documents.
    :param update_body: Dictionary with key-value pairs to update in matching documents.
    :return: Number of updated documents.
    """
    # Constructing the search query
    must_clauses = [{"match": {k: v}} for k, v in search_dict.items()]
    search_query = {
        "query": {
            "bool": {
                "must": must_clauses
            }
        }
    }
    response = es.search(index=index_name, body=search_query, size=1000)

    doc_ids = [hit['_id'] for hit in response['hits']['hits']]

    actions = [
        {
            "_op_type": "update",
            "_index": index_name,
            "_id": doc_id,
            "doc": update_body
        }
        for doc_id in doc_ids
    ]

    success_count, failed_bulk_operations = helpers.bulk(es, actions)
    if failed_bulk_operations:
        print("Errors encountered during bulk update:", failed_bulk_operations)
    else:
        print(f"Successfully updated {success_count} documents.")

    return 

   
def saveESData(index, info):
    try:
        response = es.index(index=index, document=info, refresh=True)
        return response
    except Exception as e:
        print(f"Error indexing map data: {e}")
        return None


def update_document_by_id(index_name, doc_id, updates):
    """Update an Elasticsearch document by its ID with the provided updates."""
    try:
        response = es.update(
            index=index_name, 
            id=doc_id,
            body={
                "doc": updates
            },
            refresh=True
        )
        return response
    except Exception as e:
        print(f"Error updating document: {e}")
        return None


def updateGCPs(map_id, gcps):
    # get current gcps for this map.
    index_name = "gcps"
    query_body = {
        "query": {
            "term": {
                "map_id": map_id
            }
        }
    }
    response = es.search(index=index_name, body=query_body, size=1000)
    all_gcps={}
    for hit in response["hits"]["hits"]:
        all_gcps[hit['_source']['gcp_id']] = hit['_source']

    # now loop over each point that was used in projection
    # see if that gcp_id is already accounted for, 
    # if all the values are the same we leave it alone just save id wiht proj_info index
    # If values are different at all or "manual" found in gcp_id,
    #  create new id and save new point with updated values

    gcp_ids=[]
    new_gcps=[]
    for gcp in gcps:
        if gcp['gcp_id'] in all_gcps.keys():
            if compare_dicts(gcp, all_gcps[gcp['gcp_id']], ['x','y','rowb', "coll", "crs"]):
                print("Point has stayed the same")
                gcp_ids.append(gcp['gcp_id'])
                continue
        
        print('New point being created/saved')
        new_gcp = copy.deepcopy(gcp)
        new_gcp['gcp_id']=uuid.uuid4()
        gcp_ids.append(new_gcp['gcp_id'])
        new_gcps.append(new_gcp)

    save_gcps_in_es(gcps=new_gcps, map_id=map_id)
    return gcp_ids


def compare_dicts(dict1, dict2, keys):

    for key in keys:
        if dict1.get(key) != dict2.get(key):
            return False
    return True


def query_gpt4(prompt_text):
    endpoint = "https://api.openai.com/v1/chat/completions"  
    headers = {
        "Authorization": f"Bearer {app_settings.open_ai_key}", 
         "OPENAI_API_KEY":f"{app_settings.open_ai_key}", 
        "Content-Type": "application/json",
        "User-Agent": "OpenAI-Python-Client"
    }
    
    data = {
        "model":"gpt-3.5-turbo",
        "messages": [{"role":"user","content":prompt_text}],
        "max_tokens": 550  
    }
    
    response = requests.post(endpoint, headers=headers, json=data)
    
    if response.status_code == 200:
        choices=response.json()['choices']
        print(choices)
        first_message = choices[0]['message']['content']
        matches = re.findall(r'EPSG:\d+', first_message)

        return {"matches":matches,"reasoning":first_message}
    else:
        raise Exception(f"API call failed with status code {response.status_code}: {response.text}")



@router.post("/tif_ocr")
def ocr(req:EPSGLookupRequest):
    bboxes = req.bboxes
    s3_key = f"{app_settings.s3_tiles_prefix}/{req.map_name}/{req.map_name}.cog.tif"

    logger.debug("Crop Tiff for ocr - loading: %s", s3_key)
    img = load_tiff(s3_key)
    all_text=""
    for bbox in bboxes:
        cropped_img = img.crop((bbox[0], img.size[1]-bbox[3] , bbox[2], img.size[1]-bbox[1] ))
        all_text= all_text +" "+ pytesseract.image_to_string(cropped_img)
    all_text=all_text.replace('\n', ' ')

    return {'extracted_text':all_text}


@router.post("/send_prompt")
def send_prompt(req:PromptRequest):
    return query_gpt4(req.prompt)