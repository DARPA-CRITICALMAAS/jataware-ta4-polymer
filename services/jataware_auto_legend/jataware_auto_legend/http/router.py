from fastapi import APIRouter

from .routes import health, legend

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    },
    {"name": "Legend", "description": "Legend endpoints"},
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(legend.router, prefix="/legend", tags=["Legend"])
