import json
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime
from io import BytesIO
from logging import Logger
from time import perf_counter

import httpx
import pytesseract
import rasterio as rio
import rasterio.transform as riot
from cdr_schemas.georeference import GeoreferenceResults
from fastapi import HTTPException, Response, status
from PIL import Image
from pyproj import Transformer
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.windows import Window

from auto_georef.common.tiff_cache import get_cached_tiff
from auto_georef.common.utils import s3_client, time_since, upload_s3_file
from auto_georef.es import cdr_GCP_by_id, return_ES_doc_by_id, save_ES_data, search_by_cog_id, update_GCPs
from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)

Image.MAX_IMAGE_PIXELS = None

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


# async def cog_height(cache, cog_id):
#     s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"

#     src = await run_in_threadpool(get_cached_tiff, cache, s3_key)
#     return src.height


def cog_height(cache, cog_id):
    with get_cached_tiff(cache, cog_id) as image_size:
        height = image_size[1]
    return height


def clip_bbox_(cache, minx, miny, maxx, maxy, cog_id):
    with get_cached_tiff(cache, cog_id) as image_size:
        img = image_size[0]
        height = image_size[1]

    box = (minx, height - maxy, maxx, height - miny)

    clipped_img = img.crop(box)
    if clipped_img.mode != "RGB":
        clipped_img = clipped_img.convert("RGB")

    img_byte_arr = BytesIO()
    clipped_img.save(img_byte_arr, format="PNG")
    img_byte_arr = img_byte_arr.getvalue()

    return Response(content=img_byte_arr, media_type="image/png")


def clip_tiff_(cache, rowb, coll, cog_id):
    size = 225

    with get_cached_tiff(cache, cog_id) as image_size:
        img = image_size[0]
        height = image_size[1]
        y = height - rowb

    box = (coll - (size / 2), y - (size / 2), coll + (size / 2), y + (size / 2))
    clipped_img = img.crop(box)
    if clipped_img.mode != "RGB":
        clipped_img = clipped_img.convert("RGB")

    center_x, center_y = int(size / 2), int(size / 2)  # Center of a 200x200 image

    for i in range(center_y - 5, center_y + 5):
        for j in range(center_x - 5, center_x + 5):
            try:
                clipped_img.putpixel((j, i), (255, 0, 0))  # Red
            except Exception as e:
                logging.error(e)

    img_byte_arr = BytesIO()
    clipped_img.save(img_byte_arr, format="PNG")
    img_byte_arr = img_byte_arr.getvalue()

    return Response(content=img_byte_arr, media_type="image/png")


def cps_to_transform(cps, to_crs):
    cps = [
        {
            "row": float(cp["rows_from_top"]),
            "col": float(cp["columns_from_left"]),
            "x": float(cp["longitude"]),
            "y": float(cp["latitude"]),
            "crs": cp["crs"],
        }
        for cp in cps
    ]
    cps_p = []
    for cp in cps:
        proj = Transformer.from_crs(cp["crs"], to_crs, always_xy=True)
        x_p, y_p = proj.transform(xx=cp["x"], yy=cp["y"])
        cps_p.append(riot.GroundControlPoint(row=cp["row"], col=cp["col"], x=x_p, y=y_p))

    return riot.from_gcps(cps_p)


def project_(cache, cog_id, pro_cog_path, geo_transform, crs):
    disk_cache_path = os.path.join(app_settings.disk_cache_dir, cog_id + ".cog.tif")
    if not os.path.isfile(disk_cache_path):
        logging.info(f"File was not found on disk")
        with get_cached_tiff(cache, cog_id):
            logger.info(f"Added file to disk")
    else:
        logging.warning("File found on disk so we can open that")
    with rio.open(disk_cache_path) as raw:
        bounds = riot.array_bounds(raw.height, raw.width, geo_transform)
        pro_transform, pro_width, pro_height = calculate_default_transform(
            crs, crs, raw.width, raw.height, *tuple(bounds)
        )
        pro_kwargs = raw.profile.copy()
        pro_kwargs.update(
            {
                "driver": "COG",
                "crs": {"init": crs},
                "transform": pro_transform,
                "width": pro_width,
                "height": pro_height,
            }
        )
        _raw_data = raw.read()
        with rio.open(pro_cog_path, "w", **pro_kwargs) as pro:
            for i in range(raw.count):
                _ = reproject(
                    source=_raw_data[i],
                    destination=rio.band(pro, i + 1),
                    src_transform=geo_transform,
                    src_crs=crs,
                    dst_transform=pro_transform,
                    dst_crs=crs,
                    resampling=Resampling.bilinear,
                    num_threads=8,
                    warp_mem_limit=256,
                )


