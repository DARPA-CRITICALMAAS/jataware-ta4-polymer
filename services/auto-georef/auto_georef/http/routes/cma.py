import logging
from logging import Logger
from typing import List

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

router = APIRouter()

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


@router.get("/")
def list_cmas():
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cmas?size=40"
    response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status()
    return response.json()


@router.get("/{cma_id}")
def get_cma(cma_id):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cma?cma_id={cma_id}"
    response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status()
    return response.json()


class LinkCOGBody(BaseModel):
    cog_ids: List[str]


@router.post("/{cma_id}/link")
def link_cma(cma_id, body: LinkCOGBody):
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/link_cma_cogs"

    data = {"cma_id": cma_id, "cog_ids": body.cog_ids}

    response = httpx.post(url, headers=auth, timeout=None, json=data).raise_for_status()
    return True


@router.post("/{cma_id}/unlink")
def unlink_cma(cma_id, body: LinkCOGBody):
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/unlink_cma_cogs"
    data = {"cma_id": cma_id, "cog_ids": body.cog_ids}

    response = httpx.post(url, headers=auth, timeout=None, json=data).raise_for_status()
    return True