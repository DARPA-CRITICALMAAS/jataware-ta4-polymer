import hashlib
import hmac
import logging
from logging import Logger
from typing import Any

from cdr_schemas.cdr_responses.prospectivity import ProspectModelMetaData
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from starlette.background import BackgroundTasks

from baseline_mpm.baseline import BaselineModel
from baseline_mpm.settings import app_settings

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)


file_logger = logging.getLogger("file_logger")
file_logger.setLevel(logging.INFO)

file_handler = logging.FileHandler("error_log.log")
file_handler.setLevel(logging.ERROR)
file_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
file_handler.setFormatter(file_formatter)

file_logger.addHandler(file_handler)

file_logger.error("Starting file logger.")

router = APIRouter()


auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


class Event(BaseModel):
    id: str
    event: str
    payload: Any | None


########################### helpers ###################


cdr_signiture = APIKeyHeader(name="x-cdr-signature-256")


async def verify_signature(request: Request, signature_header: str = Depends(cdr_signiture)):

    payload_body = await request.body()
    if not signature_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="x-hub-signature-256 header is missing!")

    hash_object = hmac.new(app_settings.secret_token.encode("utf-8"), msg=payload_body, digestmod=hashlib.sha256)
    expected_signature = hash_object.hexdigest()
    if not hmac.compare_digest(expected_signature, signature_header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Request signatures didn't match!")

    return True


async def event_handler(evt: Event):
    try:
        match evt:
            case Event(event="ping"):
                logger.info("Received PING!")
            case Event(event="prospectivity_model_run.process"):
                logger.info("Received model run event payload!")
                if evt.payload.get("model_type") == "jataware_rf":
                    BaselineModel.run_pipeline(
                        payload=ProspectModelMetaData(
                            model_run_id=evt.payload.get("model_run_id"),
                            cma=evt.payload.get("cma"),
                            model_type=evt.payload.get("model_type"),
                            train_config=evt.payload.get("train_config"),
                            evidence_layers=evt.payload.get("evidence_layers"),
                        ),
                        cdr_host=app_settings.cdr_endpoint_url,
                        cdr_token=app_settings.cdr_bearer_token,
                        file_logger=file_logger,
                    )
                else:
                    logger.info(f"nothing to do for model type {evt.payload.get('model_type')}")
            case _:
                logger.error("Nothing to do for event: %s", evt)

    except Exception:
        logger.exception("background processing event: %s", evt)
        raise


@router.post("/project")
async def hook(
    evt: Event,
    background_tasks: BackgroundTasks,
    request: Request,
    verified_signature: bool = Depends(verify_signature),
):
    # with open("/home/apps/baseline_mpm/payloads/test.json","r") as f:
    #     evt =json.loads(f.read())
    #     evt = Event.parse_obj(evt.get("event"))
    background_tasks.add_task(event_handler, evt)
    
    return {"ok": "success"}
