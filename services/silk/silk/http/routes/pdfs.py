import logging
from logging import Logger
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Form, Response, UploadFile

from ...common.s3_utils import read_s3_contents, s3_client, upload_s3_bytes
from ...db.db import db_session
from ...db.models import DbPdf
from ...settings import app_settings

logger: Logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/download/{name}",
    summary="",
    description="download pdf",
    response_class=Response,
)
def get_download(name: str):
    s3 = s3_client(app_settings.s3_endpoint_url)
    key = str(Path("/").joinpath(app_settings.s3_documents_prefix, name))
    logger.debug(key)
    content = read_s3_contents(s3, app_settings.s3_documents_bucket, key)
    headers = {"Content-Disposition": f"inline; filename='{name}'"}
    return Response(content, headers=headers, media_type="application/pdf")


@router.post(
    "/upload",
    summary="",
    description="upload pdf",
)
def create_upload_file(file: Annotated[UploadFile, Form()], response: Response):
    logger.debug("uploaded - %s", file.filename)
    s3 = s3_client(app_settings.s3_endpoint_url)
    uuid = uuid4().hex

    doc_cache = Path(app_settings.doc_cache)
    doc_cache.mkdir(parents=True, exist_ok=True)

    contents = file.file.read()
    # md5 = hashlib.md5(contents)
    # md5_hash = md5.hexdigest()
    # uuid = md5_hash

    key = str(Path("").joinpath(app_settings.s3_documents_prefix, uuid, f"{uuid}.pdf"))
    logger.debug(key)

    size = len(contents)
    with db_session() as session:
        record = DbPdf(
            id=uuid,
            s3_key=key,
            size=size,
            file_name=file.filename,
            source="upload",
        )
        # this can create dirty records between uploading to s3 and writing to the db
        session.add(record)
        # save local
        with Path(doc_cache).joinpath(f"{uuid}.pdf").open("wb") as f:
            f.write(contents)
        # save s3
        upload_s3_bytes(s3, app_settings.s3_documents_bucket, key, contents)
        session.commit()

    response.headers["HX-Redirect"] = f"/d/{uuid}/0"
    return {"id": uuid}