def compare_dicts(dict1, dict2, keys):
    for key in keys:
        if dict1.get(key) != dict2.get(key):
            return False
    return True


def query_gpt4(prompt_text):
    endpoint = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {app_settings.open_ai_key}",
        "OPENAI_API_KEY": f"{app_settings.open_ai_key}",
        "Content-Type": "application/json",
        "User-Agent": "OpenAI-Python-Client",
    }

    data = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": 550,
    }

    response = httpx.post(endpoint, headers=headers, json=data)

    if response.status_code == 200:
        choices = response.json()["choices"]
        print(choices)
        first_message = choices[0]["message"]["content"]
        matches = re.findall(r"EPSG:\d+", first_message)

        return {"matches": matches, "reasoning": first_message}
    else:
        raise Exception(f"API call failed with status code {response.status_code}: {response.text}")


def inverse_geojson(geojson, image_height):
    if geojson is None:
        return None
    geom_type = geojson["type"]

    def transform_coord(coord):
        return [coord[0], image_height - coord[1]]

    if geom_type == "Point":
        geojson["coordinates"] = transform_coord(geojson["coordinates"])
    elif geom_type in ["LineString", "MultiPoint"]:
        geojson["coordinates"] = [transform_coord(coord) for coord in geojson["coordinates"]]
    elif geom_type in ["Polygon", "MultiLineString"]:
        geojson["coordinates"] = [[transform_coord(coord) for coord in ring] for ring in geojson["coordinates"]]
    elif geom_type == "MultiPolygon":
        geojson["coordinates"] = [
            [[transform_coord(coord) for coord in ring] for ring in polygon] for polygon in geojson["coordinates"]
        ]
    elif geom_type == "GeometryCollection":
        for geometry in geojson["geometries"]:
            inverse_geojson(geometry, image_height)
    else:
        raise ValueError(f"Unsupported geometry type: {geom_type}")
    return geojson


def inverse_bbox(bbox, height):
    if not bbox:
        return []
    else:
        return [
            bbox[0],
            height - bbox[3],
            bbox[2],
            height - bbox[1],
        ]


async def post_results(files, data):
    async with httpx.AsyncClient(timeout=None) as client:
        data_ = {"georef_result": data}  # Marking the part as JSON
        files_ = []
        for file_path, file_name in files:
            print(file_path, file_name)
            files_.append(("files", (file_name, open(file_path, "rb"))))
        try:
            if len(files_) > 0:
                logging.debug(f"files to be sent {files_}")
                logging.debug(f"data to be sent {data_}")
                r = await client.post(
                    app_settings.cdr_endpoint_url + "/v1/maps/publish/georef",
                    files=files_,
                    data=data_,
                    headers=auth,
                )
                logging.debug(f"Response text from CDR {r.text}")
                r.raise_for_status()
            else:
                logging.debug(f"files to be sent {files_}")
                logging.debug(f"data to be sent {data_}")
                r = await client.post(
                    app_settings.cdr_endpoint_url + "/v1/maps/publish/georef",
                    files=[],
                    data=data_,
                    headers=auth,
                )
                logging.debug(f"Response text from CDR {r.text}")
                r.raise_for_status()
        except Exception as e:
            logging.exception(e)
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"projection not updated in cdr")


def get_gcp_from_cdr(gcp_id):
    endpoint = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/gcp/{gcp_id}"
    response = httpx.get(endpoint, headers=auth)
    if response.status_code == 200:
        return response.json()

    return None


