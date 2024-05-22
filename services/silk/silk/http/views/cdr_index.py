import asyncio
import io
import logging
from logging import Logger
from pathlib import Path
from typing import Annotated, List
from urllib.parse import urlparse
from uuid import uuid4

import aiofiles
import fitz
import httpx
from cachetools import TTLCache
from cdr_schemas.document import DocumentMetaData, DocumentProvenance, UploadDocument
from fastapi import APIRouter, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from sqlalchemy import desc

from ...common.utils import dget
from ...db.db import db_session
from ...db.models import DbJobTracker
from ...pdf.utils import cache_open_pdf
from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)

router = APIRouter()

pubs_search = TTLCache(maxsize=300, ttl=60)
pubs_uploads = TTLCache(maxsize=100, ttl=300)


@router.get("/cdr/")
def index(request: Request):
    logger.debug(templates.get_template("cdr/index.html"))
    return templates.TemplateResponse(
        "cdr/index.html",
        {
            "request": request,
        },
    )


@router.get("/cdr/search")
def search(request: Request):
    logger.debug(templates.get_template("cdr/search.html"))
    return templates.TemplateResponse(
        "cdr/search.html",
        {
            "request": request,
        },
    )


@router.get("/cdr/download/{doc_id}")
async def download(doc_id: str, request: Request):
    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(follow_redirects=False) as http:
        resp = await http.get(f"https://api.cdr.land/v1/docs/document/{doc_id}", headers=headers)
        await asyncio.sleep(0)

        location = resp.headers.get("location")
        logger.debug(location)
    return RedirectResponse(location)


async def search_cdr(search: str, search_by: str, request: Request):
    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}

    docs = []
    url = "https://api.cdr.land/v1/docs/documents/q/title"
    if search and len(search) > 2:
        pattern = search.strip()
        params = {
            "size": 40,
        }

        match search_by:
            case "title":
                params["pattern"] = f"*{pattern}*"
                url = "https://api.cdr.land/v1/docs/documents/q/title"
            case "doi":
                params["pattern"] = f"*{pattern}*"
                url = "https://api.cdr.land/v1/docs/documents/q/doi"
            case "prov":
                params["pattern"] = f"{pattern}"
                params["prefix_match"] = True
                url = "https://api.cdr.land/v1/docs/documents/q/provenance"
            case "url":
                params["pattern"] = f"{pattern}"
                url = "https://api.cdr.land/v1/docs/documents/q/provenance/url"

        async with httpx.AsyncClient(follow_redirects=True) as http:
            resp = await http.post(url, headers=headers, params=params, timeout=None)
            docs = resp.json()
            await asyncio.sleep(0)

    return templates.TemplateResponse(
        "cdr/cdr_search_results.html",
        {
            "request": request,
            "docs": docs,
        },
    )


async def match_doi(doi):
    if doi in pubs_search:
        logger.debug("cache hit: %s", doi)
        return pubs_search.get(doi, "")

    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}

    params = {"pattern": f"*{doi}*"}
    url = "https://api.cdr.land/v1/docs/documents/q/doi"

    async with httpx.AsyncClient(follow_redirects=True) as http:
        resp = await http.post(url, headers=headers, params=params, timeout=None)
        docs = resp.json()
        await asyncio.sleep(0)

        if len(docs) == 1:
            pubs_search[doi] = dget(docs, "0.id", "")
        else:
            pubs_search[doi] = ""

        if len(docs) > 1:
            logger.warning("Multiple CDR items for doi: %s - %d", doi, len(docs))

        return pubs_search.get(doi, "")


@router.get("/partials/cdr/match")
async def pubs_match(doi: str, request: Request, indexid: str = ""):
    if cdr_id := await match_doi(doi):
        return HTMLResponse(content=f"""<a href="/cdr/d/{cdr_id}/0" class="link link-primary text-sm">view</a>""")

    return HTMLResponse(
        content=f"""<a class="btn btn-xs btn-primary" href="/cdr/upload/pubs?indexid={indexid}">push to cdr</a>"""
    )


async def search_pubs(search: str, search_by: str, request: Request):
    match search_by:
        case "term":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=40&page_number=1&q={search}"
        case "title":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=40&page_number=1&q=&title={search}"
        case "doi":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=40&page_number=1&q=&doi={search}"
        case _:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid search field: {search_by}")

    docs = []
    if search:
        async with httpx.AsyncClient(follow_redirects=True) as http:
            resp = await http.get(url, timeout=None)
            j = resp.json()
            docs = dget(j, "records", [])
            await asyncio.sleep(0)

    return templates.TemplateResponse(
        "cdr/pubs_search_results.html",
        {
            "request": request,
            "docs": docs,
        },
    )


