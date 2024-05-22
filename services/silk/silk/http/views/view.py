import asyncio
import logging
import uuid
from logging import Logger
from pathlib import Path
from uuid import uuid4

import aiofiles
import httpx
from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from pyzotero import zotero

from ...common.s3_utils import aws_s3_client, s3_client, s3_presigned_url, upload_s3_file
from ...common.utils import dget
from ...db.db import db_session
from ...db.models import DbPdf
from ...settings import app_settings
from ...templates import templates

logger: Logger = logging.getLogger(__name__)

router = APIRouter()

presigned_url_cache = TTLCache(maxsize=10, ttl=60)
# pubs_link_cache = TTLCache(maxsize=10, ttl=360)


@router.get("/index/search")
def index_search_tmpl(which: str, request: Request, search_by: str = "title"):
    return templates.TemplateResponse(
        "index/search.html",
        {
            "request": request,
            "search_by": search_by,
        },
    )


@router.get("/")
def index(request: Request):
    return RedirectResponse("/cdr/")

    # logger.debug(templates.get_template("index/index.html"))
    # return templates.TemplateResponse(
    #     "index/index.html",
    #     {
    #         "request": request,
    #     },
    # )


@router.get("/download/pubs/progress")
def pubs_download_progress(url: str, request: Request):
    return templates.TemplateResponse(
        "index/downloading.html",
        {"request": request, "connect": f"/partials/pubs/download/progress?url={url}"},
    )


@router.get("/download/xdd/progress")
def xdd_download_progress(doc_id: str, request: Request):
    return templates.TemplateResponse(
        "index/downloading.html",
        {"request": request, "connect": f"/partials/xdd/download/progress?doc_id={doc_id}"},
    )


@router.get("/download/zot/progress")
def zot_download_progress(key: str, request: Request):
    return templates.TemplateResponse(
        "index/downloading.html",
        {
            "request": request,
            "connect": f"/partials/zot/download/progress?key={key}",
        },
    )


async def _download_events(url):
    c = 0
    uuid = uuid4().hex
    async with httpx.AsyncClient(follow_redirects=True) as http:
        logger.debug("downloading: %s", url)

        try:
            # HACK
            headers = {"X-Api-Key": app_settings.xdd_api_key}

            async with http.stream("GET", url, headers=headers, timeout=None) as resp:
                resp.raise_for_status()
                l = int(resp.headers.get("Content-Length", -1))
                doc_cache = Path(app_settings.doc_cache)
                doc_cache.mkdir(parents=True, exist_ok=True)
                output_file = str(Path(doc_cache).joinpath(f"{uuid}.pdf"))

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
                        await asyncio.sleep(0)

                # TODO s3 upload
                key = str(Path("").joinpath(app_settings.s3_documents_prefix, uuid, f"{uuid}.pdf"))
                msg = """<progress class="progress progress-accent w-56"></progress>"""
                yield f"event: progress\ndata: {msg}\n\n"
                s3 = s3_client(app_settings.s3_endpoint_url)
                await run_in_threadpool(lambda: upload_s3_file(s3, app_settings.s3_documents_bucket, key, output_file))
                with db_session() as session:
                    record = DbPdf(id=uuid, s3_key=key, size=c, file_name=f"{uuid}.pdf")
                    session.add(record)
                    session.commit()

                msg = f"""<script>window.location.href='/d/{uuid}/0';</script>"""
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


@router.get("/partials/xdd/download/progress")
async def sse_xdd_download_progress(doc_id: str, request: Request) -> StreamingResponse:
    url = f"https://xdddev.chtc.io/documentstore-api/documents/{doc_id}/content"

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(_download_events(url), headers=headers)


@router.get("/partials/pubs/download/progress")
async def sse_pubs_download_progress(url: str, request: Request) -> StreamingResponse:
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(_download_events(url), headers=headers)


@router.get("/partials/zot/download/progress")
async def sse_zot_download_progress(key: str, request: Request) -> StreamingResponse:
    url = presigned_url_cache.get(key)
    logger.debug("cached url: %s", url)
    if not url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="key not found or expired")

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return StreamingResponse(_download_events(url), headers=headers)


async def _stream_results(url: str):
    c = 0
    async with httpx.AsyncClient(follow_redirects=True) as http:
        async with http.stream("GET", url, timeout=None) as resp:
            int(resp.headers["Content-Length"])
            async for chunk in resp.aiter_bytes():
                yield chunk
                c += len(chunk)
                await asyncio.sleep(0)


@router.get(
    "/partials/xdd/download",
    # status_code=status.HTTP_204_NO_CONTENT,
    response_class=StreamingResponse,
)
async def xdd_download(doc_id: str, request: Request, response: HTMLResponse):
    url = f"https://xdddev.chtc.io/documentstore-api/documents/{doc_id}/content"
    headers = {"Content-Disposition": f"inline; filename={doc_id}.pdf"}

    return StreamingResponse(_stream_results(url), headers=headers, media_type="application/pdf")


