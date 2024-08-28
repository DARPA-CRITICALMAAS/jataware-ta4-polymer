from fastapi import APIRouter

from .routes import cache, cma, health, map, segment

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    },
    {"name": "Cache", "description": "Manage cache endpoints"},
    {"name": "Map", "description": "Map endpoints"},
    {"name": "Segment", "description": "Segment Map"},
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(cache.router, prefix="/cache", tags=["Cache"])
api_router.include_router(map.router, prefix="/map", tags=["Map"])
api_router.include_router(segment.router, prefix="/segment", tags=["Segment"])
api_router.include_router(cma.router, prefix="/cma", tags=["CMA"])
