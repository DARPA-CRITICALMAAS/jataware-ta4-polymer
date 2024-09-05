import copy
import json
import logging
from logging import Logger
from typing import Annotated
from urllib.parse import parse_qsl, urlencode, urlparse
import time
from functools import lru_cache

import httpx
from fastapi import APIRouter, Form, Request

from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)

router = APIRouter()


auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


def ttl_lru_cache(seconds_to_live: int, maxsize: int = 128):
    """
    Time aware lru caching
    """
    def wrapper(func):

        @lru_cache(maxsize)
        def inner(__ttl, *args, **kwargs):
            # Note that __ttl is not passed down to func,
            # as it's only used to trigger cache miss after some time
            return func(*args, **kwargs)
        return lambda *args, **kwargs: inner(time.time() // seconds_to_live, *args, **kwargs)
    return wrapper


@ttl_lru_cache(seconds_to_live=10)
def get_cmas():
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/cmas?size=40"
    response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status()
    return response.json()


@router.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        "index/index.html.jinja",
        {
            "request": request,
            "upload_map_url": "/ui/upload/v1/maps/upload/map",
            "job_url": "/ui/upload/v1/jobs/status/",
            "template_prefix": app_settings.template_prefix,
            "rock_units_uri": f"{app_settings.template_prefix}/get-rock-units",
            "list_cmas_uri": f"{app_settings.template_prefix}/cma",
        },
    )


def patch_url(url, **kwargs):
    """
    Updates query string using kwargs
    Example: input_url = "http://sample.com?count=1"
    patch_url(input_url, page=15) # out: "http://sample/com?count=1&page=15"
    Works as well if query params were missing initially (appends ? instead of &)
    """
    return urlparse(url)._replace(query=urlencode(dict(parse_qsl(urlparse(url).query), **kwargs))).geturl()


def format_scale(scale):
    """
    Adds metric scale to numbers. Examples:
    2000 => 2k
    1000000 => 1000K
    1 => 1
    """
    try:
        return "{:,.0f}".format(scale / 1000).replace(",", "") + "K"
    except TypeError:
        return scale


def format_map(m):
    """
    Formats a map entry, for now adds the proper catalog ngmdb url and formats
    scale.
    """
    provider_catalog_url = m["provider_url"]
    cog_id = m["cog_id"]

    if m["ngmdb_prod"]:
        provider_catalog_url = f"{m['provider_url']}/Prodesc/proddesc_{m['ngmdb_prod']}.htm"
    return m | {
        "provider_catalog_url": provider_catalog_url,
        "fmt_scale": format_scale(m["scale"]),
        "gcp_url": f"/points/{m['cog_id']}",
        "thumbnail": f"https://s3.amazonaws.com/public.cdr.land/cogs/thumbnails/{cog_id}_300x300.jpg",
    }


