import logging
from logging import Logger

from segment_api.redisapi import redis_client

logger: Logger = logging.getLogger(__name__)

lock_key = "processing_map"


def check_and_set_key() -> bool:
    """
    Check if the key already exists in Redis. If not, set it and return True.
    If the key exists, return False.
    """
    if redis_client.setnx(lock_key, "1"):
        redis_client.expire(lock_key, 4000)
        return True
    return False


def remove_key():
    redis_client.delete(lock_key)
