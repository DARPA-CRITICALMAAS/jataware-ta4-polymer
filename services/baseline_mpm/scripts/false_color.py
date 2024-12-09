#!/usr/bin/env python

"""
    false_color.py
    
    [TODO] do this with rasterio so that projection information is preserved
"""

import sys
from tifffile import imread as tiffread
from tifffile import imwrite as tiffwrite
import matplotlib as mpl
import numpy as np

from rcode import *
import matplotlib.pyplot as plt

# --
# Params

cm   = 'nipy_spectral'
cmap = mpl.colormaps[cm]#.resampled(2 ** 14) # !! [BUG?] Still quantizes too much?

# --
# CLI

inpath  = sys.argv[1]
outpath = inpath.replace('.tif', '-fc.tif')

# --
# IO

x = tiffread(inpath)

# --
# Normalize

x = np.sqrt(x)
x = x / np.nanmax(x)
x = x - np.nanmin(x)

# --
# Colorize

c = cmap(x)[...,:3]
c = (c * 255).astype(np.uint8)

# --
# Save

tiffwrite(outpath, c)