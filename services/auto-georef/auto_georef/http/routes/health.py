import logging
from logging import Logger

from fastapi import APIRouter, Response
from starlette.status import HTTP_204_NO_CONTENT

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/check",
    summary="health check",
    description="Health check end point",
    status_code=HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def get_health_check():
    pass