def build_cdr_georef_result(proj_id):
    # get projection from es
    projection = return_ES_doc_by_id(app_settings.polymer_projections_index, proj_id)
    all_gcps = []
    georef_result = None
    if projection:
        for gcp_id in projection.get("gcps_ids"):
            #  get gcp from es
            gcp_ = return_ES_doc_by_id(app_settings.polymer_gcps_index, gcp_id)
            if gcp_ is not None:
                # found in es which means it has been edited or created in polymer
                gcp_["map_geom"] = {
                    "latitude": gcp_.get("latitude"),
                    "longitude": gcp_.get("longitude"),
                }
                gcp_["px_geom"] = {
                    "rows_from_top": gcp_.get("rows_from_top"),
                    "columns_from_left": gcp_.get("columns_from_left"),
                }
                del gcp_["rows_from_top"]
                del gcp_["columns_from_left"]
                del gcp_["latitude"]
                del gcp_["longitude"]
                del gcp_["registration_id"]
                del gcp_["reference_id"]
                all_gcps.append(gcp_)
            else:
                # get gcp from cdr since not in es
                gcp_ = get_gcp_from_cdr(gcp_id=gcp_id)
                if gcp_:
                    gcp_["map_geom"] = {
                        "latitude": gcp_.get("latitude"),
                        "longitude": gcp_.get("longitude"),
                    }
                    gcp_["px_geom"] = {
                        "rows_from_top": gcp_.get("rows_from_top"),
                        "columns_from_left": gcp_.get("columns_from_left"),
                    }
                    gcp_["model_version"] = gcp_["model"]["model_version"]
                    gcp_["model"] = gcp_["model"]["model_name"]

                    del gcp_["rows_from_top"]
                    del gcp_["columns_from_left"]
                    del gcp_["latitude"]
                    del gcp_["longitude"]
                    del gcp_["registration_id"]
                    del gcp_["reference_id"]

                    all_gcps.append(gcp_)

        georef_result = {
            "likely_CRSs": [],
            "map_area": None,
            "projections": [
                {
                    "crs": projection["crs"],
                    "gcp_ids": projection["gcps_ids"],
                    "file_name": projection["projection_id"],
                    "validated": True,
                }
            ],
        }
        georef_result = GeoreferenceResults(
            cog_id=projection.get("cog_id"),
            georeference_results=[georef_result],
            system=app_settings.polymer_auto_georef_system,
            system_version=app_settings.polymer_auto_georef_system_version,
            gcps=all_gcps,
        ).model_dump_json()

    return georef_result, projection.get("cog_id")


async def send_georef_to_cdr(proj_id):
    data, cog_id = build_cdr_georef_result(proj_id=proj_id)
    if data is not None:
        s3_key = f"{app_settings.polymer_s3_cog_projections_prefix}/{cog_id}/{proj_id}"
        all_files = []

        with tempfile.TemporaryDirectory() as tmpdir:
            proj_file_name = f"{s3_key.split('/')[-1]}"
            raw_path = os.path.join(tmpdir, proj_file_name)
            s3 = s3_client()
            s3.download_file(app_settings.polymer_public_bucket, s3_key, raw_path)
            pro_cog_path = os.path.join(tmpdir, proj_file_name)

            all_files.append((pro_cog_path, proj_file_name))

            await post_results(files=all_files, data=data)

            logging.info("Finished")


async def post_feature_results(data):
    async with httpx.AsyncClient(timeout=None) as client:
        try:
            r = await client.post(
                app_settings.cdr_endpoint_url + "/v1/maps/publish/features",
                data=json.dumps(data),
                headers=auth,
            )
            logging.debug(f"Response text from CDR {r.text}")
            r.raise_for_status()
        except Exception as e:
            logging.error(e)


async def publish_legend_items(data):
    async with httpx.AsyncClient(timeout=None) as client:
        try:
            r = await client.post(
                app_settings.cdr_endpoint_url + "/v1/features/publish/legend_items",
                data=json.dumps(data),
                headers=auth,
            )
            logging.debug(f"Response text from CDR {r.text}")
            r.raise_for_status()
        except Exception as e:
            logging.error(e)


async def send_feature_results_to_cdr(data):
    await post_feature_results(data)
    return


async def send_new_legend_items_to_cdr(data):
    await publish_legend_items(data)
    return


# todo update to point to cdr for this data
def getMapUnit(age_text):
    if age_text == "":
        return None
    map_units = httpx.get("https://macrostrat.org/api/v2/defs/intervals?all")
    mapper = {}
    for unit in map_units.json()["success"]["data"]:
        mapper[unit["name"].lower()] = unit

    if age_text.lower() not in mapper.keys():
        return None
    return {
        "age_text": mapper[age_text.lower()].get("name"),
        "t_age": mapper[age_text.lower()].get("t_age", None),
        "b_age": mapper[age_text.lower()].get("b_age", None),
    }


def get_projections_from_cdr(cog_id):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/projections/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data = response.json()

        if response_data is None:
            response_data = []
        for response in response_data:
            response["in_cdr"] = True
        return response_data
    return []


