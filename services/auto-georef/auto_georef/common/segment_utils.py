import itertools
import logging
from logging import Logger
from typing import Any

import httpx
import numpy as np
from cdr_schemas.cdr_responses.features import PolygonExtractionResponse
from cdr_schemas.cdr_responses.legend_items import LegendItemResponse
from cdr_schemas.feature_results import FeatureResults
from cdr_schemas.features.polygon_features import PolygonLegendAndFeaturesResult
from pydantic import BaseModel
from tifffile import imread as tiffread

from auto_georef.common.tiff_cache import get_cached_tiff
from auto_georef.common.utils import timeit
from auto_georef.http.routes.cache import cache
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)


class CDRClient:
    def __init__(self, cog_id: str):
        self.cog_id = cog_id
        self.headers = {"accept": "application/json", "Authorization": app_settings.cdr_bearer_token}
        self.base_url = f"{app_settings.cdr_endpoint_url}/v1/features"
        self.client = httpx.Client(timeout=None)

    def post(self, endpoint: str, data: dict[str, Any] | BaseModel | None = None):
        json = data.model_dump() if isinstance(data, BaseModel) else data
        response = self.client.post(f"{self.base_url}/{endpoint}", headers=self.headers, json=json)
        response.raise_for_status()
        return response.json()

    def get(self, endpoint: str, data: dict | None = None):
        url_search_params = "&".join([f"{k}={v}" for k, v in data.items()])
        response = self.client.get(f"{self.base_url}/{endpoint}?{url_search_params}", headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_system_versions(self, type: str) -> dict[str, list[str]]:
        response: list[tuple[str, str]] = self.get(f"{self.cog_id}/system_versions", {"type": type})
        return response

    @timeit(logger)
    def get_polygons(self, system: str, version: str, max_polygons: int):
        SIZE = 100_000

        def get_data(page: int):
            return {
                "cog_id": self.cog_id,
                "system_version": f"{system}__{version}",
                "georeference_data": False,
                "legend_data": True,
                "page": page,
                "size": SIZE,
            }

        all_extractions: list[PolygonExtractionResponse] = []
        for i in itertools.count():
            extractions = self.get(f"{self.cog_id}/polygon_extractions", get_data(i))
            all_extractions.extend([PolygonExtractionResponse(**e) for e in extractions])

            if len(extractions) < SIZE or len(all_extractions) >= max_polygons:
                break

        return all_extractions[:max_polygons]

    def get_legend_items(self, system: str, version: str) -> list[LegendItemResponse]:
        data = {
            "cog_id": self.cog_id,
            "system_version": f"{system}__{version}",
            "feature_type": "polygon",  # Or "" empty string
            "validated": True,
        }
        response = self.get(f"{self.cog_id}/legend_items", data)
        return response

    def publish_polygons(self, system: str, version: str, results: list[PolygonLegendAndFeaturesResult]):
        for result in results:
            feature_result = FeatureResults(
                system=system, system_version=version, cog_id=self.cog_id, polygon_feature_results=[result]
            )
            json = self.post(f"publish/polygon_features", feature_result)
            features = json["features_saved"]
            logger.info(f"Published {features} features")

    def legend_item_intersect(self, legend_id: str):
        data = {"legend_id": legend_id}
        items = self.get(f"legend_item_intersect", data)
        item = max(items, key=lambda item: item["ratio"])
        logger.info(f"Intersected legend item {item} with ratio {item['ratio']}")
        return item

    def legend_item_intersect_point(self, x: float, y: float):
        data = {"cog_id": self.cog_id, "rows_from_top": round(y), "columns_from_left": round(x)}
        items = self.post(f"legend_item_intersect_point", data)
        item, *_ = items  # Get the first item
        logger.info(f"Intersected legend item {item}")
        return item


def normalize_image(image):
    """
    Normalize the image to have 3 channels
    """

    # If no channels, copy the image to 3 channels
    if image.ndim == 2:
        image = np.stack((image,) * 3, axis=-1)

    # If 1 channel, copy the channel to 3 channels
    if image.shape[2] == 1:
        image = np.stack((image.squeeze(axis=2),) * 3, axis=-1)

    return image


@timeit(logger)
def quick_cog(cog_id):
    """
    Quickly read a COG image.

    Checks if the lasso tool is available to avoid redoing a numpy tiff read.
    Otherwise, reads the image from the disk cache.
    """

    with get_cached_tiff(cache, cog_id):
        logger.info(f"Slow reading of COG {cog_id} from disk cache")
        return read_cog(cog_id)


def read_cog(cog_id):
    """
    Read a COG image from the local cache and return it as a numpy array
    """

    image_path = app_settings.disk_cache_dir + f"/{cog_id}.cog.tif"
    return np.array(tiffread(image_path))


def batched(iterable, n):
    """
    Yield batches of n elements from an iterable. Should use `itertools.batched` directly if possible.
    """

    import itertools

    if "batched" in dir(itertools):
        yield from itertools.batched(iterable, n)
        return

    if n < 1:
        raise ValueError("n must be at least one")
    iterator = iter(iterable)
    while batch := tuple(itertools.islice(iterator, n)):
        yield batch


def rgb_to_hsl(rgb):
    """
    Convert an RGB color to HSL
    """
    r, g, b = rgb
    r /= 255.0
    g /= 255.0
    b /= 255.0

    max_color = max(r, g, b)
    min_color = min(r, g, b)
    l = (max_color + min_color) / 2.0

    if max_color == min_color:
        h = s = 0.0
    else:
        d = max_color - min_color
        s = d / (2.0 - max_color - min_color) if l > 0.5 else d / (max_color + min_color)

        if max_color == r:
            h = (g - b) / d + (6.0 if g < b else 0.0)
        elif max_color == g:
            h = (b - r) / d + 2.0
        else:
            h = (r - g) / d + 4.0
        h /= 6.0

    return (h * 360.0, s * 100.0, l * 100.0)


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join([c * 2 for c in hex_color])
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
