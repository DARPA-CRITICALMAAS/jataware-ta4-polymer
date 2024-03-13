#!/usr/bin/env python

"""
    helpers.py
"""

from itertools import chain, combinations

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def round4(x):
    return float(f"{float(x):0.4f}")


def to_numpy(x):
    return x.detach().cpu().numpy()


def powerset(iterable, minsize=3, maxsize=6):
    s = list(iterable)
    if minsize is None:
        minsize = 0
    if maxsize is None:
        maxsize = len(s) + 1

    return chain.from_iterable(combinations(s, r) for r in range(minsize, maxsize))
