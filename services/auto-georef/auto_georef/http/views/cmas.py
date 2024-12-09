import logging
from datetime import datetime
from logging import Logger
from typing import Annotated
from functools import reduce

import httpx
from fastapi import APIRouter, Form, Request

from ...settings import app_settings
from ...templates import templates
from .common import extraction_colors, format_map

logger: Logger = logging.getLogger(__name__)

router = APIRouter()


auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


@router.get("/")
def index(request: Request):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cmas?size=60"
    response = httpx.get(fetch_url, headers=auth, timeout=None)
    cmas = response.json()

    return templates.TemplateResponse(
        "cma/index.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            "failed": response.status_code != 200,
            "cmas": cmas,
        },
    )


def NoneToEmptyStr(val):
    return "" if val is None else val


def replaceNoneInDict(myDict):
    return {k: NoneToEmptyStr(v) for k, v in myDict.items()}


VALIDATED_INDEX = 0
PENDING_INDEX = 1
EMPTY_INDEX = 2

extraction_headings = {
    "projections": "Projections",
    "legend_items": "Legends",
    "points": "Points",
    "lines": "Lines",
    "polygons": "Polygons",
}


def reformat_dict(input_dict): 
    """
    Reformats inconsistent cdr total,validated count keys for each
    feature_type to the same keys: either to "validated" or "total". Sample input:
    {"total_lines":..., "total_validated_lines"} or {"georeference_count":..., "validated_count":...}
    output: {"validated":..., "total":...}
    """
    output_dict = {} 
    for key, value in input_dict.items():
        if "validated" in key: 
            output_dict["validated"] = value 
        else:
            output_dict["total"] = value 
    return output_dict


def group_totals(acc, cog_dict):
    if cog_dict["validated"] > 0:
        acc[VALIDATED_INDEX] += 1
    elif cog_dict["total"] > 0:
        acc[PENDING_INDEX] += 1
    else:
        acc[EMPTY_INDEX] += 1
    return acc


def accumulate_stats_for_feature(cog_stats_for_feature):
    totals = [0,0,0]
    formatted = map(reformat_dict, cog_stats_for_feature.values())
    totals = reduce(group_totals, formatted, totals)
    return totals


@router.get("/cma-stats")
def get_cma_stats(request: Request, cma_id):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cma?cma_id={cma_id}"
    response = httpx.get(fetch_url, headers=auth, timeout=None)

    cma = response.json()
    cogs = cma.get("cogs")

    stats = {
        "projections": [0, 0, 0],
        "legend_items": [0, 0, 0],
        "lines": [0, 0, 0],
        "points": [0, 0, 0],
        "polygons": [0, 0, 0],
    }

    cdr_features = ["projection", "point", "line", "polygon", "legend_item"]

    stats_url = f"{app_settings.cdr_endpoint_url}/v1/features/feature_type/statistics"
    for feature_type in cdr_features:
        stat_call = httpx.post(stats_url, headers=auth, timeout=None, json={
            "cog_ids": list(map(lambda c: c["cog_id"], cogs)),
            "feature_type": feature_type
        })
    #     # sample response:
    #     # {
    #     #   "46d902d905b92df90c39447955b9593d583d5a9d322525252525252583679344": {
    #     #     "georeferenced_count": 8,
    #     #     "validated_count": 2
    #     #   },
    #     #   "48e472e466e504e50cd54eb561b5c4b516b53bb53db51cb5d8b471b557844f0a": {
    #     #     "georeferenced_count": 4,
    #     #     "validated_count": 2
    #     #   }
    #     # }
        if stat_call.status_code == 200:
            # endpoint was already pluralizing, so we'll add (s) from cdr singular feature_type..
            stats[f"{feature_type}s"] = accumulate_stats_for_feature(stat_call.json())
        # for now else means stats remains at 0

    return templates.TemplateResponse(
        "cma/stats-charts.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            "stats": stats,
            "cma": cma,
            "categories": list(stats.keys()),
            "headings": extraction_headings,
            "colors": extraction_colors,
        },
    )


@router.post("/details")
def get_cma_maps(request: Request, cma_id: Annotated[str, Form()]):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cma?cma_id={cma_id}"
    response = httpx.get(fetch_url, headers=auth, timeout=None)

    cma = response.json()
    cogs = cma.get("cogs")
    # MOCK:
    # cogs = [
    #     {
    #         "thumbnail_url": None,
    #         "state": None,
    #         "cog_name": None,
    #         "publish_year": None,
    #         "quadrangle": None,
    #         "alternate_name": None,
    #         "keywords": None,
    #         "ngmdb_prod": None,
    #         "citation": None,
    #         "ngmdb_item": None,
    #         "cog_id": "331329132db72337251b29db18ef38eb2a732c6b249316530d43151f371f191f",
    #         "scale": None,
    #         "has_part_names": None,
    #         "cog_url": None,
    #         "publisher": None,
    #         "cog_size": None,
    #         "best_bounds": None,
    #         "provider_name": None,
    #         "display_links_str": None,
    #         "no_map": None,
    #         "authors": None,
    #         "provider_url": None,
    #         "original_download_url": None,
    #         "georeferenced_count": 0,
    #         "validated_count": 0
    #     }
    # ]
    if cogs:
        cogs = map(replaceNoneInDict, cogs)
        maps = list(map(format_map, cogs))
    else:
        maps = []

    creation_dt = cma["creation_date"][:26]  # ignore extra msecs decimals...
    dt = datetime.strptime(creation_dt, "%Y-%m-%dT%H:%M:%S.%f")
    date_created = datetime.strftime(dt, "%Y-%m-%d")

    return templates.TemplateResponse(
        "cma/details.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            "maps_ui_base_url": app_settings.maps_ui_base_url,
            "maps": maps,
            "cma": cma,
            "date_created": date_created,
        },
    )