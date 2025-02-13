import logging
from logging import Logger

from cachetools import TTLCache
from fastapi import APIRouter, Response
from starlette.status import HTTP_204_NO_CONTENT

from segment_api.common.tiff_cache import clear_disk
from segment_api.redisapi import delete_keys_with_prefix

lock_key = "processing_map"

logger: Logger = logging.getLogger(__name__)
router = APIRouter()

segment_cache = TTLCache(maxsize=6, ttl=1000)

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
    "/clear_segment_memory_cache",
    summary="clear segment memory cache",
    description="Clear segment embedding memory cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_segment_memory_cache():
    segment_cache.clear()
    return


@router.get(
    "/clear_redis_cache",
    summary="clear redis cache",
    description="Clear redis cache",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def clear_redis_cache():
    delete_keys_with_prefix(lock_key)
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
    await clear_segment_memory_cache()
    await clear_disk_cache()
    return
