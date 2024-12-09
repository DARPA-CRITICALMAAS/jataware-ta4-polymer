from fastapi import APIRouter

from .routes import health, model

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    },
    {"name": "Model", "description": "Model run endpoints"},
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(model.router, prefix="/model", tags=["Model"])
