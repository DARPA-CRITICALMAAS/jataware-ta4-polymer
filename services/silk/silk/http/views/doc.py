import logging
import uuid
from collections import defaultdict
from itertools import groupby
from logging import Logger
from pathlib import Path
from typing import Dict, List

import fitz
import openai
from cachetools import TTLCache
from fastapi import APIRouter, Request, Response, status
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import joinedload

from ...db.db import db_session
from ...db.models import DbAnnotation, DbPdf
from ...pdf.utils import cache_open_pdf
from ...settings import app_settings
from ...templates import templates

openai.api_key = app_settings.openai_api_key


logger: Logger = logging.getLogger(__name__)
router = APIRouter()
gpt_cache = TTLCache(maxsize=10, ttl=60)


@router.get("/d/{doc_id}/{page}")
async def index(doc_id: str, page: int, request: Request, bbox: str = ""):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)

    p = doc[page]
    r = p.rect
    rotation = p.rotation
    logger.debug("page rect: %s", r)
    page_x1 = r.x1
    page_y1 = r.y1

    selection = []
    if bbox:
        x0, y0, x1, y1, *_ = bbox.split(",")
        selection = [float(f) for f in [x0, y0, x1, y1]]

    return templates.TemplateResponse(
        "doc/index.html",
        {
            "doc_id": doc_id,
            "request": request,
            "file": pdf.file_name,
            "page_num": page,
            "page_count": doc.page_count,
            "page_height": page_y1,
            "page_width": page_x1,
            "scale_factor": 4.0,
            "rotation": rotation,
            "selection": selection,
        },
    )


def recoverpix(doc, item):
    xref = item[0]  # xref of PDF image
    smask = item[1]  # xref of its /SMask

    # special case: /SMask or /Mask exists
    if smask > 0:
        pix0 = fitz.Pixmap(doc.extract_image(xref)["image"])
        if pix0.alpha:  # catch irregular situation
            pix0 = fitz.Pixmap(pix0, 0)  # remove alpha channel
        mask = fitz.Pixmap(doc.extract_image(smask)["image"])

        try:
            pix = fitz.Pixmap(pix0, mask)
        except:  # fallback to original base image in case of problems
            pix = fitz.Pixmap(doc.extract_image(xref)["image"])

        if pix0.n > 3:
            ext = "pam"
        else:
            ext = "png"

        return {  # create dictionary expected by caller
            "ext": ext,
            "colorspace": pix.colorspace.n,
            "image": pix.tobytes(ext),
        }

    # special case: /ColorSpace definition exists
    # to be sure, we convert these cases to RGB PNG images
    if "/ColorSpace" in doc.xref_object(xref, compressed=True):
        pix = fitz.Pixmap(doc, xref)
        pix = fitz.Pixmap(fitz.csRGB, pix)
        return {  # create dictionary expected by caller
            "ext": "png",
            "colorspace": 3,
            "image": pix.tobytes("png"),
        }
    return doc.extract_image(xref)


