import logging
import os
import random
import tempfile
from logging import Logger
from time import perf_counter
from typing import Optional
from elasticsearch import Elasticsearch
import uuid
from datetime import datetime
from enum import Enum
import pyproj
import rasterio as rio
import rasterio.transform as riot
from fastapi import (
    APIRouter,
    HTTPException,
    UploadFile,
)
from osgeo import gdal

from wand.image import Image as wandImage
from PIL import Image
import pytesseract
from PIL import Image
from pydantic import BaseModel
from starlette.status import (
    HTTP_201_CREATED,
    HTTP_200_OK,
    HTTP_404_NOT_FOUND,
    HTTP_400_BAD_REQUEST,
)
Image.MAX_IMAGE_PIXELS = None
from cachetools import TTLCache
cache = TTLCache(maxsize=50, ttl=500)  


from auto_georef.common.utils import time_since, s3_client, load_tiff_cache, upload_s3_file

from auto_georef.georef.autogeoreferencer import AutoGeoreferencer
from auto_georef.settings import app_settings
from auto_georef.common.map_utils import (
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
    generate_map_id
)

logger: Logger = logging.getLogger(__name__)

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

class ProjectMapRequest(BaseModel):
    map_id: str
    map_name: str
    crs: Optional[str]
    gcps: Optional[list]


class Proj_Status(Enum):
    CREATED = "created"
    SUCCESS = "success"
    FAILED = "failed"


class SaveProjInfo(BaseModel):
    map_id: str
    proj_id: str
    status: Proj_Status



class PromptRequest(BaseModel):
    prompt: str


class SearchMapsReq(BaseModel):
    query: str
    page: int = 1
    size: int = 10
    georeferenced: bool = False
    validated: bool = False
    random: bool = False


########################### GETs ###########################