@router.get("/partials/cdr/search")
async def partial_search(search: str, which: str, search_by: str, request: Request):
    match which:
        case "cdr":
            return await search_cdr(search, search_by, request)
        case "pubs":
            return await search_pubs(search, search_by, request)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid source: {which}")


async def _download_events(doc_id, redirect_page: int = 0):
    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}
    url = f"https://api.cdr.land/v1/docs/document/{doc_id}"
    c = 0
    async with httpx.AsyncClient(follow_redirects=True) as http:
        logger.debug("downloading: %s", url)

        try:
            async with http.stream("GET", url, headers=headers, timeout=None, follow_redirects=True) as resp:
                resp.raise_for_status()
                l = int(resp.headers.get("Content-Length", -1))
                doc_cache = Path(app_settings.doc_cache)
                doc_cache.mkdir(parents=True, exist_ok=True)
                output_file = str(Path(doc_cache).joinpath(f"{doc_id}.pdf"))

                async with aiofiles.open(output_file, mode="wb") as f:
                    async for chunk in resp.aiter_bytes():
                        await f.write(chunk)
                        c += len(chunk)
                        if l > 0:
                            msg = f"""
                            <progress class="progress progress-primary w-56" value="{c}" max="{l}"></progress>
                            """  # noqa: E501
                        else:
                            msg = """<progress class="progress progress-warning w-56"></progress>"""

                        logger.debug("========== %d / %d", c, l)
                        msg = msg.replace("\n", " ")
                        yield f"event: progress\ndata: {msg}\n\n"
                        yield f"event: bytes\ndata: {c}\n\n"
                        await asyncio.sleep(0.01)

                msg = """<progress class="progress progress-accent w-56"></progress>"""
                yield f"event: progress\ndata: {msg}\n\n"

                msg = f"""<script>window.location.href='/cdr/d/{doc_id}/{redirect_page}';</script>"""
                yield f"event: redirect\ndata: {msg}\n\n"
                yield "event: fin\ndata: redirecting ... \n\n"

        except httpx.HTTPStatusError as he:
            logger.exception(he)
            yield (
                "event: fin\ndata: download failed... <br/>"
                f"Received response status code <{he.response.status_code}> on download"
                "\n\n"
            )

        except Exception as e:
            logger.exception(e)
            yield "event: fin\ndata: download failed...\n\n"


@router.get("/partials/cdr/download/progress")
async def sse_cdr_download_progress(doc_id: str, request: Request, page: int = 0) -> StreamingResponse:
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(_download_events(doc_id, page), headers=headers)


@router.get("/cdr/download/progress/{doc_id}")
def cdr_download_progress(doc_id: str, request: Request, page: int = 0):
    try:
        _doc = cache_open_pdf(doc_id)
        logger.debug("cache hit skipping download: %s", doc_id)
        return RedirectResponse(f"/cdr/d/{doc_id}/{page}")
    except fitz.FileNotFoundError:
        pass

    return templates.TemplateResponse(
        "cdr/downloading.html",
        {"request": request, "connect": f"/partials/cdr/download/progress?doc_id={doc_id}&page={page}"},
    )


@router.get("/cdr/upload/")
def index_upload(request: Request):
    logger.debug(templates.get_template("cdr/upload.html"))
    return templates.TemplateResponse("cdr/upload.html", {"request": request, "content": ""})


@router.get("/cdr/upload/pubs")
async def index_upload_pubs(request: Request, indexid: str = ""):
    url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=5&page_number=1&q=&indexId={indexid}"
    async with httpx.AsyncClient(follow_redirects=True) as http:
        resp = await http.get(url, timeout=None)
        j = resp.json()
        docs = dget(j, "records", [])
        await asyncio.sleep(0)

        if len(docs) == 1:
            doc = docs[0]
            logger.debug(templates.get_template("cdr/pubs_upload.html"))
            return templates.TemplateResponse("cdr/pubs_upload.html", {"request": request, "content": "", "doc": doc})

    # shit


