import logging
from logging import Logger
from typing import Literal, TypeAlias

import cv2
import numpy as np
from cdr_schemas.features.polygon_features import Polygon
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, PositiveInt, field_validator
from rasterio.features import rasterize
from rasterio.features import shapes as rio_shapes
from starlette.status import HTTP_204_NO_CONTENT

from segment_api.common.embed_lock import check_and_set_key, remove_key
from segment_api.common.segment_utils import LassoTool, SegmentFloodFill, ToolCache, quick_cog, rgb_to_hsl
from segment_api.common.tiff_cache import get_cached_tiff
from segment_api.settings import app_settings

logger: Logger = logging.getLogger(__name__)
router = APIRouter()

# If python3.12, use type statements instead
PixelCoordinate: TypeAlias = tuple[float, float]
Color: TypeAlias = tuple[float, float, float]


class MultiPolygon(BaseModel):
    """
    GeoJSON MultiPolygon
    """

    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[list[float | int]]]]


class LineString(BaseModel):
    """
    GeoJSON LineString
    """

    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class LabelPoint(BaseModel):
    """
    Custom SAM label point
    """

    type: str
    coordinate: PixelCoordinate

    @field_validator("type")
    def validate_type(cls, value):
        if value not in ["positive", "negative"]:
            raise ValueError("Value must be either 'positive' or 'negative'")
        return value


@router.get("/segment_in_cache")
def check_segment_in_cache(cog_id):
    return ToolCache(cog_id).segment is not None


@router.get("/lasso_in_cache")
def check_lasso_in_cache(cog_id):
    return ToolCache(cog_id).lasso is not None


@router.post("/embeddings_to_s3")
def create_send_embeds(background_tasks: BackgroundTasks, cog_id: str, overwrite: bool = False):
    """
    Create embeddings and send to S3
    """

    def save_embeds(segment: SegmentFloodFill):
        segment.upload_embeds(overwrite)
        ToolCache(cog_id).segment = segment
        remove_key()

    if not check_and_set_key():
        message = "Sorry processing another map. Try again later."
        logger.exception(message)
        raise HTTPException(503, message)
    try:
        get_cached_tiff(cog_id)
        logger.info(f"Loaded tiff in cache")
        segment = SegmentFloodFill(cog_id)

        # Save embeddings in the background
        background_tasks.add_task(save_embeds, segment)

        # Estimate time to completion
        millis_per_embed = app_settings.time_per_embedding
        time = len(segment.tiles) * millis_per_embed / 1000 / 60
        return {"time": time}
    except SegmentFloodFill.ModelWeightsNotFoundError:
        message = "Failed to load model weights"
        logger.exception(message)
        raise HTTPException(500, message)


@router.post("/load_segment", status_code=HTTP_204_NO_CONTENT)
def load_segment(cog_id: str):
    """
    Load the segment for the specified `cog_id`
    """
    try:
        get_cached_tiff(cog_id)
        logger.info(f"Loaded tiff in cache")
        segment = SegmentFloodFill(cog_id)
        segment.load_embeds()
        ToolCache(cog_id).segment = segment
    except SegmentFloodFill.EmbeddingsNotFoundError:
        message = f"Failed to load embeddings for {cog_id}"
        logger.exception(message)
        raise HTTPException(400, message)
    except SegmentFloodFill.ModelWeightsNotFoundError:
        message = "Failed to load model weights"
        logger.exception(message)
        raise HTTPException(500, message)


@router.post("/load_lasso", status_code=HTTP_204_NO_CONTENT)
def load_lasso(cog_id: str):
    """
    Load the lasso tool for the specified `cog_id`
    """
    get_cached_tiff(cog_id)
    logger.info(f"Loaded tiff in cache")
    ToolCache(cog_id).lasso = LassoTool(cog_id)


class SegmentRequest(BaseModel):
    cog_id: str
    points: list[LabelPoint]


class SegmentResponse(BaseModel):
    geometry: MultiPolygon


