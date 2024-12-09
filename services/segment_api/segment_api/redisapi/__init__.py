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