@router.get("/partials/d/img/{doc_id}/{page_num}/{xref}", response_class=Response)
async def index_overview_image(doc_id: str, page_num: int, xref: int, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()
    doc = cache_open_pdf(pdf.id)

    img = next((img for img in doc[page_num].get_images() if img[0] == xref), None)
    if not img:
        return Response(status_code=status.HTTP_404_NOT_FOUND, content="")

    image = recoverpix(doc, img)
    image["colorspace"]
    imgdata = image["image"]

    return Response(content=imgdata, media_type="image/png")


@router.get("/i/{doc_id}")
async def image_overview(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    doc = cache_open_pdf(pdf.id)

    imgs = []

    # for i, page in enumerate(doc):
    #     if xs := page.get_images():
    #         for img in xs:
    #             imgs.append((i, img))

    for i, page in enumerate(doc):
        if xs := page.get_image_info():
            for img in xs:
                x0, y0, x1, y1 = img["bbox"]
                imgs.append(
                    {
                        "page": i,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                    }
                )

    return templates.TemplateResponse(
        "doc/images.html",
        {
            "doc_id": doc_id,
            "request": request,
            "imgs": imgs,
        },
    )


@router.get("/partials/t/search/{doc_id}")
async def index_text_search_results(doc_id: str, request: Request, term: str = ""):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    results = defaultdict(list)

    doc = cache_open_pdf(pdf.id)

    if term and len(term) > 2:
        for p in doc:
            page_search_results = [
                fitz.Rect(float(r[0]), float(r[1]), float(r[2]), float(r[3])) for r in p.search_for(term)
            ]

            blocks = p.get_text("blocks")

            for block in blocks:
                x0, y0, x1, y1, *_ = block
                r = fitz.Rect(x0, y0, x1, y1)

                if any(term for term in page_search_results if r.contains(term)):
                    results[p.number].append(
                        {
                            "page": p.number,
                            "x0": x0,
                            "y0": y0,
                            "x1": x1,
                            "y1": y1,
                        }
                    )

    return templates.TemplateResponse(
        "doc/text_search_results.html",
        {
            "doc_id": doc_id,
            "request": request,
            "results": results,
            "term": term,
        },
    )


@router.get("/t/{doc_id}")
async def index_text_search(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    cache_open_pdf(pdf.id)

    return templates.TemplateResponse(
        "doc/text_search.html",
        {
            "doc_id": doc_id,
            "request": request,
            "results": [],
            "imgs": [],
        },
    )


class Rect(BaseModel):
    x0: float
    x1: float
    y0: float
    y1: float


class Rects(BaseModel):
    selections: List[Rect]


@router.post("/doc/partials/clip/{doc_id}/{page}")
async def clip_item(doc_id: str, page: int, rects: Rects, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache
    doc = cache_open_pdf(pdf.id)
    p = doc[page]
    mb = p.mediabox
    logger.debug(mb)
    logger.debug(rects)

    clips = []
    for r in rects.selections:
        x0 = max(mb.x0, r.x0)
        x1 = min(mb.x1, r.x1)
        y0 = max(mb.y0, r.y0)
        y1 = min(mb.y1, r.y1)

        wrect = fitz.Rect(x0, y0, x1, y1)
        logger.debug(wrect)
        s = p.get_text(clip=wrect)
        img_url = f"/svg/pdf/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}"
        p.set_cropbox(wrect)
        zoom_x = 4.0  # horizontal zoom
        zoom_y = 4.0  # vertical zoom

        pix = p.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y), clip=wrect)
        logger.debug(pix)
        pix.tobytes()

        # TODO: table extarction expensive
        # img = Image(pix_xs)
        # extracted_tables = img.extract_tables(
        #     ocr=ocr,
        #     implicit_rows=False,
        #     borderless_tables=True,
        #     min_confidence=50)

        tbls = []
        for tbl in []:  # extracted_tables:
            tbls.append(
                {
                    "html": tbl.df.to_html(header=False, index=False, classes="table-xs table-zebra").replace(
                        "None", ""
                    ),
                    "csv": tbl.df.to_csv(header=False, index=False),
                }
            )

        clips.append(
            {
                "text": s,
                "img_url": img_url,
                "tbls": tbls,
            }
        )

    return templates.TemplateResponse(
        "doc/items.html", {"request": request, "doc_id": doc_id, "file": pdf.file_name, "page": page, "clips": clips}
    )


@router.get("/doc/download/{doc_id}", response_class=Response)
async def doc_id_download(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    logger.debug("pdf.id=%s", pdf.id)
    # cache

    headers = {"Content-Disposition": f"inline; filename={pdf.file_name}"}
    # TODO: async read iter
    with Path(app_settings.doc_cache).joinpath(f"{pdf.id}.pdf").open("rb") as f:
        content = f.read()

    return Response(content, headers=headers, media_type="application/pdf")


@router.get("/doc/annotations/download/{doc_id}")
async def doc_id_annotations_download(doc_id: str, request: Request):
    with db_session() as session:
        pdf = (
            session.query(DbPdf)
            .options(joinedload(DbPdf.doc_info), joinedload(DbPdf.annotations).joinedload(DbAnnotation.tags))
            .filter_by(id=doc_id)
            .one()
        )
        return pdf


class GptRequest(BaseModel):
    content: str
    prompt: str


@router.post("/doc/ask/gpt")
async def gpt_response(gpt: GptRequest, request: Request, model: str = "gpt-3.5-turbo"):
    prompt = f"""
    {gpt.content.strip()}
    """
    msgs = [{"role": "system", "content": prompt}]
    msgs.append({"role": "user", "content": gpt.prompt})
    completion = openai.ChatCompletion.create(
        model="gpt-4",
        messages=msgs,
        temperature=0,
    )

    result = completion.choices[0].message.content

    return templates.TemplateResponse(
        "doc/gpt.html",
        {
            "request": request,
            "assistant": result,
        },
    )


class GptChat(BaseModel):
    msgs: List[Dict]
    model: str


@router.post("/doc/ask/gpt/stream")
async def gpt_response_stream(gpt: GptRequest, request: Request, model: str = "gpt-3.5-turbo"):
    prompt = f"""
    {gpt.content.strip()}
    """
    msgs = [{"role": "system", "content": prompt}]
    msgs.append({"role": "user", "content": gpt.prompt})
    chat_id = uuid.uuid4().hex
    logger.debug("chat id: %s", chat_id)
    gpt_cache[chat_id] = GptChat(msgs=msgs, model=model)

    return templates.TemplateResponse(
        "doc/gpt.html",
        {"request": request, "connect": f"/doc/ask/gpt/stream/{chat_id}"},
    )


async def gpt_stream(msgs, model):
    async for chunk in await openai.ChatCompletion.acreate(
        messages=msgs,
        model=model,
        stream=True,
    ):
        content = chunk["choices"][0].get("delta", {}).get("content")
        if content:
            yield f"event: gpt_response\ndata: {content}\n\n"

    yield "event: fin\ndata: \n\n"


@router.get("/doc/ask/gpt/stream/{chat_id}")
async def gpt_response_stream_sse(chat_id: str, request: Request) -> StreamingResponse:
    chat = gpt_cache[chat_id]

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(gpt_stream(chat.msgs, chat.model), headers=headers)


@router.get("/partial/doc/annotations/{doc_id}/{page}")
def doc_annotations(doc_id: str, page: int, request: Request):
    with db_session() as session:
        annotations = (
            session.query(DbAnnotation)
            .options(joinedload(DbAnnotation.tags))
            .filter_by(doc_id=doc_id, page=page)
            .all()
        )

    return templates.TemplateResponse(
        "doc/annotations.html",
        {"doc_id": doc_id, "request": request, "annotations": annotations},
    )


@router.delete("/partial/doc/annotations/{annotation_id}")
def delete_annotations(annotation_id, request: Request):
    with db_session() as session:
        if annotation := session.query(DbAnnotation).filter_by(id=annotation_id).first():
            session.delete(annotation)
            session.commit()

    return HTMLResponse(status_code=status.HTTP_200_OK, content="")


@router.get("/a/{doc_id}")
def annotations_overview(doc_id: str, request: Request):
    return templates.TemplateResponse(
        "doc/annotation_overview.html",
        {
            "doc_id": doc_id,
            "request": request,
        },
    )


@router.get("/partial/a/search/{doc_id}")
def annotations_overview_filtered(doc_id: str, request: Request, q: str = ""):
    with db_session() as session:
        annotations = (
            session.query(DbAnnotation)
            .options(joinedload(DbAnnotation.tags))
            .filter_by(doc_id=doc_id)
            .order_by(DbAnnotation.page)
            .all()
        )

    if q:
        annotations = [
            annotation for annotation in annotations for tag in annotation.tags if q.lower() in tag.value.lower()
        ]

    page_annotations = groupby(annotations, lambda a: a.page)

    return templates.TemplateResponse(
        "doc/component_annotation_overview_filtered.html",
        {
            "doc_id": doc_id,
            "request": request,
            "page_annotations": page_annotations,
        },
    )
