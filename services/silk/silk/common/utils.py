from functools import partial, wraps
from time import perf_counter
from typing import Any, Callable


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
