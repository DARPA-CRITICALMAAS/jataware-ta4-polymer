import logging
from functools import lru_cache
from logging import Logger
from pathlib import Path

import fitz

from ..common import utils
from ..settings import app_settings

logger: Logger = logging.getLogger(__name__)


@utils.timeit(logger)
def open_pdf(f):
    doc = fitz.open(f)
    return doc


@utils.timeit(logger)
def page_svg(page):
    svg = page.get_svg_image(matrix=fitz.Identity)
    return svg


# threading nightmare
@lru_cache(maxsize=8)
def _load_pdf(record_id):
    logger.debug("cache miss %s", record_id)
    doc = fitz.open(Path(app_settings.doc_cache).joinpath(f"{record_id}.pdf"))
    return doc


@utils.timeit(logger)
def cache_open_pdf(record_id):
    return _load_pdf(record_id)