# TODO features_extracted and legends_extracted is not implemented in CDR yet, so we ignore those
@router.post("/search-maps")
def search_maps(
    request: Request,
    # Form data attributes (not json)
    search_text: Annotated[str, Form()] = "",
    scale_min: Annotated[int, Form()] = 0,
    scale_max: Annotated[int, Form()] = 0,
    multi_polygons_intersect: Annotated[str, Form()] = None,
    georeferenced_status: Annotated[str, Form()] = "",
    features_extracted: Annotated[bool, Form()] = False,
    legends_extracted: Annotated[bool, Form()] = False,
    publish_year_min: Annotated[int, Form()] = 0,
    publish_year_max: Annotated[int, Form()] = 0,
    count: Annotated[bool, Form()] = False,
    sgmc_geology_major_1: Annotated[str, Form()] = "[]",
    sgmc_geology_major_2: Annotated[str, Form()] = "[]",
    sgmc_geology_major_3: Annotated[str, Form()] = "[]",
    sgmc_geology_minor_1: Annotated[str, Form()] = "[]",
    sgmc_geology_minor_2: Annotated[str, Form()] = "[]",
    sgmc_geology_minor_3: Annotated[str, Form()] = "[]",
    sgmc_geology_minor_4: Annotated[str, Form()] = "[]",
    sgmc_geology_minor_5: Annotated[str, Form()] = "[]",
    # query params
    page: int = 0,
    page_size: int = 20,
):
    url = app_settings.cdr_endpoint_url + "/v1/maps/search/cogs"

    formatted_params = {
        "sgmc_geology_major_1": json.loads(sgmc_geology_major_1),
        "sgmc_geology_major_2": json.loads(sgmc_geology_major_2),
        "sgmc_geology_major_3": json.loads(sgmc_geology_major_3),
        "sgmc_geology_minor_1": json.loads(sgmc_geology_minor_1),
        "sgmc_geology_minor_2": json.loads(sgmc_geology_minor_2),
        "sgmc_geology_minor_3": json.loads(sgmc_geology_minor_3),
        "sgmc_geology_minor_4": json.loads(sgmc_geology_minor_4),
        "sgmc_geology_minor_5": json.loads(sgmc_geology_minor_5),
    }

    match georeferenced_status:
        case "georeferenced":
            formatted_params["georeferenced"] = True
        case "not_georeferenced":
            formatted_params["georeferenced"] = False
        case "validated":
            formatted_params["georeferenced"] = True
            formatted_params["validated"] = True

    data = {
        "publish_year_min": publish_year_min,
        "publish_year_max": publish_year_max,
        "search_text": search_text,
        "min_lat": 0,
        "max_lat": 0,
        "min_lon": 0,
        "max_lon": 0,
        "scale_min": scale_min,
        "scale_max": scale_max,
        "page": page,
        "size": page_size,
        "count": count,
    } | formatted_params

    if multi_polygons_intersect:
        data["multi_polygons_intersect"] = json.loads(multi_polygons_intersect)

    if count:
        response = httpx.post(url, json=data, headers=auth, timeout=None).raise_for_status()
        response_data = response.json()
        return response_data

    try:
        response = httpx.post(url, json=data, headers=auth, timeout=None)
    except httpx.ConnectError:
        return templates.TemplateResponse(
            "index/map-list-error.html.jinja",
            {
                "request": request,
                "template_prefix": app_settings.template_prefix,
            },
        )

    if response.status_code == 200:
        response_data = response.json()

        prev_page_url = False
        next_page_url = False

        if page > 0:
            prev_page_url = patch_url(app_settings.template_prefix + "/search-maps", page=page - 1)
        if len(response_data) >= page_size:
            next_page_url = patch_url(app_settings.template_prefix + "/search-maps", page=page + 1)

        if len(response_data) > 0:
            maps_count = len(response_data)

            return templates.TemplateResponse(
                "index/map-list.html.jinja",
                {
                    "request": request,
                    "maps": map(format_map, response_data),
                    "page": page,
                    "page_size": page_size,
                    "prev_page_url": prev_page_url,
                    "next_page_url": next_page_url,
                    "template_prefix": app_settings.template_prefix,
                    "maps_in_page": f"{(page * page_size) + 1}-{(page + 1) * maps_count}"
                    if maps_count >= page_size
                    else f"last {maps_count}",
                    "use_maps_grid": maps_count > 1,
                },
            )
        else:
            return templates.TemplateResponse(
                "index/map-list-empty.html.jinja",
                {
                    "request": request,
                    "template_prefix": app_settings.template_prefix,
                    "page": page,
                    "prev_page_url": prev_page_url,
                    "next_page_url": next_page_url,
                },
            )
    else:
        return templates.TemplateResponse(
            "index/map-list-error.html.jinja",
            {
                "request": request,
                "template_prefix": app_settings.template_prefix,
                "error_details": f"Status returned by CDR: {response.status_code}.",
            },
        )


