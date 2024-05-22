import json
import logging
from functools import lru_cache
from logging import Logger
from typing import Annotated

import fitz
import httpx
import openai
from cachetools import TTLCache
from fastapi import APIRouter, Form, Request, Response, UploadFile, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import joinedload

from ...common.utils import dget
from ...db.db import db_session
from ...db.models import DbAnnotation, DbAnnotationTag, DbDocInfo, DbPdf
from ...pdf.utils import cache_open_pdf
from ...settings import app_settings
from ...templates import templates

openai.api_key = app_settings.openai_api_key


logger: Logger = logging.getLogger(__name__)
router = APIRouter()
gpt_cache = TTLCache(maxsize=10, ttl=60)


@router.get("/info/d/{doc_id}")
async def info(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

    return templates.TemplateResponse(
        "doc/info.html",
        {"doc_id": doc_id, "request": request, "doc_info": pdf.doc_info},
    )


@router.get("/partial/info/d/{doc_id}")
async def doc_info(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

    return templates.TemplateResponse(
        "doc/component_info.html",
        {"doc_id": doc_id, "request": request, "doc_info": pdf.doc_info},
    )


@router.get("/partial/info/d/{doc_id}/edit")
async def doc_info_edit(doc_id: str, request: Request):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

    return templates.TemplateResponse(
        "doc/component_info_edit.html",
        {"doc_id": doc_id, "request": request, "doc_info": pdf.doc_info},
    )


@router.put("/partial/info/d/{doc_id}")
async def doc_info_update(
    doc_id: str,
    request: Request,
    doi: Annotated[str, Form()] = "",
    name: Annotated[str, Form()] = "",
    authors: Annotated[str, Form()] = "",
    journal: Annotated[str, Form()] = "",
    uri: Annotated[str, Form()] = "",
    title: Annotated[str, Form()] = "",
    year: Annotated[str, Form()] = "",
    month: Annotated[str, Form()] = "",
    volume: Annotated[str, Form()] = "",
    issue: Annotated[str, Form()] = "",
    description: Annotated[str, Form()] = "",
    xdd_id: Annotated[str, Form()] = "",
):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

        if not pdf.doc_info:
            pdf.doc_info = DbDocInfo()

        pdf.doc_info.doi = doi
        pdf.doc_info.name = name
        pdf.doc_info.authors = authors
        pdf.doc_info.journal = journal
        pdf.doc_info.uri = uri
        pdf.doc_info.title = title
        pdf.doc_info.year = year
        pdf.doc_info.month = month
        pdf.doc_info.volume = volume
        pdf.doc_info.issue = issue
        pdf.doc_info.description = description
        pdf.doc_info.xdd_id = xdd_id
        logger.debug("updating %s", session.dirty)
        session.commit()
        session.flush()

        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

    return templates.TemplateResponse(
        "doc/component_info.html",
        {"doc_id": doc_id, "request": request, "doc_info": pdf.doc_info},
    )


@router.delete("/partial/info/d/{doc_id}/clear")
async def delete_all_annotations(doc_id: str, request: Request, response: Response):
    with db_session() as session:
        annotations = session.query(DbAnnotation).filter_by(doc_id=doc_id).all()
        for a in annotations:
            session.delete(a)
        session.commit()


@router.post("/partial/info/d/{doc_id}/mc/upload")
async def doc_info_upload_mc(doc_id: str, file: Annotated[UploadFile, Form()], request: Request, response: Response):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

        doc = cache_open_pdf(pdf.id)
        j = json.load(file.file)

        update_doc_info = True

        for mineral_system in ["energy", "overflow", "pathway", "preservation", "source", "trap"]:
            logger.debug("mineral_system: %s", mineral_system)
            mappable_criteria = j.get(mineral_system, [])

            for mc in mappable_criteria:
                criteria = mc.get("criteria", [])

                for ref in mc.get("supporting_references"):
                    if update_doc_info:
                        if not pdf.doc_info:
                            pdf.doc_info = DbDocInfo()

                        di = ref.get("document", {})
                        for k in [
                            "title",
                            "doi",
                            "authors",
                            "journal",
                            "year",
                            "month",
                            "volume",
                            "issue",
                            "description",
                        ]:
                            if v := di.get(k):
                                setattr(pdf.doc_info, k, v)

                        session.commit()
                        update_doc_info = False

                    for pi in ref.get("page_info"):
                        if (page_num := pi.get("page")) is None:
                            logger.warning("No Page: %s", pi)
                            continue

                        page = doc[page_num]
                        r = page.rect

                        if bbox := pi.get("bounding_box"):
                            _r = fitz.Rect(bbox[0])
                            for x0, y0, x1, y1 in bbox[1:]:
                                if x0 < _r.x0:
                                    _r.x0 = x0
                                if y0 < _r.y0:
                                    _r.y0 = y0
                                if x1 > _r.x1:
                                    _r.x1 = x1
                                if y1 > _r.y1:
                                    _r.y1 = y1

                            logger.debug("page: %s, rect: %s", page_num, _r)
                            r = _r

                        annotation = DbAnnotation(
                            annotation_type="txt", doc_id=doc_id, page=page_num, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1
                        )
                        annotation.tags.append(
                            DbAnnotationTag(label="mappable_criteria", value=criteria, comment=mineral_system)
                        )
                        annotation.tags.append(
                            DbAnnotationTag(label="text", value=pi.get("text", ""), comment=mineral_system)
                        )
                        session.add(annotation)
                        session.commit()

    headers = {"HX-Redirect": f"/a/{doc_id}"}
    return HTMLResponse(content="", status_code=status.HTTP_200_OK, headers=headers)


@lru_cache(maxsize=128)
def lookup_resource_label(label):
    url = "https://minmod.isi.edu/sparql"

    q = f"""
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT ?label
    WHERE {{
      <{label}> rdfs:label ?label .
    }}
    """

    headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/sparql-results+json"}
    try:
        r = httpx.post(url=url, data={"query": q}, headers=headers, verify=False)
        r.raise_for_status()

        j = r.json()
        # this is a bit of a hack don't expect this to parse all your sparql queries
        value = dget(j, "results.bindings.0.label.value")

        # if the query failed just return the label and give up
        return value or label

    except Exception:
        logger.exception("sparql exception")
        raise


@router.post("/partial/info/d/{doc_id}/ms/upload")
def doc_info_upload(doc_id: str, file: Annotated[UploadFile, Form()], request: Request, response: Response):
    with db_session() as session:
        pdf = session.query(DbPdf).options(joinedload(DbPdf.doc_info)).filter_by(id=doc_id).one()

        doc = cache_open_pdf(pdf.id)
        j = json.load(file.file)

        for ms in j.get("MineralSite", []):
            for mi in ms.get("MineralInventory", []):
                commodity = lookup_resource_label(mi.get("commodity"))
                ore_unit = lookup_resource_label(dget(mi, "ore.ore_unit"))
                ore_value = dget(mi, "ore.ore_value")
                grade_unit = lookup_resource_label(dget(mi, "grade.grade_unit"))
                grade_value = dget(mi, "grade.grade_value")
                cutoff_grade_unit = lookup_resource_label(dget(mi, "cutoff_grade.grade_unit"))
                cutoff_grade_value = dget(mi, "cutoff_grade.grade_value")
                contained_metal = mi.get("contained_metal")
                zone = mi.get("zone")

                for p in dget(mi, "reference.page_info", []):
                    if page_num := p.get("page"):
                        page = doc[page_num]
                        r = page.rect

                        annotation = DbAnnotation(
                            annotation_type="txt", doc_id=doc_id, page=page_num, x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1
                        )

                        tags = [
                            DbAnnotationTag(label="commodity", value=commodity, comment="commondity"),
                            DbAnnotationTag(label=ore_unit, value=ore_value, comment="ore"),
                            DbAnnotationTag(label=grade_unit, value=grade_value, comment="grade"),
                            DbAnnotationTag(label=cutoff_grade_unit, value=cutoff_grade_value, comment="cutoff_grade"),
                            DbAnnotationTag(label="contained_metal", value=contained_metal, comment="contained_metal"),
                            DbAnnotationTag(label="zone", value=zone, comment="zone"),
                        ]
                        for t in tags:
                            annotation.tags.append(t)
                        session.add(annotation)
                        session.commit()

    headers = {"HX-Redirect": f"/a/{doc_id}"}
    return HTMLResponse(content="", status_code=status.HTTP_200_OK, headers=headers)
