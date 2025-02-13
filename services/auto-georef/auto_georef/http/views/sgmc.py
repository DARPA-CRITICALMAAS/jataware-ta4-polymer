# import json
import logging
from logging import Logger
from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

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
        "sgmc/index.html.jinja",
        {
            "request": request,
            "rock_units_uri": f"{app_settings.template_prefix}/get-rock-units",
            "template_prefix": app_settings.template_prefix,
            "list_cmas_uri": f"{app_settings.template_prefix}/list-cmas",
            "job_status_uris": job_status_uris,
            "download_feature_package_uri": f"{app_settings.template_prefix}/sgmc/create-features-package",
            "rasterize_evidence_layers_uri": f"{app_settings.template_prefix}/sgmc/rasterize-layers",
            "processed_data_layers_uri": f"{app_settings.template_prefix}/features/processed_data_layers",
            "tile_host": app_settings.cdr_endpoint_url,
            "token": app_settings.cdr_bearer_token,
        },
    )


class SGMCPackageData(BaseModel):
    sgmc_geology_major_1: List[str] = Field(default_factory=list)
    sgmc_geology_major_2: List[str] = Field(default_factory=list)
    sgmc_geology_major_3: List[str] = Field(default_factory=list)
    sgmc_geology_minor_1: List[str] = Field(default_factory=list)
    sgmc_geology_minor_2: List[str] = Field(default_factory=list)
    sgmc_geology_minor_3: List[str] = Field(default_factory=list)
    sgmc_geology_minor_4: List[str] = Field(default_factory=list)
    sgmc_geology_minor_5: List[str] = Field(default_factory=list)
    cma_id: str = ""


@router.post("/create-features-package")
def create_features_package(request: Request, data: SGMCPackageData):
    url = f"{app_settings.cdr_endpoint_url}/v1/sgmc/intersect_package"
    raw_data = data.dict()
    job_response = httpx.post(url, headers=auth, timeout=None, json=raw_data)
    if job_response.status_code == 200:
        job_id = job_response.json()["job_id"]
        return job_id

    raise HTTPException(status_code=job_response.status_code, detail=job_response.text)


@router.post("/rasterize-layers")
def create_rasterized_layers(request: Request, data: SGMCPackageData):
    url = f"{app_settings.cdr_endpoint_url}/v1/sgmc/intersect_package_to_raster"
    raw_data = data.dict()

    job_response = httpx.post(url, headers=auth, timeout=None, json=raw_data)
    if job_response.status_code == 200:
        job_id = job_response.json()["job_id"]
        return job_id

    raise HTTPException(status_code=job_response.status_code, detail=job_response.text)
