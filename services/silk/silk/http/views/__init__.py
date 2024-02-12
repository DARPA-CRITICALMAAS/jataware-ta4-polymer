from fastapi import APIRouter

from . import doc, meta, rect, view

view_router = APIRouter()
view_router.include_router(view.router)
view_router.include_router(meta.router)
view_router.include_router(doc.router)
view_router.include_router(rect.router)
