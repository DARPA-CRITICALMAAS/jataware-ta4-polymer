from fastapi import APIRouter

from .routes import db, health, pdfs

tags_metadata = [
    {
        "name": "Health",
        "description": "Health Checks",
    }
]

api_router = APIRouter()
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(pdfs.router, prefix="/pdfs", tags=["Pdfs"])
api_router.include_router(db.router, prefix="/db", tags=["Database"])
