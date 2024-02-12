import logging
from logging import Logger

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.routing import Mount

from ..db.db import sqlite_engine
from ..settings import app_settings
from . import views
from .middleware import setup_middleware
from .router import api_router, tags_metadata

logger: Logger = logging.getLogger(__name__)
api = FastAPI(debug=True, openapi_tags=tags_metadata)
setup_middleware(api)
api.include_router(api_router, prefix="/v1")
api.mount("/static", StaticFiles(directory="static"), name="static")
api.include_router(views.view_router, include_in_schema=False)


def print_debug_routes() -> None:
    max_len = max(len(route.path) for route in api.routes)
    routes = sorted(
        [
            (method, route.path, route.name)
            for route in api.routes
            if not isinstance(route, Mount)
            for method in route.methods
        ],
        key=lambda x: (x[1], x[0]),
    )
    route_table = "\n".join(f"{method:7} {path:{max_len}} {name}" for method, path, name in routes)
    logger.debug("Route Table:\n%s", route_table)


@api.on_event("startup")
async def startup_event() -> None:
    logger.info("startup")
    logger.debug(app_settings)
    print_debug_routes()


@api.on_event("shutdown")
def shutdown_event() -> None:
    try:
        sqlite_engine.dispose()
    except Exception:
        logger.exception("sqlite closing")
    logger.debug("shutdown")
