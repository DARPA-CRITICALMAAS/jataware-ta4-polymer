from fastapi import APIRouter

from .routes import health, map

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    },
    {"name": "Map", "description": "Map endpoints"},
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(map.router, prefix="/map", tags=["Map"])