@router.get("/maps", status_code=HTTP_200_OK)
def maps(georeferenced=True, validated=False, size=10000):
    maps_loading = perf_counter()
    search_body = {
        "_source": ["map_name", "map_id", "georeferenced", "validated"],
        "query": {
            "bool": {
                "filter": [
                    {"term": {"georeferenced": georeferenced}},
                    {"term": {"validated": validated}},
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
        }
        for hit in response["hits"]["hits"]
    ]

    time_since(logger, "maps list loaded", maps_loading)
    return {"maps": maps}


@router.get("/random", status_code=HTTP_200_OK)
def map_random(georeferenced: bool = False):
    opts = maps(georeferenced)
    choice = random.choice(opts.get("maps"))
    logger.debug("select random: %s", choice)
    return {"map": choice["map_id"]}


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
    georeferenced = len(maps(georeferenced=True, validated=False)["maps"])
    validated = len(maps(georeferenced=True, validated=True)["maps"])
    not_georeferenced = len(maps(georeferenced=False, validated=False)["maps"])
    return {
        "georeferenced": georeferenced,
        "validated": validated,
        "not_georeferenced": not_georeferenced,
    }


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


@router.post("/extract_gcps")
def extract_gcps(req: ExtractPointsRequest):
    # still works not need to maybe just return gcps that are created via AI.
    s3_key = f"{app_settings.s3_tiles_prefix_v2}/{req.map_id}/{req.map_id}.cog.tif"

    logger.debug("extract_gcps - loading: %s", s3_key)
    img = load_tiff_cache(cache, s3_key)

    start_autogeoref = perf_counter()
    cps = extract_gcps_(AGR, img)

    time_since(logger, "autogeoref gcps", start_autogeoref)

    return cps


@router.post("/proj_info", status_code=HTTP_201_CREATED)
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

    return {"message": "projection updated"}


@router.post("/maps_search")
async def search_maps(req: SearchMapsReq):
    page = req.page + 1
    size = req.size
    q = req.query
    georeferenced = req.georeferenced
    validated = req.validated
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


@router.post("/project")
def project(req: ProjectMapRequest):
    map_name = req.map_name
    map_id = req.map_id
    cps = req.gcps
    gcps = req.gcps
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
        s3_pro_unique_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"
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
                "transformation": "polynomial_1"

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
def ocr(req: OCRRequest):
    bboxes = req.bboxes
    s3_key = f"{app_settings.s3_tiles_prefix_v2}/{req.map_id}/{req.map_id}.cog.tif"

    logger.debug("Crop Tiff for ocr - loading: %s", s3_key)
    img = load_tiff_cache(cache, s3_key)
    all_text = ""
    for bbox in bboxes:
        cropped_img = img.crop(
            (bbox[0], img.size[1] - bbox[3], bbox[2], img.size[1] - bbox[1])
        )
        all_text = all_text + " " + pytesseract.image_to_string(cropped_img)
    all_text = all_text.replace("\n", " ")

    return {"extracted_text": all_text}


@router.post("/send_prompt")
def send_prompt(req: PromptRequest):
    return query_gpt4(req.prompt)


@router.post("/processMap")
async def upload_file(file: UploadFile):
    #  Only tif files supported

    if not file.filename.endswith(".tif"):
        raise HTTPException(
            status_code=400, detail="Invalid file type. Only TIFF files are allowed."
        )

    #  map name with . replaced with _ incase . is in filename
    map_name = file.filename.split(".tif")[0].replace(".", "_")
    
    # read uploaded file and save to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".tif") as temp_file:
        # Read and write to a temporary file
        file_contents = file.file.read()
        temp_file.write(file_contents)
        temp_file_path = temp_file.name

    # Now open it with GDAL to save crs info
    original_crs = return_crs(temp_file_path)
    # save a version of the uploaded file with no crs info
    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, map_name + ".tif")
        with wandImage(blob=file_contents) as img:
            img.strip()
            img.save(filename=output_path)

        cog_path = output_path.split(".tif")[0] + ".cog.tif"
        
        # convert tif to cog
        saveTifasCog(file_path=output_path, cog_path=cog_path)
        map_id = generate_map_id(cog_path)
        if document_exists(es, app_settings.maps_index, map_id):
            raise HTTPException(
                status_code=400, detail="Map has already been uploaded."
            )
        
        s3_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}"+'.cog.tif'

        # save cog file to s3
        upload_s3_file(s3_key, cog_path)

        # open local cog file to extract gcps and read height/width
        img = Image.open(output_path)
        width, height = img.size
        gcps = extract_gcps_(AGR, img)
        for gcp in gcps:
            # add unique id for gcps
            gcp["gcp_id"] = uuid.uuid4()

        # save gcps
        gcps_ = prepare_gcps_for_es(
            gcps=gcps,
            map_id=map_id,
            extraction_model="jataware_gcp_extractor",
            extraction_model_version="0.0.1",
        )
        try:
            for gcp_data in gcps_:
                saveESData(es = es, 
                            index=app_settings.gcps_index, 
                            info=gcp_data,
                            id=gcp_data['gcp_id'])
        except Exception as e:
            print(f"Error indexing gcp data: {e}")

        if len(gcps) < 4:
            logging.info("Failed to find enough gcps")
            saveESData(
                es=es,
                index=app_settings.maps_index,
                info={
                    "map_id": map_id,
                    "map_name": map_name,
                    "height": height,
                    "width": width,
                    "finished_proj_id": None,
                    "georeferenced": False,
                    "validated": False,
                    "modified": datetime.now(),
                    "created": datetime.now(),
                    "finished": None,
                    "source": f"{app_settings.s3_endpoint_url}/{app_settings.s3_tiles_bucket}/{app_settings.s3_tiles_prefix}/{map_id}/{map_id}.cog.tif",
                    "original_crs": original_crs,
                },
                id=map_id,
            )
            return {
                "message": "File uploaded successfully, unable to georeference due to lack of gcps"
            }
        CRSs = []
        all_crs = generateCrsListFromGCPs(gcps=gcps)
        CRSs = filterCRSList(all_crs)
        for crs_id in CRSs:
            epsg_id = uuid.uuid4()

            saveESData(
                es=es,
                index=app_settings.epsgs_index,
                info={
                    "epsg_id": epsg_id,
                    "map_id": map_id,
                    "epsg_code": crs_id,
                    "created": datetime.now(),
                    "provenance": "api_endpoint",
                    "extraction_model": None,
                    "extraction_model_version": None,
                },
                id=epsg_id,
            )
            ### create proj_id hash ###
            # if we want determistic ids add gcps ids to proj_id and proj_crs code
            # sorted_cps = sorted(gcps, key=lambda item: (item['rowb'], item['coll'], item['x'] ))
            # proj_id = hashlib.sha256((crs_id + concat_values(sorted_cps)).encode()).hexdigest()

            proj_id = uuid.uuid4()
            pro_cog_path = os.path.join(tmpdir, f"{map_id}_{proj_id}.pro.cog.tif")
            geo_transform = cps_to_transform(gcps, height=height, to_crs=crs_id)

            project_(cog_path, pro_cog_path, geo_transform, crs_id)

            s3_pro_key = f"{app_settings.s3_tiles_prefix_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"

            upload_s3_file(s3_pro_key, pro_cog_path)

            saveESData(
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
                    "provenance": "api_endpoint",
                    "transformation": "polynomial_1"

                },
                id=proj_id,
            )

        saveESData(
            es=es,
            index=app_settings.maps_index,
            info={
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
            },
            id=map_id,
        )

    return {"message": "File uploaded and georeferenced without errors"}