async def _pubs_download_events(cache_key):
    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}
    cdr_url = "https://api.cdr.land/v1/docs/document"
    upload_payload = pubs_uploads[cache_key]
    doc = upload_payload["doc"]
    data = {"document": doc.model_dump_json(exclude_none=True)}
    url = upload_payload.get("url")
    filename = Path(urlparse(url).path).name
    yield f"event: filename\ndata: {filename}\n\n"
    c = 0
    async with httpx.AsyncClient(follow_redirects=True) as http:
        logger.debug("pubs downloading: %s", url)

        try:
            async with http.stream("GET", url, headers=headers, timeout=None, follow_redirects=True) as resp:
                resp.raise_for_status()
                l = int(resp.headers.get("Content-Length", -1))
                buff = io.BytesIO()
                async for chunk in resp.aiter_bytes():
                    buff.write(chunk)
                    c += len(chunk)
                    if l > 0:
                        msg = f"""<progress class="progress progress-primary w-56" value="{c}" max="{l}"></progress>"""  # noqa: E501
                    else:
                        msg = """<progress class="progress progress-warning w-56"></progress>"""

                    logger.debug("========== %d / %d", c, l)
                    msg = msg.replace("\n", " ")
                    yield f"event: progress\ndata: {msg}\n\n"
                    if l > 0:
                        yield f"event: bytes\ndata: {c} / {l}\n\n"
                    else:
                        yield f"event: bytes\ndata: {c}\n\n"
                    await asyncio.sleep(0.01)

                msg = """<progress class="progress progress-accent w-56"></progress>"""
                yield f"event: progress\ndata: {msg}\n\n"
                yield "event: status\ndata: downloaded\n\n"
                yield "event: status\ndata: sending to cdr\n\n"
                files = {"pdf": (filename, buff.getvalue())}

                res = httpx.post(cdr_url, headers=headers, data=data, files=files, timeout=None)
                res.raise_for_status()
                j = res.json()
                job_id = j.get("job_id")
                logger.debug("job id %s", job_id)

                with db_session() as session:
                    record = DbJobTracker(job_id=job_id, file_name=filename, title=doc.title)
                    session.add(record)
                    session.commit()

                yield f"event: status\ndata: submitted {job_id}\n\n"
                msg = """<script>window.location.href="/cdr/jobs/";</script>"""
                yield f"event: redirect\ndata: {msg}\n\n"
                yield "event: fin\ndata: redirecting ... \n\n"

        except httpx.HTTPStatusError as he:
            logger.exception(he)
            yield (
                "event: fin\ndata: download failed... <br/>"
                f"Received response status code <{he.response.status_code}> on download"
                "\n\n"
            )

        except Exception as e:
            logger.exception(e)
            yield "event: fin\ndata: download failed...\n\n"


@router.get("/partials/cdr/download/pubs/progress/{cache_key}")
async def sse_cdr_download_pubs_progress(cache_key: str, request: Request) -> StreamingResponse:
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(_pubs_download_events(cache_key), headers=headers)


@router.post(
    "/cdr/upload/pubs",
    summary="",
    description="upload pdf",
)
def pubs_create_upload_file(
    request: Request,
    url: Annotated[str, Form()],
    title: Annotated[str, Form()],
    src_name: Annotated[str, Form()],
    src_id: Annotated[str, Form()] = "",
    src_url: Annotated[str, Form()] = "",
    doi: Annotated[str, Form()] = "",
    is_open: Annotated[bool, Form()] = False,
    year: Annotated[str, Form()] = "",
    authors: List[str] = Form(..., default_factory=list),
):
    meta = {
        "doi": doi,
        "authors": authors,
    }

    if year:
        try:
            meta["year"] = int(year)
        except Exception:
            pass

    upload_doc = UploadDocument(
        system=app_settings.cdr_system_name,
        system_version=app_settings.cdr_system_version,
        title=title,
        is_open=is_open,
        metadata=DocumentMetaData(**meta),
        provenance=[
            DocumentProvenance(
                external_system_name=src_name,
                external_system_id=src_id,
                external_system_url=src_url,
            ),
        ],
    )

    key = uuid4().hex
    pubs_uploads[key] = {"doc": upload_doc, "url": url}
    connect_url = f"/partials/cdr/download/pubs/progress/{key}"
    logger.debug(templates.get_template("cdr/pubs_downloading.html"))

    ## download from url
    return templates.TemplateResponse("cdr/pubs_downloading.html", {"request": request, "connect": connect_url})


