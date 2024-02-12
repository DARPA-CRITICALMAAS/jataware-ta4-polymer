import logging
from logging import Logger

from fastapi import APIRouter

from ...db.db import db_session
from ...db.models import DbPdf

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/pdfs", summary="", description="")
def get_pdfs():
    with db_session() as session:
        pdfs = session.query(DbPdf).all()

    return pdfs
