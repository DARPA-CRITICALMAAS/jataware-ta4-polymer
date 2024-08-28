import glob
import logging
import os
from contextlib import contextmanager
from logging import Logger

import redis

from auto_georef.common.utils import check_file_exists, load_from_disk, s3_client
from auto_georef.redisapi import cache_prefix, key_exists, redis_client
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)


def populate_cache(cog_id, cache_key):
    if not check_file_exists(cache_key.split(":")[1] + ".cog.tif"):
        logger.info(f"Downloading cog from s3: {cog_id}")
        s3 = s3_client(app_settings.cdr_s3_endpoint_url)
        s3_key = "cogs/" + cog_id + ".cog.tif"
        raw_path = os.path.join(app_settings.disk_cache_dir, cog_id + ".cog.tif")
        s3.download_file(app_settings.cdr_public_bucket, s3_key, raw_path)

    redis_client.set(cache_key, "true", nx=True, ex=app_settings.redis_cache_timeout)


def load(cache, cog_id):
    cache_key = cache_prefix + ":" + cog_id
    download_key = cache_prefix + ":" + cog_id + "_download"
    disk_read_key = cache_prefix + ":" + cog_id + "_disk_read"

    if cache.get(cog_id):
        return
    with redis.lock.Lock(redis=redis_client, name=download_key, blocking_timeout=120):
        with redis.lock.Lock(redis=redis_client, name=disk_read_key, blocking_timeout=15):
            if cache.get(cog_id):
                return

            if check_file_exists(cache_key.split(":")[1] + ".cog.tif"):
                cache[cog_id] = load_from_disk(cog_id)
                return

            populate_cache(cog_id, cache_key)
            cache[cog_id] = load_from_disk(cog_id)
    return


@contextmanager
def get_cached_tiff(cache, cog_id):
    logger.info(f"Checking cache: {cog_id}")
    try:
        load(cache, cog_id)
        yield cache[cog_id]

    except Exception:
        logger.exception("context manager error")
        raise


# def load_tiff_cache(cache, cog_id):
#     s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
#     if s3_key in cache:
#         logger.debug("Loading image from cache: %s", s3_key)
#         return cache[s3_key]

#     with get_cached_tiff(cog_id) as src:
#         cache[s3_key] = src
#     return src


def clear_disk():
    logger.info("Attempting to clear disk cache")
    files = glob.glob(os.path.join(app_settings.disk_cache_dir, "*"))
    for file in files:
        if os.path.isfile(file):
            cog_id = os.path.basename(file).split(".")[0]
            if key_exists(cog_id):
                logger.info(f"Cache still valid for {cog_id}")
            else:
                logger.info(f"Deleting disk cache for {file}")
                os.remove(file)
