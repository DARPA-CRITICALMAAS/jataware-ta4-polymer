import hashlib
import itertools
import logging
import operator
import re
from logging import Logger
from typing import Any, Callable, Literal

import httpx
from cdr_schemas.cdr_responses.features import LineExtractionResponse, PointExtractionResponse
from cdr_schemas.cdr_responses.legend_items import LegendItemResponse
from cdr_schemas.feature_results import FeatureResults
from cdr_schemas.features.line_features import (
    DashType,
    Line,
    LineFeature,
    LineFeatureCollection,
    LineLegendAndFeaturesResult,
    LineProperties,
)
from cdr_schemas.features.point_features import (
    Point,
    PointFeature,
    PointFeatureCollection,
    PointLegendAndFeaturesResult,
    PointProperties,
)
from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.status import HTTP_204_NO_CONTENT

from ...common.tiff_cache import get_cached_tiff
from ...http.routes.cache import cache
from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)
router = APIRouter()

POLYMER: Literal["polymer"] = "polymer"
FType = Literal["line", "point"]


class FeatureResponse(BaseModel):
    feature_id: str
    geometry: Line | Point
    name: str
    legend_id: str
    bbox: list[float | int]
    is_validated: bool | None
    dash_pattern: DashType | None


class FeatureGroup(BaseModel):
    name: str
    legend_id: str


class PublishRequest(BaseModel):
    cog_id: str
    geometry: Line | Point
    feature_id: str
    legend_id: str
    dash_pattern: DashType | None = None


class UpdateStatusRequest(BaseModel):
    feature_id: str
    ftype: str
    is_validated: bool | None


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
        try:
            return response.json()
        except Exception:
            return response.text

    def post(self, endpoint: str, data: dict[str, Any] | BaseModel | None = None):
        json = data.model_dump() if isinstance(data, BaseModel) else data
        response = self.client.post(f"{self.base_url}/{endpoint}", headers=self.headers, json=json)
        response.raise_for_status()
        try:
            return response.json()
        except Exception:
            return response.text

    def get_system_versions(self, type: str) -> list[tuple[str, str]]:
        response = self.get(f"{self.cog_id}/system_versions", {"type": type})
        return response

    def get_legend_items(self, ftype: str):
        data = {
            "cog_id": self.cog_id,
            "system_version": f"{self.system}__{self.version}",
            "feature_type": ftype,  # Or "" empty string
            "validated": True,
        }
        response: list[LegendItemResponse] = self.get(f"{self.cog_id}/legend_items", data)
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

    def _publish_feature(self, ftype: str, result: LineLegendAndFeaturesResult | PointLegendAndFeaturesResult):
        feature_results = FeatureResults(
            system=self.system,
            system_version=self.version,
            cog_id=self.cog_id,
            point_feature_results=[result] if ftype == "point" else [],
            line_feature_results=[result] if ftype == "line" else [],
        )
        json = self.post(f"publish/{ftype}_features", feature_results)
        logger.info(f"Published {ftype}: {json}")

    def publish_line(self, result: LineLegendAndFeaturesResult):
        self._publish_feature("line", result)

    def publish_point(self, result: PointLegendAndFeaturesResult):
        self._publish_feature("point", result)

    def update_status(self, feature_id: str, ftype: str, is_validated: bool | None):
        data = {"feature_ids": [feature_id], "feature_type": ftype, "validated": is_validated}
        self.post(f"update/bulk_feature_status", data)


def create_template(name: str, request: Request, context: dict | None = None):
    return templates.TemplateResponse(
        f"points_lines/{name}.html.jinja",
        {
            "request": request,
            "template_prefix": app_settings.template_prefix,
            **(context or {}),
        },
    )


def flip_bbox(bbox: list[float | int], height: int):
    x1, y1, x2, y2 = bbox
    return [x1, height - y2, x2, height - y1]


def flip_geometry(feature: Line | Point, height: int):
    def fix_coordinate(coordinate: list[int | float], height: int):
        x, y = coordinate
        return [x, height - y]

    if isinstance(feature, Line):
        return Line(coordinates=[fix_coordinate(c, height) for c in feature.coordinates])
    elif isinstance(feature, Point):
        return Point(coordinates=fix_coordinate(feature.coordinates, height))


