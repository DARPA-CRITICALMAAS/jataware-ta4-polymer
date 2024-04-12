import logging
from functools import reduce
from io import BytesIO, StringIO
from logging import Logger
from typing import Annotated

import fitz
import httpx
import openai
import pandas
from fastapi import APIRouter, Form, Request, status
from fastapi.responses import HTMLResponse
from PIL import Image

from ...db.db import db_session
from ...db.models import DbAnnotation, DbAnnotationTag, DbPdf
from ...pdf.utils import cache_open_pdf
from ...settings import app_settings
from ...templates import templates

openai.api_key = app_settings.openai_api_key

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/r/{annotation_type}/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
def index(annotation_type: str, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    doc = cache_open_pdf(pdf.id)
    p = doc[page]
    r = p.rect
    rotation = p.rotation
    logger.debug("page rect: %s", r)
    page_x1 = r.x1
    page_y1 = r.y1

    wrect = fitz.Rect(x0, y0, x1, y1)
    s = p.get_text(clip=wrect)

    def clean(a, line):
        l = line.strip()
        if a[-2:] == "\n\n" and l == "":
            return a
        return a + l + "\n"

    clean_extract = reduce(clean, s.split("\n"), "")

    return templates.TemplateResponse(
        "rect/index.html",
        {
            "doc_id": doc_id,
            "request": request,
            "file": pdf.file_name,
            "page_num": page,
            "page_count": doc.page_count,
            "page_height": page_y1,
            "page_width": page_x1,
            "scale_factor": 4.0,
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
            "extract_text": clean_extract,
            "rotation": rotation,
            "annotation_type": annotation_type,
        },
    )


@router.get("/r/tbl/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
def index_table(doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    doc = cache_open_pdf(pdf.id)
    p = doc[page]
    r = p.rect
    rotation = p.rotation
    logger.debug("page rect: %s", r)
    page_x1 = r.x1
    page_y1 = r.y1

    return templates.TemplateResponse(
        "select_table/index.html",
        {
            "doc_id": doc_id,
            "request": request,
            "file": pdf.file_name,
            "page_num": page,
            "page_count": doc.page_count,
            "page_height": page_y1,
            "page_width": page_x1,
            "scale_factor": 4.0,
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
            "rotation": rotation,
        },
    )


@router.delete("/partial/r/labels/{label_id}")
def delete_label(label_id: str, request: Request):
    logger.debug("delete label %s", label_id)
    with db_session() as session:
        if label := session.query(DbAnnotationTag).filter_by(id=label_id).first():
            session.delete(label)
            session.commit()

    return HTMLResponse(status_code=status.HTTP_200_OK, content="")


@router.post("/partial/r/labels")
def add_label(
    request: Request,
    doc_id: Annotated[str, Form()],
    page: Annotated[int, Form()],
    x0: Annotated[float, Form()],
    x1: Annotated[float, Form()],
    y0: Annotated[float, Form()],
    y1: Annotated[float, Form()],
    annotation_type: Annotated[str, Form()],
    annotation_id: Annotated[str, Form()] = "",
    label: Annotated[str, Form()] = "",
    value: Annotated[str, Form()] = "",
    comment: Annotated[str, Form()] = "",
):
    form_data = {"label": label, "value": value, "comment": comment}

    data = {
        "request": request,
        "form_data": form_data,
        "invalid": {},
        "doc_id": doc_id,
        "page": page,
        "x0": x0,
        "x1": x1,
        "y0": y0,
        "y1": y1,
        "annotation_id": annotation_id,
        "annotation_type": annotation_type,
    }

    if not label:
        data["invalid"]["label"] = True

    if not value:
        data["invalid"]["value"] = True

    if data["invalid"]:
        # headers = { 'HX-Retarget': "#error", "HX-Reswap": "innerHTML"}
        return templates.TemplateResponse("rect/add_label.html", data)

    logger.debug("finding annotation")

    with db_session() as session:
        tag = DbAnnotationTag(**form_data)
        logger.debug("tag id = %s", tag.id)
        if annotation_id and (annotation := session.query(DbAnnotation).filter_by(id=annotation_id).first()):
            annotation.tags.append(tag)
            data["annotation_id"] = annotation.id
            logger.debug("added %s", form_data)
            session.commit()

        elif (
            annotation := session.query(DbAnnotation)
            .filter_by(doc_id=doc_id, page=page, x0=x0, x1=x1, y0=y0, y1=y1)
            .first()
        ):
            data["annotation_id"] = annotation.id
            annotation.tags.append(tag)
            logger.debug("added %s", form_data)
            session.commit()

        else:
            logger.debug("adding new annotation record")
            annotation = DbAnnotation(
                annotation_type=annotation_type, doc_id=doc_id, page=page, x0=x0, y0=y0, x1=x1, y1=y1
            )
            annotation.tags.append(tag)
            session.add(annotation)
            session.commit()

        data["label"] = tag
        logger.debug(tag.id)
    data["form_data"] = {}
    return templates.TemplateResponse("rect/add_label.html", data)


@router.get("/partial/r/{annotation_type}/labels/form/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
def get_labels_form(
    annotation_type: str, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float, request: Request
):
    with db_session() as session:
        annotation = (
            session.query(DbAnnotation)
            .filter_by(
                annotation_type=annotation_type,
                doc_id=doc_id,
                page=page,
                x0=x0,
                x1=x1,
                y0=y0,
                y1=y1,
            )
            .first()
        )

        annotation_id = annotation.id if annotation else ""

    return templates.TemplateResponse(
        "rect/add_label.html",
        {
            "request": request,
            "invalid": {},
            "form_data": {},
            "doc_id": doc_id,
            "page": page,
            "x0": x0,
            "x1": x1,
            "y0": y0,
            "y1": y1,
            "annotation_id": annotation_id,
            "annotation_type": annotation_type,
        },
    )


@router.get("/partial/r/{annotation_type}/labels/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
def rect_labels(
    annotation_type: str, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float, request: Request
):
    labels = []
    with db_session() as session:
        if (
            annotation := session.query(DbAnnotation)
            .filter_by(annotation_type=annotation_type, doc_id=doc_id, page=page, x0=x0, x1=x1, y0=y0, y1=y1)
            .first()
        ):
            labels = annotation.tags
    return templates.TemplateResponse(
        "rect/labels.html",
        {
            "doc_id": doc_id,
            "request": request,
            "labels": labels,
        },
    )


@router.get("/partial/gpt/table/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
def gpt_table(doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).filter_by(id=doc_id).one()

    doc = cache_open_pdf(pdf.id)
    p = doc[page]
    r = p.rect
    rotation = p.rotation
    page_x1 = r.x1
    page_y1 = r.y1

    wrect = fitz.Rect(x0, y0, x1, y1)
    s = p.get_text(clip=wrect)

    def clean(a, line):
        l = line.strip()
        if a[-2:] == "\n\n" and l == "":
            return a
        return a + l + "\n"

    clean_extract = reduce(clean, s.split("\n"), "")

    context = f"{ clean_extract }"

    prompt = """
    You have been given a string that represents a table.
    Produce a csv from the string only respond with the csv, your response should be parseable with pandas.read_csv
    """

    msgs = [{"role": "system", "content": context}, {"role": "user", "content": prompt}]

    completion = openai.ChatCompletion.create(
        model="gpt-4",
        messages=msgs,
        temperature=0,
    )
    result = completion.choices[0].message.content

    tbl = ""
    try:
        buf = StringIO(result)
        df = pandas.read_csv(buf)
        tbl = df.to_html(index=False)
    except Exception:
        logger.exception("pandas table")

    return templates.TemplateResponse(
        "select_table/table.html",
        {
            "doc_id": doc_id,
            "request": request,
            "file": pdf.file_name,
            "page_num": page,
            "page_count": doc.page_count,
            "page_height": page_y1,
            "page_width": page_x1,
            "scale_factor": 4.0,
            "x0": x0,
            "y0": y0,
            "x1": x1,
            "y1": y1,
            "extract_text": result.strip(),
            "extract_table": tbl,
            "rotation": rotation,
        },
    )


@router.post("/partial/r/table/refresh")
def refresh_table(extract_text: Annotated[str, Form()], request: Request):
    tbl = ""
    try:
        buf = StringIO(extract_text)
        df = pandas.read_csv(buf)
        tbl = df.to_html(index=False)
    except Exception:
        logger.exception("pandas table")
        # headers = { 'HX-Retarget': "#errors", "HX-Reswap": "innerHTML"}
        return HTMLResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content="failed to parse to table")

    return HTMLResponse(status_code=status.HTTP_200_OK, content=tbl)


async def send_to_georeferencer(doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float):
    try:
        with db_session() as session:
            pdf = session.query(DbPdf).filter_by(id=doc_id).one()
        doc = cache_open_pdf(pdf.id)

        p = doc[page]

        mb = p.mediabox
        r = fitz.Rect(x0, y0, x1, y1)
        x0 = max(mb.x0, r.x0)
        x1 = min(mb.x1, r.x1)
        y0 = max(mb.y0, r.y0)
        y1 = min(mb.y1, r.y1)

        p.set_cropbox(p.mediabox)

        zoom_x = 4.0  # horizontal zoom
        zoom_y = 4.0  # vertical zoom
        r = r * p.rotation_matrix
        pix = p.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y), clip=r)
        img = Image.open(BytesIO(pix.tobytes()))
        tiff = BytesIO()
        img.save(tiff, format="TIFF")

        url = f"{app_settings.georef_api_host}/api/map/processMap"
        files = {"file": (f"silk_{doc_id}_{page}.tiff", tiff.getvalue())}

        async with httpx.AsyncClient(timeout=None) as client:
            logger.debug("login")
            await client.post(
                "https://auth.polymer.rocks/api/firstfactor",
                json={"username": app_settings.authelia_user, "password": app_settings.authelia_pass},
            )

            logger.debug("post")
            r = await client.post(url, files=files)
            r.raise_for_status()

            j = r.json()
            map_id = j.get("map_id")

            return map_id

    except Exception:
        logger.exception("failed")


@router.get("/partial/georef/img/{doc_id}/{page}/{x0}/{y0}/{x1}/{y1}")
async def georef_image(request: Request, doc_id: str, page: int, x0: float, y0: float, x1: float, y1: float):
    map_id = await send_to_georeferencer(doc_id, page, x0, y0, x1, y1)

    html = f"""
    <a target="_blank" class="link link-primary text-sm" href="https://georef.polymer.rocks/points/{map_id}">View Georeferenced</a>
    """  # noqa: E501
    return HTMLResponse(status_code=status.HTTP_200_OK, content=html)