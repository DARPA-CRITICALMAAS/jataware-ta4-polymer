from functools import wraps
from time import perf_counter
from typing import Any, Callable

import numpy as np
from PIL import Image


def load_tiff(fname, as_np=True):
    img = Image.open(fname)
    img = img.convert("RGB")
    if as_np:
        img = np.array(img)

    return img


def time_since(logger, msg, start):
    fin = perf_counter() - start
    logger.debug(f"{msg} - completed in %.8f", fin)


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
