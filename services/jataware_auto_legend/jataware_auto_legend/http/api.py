import logging
from logging import Logger

from fastapi import FastAPI

from .middleware import setup_middleware
from .router import api_router, tags_metadata

logger: Logger = logging.getLogger(__name__)
api = FastAPI(debug=True, openapi_tags=tags_metadata)
setup_middleware(api)
api.include_router(api_router)


def print_debug_routes() -> None:
    max_len = max(len(route.path) for route in api.routes)
    routes = sorted(
        [(method, route.path, route.name) for route in api.routes for method in route.methods],
        key=lambda x: (x[1], x[0]),
    )
    route_table = "\n".join(f"{method:7} {path:{max_len}} {name}" for method, path, name in routes)
    logger.debug("Route Table:\n%s", route_table)
