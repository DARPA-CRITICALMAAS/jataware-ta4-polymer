from fastapi import APIRouter

from . import index, points_lines

view_router = APIRouter()
view_router.include_router(index.router)
view_router.include_router(points_lines.router)