def add_gcps_to_projections(cog_id, polymer_projections):
    projections = []
    for projection in polymer_projections:
        projection["gcps"] = []
        for gcp_id in projection.get("gcps_ids"):
            projection["gcps"].append(cdr_GCP_by_id(cog_id, gcp_id))
        projections.append(projection)

    return projections


def get_projections_from_polymer(cog_id):
    polymer_projections = search_by_cog_id(app_settings.polymer_projections_index, cog_id)
    polymer_projections = add_gcps_to_projections(cog_id, polymer_projections)
    for proj in polymer_projections:
        proj["in_cdr"] = False
    return polymer_projections


def get_cdr_gcps(cog_id):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/gcps/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data = response.json()
        if response_data is None:
            response_data = []
    return response_data


def get_cog_meta(cog_id):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/meta/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = {"cog_id": cog_id}
    if response.status_code == 200:
        response_data = response.json()
    if response_data is None:
        return {}
    return response_data


def get_area_extractions(cache, cog_id):
    height = cog_height(cache=cache, cog_id=cog_id)
    map_areas = search_by_cog_id(app_settings.polymer_area_extractions, cog_id=cog_id)
    for area in map_areas:
        area["coordinates_from_bottom"] = inverse_geojson(area.get("coordinates"), height)
        area["extent_from_bottom"] = inverse_bbox(area["bbox"], height)
    return map_areas


def project_cog(cache, req):
    cog_id = req.cog_id
    cps = [gcp.dict() for gcp in req.gcps]
    gcps = [gcp.dict() for gcp in req.gcps]

    crs = req.crs

    if len(cps) == 0:
        raise HTTPException(status_code=404, detail="No Control Points Found!")

    start_proj = perf_counter()

    with tempfile.TemporaryDirectory() as tmpdir:
        pro_cog_path = os.path.join(tmpdir, f"{cog_id}.pro.cog.tif")

        start_transform = perf_counter()

        geo_transform = cps_to_transform(cps, to_crs=crs)

        time_since(logger, "geo_transform loaded", start_transform)

        start_reproj = perf_counter()

        project_(cache, cog_id, pro_cog_path, geo_transform, crs)

        time_since(logger, "reprojection file created", start_reproj)

        proj_id = "polymer_" + str(cog_id) + str(uuid.uuid4()) + ".pro.cog.tif"
        s3_pro_unique_key = f"{app_settings.polymer_s3_cog_projections_prefix}/{cog_id}/{proj_id}"
        upload_s3_file(s3_pro_unique_key, app_settings.polymer_public_bucket, pro_cog_path)

        # update ES
        gcp_ids = update_GCPs(cog_id, gcps)

        # save projection code

        save_ES_data(
            index=app_settings.polymer_projections_index,
            info={
                "cog_id": cog_id,
                "projection_id": proj_id,
                "crs": crs,  # epsg_code used for reprojection
                "gcps_ids": gcp_ids,  # gcps used in reprojection
                "created": datetime.now(),  # when file was created
                "status": "created",  # (created, failed, validated)
                "download_url": f"{app_settings.polymer_s3_endpoint_url}/{app_settings.polymer_public_bucket}/{s3_pro_unique_key}",
                "map_area_id": "",
                "system": app_settings.polymer_auto_georef_system,
                "system_version": app_settings.polymer_auto_georef_system_version,
            },
            id=proj_id,
        )
    time_since(logger, "total projection took", start_proj)

    return {"pro_cog_path": f"{app_settings.polymer_s3_endpoint_url}/{s3_pro_unique_key}"}


def ocr_bboxes(req):
    bboxes = req.bboxes
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{req.cog_id}.cog.tif"

    with rio.open(f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}/{s3_key}") as src:
        all_texts = []
        for box in bboxes:
            top = src.height - box[3]
            left = box[0]
            width = box[2] - box[0]
            height = box[3] - box[1]

            window = Window(left, top, width, height)
            w = src.read(1, window=window)
            image = Image.fromarray(w)
            all_texts.append(pytesseract.image_to_string(image).replace("\n", " "))

    return {"extracted_text": all_texts}


def cog_height_not_in_memory(cog_id):
    s3_key = f"{app_settings.cdr_s3_cog_prefix}/{cog_id}.cog.tif"
    gdal_env = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    }

    with rio.Env(**gdal_env) as rio_env:
        with rio.open(f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}/{s3_key}") as src:
            height = src.height
            return height
