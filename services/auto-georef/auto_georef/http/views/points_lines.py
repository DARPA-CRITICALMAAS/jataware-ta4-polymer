import itertools
import logging
import operator
import re
from logging import Logger
from typing import Any, Callable, Literal

import httpx
from cdr_schemas.cdr_responses.features import LineExtractionResponse, PointExtractionResponse
from cdr_schemas.cdr_responses.legend_items import LegendItemResponse
from cdr_schemas.features.line_features import Line
from cdr_schemas.features.point_features import Point
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ...common.tiff_cache import get_cached_tiff
from ...http.routes.cache import cache
from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


def create_template(name: str, request: Request, context: dict | None = None):
    return templates.TemplateResponse(
        f"points_lines/{name}.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            **(context or {}),
        },
    )


class CDRClient:
    def __init__(self, cog_id: str, *, system: str | None = None, version: str | None = None):
        self.cog_id = cog_id
        self.system = system
        self.version = version

        self.headers = {"accept": "application/json", "Authorization": app_settings.cdr_bearer_token}
        self.base_url = f"{app_settings.cdr_endpoint_url}/v1/features"
        self.client = httpx.Client(timeout=None)

    def get(self, endpoint: str, data: dict | None = None):
        url_search_params = "&".join([f"{k}={v}" for k, v in data.items()])
        response = self.client.get(f"{self.base_url}/{endpoint}?{url_search_params}", headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_system_versions(self, type: str) -> dict[str, list[str]]:
        response: list[tuple[str, str]] = self.get(f"{self.cog_id}/system_versions", {"type": type})
        return response

    def _get_features(self, ftype: str, ExtractionResponse: Callable, max_num: int):
        SIZE = 10_000

        def get_data(page: int):
            return {
                "cog_id": self.cog_id,
                "system_version": f"{self.system}__{self.version}",
                "georeference_data": False,
                "legend_data": True,
                "page": page,
                "size": SIZE,
            }

        all_extractions = []
        for i in itertools.count():
            extractions = self.get(f"{self.cog_id}/{ftype}_extractions", get_data(i))
            all_extractions.extend([ExtractionResponse(**e) for e in extractions])

            if len(extractions) < SIZE or len(all_extractions) >= max_num:
                break

        return all_extractions[:max_num]

    def get_lines(self, max_num: int) -> list[LineExtractionResponse]:
        return self._get_features("line", LineExtractionResponse, max_num)

    def get_points(self, max_num: int) -> list[PointExtractionResponse]:
        return self._get_features("point", PointExtractionResponse, max_num)


class FeatureResponse(BaseModel):
    geometry: Line | Point
    name: str
    legend_id: str
    bbox: list[float | int]


class FeatureGroup(BaseModel):
    name: str
    legend_id: str


@router.get("/lines/features")
def get_features(
    request: Request, cog_id: str, ftype: Literal["line", "point"], system: str, version: str, max_num: int = 0
):
    client = CDRClient(cog_id, system=system, version=version)
    with get_cached_tiff(cache, cog_id) as image_size:
        image_size[0]
        height = image_size[1]

    # Helper functions
    def fix_coordinate(x, y):
        return [x, height - y]

    def flip_bbox(bbox: list[float | int]):
        x1, y1, x2, y2 = bbox
        return [x1, height - y2, x2, height - y1]

    def create_legend_item(legend_item: Any | None):
        try:
            return LegendItemResponse(**legend_item)
        except Exception:
            return None

    def get_name(legend_item: Any | None):
        li = create_legend_item(legend_item)
        name = "Unknown"
        if li is not None:
            name = li.label or li.abbreviation or name
        name = " ".join(word.capitalize() for word in re.split(r"[_\-\s]+", name))
        return name

    def flip_geometry(feature: Line | Point):
        if isinstance(feature, Line):
            return Line(coordinates=[fix_coordinate(*c) for c in feature.coordinates])
        elif isinstance(feature, Point):
            return Point(coordinates=fix_coordinate(*feature.coordinates))

    # Get features
    features = None
    if ftype == "line":
        features = client.get_lines(max_num or 1 << 32)
    elif ftype == "point":
        features = client.get_points(max_num or 1 << 32)

    # Process features
    features = [
        FeatureResponse(
            geometry=flip_geometry(f.px_geojson),
            name=get_name(f.legend_item),
            legend_id=f.legend_id or "",
            bbox=flip_bbox(f.px_bbox),
        )
        for f in features
    ]

    legend_id_key: Callable[[FeatureResponse], str] = lambda f: f.legend_id
    features = sorted(features, key=legend_id_key)
    grouped_features = {lid: list(f) for lid, f in itertools.groupby(features, key=legend_id_key)}
    feature_groups = [FeatureGroup(name=f.name, legend_id=lid) for lid, (f, *_) in grouped_features.items()]

    context = {
        "features": {lid: [f.model_dump() for f in fs] for lid, fs in grouped_features.items()},
        "groups": feature_groups,
    }

    return create_template("groups", request, context)


def get_systems(cog_id: str, type: str):
    """
    Get the systems and versions for the specified `cog_id` and `type`
    """
    client = CDRClient(cog_id)
    response = client.get_system_versions(type)
    response = sorted(response, key=operator.itemgetter(0))
    systems = itertools.groupby(response, operator.itemgetter(0))
    systems: dict[str, list[str]] = {system: [v for _, v in sys_ver] for system, sys_ver in systems}
    return systems  # system: [versions]


@router.get("/lines/{cog_id}")
def index(request: Request, cog_id: str):
    line_systems = get_systems(cog_id, "line")
    point_systems = get_systems(cog_id, "point")
    logger.info(f"line_systems: {line_systems}")
    logger.info(f"point_systems: {point_systems}")

    cog_url = f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}/cogs/{cog_id}.cog.tif"
    context = {
        "page_title": "Polymer Points & Lines",
        "cog_id": cog_id,
        "cog_url": cog_url,
        "line_systems": line_systems,
        "point_systems": point_systems,
    }

    return create_template("index", request, context)
