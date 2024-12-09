import logging
from logging import Logger

import httpx
from cachetools import TTLCache

from .settings import app_settings

logger: Logger = logging.getLogger(__name__)


meta_cache = TTLCache(maxsize=30, ttl=300)


def get_doc_meta(cdr_id: str):
    if meta := meta_cache.get(cdr_id):
        return meta

    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{app_settings.cdr_api_host}/v1/docs/document/meta/{cdr_id}"
    res = httpx.get(url, headers=headers, timeout=None)
    res.raise_for_status()

    meta = res.json()
    meta_cache[cdr_id] = meta

    return meta
