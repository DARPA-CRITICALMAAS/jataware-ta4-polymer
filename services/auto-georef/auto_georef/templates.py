import json
import logging
from datetime import datetime
from logging import Logger
from pathlib import Path
from urllib.parse import urlparse

from fastapi.templating import Jinja2Templates
from humanfriendly import format_size
from humanize import naturaldelta

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


def human_delta(t: datetime):
    now = datetime.utcnow()
    delta = now - t
    return naturaldelta(delta, minimum_unit="milliseconds")


funcs = {
    "dget": dget,
    "some": some,
    "path_match": path_match,
    "path_ext": path_ext,
    "format_size": format_size,
    "human_delta": human_delta,
}

templates = Jinja2Templates(directory=app_settings.ui_templates_dir)
templates.env.globals.update(funcs)
templates.env.filters["jsonify"] = json.dumps