def get_features(cog_id: str, ftype: FType, system: str, version: str, max_num: int):
    client = CDRClient(cog_id, system=system, version=version)

    with get_cached_tiff(cache, cog_id) as (_, height):
        pass

    # Helper functions
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

    def get_feature_id(feature: LineExtractionResponse | PointExtractionResponse):
        if isinstance(feature, LineExtractionResponse):
            return feature.line_id
        elif isinstance(feature, PointExtractionResponse):
            return feature.point_id

    def get_dash_pattern(feature: LineExtractionResponse | PointExtractionResponse):
        return feature.dash_pattern if isinstance(feature, LineExtractionResponse) else None

    # Get features
    features = None
    if ftype == "line":
        features = client.get_lines(max_num or 1 << 32)
    elif ftype == "point":
        features = client.get_points(max_num or 1 << 32)

    # Process features
    features = [
        FeatureResponse(
            geometry=flip_geometry(f.px_geojson, height),
            name=get_name(f.legend_item),
            legend_id=f.legend_id or "",
            bbox=flip_bbox(f.px_bbox, height),
            is_validated=f.validated,
            feature_id=get_feature_id(f),
            dash_pattern=get_dash_pattern(f),
        )
        for f in features
    ]

    legend_id_key: Callable[[FeatureResponse], str] = lambda f: f.legend_id
    features = sorted(features, key=legend_id_key)
    grouped_features = {lid: list(f) for lid, f in itertools.groupby(features, key=legend_id_key)}
    feature_groups = [FeatureGroup(name=f.name, legend_id=lid) for lid, (f, *_) in grouped_features.items()]

    return grouped_features, feature_groups


def get_systems(cog_id: str, type: str):
    """
    Get the systems and versions for the specified `cog_id` and `type`
    """

    # Helper functions to sort versions in semver order safely while also
    # handling non-semver versions
    version_split = lambda v: re.split(r"[^\d\w]+", v)
    safe_int = lambda v: int("0" + "".join(d for d in v if d.isdigit()))
    semver_parse_key = lambda v: [safe_int(n) for n in version_split(v)]
    sorted_versions = lambda v: sorted(v, key=semver_parse_key, reverse=True)

    # Get the systems and versions groups
    client = CDRClient(cog_id)
    response = client.get_system_versions(type)
    response = sorted(response, key=operator.itemgetter(0))
    groups = itertools.groupby(response, operator.itemgetter(0))

    # Get the systems and their sorted versions
    systems = {sys: [v for _, v in sys_ver] for sys, sys_ver in groups}
    systems = {sys: sorted_versions(ver) for sys, ver in systems.items()}
    systems: dict[str, list[str]]  # system: [versions]
    return systems


def get_latest_version(cog_id: str, system: str):
    """
    Get the latest polymer version for the specified `cog_id`
    """

    systems = get_systems(cog_id, "legend_item")

    if system not in systems:
        return None
    if not systems[system]:
        return None

    latest_version, *_ = systems[system]
    return latest_version


def get_legend_items(cog_id: str, ftype: str, system: str, version: str):
    """
    Get the legend items for the specified `cog_id`, `ftype`, `system`, and `version`
    """

    client = CDRClient(cog_id, system=system, version=version)
    response = client.get_legend_items(ftype)
    legend_items = [LegendItemResponse(**li) for li in response]
    return legend_items


@router.post("/update-status", status_code=HTTP_204_NO_CONTENT)
def update_status(request: UpdateStatusRequest):
    """
    Update the status of a feature
    """

    logger.info(f"Updating status of feature: {request.feature_id} to {request.is_validated}")

    client = CDRClient("")
    client.update_status(request.feature_id, request.ftype, request.is_validated)


