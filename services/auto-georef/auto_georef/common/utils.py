import io
import logging
from functools import wraps
from logging import Logger
from time import perf_counter
from typing import Any, Callable

import boto3
import fitz
import numpy as np
from fastapi.concurrency import run_in_threadpool
from PIL import Image

from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)


def timeit(logger):
    def dec(f: Callable[..., Any]) -> Any:
        @wraps(f)
        def w(*args: Any, **kwargs: Any) -> Any:
            start = perf_counter()
            rtn = f(*args, **kwargs)
            time_since(logger, f"{f.__name__}", start)
            return rtn

        return w

    return dec


# s3 client builder
def s3_client():
    s3 = boto3.client("s3", endpoint_url=app_settings.cdr_s3_endpoint_url, verify=False)
    return s3


def download_file(s3_key, local_file_path):
    s3 = s3_client()
    try:
        s3.download_file(app_settings.cdr_public_bucket, s3_key, local_file_path)
        logging.info(f"File downloaded successfully to {local_file_path}")
    except Exception:
        logging.exception(f"Error downloading file from S3")


@timeit(logger)
async def load_tiff_cache(cache, s3_key):
    if s3_key in cache:
        logger.debug("Loading image from cache: %s", s3_key)
        return cache[s3_key]

    logger.debug("Loading image from S3: %s", s3_key)
    img_data = await run_in_threadpool(lambda: read_s3_contents(s3_key))
    image = Image.open(io.BytesIO(img_data))

    cache[s3_key] = image
    return image


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
        s3.head_object(Bucket=app_settings.cdr_public_bucket, Key=s3_key)
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


@timeit(logger)
def pdf_to_hd_tif(filepath, temp_file):
    doc = fitz.open(filepath)

    page = doc.load_page(0)

    pixels = page.get_pixmap(matrix=fitz.Matrix(5.0, 5.0))

    img = Image.open(io.BytesIO(pixels.tobytes()))
    tiff = io.BytesIO()
    img.save(tiff, format="TIFF")

    temp_file.write(tiff.getvalue())