@router.post(
    "/cdr/upload",
    summary="",
    description="upload pdf",
    response_class=HTMLResponse,
)
def create_upload_file(
    file: Annotated[UploadFile, Form()],
    title: Annotated[str, Form()],
    src_name: Annotated[str, Form()],
    src_id: Annotated[str, Form()] = "",
    src_url: Annotated[str, Form()] = "",
    doi: Annotated[str, Form()] = "",
    is_open: Annotated[bool, Form()] = False,
):
    logger.debug("uploaded - %s", file.filename)
    contents = file.file.read()

    meta = {"doi": doi}

    upload_doc = UploadDocument(
        system=app_settings.cdr_system_name,
        system_version=app_settings.cdr_system_version,
        title=title,
        is_open=is_open,
        metadata=DocumentMetaData(**meta),
        provenance=[
            DocumentProvenance(
                external_system_name=src_name,
                external_system_id=src_id,
                external_system_url=src_url,
            ),
        ],
    )

    # https://api.cdr.land/v1/jobs/result/d2b458a66fa6477292eaab5a42d9c1b0
    # url = f"https://api.cdr.land/v1/docs/document/{doc_id}"

    logger.debug(upload_doc)

    in_memory_file = io.BytesIO(contents)

    data = {"document": upload_doc.model_dump_json(exclude_none=True)}
    files = {"pdf": (file.filename, in_memory_file.getvalue())}

    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}

    res = httpx.post("https://api.cdr.land/v1/docs/document", headers=headers, data=data, files=files, timeout=None)
    res.raise_for_status()
    j = res.json()
    job_id = j.get("job_id")
    logger.debug("job id %s", job_id)

    with db_session() as session:
        record = DbJobTracker(job_id=job_id, file_name=file.filename, title=title)
        session.add(record)
        session.commit()

    return ResponeRedirect("/cdr/jobs/")


@router.get("/cdr/jobs/")
def jobs_index(request: Request):
    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}
    url = "https://api.cdr.land/v1/jobs/q/size"
    res = httpx.get(url, headers=headers, timeout=None)
    res.raise_for_status()
    qsize = res.json().get("size", -1)
    logger.debug(templates.get_template("jobs/index.html"))

    with db_session() as session:
        jobs = session.query(DbJobTracker).order_by(desc(DbJobTracker.created_date)).limit(50).all()

        return templates.TemplateResponse(
            "jobs/index.html", {"request": request, "content": "", "jobs": jobs, "qsize": qsize}
        )


@router.get("/cdr/jobs/{job_id}")
def job_index(job_id: str, request: Request):
    logger.debug(templates.get_template("jobs/job.html"))

    with db_session() as session:
        if job := session.query(DbJobTracker).filter_by(job_id=job_id).first():
            return templates.TemplateResponse("jobs/job.html", {"request": request, "content": "", "job": job})

    logger.debug(templates.get_template("shared/notfound.html"))
    return templates.TemplateResponse(
        "shared/notfound.html", {"request": request, "content": f"job not found {job_id}"}
    )


@router.get("/partials/cdr/job/result/{job_id}")
def jobs_info(job_id: str, request: Request, response: Response):
    # logger.debug(templates.get_template("jobs/jobinfo.html"))

    token = app_settings.cdr_api_key
    headers = {"Authorization": f"Bearer {token}"}

    url = f"https://api.cdr.land/v1/jobs/result/{job_id}"
    res = httpx.get(url, headers=headers, timeout=None)
    res.raise_for_status()
    j = res.json()
    job_state = j.get("state")
    result_type = ""

    if job_state == "success":
        result = j.get("result")
        if d := result.get("duplicate"):
            result_type = "duplicate"
            doc = d
        if d := result.get("created"):
            result_type = "created"
            doc = d

    cdr_id = doc.get("id", "")

    logger.debug("j: %s, c: %s, r: %s", job_id, cdr_id, result_type)

    with db_session() as session:
        if job := session.query(DbJobTracker).filter_by(job_id=job_id).first():
            job.result = result_type
            job.cdr_id = cdr_id
            session.commit()

            return templates.TemplateResponse("jobs/job.html", {"request": request, "content": "", "job": job})


@router.put("/cdr/process/send/{doc_id}")
async def process_doc_cdr(doc_id: str, request: Request):
    url = f"https://admin.cdr.land/admin/events/fire/doc/{doc_id}"
    async with httpx.AsyncClient(timeout=None) as client:
        logger.debug("login")
        await client.post(
            "https://auth.cdr.land/api/firstfactor",
            json={"username": app_settings.cdr_admin_authelia_user, "password": app_settings.cdr_admin_authelia_pass},
        )

        resp = await client.post(url)
        resp.raise_for_status()
        j = resp.json()
        event_id = j.get("event_id", "")
        logger.debug("doc event id: %s", event_id)
    submitted = """<div class="text-sm text-success">Document Submitted</div>"""
    return HTMLResponse(content=submitted)
