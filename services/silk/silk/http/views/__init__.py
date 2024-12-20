from fastapi import APIRouter

from . import cdr_doc, cdr_index, doc, doc_info, meta, rect, view

view_router = APIRouter()

view_router.include_router(cdr_index.router)
view_router.include_router(cdr_doc.router)
view_router.include_router(view.router)
view_router.include_router(meta.router)
view_router.include_router(doc.router)
view_router.include_router(doc_info.router)
view_router.include_router(rect.router)
