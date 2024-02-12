import logging
from logging import Logger

import fitz
from fastapi import APIRouter, Request, Response
from fastapi.responses import PlainTextResponse

from ...db.db import db_session
from ...db.models import DbPdf
from ...pdf.utils import cache_open_pdf, page_svg

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/svg/pdf/{doc_id}/{page}", response_class=Response)
def svg(request: Request, doc_id: str, page: int, term: str = "", blocks: bool = False, bbox: str = ""):
    # cache?
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    blue = (0, 0, 1)
    red = (1, 0, 0)
    gold = (1, 1, 0)
    if term:
        logger.debug(term)
        for r in p.search_for(term):
            logger.debug(r)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=blue, fill=gold)
            annot.update(opacity=0.5)

    if blocks:
        blocks = p.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, *_ = block
            r = fitz.Rect(x0, y0, x1, y1)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=red, fill=None)
            annot.update(opacity=1)

    svg = page_svg(p)

    return Response(content=svg, media_type="image/svg+xml")


@router.get("/png/pdf/{doc_id}/{page}", response_class=Response)
def png(request: Request, doc_id: str, page: int, term: str = "", blocks: bool = False, bbox: str = ""):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    blue = (0, 0, 1)
    red = (1, 0, 0)
    gold = (1, 1, 0)
    if term:
        logger.debug(term)
        for r in p.search_for(term):
            logger.debug(r)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=blue, fill=gold)
            annot.update(opacity=0.5)

    if bbox:
        x0, y0, x1, y1, *_ = bbox.split(",")
        annot = p.add_rect_annot(fitz.Rect(float(x0), float(y0), float(x1), float(y1)))
        annot.set_border(width=1, dashes=[1, 2])
        annot.set_colors(stroke=blue, fill=gold)
        annot.update(opacity=0.5)

    if blocks:
        blocks = p.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, *_ = block
            r = fitz.Rect(x0, y0, x1, y1)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=red, fill=None)
            annot.update(opacity=1)

    zoom_x = 4.0  # horizontal zoom
    zoom_y = 4.0  # vertical zoom
    pix = p.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y))
    return Response(content=pix.tobytes(), media_type="image/png")


@router.get("/thumb/pdf/{doc_id}/{page}", response_class=Response)
def png_thumb(request: Request, doc_id: str, page: int, term: str = "", blocks: bool = False, bbox: str = ""):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    blue = (0, 0, 1)
    red = (1, 0, 0)
    gold = (1, 1, 0)
    if term:
        logger.debug(term)
        for r in p.search_for(term):
            logger.debug(r)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=blue, fill=gold)
            annot.update(opacity=0.5)

    if bbox:
        x0, y0, x1, y1, *_ = bbox.split(",")
        annot = p.add_rect_annot(fitz.Rect(float(x0), float(y0), float(x1), float(y1)))
        annot.set_border(width=1, dashes=[1, 2])
        annot.set_colors(stroke=blue, fill=gold)
        annot.update(opacity=0.5)

    if blocks:
        blocks = p.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, *_ = block
            r = fitz.Rect(x0, y0, x1, y1)
            annot = p.add_rect_annot(r)
            annot.set_border(width=1, dashes=[1, 2])
            annot.set_colors(stroke=red, fill=None)
            annot.update(opacity=1)

    pix = p.get_pixmap()
    return Response(content=pix.tobytes(), media_type="image/png")


@router.get("/svg/pdf/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}", response_class=Response)
def crop(request: Request, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float):
    # cache?

    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    logger.debug(
        "p.mediabox= %s, p.rotation= %s, p.cropbox= %s, p.rect = %s", p.mediabox, p.rotation, p.cropbox, p.rect
    )
    mb = p.mediabox
    r = fitz.Rect(x0, y0, x1, y1)
    logger.debug("r= %s", r)
    logger.debug(
        "p.mediabox= %s, p.rotation= %s, p.cropbox= %s, p.rect = %s", p.mediabox, p.rotation, p.cropbox, p.rect
    )
    logger.debug("r= %s", r)
    x0 = max(mb.x0, r.x0)
    x1 = min(mb.x1, r.x1)
    y0 = max(mb.y0, r.y0)
    y1 = min(mb.y1, r.y1)
    logger.debug("p.mediabox= %s", p.mediabox)
    p.set_cropbox(p.mediabox)
    logger.debug("p.mediabox= %s", p.mediabox)
    zoom_x = 4.0  # horizontal zoom
    zoom_y = 4.0  # vertical zoom
    logger.debug(
        "r = %s, p.mediabox= %s, p.rotation= %s, p.cropbox= %s, p.rect = %s",
        r,
        p.mediabox,
        p.rotation,
        p.cropbox,
        p.rect,
    )
    r * p.rotation_matrix
    pix = p.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y), clip=r)
    return Response(content=pix.tobytes(), media_type="image/png")


@router.get("/txt/pdf/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}", response_class=Response)
def txt(request: Request, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    wrect = fitz.Rect(x0, y0, x1, y1)
    s = p.get_text(clip=wrect)
    return PlainTextResponse(s)
