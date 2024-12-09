import glob
import logging
import os
from logging import Logger

import redis

from segment_api.common.utils import check_file_exists, s3_client
from segment_api.redisapi import cache_prefix, redis_client
from segment_api.settings import app_settings

logger: Logger = logging.getLogger(__name__)

# def full_disk_space(path="/", min_free_gb=10):
#     _, _, free = shutil.disk_usage(path)
#     free_gb = free // (2**30)
#     if free_gb < min_free_gb:
#         logger.info(f"Warning: Less than {min_free_gb} GB of free space remaining!")
#         return True
#     else:
#         return False


def populate_cache(cog_id):
    # if full_disk_space():
    #     clear_disk()

    if not check_file_exists(f"{cog_id}.cog.tif"):
        logger.info(f"Downloading cog from s3: {cog_id}")
        s3 = s3_client(app_settings.cdr_s3_endpoint_url)
        s3_key = app_settings.cdr_s3_cog_prefix + "/" + cog_id + ".cog.tif"
        logger.info(s3_key)
        raw_path = os.path.join(app_settings.disk_cache_dir, cog_id + ".cog.tif")
        logger.info(raw_path)
        s3.download_file(app_settings.cdr_public_bucket, s3_key, raw_path)


def load(cog_id):
    download_key = cache_prefix + ":" + cog_id + "_download"

    if check_file_exists(f"{cog_id}.cog.tif"):
        return
    with redis.lock.Lock(redis=redis_client, name=download_key, blocking_timeout=120):
        if check_file_exists(f"{cog_id}.cog.tif"):
            return
        populate_cache(cog_id)
    return


def get_cached_tiff(cog_id):
    logger.info(f"Checking cache: {cog_id}")
    try:
        load(cog_id)

    except Exception:
        logger.exception("get cache tiff error")
        raise


def clear_disk():
    logger.info("Attempting to clear disk cache")
    files = glob.glob(os.path.join(app_settings.disk_cache_dir, "*"))
    for file in files:
        if os.path.isfile(file):
            logger.info(f"Deleting disk cache for {file}")
            os.remove(file)
