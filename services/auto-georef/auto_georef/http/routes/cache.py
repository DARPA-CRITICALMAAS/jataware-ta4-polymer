import logging
from logging import Logger

import httpx
from cachetools import TTLCache
from fastapi import APIRouter, Response
from starlette.status import HTTP_204_NO_CONTENT

from auto_georef.common.tiff_cache import clear_disk
from auto_georef.redisapi import cache_prefix, delete_keys_with_prefix
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)
router = APIRouter()

cache = TTLCache(maxsize=2, ttl=1000)

# segment_cache = TTLCache(maxsize=2, ttl=1000)


@router.get(
    "/clear_disk_cache",
    summary="clear disk cache",
    description="Clear disk cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_disk_cache():
    clear_disk()
    return


@router.get(
    "/clear_redis_cache",
    summary="clear redis cache",
    description="Clear redis cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_redis_cache():
    delete_keys_with_prefix(cache_prefix)
    return


@router.get(
    "/clear_memory_cache",
    summary="clear memory cache",
    description="Clear memory cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_memory_cache():
    cache.clear()
    return


@router.get(
    "/clear_segment_memory_cache",
    summary="clear segment memory cache",
    description="Clear segment embedding memory cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_segment_memory_cache():
    resp = httpx.get(app_settings.segment_api_endpoint_url + "/segment/clear_segment_memory_cache")
    logger.info(resp)
    resp.raise_for_status()
    return


@router.get(
    "/clear_all_cache",
    summary="clear all cache",
    description="Clear all cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_cache():
    logging.info(f"Attempting to clear all cache")
    await clear_redis_cache()
    await clear_disk_cache()
    await clear_memory_cache()
    return