@router.get(
    "/partials/xdd/id",
    # status_code=status.HTTP_204_NO_CONTENT,
    response_class=HTMLResponse,
)
async def xdd_id(xdd: str, request: Request, response: HTMLResponse):
    url = f"https://xdddev.chtc.io/documentstore-api/query?xdd_id={xdd}"
    async with httpx.AsyncClient(follow_redirects=True) as http:
        resp = await http.get(url, timeout=None)
        j = resp.json()
        ds_id = j.get("id")
        logger.debug(f"{xdd=}, {ds_id=}")
        if ds_id:
            # response.headers["HX-Redirect"] = f"https://xdddev.chtc.io/documentstore-api/documents/{ds_id}"
            # response.headers["HX-Redirect"] = f"/partials/xdd/download?doc_id={ds_id}"
            response.headers["HX-Redirect"] = f"/download/xdd/progress?doc_id={ds_id}"
            return

    return HTMLResponse(
        content="""
    <div class="notfound tooltip tooltip-left tooltip-error text-red-500" data-tip="Not Found">

          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
</div>
    """  # noqa: E501
    )


@router.get(
    "/partials/zot/attachment",
    response_class=HTMLResponse,
)
def zot_id(key: str, request: Request, response: HTMLResponse):
    try:
        zot = zotero.Zotero(app_settings.zotero_library_id, app_settings.zotero_library_type)
        item = zot.item(key)

        parent = dget(item, "data.parentItem", "")
        filename = dget(item, "data.filename", "")
        s3_key = f"documents/zotero/{parent}/{key}/{filename}"
        logger.debug("creating presigned url for key: %s", s3_key)
        s3 = aws_s3_client(profile=app_settings.s3_aws_profile)
        url = s3_presigned_url(s3, app_settings.s3_documents_bucket, s3_key)
        cache_id = uuid.uuid4().hex
        logger.debug("creating presigned uuid: %s, url: %s, key: %s", cache_id, url, s3_key)
        presigned_url_cache[cache_id] = url
        if url:
            response.headers["HX-Redirect"] = f"/download/zot/progress?key={cache_id}"
            return
    except Exception:
        logger.exception("zot item failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="") from None

    return HTMLResponse(
        content="""
    <div class="notfound tooltip tooltip-left tooltip-error text-red-500" data-tip="Not Found">

          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
</div>
    """  # noqa: E501
    )


@router.get(
    "/partials/zot/docs/attachments",
    response_class=HTMLResponse,
)
def zot_docs_id(key: str, request: Request, response: HTMLResponse):
    zot = zotero.Zotero(app_settings.zotero_library_id, app_settings.zotero_library_type)
    attachments = zot.children(key)

    attachments = [
        attach for attach in attachments if dget(attach, "data.contentType", "").lower() == "application/pdf"
    ]

    return templates.TemplateResponse(
        "index/zot_attachments.html",
        {
            "request": request,
            "attachments": attachments,
        },
    )


# @router.get("/partials/pubs/search")
async def pubs_search(search: str, search_by: str, request: Request):
    match search_by:
        case "term":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=100&page_number=1&q={search}"
        case "title":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=100&page_number=1&q=&title={search}"
        case "doi":
            url = f"https://pubs.usgs.gov/pubs-services/publication/?page_size=100&page_number=1&q=&doi={search}"
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
        "index/pubs_search_results.html",
        {
            "request": request,
            "docs": docs,
        },
    )


# @router.get("/partials/xdd/search")
async def xdd_search(search: str, search_by: str, request: Request):
    match search_by:
        case "term":
            url = f"https://xdd.wisc.edu/api/articles?term={search}&max=100&set=criticalmaas"
        case "title":
            url = f"https://xdd.wisc.edu/api/articles?title_like={search}&max=100&set=criticalmaas"
        case "doi":
            url = f"https://xdd.wisc.edu/api/articles?doi={search}&max=100&set=criticalmaas"
        case _:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid search field: {search_by}")

    docs = []
    if search:
        async with httpx.AsyncClient(follow_redirects=True) as http:
            resp = await http.get(url, timeout=None)
            j = resp.json()
            docs = dget(j, "success.data", [])
            await asyncio.sleep(0)

    return templates.TemplateResponse(
        "index/xdd_search_results.html",
        {
            "request": request,
            "docs": docs,
        },
    )


# @router.get("/partials/xdd/search")
async def zot_search(search: str, request: Request):
    docs = []
    if search:
        zot = zotero.Zotero(app_settings.zotero_library_id, app_settings.zotero_library_type)
        docs = zot.top(q=search, limit=100)
    return templates.TemplateResponse(
        "index/zot_search_results.html",
        {
            "request": request,
            "docs": docs,
        },
    )


@router.get("/partials/search")
async def index_search(search: str, which: str, search_by: str, request: Request):
    if (not search) or len(search) < 2:
        return HTMLResponse(status_code=status.HTTP_200_OK, content="")
    match (which, search_by):
        case ("pubs", "title" | "doi" | "term"):
            return await pubs_search(search, search_by, request)
        case ("xdd", "title" | "doi" | "term"):
            return await xdd_search(search, search_by, request)
        case ("zot", _):
            return await zot_search(search, request)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid search request")


@router.get("/upload")
def index_upload(request: Request):
    logger.debug(templates.get_template("upload/index.html"))
    return templates.TemplateResponse("upload/index.html", {"request": request, "content": ""})
