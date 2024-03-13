import logging
import os
import tempfile
from logging import Logger
from time import perf_counter
import uuid
from fastapi import APIRouter
from fastapi import BackgroundTasks, Depends, HTTPException, Request, status
# from fastapi.concurrency import run_in_threadpool
import tempfile
import os
from PIL import Image
from time import perf_counter
from typing import Any
from pydantic import BaseModel
import hmac
import httpx
import hashlib
from fastapi.security import APIKeyHeader
from cdr_schemas.events import MapEventPayload
from cdr_schemas.georeference import GeoreferenceResults

Image.MAX_IMAGE_PIXELS = None

from starlette.background import BackgroundTasks


from jataware_georef.common.utils import (
    time_since,
    s3_client,
    # upload_s3_file
)

from jataware_georef.georef.autogeoreferencer import AutoGeoreferencer
from jataware_georef.settings import app_settings
from jataware_georef.common.map_utils import (
    extract_gcps_,
    cps_to_transform,
    project_,
    generateCrsListFromGCPs,
    filterCRSList
)
from urllib.parse import urlparse


logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

AGR = AutoGeoreferencer()

router = APIRouter()


auth = {
    "Authorization": app_settings.cdr_bearer_token,
}

class Event(BaseModel):
    id: str
    event: str
    payload: Any | None

########################### helpers ###################

async def post_results(files, data):    
    async with httpx.AsyncClient(timeout=None) as client:
        data_ = {
            "georef_result": data  # Marking the part as JSON
        }
        files_ = []
        for file_path, file_name in files:
            files_.append(("files", (file_name, open(file_path, "rb"))))
        try:
            if len(files_)>0:
                logging.debug(f'files to be sent {files_}')
                logging.debug(f'data to be sent {data_}')
                r = await client.post(app_settings.cdr_endpoint_url, files=files_, data=data_, headers=auth)
                logging.error(f'response text {r.text}')
                r.raise_for_status()
            else:
                logging.debug(f'files to be sent {files_}')
                logging.debug(f'data to be sent {data_}')
                r = await client.post(app_settings.cdr_endpoint_url,files=[], data=data_, headers=auth)
                logging.error(f'response text {r.text}')
                r.raise_for_status()
        except Exception as e:
            logging.info(e)


def extract_s3_info(s3_url):
    parsed = urlparse(s3_url)
    if parsed.netloc.endswith('amazonaws.com'):
        parts = parsed.path.lstrip('/').split('/', 1)
        if parsed.netloc.startswith('s3'):
            # Path-style URL
            bucket = parts[0]
            path = parts[1] if len(parts) > 1 else ''
        else:
            # Virtual-hosted style URL
            bucket = parsed.netloc.split('.')[0]
            path = parsed.path.lstrip('/')
    else:
        raise ValueError("URL does not appear to be an S3 URL")
    
    return bucket, path


