import logging
import os
from logging import Logger

import redis
from redis.exceptions import ConnectionError as RedisConnectionError

from segment_api.settings import app_settings

logger: Logger = logging.getLogger(__name__)

cache_prefix = "segment_disk_cache"


try:
    redis_client = redis.Redis(host=app_settings.redis_host, port=app_settings.redis_port, decode_responses=True)
except RedisConnectionError:
    logger.error("Could not establish connection with Redis server")


def rq_del(cog_id: str, item: bytes) -> int:
    q = f"{cache_prefix}:{cog_id}"
    removed = redis_client.lrem(q, 1, item)
    if removed < 1:
        logger.warning("Expected item to be removed and none were removed")
    return removed


def key_exists(cog_id):
    key = f"{cache_prefix}:{cog_id}"
    return redis_client.exists(key) == 1


def delete_keys_with_prefix(prefix):
    cursor = 0
    while True:
        cursor, keys = redis_client.scan(cursor=cursor, match=f"{prefix}*")
        if keys:
            redis_client.delete(*keys)
        if cursor == 0:
            break
    logging.warning(f"All keys with prefix '{prefix}' have been deleted.")