@router.post("/labels")
def segment(req: SegmentRequest) -> SegmentResponse:
    """
    Segments the contiguous region based on the provided points and labels
    """

    segment = ToolCache(req.cog_id).segment
    if segment is None:
        raise HTTPException(400, "Segment not loaded in cache")

    points, labels = [], []
    for p in req.points:
        col_left, row_bottom = p.coordinate
        points.append([segment.nrow - row_bottom, col_left])
        labels.append({"positive": 1, "negative": 0}[p.type])

    # Filter out points outside image extent bounds
    filtered_points = []
    filtered_labs = []
    for point, lab in zip(points, labels):
        row, col = point
        if 0 <= row < segment.nrow and 0 <= col < segment.ncol:
            filtered_points.append(point)
            filtered_labs.append(lab)

    points = filtered_points
    labels = filtered_labs

    if len(labels) != len(points):
        raise HTTPException(500, "Points could not be filtered")

    if sum(labels) == 0:
        raise HTTPException(400, "Must include at least one valid positive label")

    _, mask_out = segment.flood_fill(points, labels)

    k = np.ones((2, 2), np.uint8)
    mask_out = cv2.morphologyEx(mask_out, cv2.MORPH_OPEN, k, iterations=3)

    contours, _ = cv2.findContours(mask_out.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        if cv2.contourArea(cnt) < 50:  # Adjust the area threshold as needed
            cv2.drawContours(mask_out, [cnt], -1, 0, -1)
    shapes = rio_shapes(mask_out.astype(np.int16), mask=None, connectivity=4)

    coordinates = []
    for shape, value in shapes:
        if value == 1:
            coords = []
            for cc in shape["coordinates"]:
                coords.append([[c[0], segment.nrow - c[1]] for c in cc])
            coordinates.append(coords)

    return SegmentResponse(geometry={"type": "MultiPolygon", "coordinates": coordinates})


class LassoStartRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate
    crop_size: PositiveInt


@router.post("/lasso-start", status_code=HTTP_204_NO_CONTENT)
def lasso_start(req: LassoStartRequest):
    """
    Start the lasso tool with the specified coordinate and buffer size
    """

    lasso_tool = ToolCache(req.cog_id).lasso
    if lasso_tool is None:
        raise HTTPException(400, "Lasso tool not loaded in cache")

    lasso_tool.start_coordinate = lasso_tool.convert_coordinate(req.coordinate)
    lasso_tool.crop_size = req.crop_size

    lasso_tool.apply_image()
    lasso_tool.build_map()

    return


class LassoStepRequest(BaseModel):
    cog_id: str
    coordinate: PixelCoordinate


class LassoStepResponse(BaseModel):
    geometry: LineString


@router.post("/lasso-step")
def lasso_step(req: LassoStepRequest) -> LassoStepResponse:
    """
    Perform a step in the lasso tool with the specified coordinate, getting a new contour
    """

    lasso_tool = ToolCache(req.cog_id).lasso
    if lasso_tool is None:
        raise HTTPException(400, "Lasso tool not loaded in cache")

    coordinate = req.coordinate
    coordinate = lasso_tool.convert_crop_coordinate(coordinate, interpolate=True)
    contour = lasso_tool.get_contour(coordinate)

    if contour is None:
        raise HTTPException(400, f"No contour found for {req.coordinate} (cropped: {coordinate})")

    # Convert contour to coordinates in the original image space
    contour = lasso_tool.convert_contour(contour)
    coordinates = contour.tolist()
    geometry = {"type": "LineString", "coordinates": coordinates}

    return LassoStepResponse(geometry=geometry)


class MeanColorRequest(BaseModel):
    cog_id: str
    geometry: Polygon | MultiPolygon


class MeanColorResponse(BaseModel):
    color: Color


@router.post("/mean-color")
def mean_color(req: MeanColorRequest) -> MeanColorResponse:
    """
    Get the mean color of the specified geometry
    """

    image = quick_cog(req.cog_id)

    try:
        result = rasterize([req.geometry.model_dump()], out_shape=image.shape[:2])
    except ValueError:
        raise HTTPException(400, "Invalid geometry")

    result = np.flipud(result)
    mask = image * np.expand_dims(result, -1)

    # Resize the masked image to a smaller size for faster processing
    scale = 0.25
    mask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    result = cv2.resize(result, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    # skip = 10
    # mask = mask[::skip, ::skip, :]
    # result = result[::skip, ::skip]

    color = np.sum(mask, axis=(0, 1)) / np.sum(result)
    color = color.astype(int).tolist()
    color = rgb_to_hsl(color)

    return MeanColorResponse(color=color)