@router.post("/georeference_map")
async def georeference_map(req: MapEventPayload,  response_model=GeoreferenceResults):
    map_id = req['map_id']
    cog_url = req['cog_url']
    bucket, s3_key = extract_s3_info(cog_url)

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = os.path.join(tmpdir, f"{s3_key.split('/')[1]}")

        start_s3_load = perf_counter()
        s3 = s3_client()
        s3.download_file(bucket, s3_key, raw_path)

        time_since(logger, "proj file loaded", start_s3_load)

        start_transform = perf_counter()

        img = Image.open(raw_path)
        width, height = img.size
        gcps = extract_gcps_(AGR, img)

        for gcp in gcps:
            gcp["gcp_id"] = str(uuid.uuid4())

        if len(gcps) < 4:
            logging.info("Failed to find enough gcps")
            # send just json
            all_gcps=[]
            for gcp in gcps:
                all_gcps.append(
                        {
                            "gcp_id": gcp["gcp_id"],
                            "map_geom": {
                                "type":"Point",
                                "coordinates": [gcp["x"], gcp["y"]]
                                },
                            "px_geom": {
                                "type":"Point",
                                "coordinates": [gcp["coll"], gcp["rowb"]]
                                },
                            "confidence":None,
                            "model": "jataware_extraction",
                            "model_version": "0.0.1",
                            "crs":gcp['crs']
                        }
                )
            if len(all_gcps)==0:
                all_gcps = []

            results = GeoreferenceResults(**{
                        "map_id" : map_id,
                        "likely_CRSs": [],
                        "gcps" : all_gcps,
                        "projections": [],
                        "system" : "jataware_georef",
                        "system_version": "0.1.0"
                    }).json()
                
            await post_results(files=[], data=results)
            return results
        
        else:
            CRSs = []
            all_crs = generateCrsListFromGCPs(gcps=gcps)
            CRSs = filterCRSList(all_crs)

            all_gcps = []
            gcp_ids = []

            for gcp in gcps:
                gcp_ids.append(str(gcp["gcp_id"]))
                all_gcps.append(
                        {
                            "gcp_id": str(gcp["gcp_id"]),
                            "map_geom": {
                                "type": "Point",
                                "coordinates": [gcp["x"], gcp["y"]]
                                },
                            "px_geom": {
                                "type": "Point",
                                "coordinates": [gcp["coll"], gcp["rowb"]]
                                },
                            "confidence":None,
                            "model": "jataware_extraction",
                            "model_version": "0.0.1",
                            "crs": gcp['crs']
                        }
                )

            all_files = []
            all_projections = []

            for crs_id in CRSs:                
                proj_id = uuid.uuid4()
                proj_file_name = f"{map_id}_{proj_id}.pro.cog.tif"

                pro_cog_path = os.path.join(tmpdir, proj_file_name)
                geo_transform = cps_to_transform(gcps, height=height, to_crs=crs_id)
                time_since(logger, "geo_transform loaded", start_transform)

                project_(raw_path, pro_cog_path, geo_transform, crs_id)

                all_projections.append({
                    "crs": crs_id,
                    "gcp_ids": gcp_ids,
                    "file_name": proj_file_name
                })

                all_files.append((pro_cog_path, proj_file_name))


                # # sending to minio for local testing
                # s3_pro_key = f"cogs/{map_id}_{proj_id}.pro.cog.tif"
                # await run_in_threadpool(lambda:upload_s3_file(s3_pro_key, bucket, pro_cog_path))

            data = GeoreferenceResults(**{
                            "map_id" : map_id,
                            "likely_CRSs": CRSs,
                            "gcps" : all_gcps,
                            "projections": all_projections,
                            "system" : "jataware_georef",
                            "system_version": "0.1.0"
                    }).json()
            
            await post_results(files=all_files, data=data)
            return data


cdr_signiture = APIKeyHeader(name="x-cdr-signature-256")


async def verify_signature(request: Request, signature_header: str = Depends(cdr_signiture)):

    payload_body = await request.body()
    if not signature_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="x-hub-signature-256 header is missing!")

    hash_object = hmac.new(app_settings.secret_token.encode(
        "utf-8"), msg=payload_body, digestmod=hashlib.sha256)
    expected_signature = hash_object.hexdigest()
    if not hmac.compare_digest(expected_signature, signature_header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Request signatures didn't match!")

    return True


async def event_handler(evt: Event):
    logger.info("New Event: %s ", evt.event)
    logger.info("Payload  %s ", evt.payload)
    try:
        match evt:
            case Event(event="ping"):
                logging.info(evt)
                logger.info("PING")
            case Event(event="map.process"):
                await georeference_map(evt.payload)
            case _:
                logger.warning("nothing to do for event: %s", evt)

    except Exception:
        logger.exception("background processing event: %s", evt)


@router.post("/project")
async def hook(
    evt: Event,
    background_tasks: BackgroundTasks,
    request: Request,
    verified_signature: bool = Depends(verify_signature),
):
    logging.error(request)
    logger.debug(f"{verified_signature=}")
    background_tasks.add_task(event_handler, evt)
    return {"ok": "success"}