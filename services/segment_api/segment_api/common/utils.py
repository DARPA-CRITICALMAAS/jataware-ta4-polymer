import io
import logging
import os
from functools import partial, wraps
from logging import Logger
from time import perf_counter
from typing import Callable, ParamSpec, TypeVar

import boto3
import numpy as np
from PIL import Image

from segment_api.settings import app_settings

logger: Logger = logging.getLogger(__name__)


def timeit(logger):
    T = TypeVar("T")
    P = ParamSpec("P")

    def dec(f: Callable[P, T]):
        @wraps(f)
        def w(*args: P.args, **kwargs: P.kwargs):
            start = perf_counter()
            rtn = f(*args, **kwargs)
            time_since(logger, f"{f.__name__}", start)
            return rtn

        return w

    return dec


# s3 client builder
def s3_client(endpoint_url=app_settings.cdr_s3_endpoint_url):
    s3 = boto3.client("s3", endpoint_url=endpoint_url, verify=False)
    return s3


def download_file_polymer(s3_key, local_file_path):
    s3 = s3_client()
    try:
        s3.download_file(app_settings.polymer_public_bucket, s3_key, local_file_path)
        logger.info(f"File downloaded successfully to {local_file_path}")
    except Exception:
        logger.exception(f"Error downloading file from S3")


def download_file(s3_key, local_file_path):
    s3 = s3_client()
    try:
        s3.download_file(app_settings.cdr_public_bucket, s3_key, local_file_path)
        logger.info(f"File downloaded successfully to {local_file_path}")
    except Exception:
        logger.exception(f"Error downloading file from S3")


@timeit(logger)
def load_tiff(s3_key):
    s3 = s3_client()
    img = s3.get_object(Bucket=app_settings.cdr_public_bucket, Key=s3_key)
    img_data = img.get("Body").read()
    return Image.open(io.BytesIO(img_data))


@timeit(logger)
def upload_s3_file(s3_key, bucket, fp):
    s3 = s3_client()
    s3.upload_file(fp, bucket, s3_key)


@timeit(logger)
def upload_s3_bytes(s3_key, xs: bytes):
    s3 = s3_client()
    s3.put_object(Body=xs, Bucket=app_settings.cdr_public_bucket, Key=s3_key)


@timeit(logger)
def upload_s3_str(s3_key, sz):
    buff = io.BytesIO()
    buff.write(sz.encode())
    upload_s3_bytes(s3_key, buff.getvalue())


@timeit(logger)
def read_s3_contents(s3_key):
    s3 = s3_client()
    try:
        data = s3.get_object(Bucket=app_settings.cdr_public_bucket, Key=s3_key)
        contents = data["Body"].read()
        return contents
    except s3.exceptions.NoSuchKey:
        logger.warning("NoSuchKey - %s", s3_key)
        return ""


@timeit(logger)
def s3_key_exists(s3_key):
    s3 = s3_client()
    try:
        s3.head_object(Bucket=app_settings.polymer_public_bucket, Key=s3_key)
        return True
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            logger.warning("404 not found - %s ", s3_key)
        elif e.response["Error"]["Code"] == "403":
            logger.warning("403 unauthorized not found - %s", s3_key)
        else:
            raise
    return False


def open_tiff(fname, as_np=True):
    img = Image.open(fname)
    img = img.convert("RGB")
    if as_np:
        img = np.array(img)

    return img


def time_since(logger, msg, start):
    fin = perf_counter() - start
    logger.debug(f"{msg} - completed in %.8f", fin)


def toint(s, default=-1):
    try:
        return int(s or "")
    except ValueError:
        return default


def nth(xs, i, default=None):
    try:
        j = int(i)
        if j >= 0:
            return xs[j]
        return default
    except ValueError:
        return default


def dget(d, path, default=None):
    if not d or not path:
        return d

    parts = path.split(".") if isinstance(path, str) else path

    f = partial(d.get, parts[0]) if isinstance(d, dict) else partial(nth, d, toint(parts[0]))

    if x := f():
        return dget(x, parts[1:], default)

    return default


def check_file_exists(filename):
    # Construct the full path to the file
    file_path = os.path.join(app_settings.disk_cache_dir, filename)
    return os.path.isfile(file_path)


def return_stacked_image(rgb, src):
    rgb = np.dstack(rgb)
    image = Image.fromarray(rgb, "RGB")
    return image, src.height


# @cached(load_tiff_cache_)
# def load_from_disk(cog_id):
#     logging.info(f"Loading cog from disk: {cog_id}")
#     with rio.open(f"{app_settings.disk_cache_dir}/{cog_id}.cog.tif") as src:
#         bands = [src.read(i) for i in range(1, src.count + 1)]

#         if len(bands) == 1:
#             gray = bands[0]
#             image = Image.fromarray(gray, "L")
#         else:
#             red = bands[0] if len(bands) > 0 else np.zeros((src.height, src.width), dtype=np.uint8)
#             green = bands[1] if len(bands) > 1 else np.zeros((src.height, src.width), dtype=np.uint8)
#             blue = bands[2] if len(bands) > 2 else np.zeros((src.height, src.width), dtype=np.uint8)

#             rgb = np.dstack((red, green, blue))
#             image = Image.fromarray(rgb, "RGB")
#         return image, src.height
