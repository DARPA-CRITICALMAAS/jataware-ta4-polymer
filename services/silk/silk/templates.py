import logging
from logging import Logger
from pathlib import Path
from urllib.parse import urlparse

from fastapi.templating import Jinja2Templates

from .common.utils import dget
from .settings import app_settings

logger: Logger = logging.getLogger(__name__)


def path_match(path, val):
    return lambda d: dget(d, path) == val


def some(xs, pred, default=None):
    return next((x for x in xs if pred(x)), None)


def path_ext(url):
    ext = Path(urlparse(url).path).suffix or ""
    return ext.lower()


funcs = {
    "dget": dget,
    "some": some,
    "path_match": path_match,
    "path_ext": path_ext,
}

templates = Jinja2Templates(directory=app_settings.templates_dir)
templates.env.globals.update(funcs)