@router.post("/publish", status_code=HTTP_204_NO_CONTENT)
def publish(request: PublishRequest):
    """
    Publish a feature to the CDR
    """

    with get_cached_tiff(cache, request.cog_id) as (_, height):
        pass

    latest_version = get_latest_version(request.cog_id, POLYMER)
    client = CDRClient(request.cog_id, system=POLYMER, version=latest_version)

    ftype = "line" if isinstance(request.geometry, Line) else "point"
    legend_items = get_legend_items(request.cog_id, ftype, POLYMER, latest_version)
    legend_items = {li.legend_id: li for li in legend_items}

    if isinstance(request.geometry, Point):
        point: Point = flip_geometry(request.geometry, height)
        point_id = hashlib.sha256(str(point).encode()).hexdigest()
        feature = PointFeature(
            id=f"{request.cog_id}_{POLYMER}_{latest_version}_{point_id}",
            geometry=point,
            properties=PointProperties(
                model=POLYMER,
                model_version=latest_version,
                reference_id=request.feature_id,
                validated=True,
            ),
        )
        features_legend = PointLegendAndFeaturesResult(
            id=request.legend_id,
            name=legend_items[request.legend_id].label,
            description=legend_items[request.legend_id].description,
            validated=True,
            point_features=PointFeatureCollection(features=[feature]),
        )
        client.publish_point(features_legend)
    elif isinstance(request.geometry, Line):
        line: Line = flip_geometry(request.geometry, height)
        line_id = hashlib.sha256(str(line).encode()).hexdigest()
        feature = LineFeature(
            id=f"{request.cog_id}_{POLYMER}_{latest_version}_{line_id}",
            geometry=line,
            properties=LineProperties(
                model=POLYMER,
                model_version=latest_version,
                validated=True,
                reference_id=request.feature_id,
                # TODO: Remove this hardcoding once the `cdr_schemas` is updated to include
                # the same `dash_pattern` type in `LineProperties` and `LineExtractionResponse`
                dash_pattern=request.dash_pattern,
            ),
        )
        features_legend = LineLegendAndFeaturesResult(
            id=request.legend_id,
            name=legend_items[request.legend_id].label,
            description=legend_items[request.legend_id].description,
            validated=True,
            line_features=LineFeatureCollection(features=[feature]),
        )
        client.publish_line(features_legend)


def dict_features(features: dict[str, list[FeatureResponse]]):
    return {lid: [f.model_dump() for f in fs] for lid, fs in features.items()}


@router.get("/view-features")
def get_view_features(request: Request, cog_id: str, ftype: FType, system: str, version: str, max_num: int = 0):
    grouped_features, feature_groups = get_features(cog_id, ftype, system, version, max_num)

    context = {
        "features": dict_features(grouped_features),
        "groups": feature_groups,
        "system": system,
        "version": version,
    }

    return create_template("groups", request, context)


@router.get("/validate-features")
def get_validate_features(request: Request, cog_id: str, ftype: FType, system: str, version: str, max_num: int = 0):
    latest_version = get_latest_version(cog_id, POLYMER)
    legend_groups = get_legend_items(cog_id, ftype, POLYMER, latest_version)
    legend_id_to_label = {li.legend_id: li.label for li in legend_groups}

    grouped_features, feature_groups = get_features(cog_id, ftype, system, version, max_num)
    polymer_grouped_features, _ = get_features(cog_id, ftype, POLYMER, latest_version, max_num)

    context = {
        "features": dict_features(grouped_features),
        "polymer_features": dict_features(polymer_grouped_features),
        "groups": feature_groups,
        "legend_groups": legend_groups,
        "legend_id_to_label": legend_id_to_label,
        "system": system,
        "version": version,
    }

    return create_template("group-select", request, context)


@router.get("/create-features")
def get_create_features(request: Request, cog_id: str, ftype: FType, max_num: int = 0):
    latest_version = get_latest_version(cog_id, POLYMER)
    legend_groups = get_legend_items(cog_id, ftype, POLYMER, latest_version)
    legend_id_to_label = {li.legend_id: li.label for li in legend_groups}

    polymer_grouped_features, _ = get_features(cog_id, ftype, POLYMER, latest_version, max_num)

    context = {
        "polymer_features": dict_features(polymer_grouped_features),
        "legend_groups": legend_groups,
        "legend_id_to_label": legend_id_to_label,
        "system": POLYMER,
        "version": latest_version,
    }

    return create_template("create-select", request, context)


@router.get("/{cog_id}")
def index(request: Request, cog_id: str):
    logger.info(f"Request for cog_id: {cog_id}")
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
