# Python standard library
import logging
from logging import Logger

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

import json
from typing import Optional

import rasterio as rio
from auto_legend.modeling.anthropic_ocr import AnthropicOCR

# Third-party imports
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from rasterio.windows import Window

from jataware_auto_legend.settings import app_settings

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

router = APIRouter()

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}

# --
# Load model

print("!! AnthropicOCR: loading...")
ocr = AnthropicOCR(
    model_path=app_settings.detr_model_path,
    device=app_settings.device,
    api_key=app_settings.anthropic_api_key,
)
print("!! AnthropicOCR: ready!")

# --
# Dataclasses


class AutoLegendRequest(BaseModel):
    cog_id: str
    bboxes: list
    no_description: bool = False


class AutoLegendRecord(BaseModel):
    id: str
    name: str
    parent: Optional[str] = None
    age: Optional[str] = None
    symbol: Optional[str] = None
    symbol_id: Optional[int] = None
    bbox: Optional[list[int]] = None


class AutoLegendResult(BaseModel):
    legend_items: list[AutoLegendRecord]


# --
# Standard endpoint


def _auto_legend(req: AutoLegendRequest):
    # !! TODO: async vs threadpool?  ocr.run has both a CPU-bound thing + an IO-bound thing
    cog_id = req.cog_id

    assert len(req.bboxes) == 1, "_auto_legend: Only one bounding box is supported at this time"
    bbox = req.bboxes[0]

    s3_url = f"{app_settings.s3_endpoint_url.rstrip('/')}/cogs/{cog_id}.cog.tif"
    with rio.open(s3_url) as src:
        left = bbox[0]
        top = src.height - bbox[3]
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]

        window = Window(left, top, width, height)
        data = src.read(window=window)

    img = Image.fromarray(data.transpose(1, 2, 0)).convert("RGB")
    # <<
    # DEBUG
    print(f"!! Legend image: {cog_id} bbox {bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}")
    img.save(f"legend_image_{cog_id}_bbox_{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}.png")
    # >>

    legend_items = ocr.run(img, no_description=req.no_description)
    return AutoLegendResult(legend_items=legend_items)


@router.post("/auto_legend")
async def auto_legend(req: AutoLegendRequest):
    extraction_data = await run_in_threadpool(_auto_legend, req)
    return extraction_data


# --
# Streaming


async def _auto_legend_stream(req: AutoLegendRequest):
    try:
        # !! TODO: async vs threadpool?  ocr.run has both a CPU-bound thing + an IO-bound thing
        cog_id = req.cog_id

        assert len(req.bboxes) == 1, "_auto_legend: Only one bounding box is supported at this time"
        bbox = req.bboxes[0]

        yield json.dumps({"__progress": 0, "__status": "OK"}) + "\n"

        s3_url = f"{app_settings.s3_endpoint_url.rstrip('/')}/cogs/{cog_id}.cog.tif"
        with rio.open(s3_url) as src:
            left = bbox[0]
            top = src.height - bbox[3]
            width = bbox[2] - bbox[0]
            height = bbox[3] - bbox[1]

            window = Window(left, top, width, height)
            data = src.read(window=window)

        img = Image.fromarray(data.transpose(1, 2, 0)).convert("RGB")
        async for legend_item in ocr.run_streaming(img, no_description=req.no_description):
            print("legend_item", legend_item)
            yield json.dumps(legend_item) + "\n"

    except Exception as e:
        yield json.dumps({"__progress": 100, "__status": "ERROR", "__error": str(e)}) + "\n"


@router.post("/auto_legend/stream")
async def auto_legend_stream(req: AutoLegendRequest):
    return StreamingResponse(_auto_legend_stream(req), media_type="application/x-ndjson")


# --
# Debug


@router.post("/debug")
async def debug(req: AutoLegendRequest):
    return {
        "legend_items": [
            {
                "id": "surficial_deposits",
                "parent": None,
                "name": "SURFICIAL DEPOSITS X",
                "age": None,
                "symbol": None,
                "symbol_id": None,
            },
            {
                "id": "alluvial_deposits",
                "parent": "surficial_deposits",
                "name": "ALLUVIAL DEPOSITS",
                "age": None,
                "symbol": None,
                "symbol_id": None,
            },
            {
                "id": "alluvium_streams",
                "parent": "alluvial_deposits",
                "name": "Alluvium in streams",
                "age": "Holocene and Pleistocene",
                "symbol": "Qa",
                "symbol_id": 0,
                "bbox": [67, 178, 221, 245],
            },
            {
                "id": "alluvium_fans",
                "parent": "alluvial_deposits",
                "name": "Alluvium in fans",
                "age": "Holocene and Pleistocene",
                "symbol": "Qaf",
                "symbol_id": 1,
                "bbox": [65, 265, 221, 333],
            },
            {
                "id": "older_alluvium",
                "parent": "alluvial_deposits",
                "name": "Older alluvium",
                "age": "Pleistocene",
                "symbol": "Qoa",
                "symbol_id": 2,
                "bbox": [65, 353, 221, 421],
            },
            {
                "id": "colluvial_deposits",
                "parent": "surficial_deposits",
                "name": "COLLUVIAL DEPOSITS",
                "age": None,
                "symbol": None,
                "symbol_id": None,
            },
            {
                "id": "colluvium_undivided",
                "parent": "colluvial_deposits",
                "name": "Colluvium, undivided",
                "age": "Holocene and Pleistocene",
                "symbol": "Qc",
                "symbol_id": 3,
                "bbox": [65, 514, 219, 582],
            },
        ]
    }