stat_display_data = {
    "projection": {
        "display_title": "Projections",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                      </svg>""",
        "main_color": "red-500",
        "alt_color": "orange-500",
        "link_segment": "/projections/",
        "disabled": False,
    },
    "gcp": {
        "display_title": "GCPs",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>""",
        "main_color": "blue-500",
        "alt_color": "cyan-400",
        "link_segment": "/points/",
        "disabled": False,
    },
    "point": {
        "display_title": "Points",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672Zm-7.518-.267A8.25 8.25 0 1 1 20.25 10.5M8.288 14.212A5.25 5.25 0 1 1 17.25 10.5" />
                      </svg>""",
        "main_color": "violet-500",
        "alt_color": "violet-300",
        "link_segment": "/lines/",
        "disabled": False,
    },
    "line": {
        "display_title": "Lines",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
                      </svg>""",
        "main_color": "amber-500",
        "alt_color": "amber-300",
        "link_segment": "/lines/",
        "disabled": False,
    },
    "polygon": {
        "display_title": "Polygons",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
                      </svg>""",
        "main_color": "teal-500",
        "alt_color": "teal-400",
        "link_segment": "/segment/",
        "disabled": False,
    },
    "legend_item": {
        "display_title": "Legends",
        "icon": """<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>""",
        "main_color": "lime-500",
        "alt_color": "emerald-500",
        "link_segment": "/swatchannotation/",
        "disabled": False,
    },
}

count_data_keys = {
    "projection": ["georeferenced_count", "validated_projection_count"],
    "gcp": ["total_gcp_count"],
    "point": ["total_point_count", "total_validated_point_count"],
    "line": ["total_line_count", "total_validated_line_count"],
    "polygon": ["total_polygon_count", "total_validated_polygon_count"],
    "legend_item": ["total_legend_items_count", "total_validated_legend_item_count"],
}


available_data_keys = {
    "projection": ["georeferenced_count", "validated_projection_count"],
    "gcp": ["total_gcp_count"],
    "point": ["points_exist", "validated_points_exist"],
    "line": ["lines_exist", "validated_lines_exist"],
    "polygon": ["polygons_exist", "validated_polygons_exist"],
    "legend_item": ["legend_items_exist", "validated_legend_items_exist"],
}


def format_map_stats(stats_count_data, cog_id):
    acc = []
    for name, count_types in count_data_keys.items():
        formatted = copy.deepcopy(stat_display_data[name])

        if formatted["link_segment"]:
            formatted["link_url"] = f"{formatted['link_segment']}{cog_id}"

        formatted["total_count"] = stats_count_data[count_types[0]]

        if name == "projection" and formatted["total_count"] == 0:
            formatted["disabled"] = True

        if len(count_types) > 1:
            formatted["validated_count"] = stats_count_data[count_types[1]]
        else:
            formatted["validated_count"] = "-"
        acc.append(formatted)
    return acc


def format_map_stats_available(boolean_stat_data, cog_id):
    acc = []
    for name, count_types in available_data_keys.items():
        formatted = stat_display_data[name]
        formatted["link_url"] = f"{formatted['link_segment']}{cog_id}"
        if "count" in count_types[0]:
            formatted["total_count"] = boolean_stat_data[count_types[0]]
        acc.append(formatted)
    return acc


# Unused, eventually remove..
@router.get("/map-stats-available/{cog_id}")
def get_map_results_stats_available(request: Request, cog_id: str):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/features/{cog_id}/statistics"
    response = httpx.get(fetch_url, headers=auth, timeout=None)

    response_data = None

    try:
        if response.status_code == 200:
            response_data = response.json()
    finally:
        if not response_data:
            logger.error(f"Error loading map available statistics for cog {cog_id}")
            response_data = {
                "georeferenced_count": "error",
                "validated_projection_count": "error",
                "total_gcp_count": "error",
                "points_exist": "error",
                "validated_points_exist": "error",
                "lines_exist": "error",
                "validated_lines_exist": "error",
                "polygons_exist": "error",
                "validated_polygons_exist": "error",
                "area_extraction_exist": "error",
                "validated_area_extraction_exist": "error",
                "legend_items_exist": "error",
                "validated_legend_items_exist": "error",
            }

    formatted_data = format_map_stats_available(response_data, cog_id)

    return templates.TemplateResponse(
        "index/map-list-stats-available.html.jinja",
        {
            "request": request,
            "stats": formatted_data,
            "cog_id": cog_id,
            "template_prefix": app_settings.template_prefix,
        },
    )


@router.get("/map-stats")
def get_all_maps_stats(request: Request):
    url = f"{app_settings.cdr_endpoint_url}/v1/maps/statistics"
    response = httpx.get(url, headers=auth).raise_for_status()

    if response.status_code == 200:
        data = response.json()

        data["has_validated_cogs"] = data["validated_projected_cogs"] > 0
        data["total_cogs"] = f'{data["total_cogs"]:,}'
        data["projected_cogs"] = f'{data["projected_cogs"]:,}'
        data["validated_projected_cogs"] = f'{data["validated_projected_cogs"]:,}'

        return templates.TemplateResponse(
            "index/global-maps-stats.html.jinja",
            {
                "request": request,
                "data": data,
                "template_prefix": app_settings.template_prefix,
            },
        )


@router.get("/map-stats/{cog_id}")
def get_map_result_stats(request: Request, cog_id: str):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/features/{cog_id}/statistics_verbose?verbose=false"
    response = httpx.get(fetch_url, headers=auth, timeout=None)

    response_data = None

    try:
        if response.status_code == 200:
            response_data = response.json()
    finally:
        if not response_data:
            logger.error(f"Error loading map stat statistics for cog {cog_id}")
            response_data = {
                "georeferenced_count": "error",
                "validated_projection_count": "error",
                "total_gcp_count": "error",
                "total_point_count": "error",
                "total_validated_point_count": "error",
                "total_line_count": "error",
                "total_validated_line_count": "error",
                "total_polygon_count": "error",
                "total_validated_polygon_count": "error",
                "total_area_extractions_count": "error",
                "total_validated_area_extraction_count": "error",
                "total_legend_items_count": "error",
                "total_validated_legend_item_count": "error",
            }

    formatted_data = format_map_stats(response_data, cog_id)

    return templates.TemplateResponse(
        "index/map-list-stats.html.jinja",
        {
            "request": request,
            "stats": formatted_data,
            "template_prefix": app_settings.template_prefix,
        },
    )


def get_map_downloads(cog_id: str):
    """
    Converted to a helper to get all downloads. Route handled under map-actions now.
    """
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/projections/{cog_id}"
    s3_prefix = f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}"

    s3_download_products = f"{s3_prefix}/12/{cog_id}.zip"
    s3_download_cog = f"{s3_prefix}/cogs/{cog_id}.cog.tif"
    # Replaced by first status=validated projection found
    # s3_download_projected_cog = f"{s3_prefix}/12/{cog_id}.projected.cog.tif"

    """
    mock start
    """
    # downloads = {
    #     "cog": s3_download_cog,
    #     "projected": f"{s3_prefix}/12/{cog_id}.projected.cog.tif",
    #     "products": s3_download_products,
    # }
    # return downloads
    """
    mock end
    """

    projections_response = None

    try:
        projections_response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status().json()
    except httpx.HTTPError as he:
        return {"disabled": True}

    try:
        if len(projections_response) > 0:
            first_validated = next((prj for prj in projections_response if prj["status"] == "validated"), None)

            if not first_validated:
                raise Exception("No validated projections detected.")

            downloads = {
                "cog": s3_download_cog,
                "projected": first_validated["download_url"],
                "products": s3_download_products,
            }

            return downloads
        else:
            raise Exception("No projections detected.")
    except:
        return {"disabled": True}


def update_selected_CMAs(cog_meta, cmas):
    cog_cmas = [cog_cma["cma_id"] for cog_cma in cog_meta.get("cmas", [])]
    return list(map(
        lambda c: c|{"selected": c["cma_id"] in cog_cmas},
        cmas,
    ))

@router.get("/map-actions/{cog_id}")
def get_map_actions(request: Request, cog_id: str):
    try:
        cmas = get_cmas()
    except httpx.HttpError:
        cmas = []

    # returns disabled or actual download links:
    downloads = get_map_downloads(cog_id)

    cog_meta_url = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/meta/{cog_id}"

    cog_meta = {}
    try:
        cog_response = httpx.get(cog_meta_url, headers=auth, timeout=None).raise_for_status()
        cog_meta = cog_response.json()
    except httpx.HttpError:
        # Ignore and return {} for now.
        pass

    all_cmas = update_selected_CMAs(cog_meta, cmas)
    has_linked_cmas = next((cma for cma in all_cmas if cma.get("selected")), False)

    linked_cmas = ""
    if has_linked_cmas:
        linked_cmas = ",".join([cma["mineral"] for cma in all_cmas if cma.get("selected", False)])
        logger.info(f"linked_cmas: {linked_cmas}")

    return templates.TemplateResponse(
        "index/map-actions.html.jinja",
        {
            "request": request,
            "cog_id": cog_id,
            "downloads": downloads,
            "cmas": all_cmas,
            "has_linked_cmas": has_linked_cmas,
            "linked_cmas": linked_cmas,
            "template_prefix": app_settings.template_prefix,
        },
    )


@router.post("/cma-link/{cma_id}")
def link_cma(request: Request, cma_id, cog_id, mineral):
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/link_cma_cogs"
    data = {"cma_id": cma_id, "cog_ids": [cog_id]}

    response = httpx.post(url, headers=auth, timeout=None, json=data).raise_for_status()

    return templates.TemplateResponse(
        "index/map-actions-updated-cma.html.jinja",
        {
            "request": request,
            "cog_id": cog_id,
            "selected": True,
            "cma_id": cma_id,
            "mineral": mineral,
            "template_prefix": app_settings.template_prefix,
        },
    )


@router.post("/cma-unlink/{cma_id}")
def unlink_cma(request: Request, cma_id, cog_id, mineral):
    url = f"{app_settings.cdr_endpoint_url}/v1/prospectivity/unlink_cma_cogs"
    data = {"cma_id": cma_id, "cog_ids": [cog_id]}

    response = httpx.post(url, headers=auth, timeout=None, json=data).raise_for_status()

    return templates.TemplateResponse(
        "index/map-actions-updated-cma.html.jinja",
        {
            "request": request,
            "cog_id": cog_id,
            "mineral": mineral,
            "selected": False,
            "cma_id": cma_id,
            "template_prefix": app_settings.template_prefix,
        },
    )


@router.get("/get-rock-units")
def get_rock_units(request: Request, major_type: str):
    fetch_url = f"{app_settings.cdr_endpoint_url}/v1/sgmc/sgmc_rock_unit_names?major_type={major_type}"
    response = httpx.get(fetch_url, headers=auth, timeout=None).raise_for_status()
    return response.json()


@router.get("/cma")
def list_cmas(request: Request):
    return get_cmas()


@router.post("/search-maps-ocr")
def search_maps_ocr(
    request: Request,
    # Form data attributes (not json)
    search_terms: Annotated[str, Form()] = "",
    # query params
    page: int = 0,
    page_size: int = 20,
):
    url = app_settings.cdr_endpoint_url + "/v1/maps/search/ocr"

    data = {
        "search_terms": search_terms.split(" "),
        "cogs_only": True,
        "page": page,
        "size": page_size,
    }

    response = httpx.post(url, json=data, headers=auth, timeout=None)

    if response.status_code == 200:
        response_data = response.json()

        prev_page_url = False
        next_page_url = False

        if page > 0:
            prev_page_url = patch_url(app_settings.template_prefix + "/search-maps-ocr", page=page - 1)
        if len(response_data) >= page_size:
            next_page_url = patch_url(app_settings.template_prefix + "/search-maps-ocr", page=page + 1)

        if len(response_data) > 0:
            maps_count = len(response_data)

            return templates.TemplateResponse(
                "index/map-list.html.jinja",
                {
                    "request": request,
                    "maps": map(format_map, response_data),
                    "page": page,
                    "page_size": page_size,
                    "prev_page_url": prev_page_url,
                    "next_page_url": next_page_url,
                    "template_prefix": app_settings.template_prefix,
                    "maps_in_page": f"{(page * page_size) + 1}-{(page + 1) * maps_count}"
                    if maps_count >= page_size
                    else f"last {maps_count}",
                    "use_maps_grid": maps_count > 2,
                },
            )
        else:
            return templates.TemplateResponse(
                "index/map-list-empty.html.jinja",
                {
                    "request": request,
                    "template_prefix": app_settings.template_prefix,
                    "page": page,
                    "prev_page_url": prev_page_url,
                    "next_page_url": next_page_url,
                },
            )
    else:
        return templates.TemplateResponse(
            "index/map-list-error.html.jinja",
            {
                "request": request,
                "template_prefix": app_settings.template_prefix,
                "error_details": f"Status returned by CDR: {response.status_code}.",
            },
        )
