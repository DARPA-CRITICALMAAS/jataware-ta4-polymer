from fastapi import APIRouter

from .routes import cache, health, segment

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    },
    {"name": "Cache", "description": "Cache"},
    {"name": "Segment", "description": "Segment Map"},
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(cache.router, prefix="/cache", tags=["Cache"])
api_router.include_router(segment.router, prefix="/segment", tags=["Segment"])
