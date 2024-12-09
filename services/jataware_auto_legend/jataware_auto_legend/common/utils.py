import logging
from functools import wraps
from logging import Logger
from time import perf_counter
from typing import Any, Callable

import boto3
import numpy as np
from PIL import Image

from jataware_auto_legend.settings import app_settings

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
    s3 = boto3.client("s3", endpoint_url=app_settings.s3_endpoint_url, verify=False)
    return s3


@timeit(logger)
def upload_s3_file(s3_key, bucket, fp):
    s3 = s3_client()
    s3.upload_file(fp, bucket, s3_key)


def open_tiff(fname, as_np=True):
    img = Image.open(fname)
    img = img.convert("RGB")
    if as_np:
        img = np.array(img)

    return img


def time_since(logger, msg, start):
    fin = perf_counter() - start
    logger.debug(f"{msg} - completed in %.8f", fin)
