# import json
import logging
from logging import Logger
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)

router = APIRouter()

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


@router.get("/")
def index(request: Request):
    job_status_uris = [
        f"{app_settings.template_prefix}/features/creation-job-status",
        f"{app_settings.template_prefix}/features/creation-job-result",
    ]

    return templates.TemplateResponse(
        "features/index.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            "list_cmas_uri": f"{app_settings.template_prefix}/list-cmas",
            "map_meta_uri": f"{app_settings.template_prefix}/features/get-map-meta",
            "job_status_uris": job_status_uris,
            "download_feature_package_uri": f"{app_settings.template_prefix}/features/create-features-package",
            "rasterize_evidence_layers_uri": f"{app_settings.template_prefix}/features/rasterize-layers",
            "processed_data_layers_uri": f"{app_settings.template_prefix}/features/processed_data_layers",
            "tile_host": app_settings.cdr_endpoint_url,
            "token": app_settings.cdr_bearer_token,
        },
    )


@router.get("/job-status-tracker")
def job_status_tracker(request: Request, job_id, title=None, job_type="raster"):
    url = f"{app_settings.cdr_endpoint_url}/v1/jobs/status/{job_id}"
    response = httpx.get(url, headers=auth, timeout=None)

    if response.status_code == 200:
        data = response.json()
        return templates.TemplateResponse(
            "features/job-status.html.jinja",
            {
                "request": request,
                "template_prefix": app_settings.template_prefix,
                "job_id": job_id,
                "title": title,
                "job_type": job_type,
                "status": data["status"],
            },
        )

    return templates.TemplateResponse(
        "features/job-status.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            "job_id": job_id,
            "title": title,
            "error": True,
        },
    )


###############################################################################
#         Non-htmx,jinja-template Responses
#         TODO possibly move to ../routes
###############################################################################


@router.get("/get-map-meta")
def get_map_meta(request: Request, cog_id: str):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/meta/{cog_id}"
    response = httpx.get(fetch_url, headers=auth, timeout=None)  # .raise_for_status()
    if response.status_code == 200:
        return response.json()
    elif response.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Map with id {cog_id} not found in cdr.")
    else:
        # Return other status codes with the same response content
        raise HTTPException(status_code=response.status_code, detail=response.text)


class FeaturePackageData(BaseModel):
    cog_ids: Optional[List[str]] = None
    category: str
    search_terms: Optional[List[str]] = []
    validated: Optional[bool] = None
    intercept_polygon: Optional[Any] = None  # unused for now
    cma_id: str = ""


def fetch_cog_ids_for_CMA_ID(cma_id):
    """
    Helper fn to get all cog_ids that belong to a CMA given the cma_id.
    """
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cma?cma_id={cma_id}"
    response = httpx.get(url, headers=auth)
    data = response.json()
    return list(map(lambda cog: cog["cog_id"], data["cogs"]))


@router.post("/create-features-package")
def create_features_package(request: Request, data: FeaturePackageData):
    url = f"{app_settings.cdr_endpoint_url}/v1/features/intersect_package"

    raw_data = data.dict()
    if raw_data["cma_id"]:
        raw_data["cog_ids"] = fetch_cog_ids_for_CMA_ID(raw_data["cma_id"])

    job_response = httpx.post(url, headers=auth, timeout=None, json=raw_data)
    if job_response.status_code == 200:
        job_id = job_response.json()["job_id"]
        return job_id

    raise HTTPException(status_code=job_response.status_code, detail=job_response.text)


@router.get("/creation-job-status")
def get_job_creation_status(request: Request, job_id: str):
    url = f"{app_settings.cdr_endpoint_url}/v1/jobs/status/{job_id}"
    response = httpx.get(url, headers=auth, timeout=None)

    if response.status_code == 200:
        return response.json()

    raise HTTPException(status_code=response.status_code, detail=response.text)


@router.get("/creation-job-result")
def get_job_creation_result(request: Request, job_id: str):
    url = f"{app_settings.cdr_endpoint_url}/v1/jobs/result/{job_id}"
    response = httpx.get(url, headers=auth, timeout=None)

    if response.status_code == 200:
        return response.json()

    raise HTTPException(status_code=response.status_code, detail=response.text)


class RasterizeLayerData(BaseModel):
    category: str
    search_terms: Optional[List[str]] = []
    validated: Optional[bool] = None
    cma_id: str
    title: str


@router.post("/rasterize-layers")
def create_rasterized_layers(request: Request, data: RasterizeLayerData):
    url = f"{app_settings.cdr_endpoint_url}/v1/features/intersect_package_to_raster"
    raw_data = data.dict()

    job_response = httpx.post(url, headers=auth, timeout=None, json=raw_data)
    if job_response.status_code == 200:
        job_id = job_response.json()["job_id"]
        return job_id

    raise HTTPException(status_code=job_response.status_code, detail=job_response.text)


@router.get("/processed_data_layers")
def get_processed_data_layers(request: Request, event_id: str):
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/processed_data_layers?event_id={event_id}"
    response = httpx.get(url, headers=auth, timeout=None)

    if response.status_code == 200:
        return response.json()

    raise HTTPException(status_code=response.status_code, detail=response.text)
