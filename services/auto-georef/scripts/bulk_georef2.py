import os
import logging
from logging import Logger
import uuid
from elasticsearch import Elasticsearch
from time import perf_counter
import boto3
from pathlib import Path
import tempfile
from wand.image import Image as wandImage
from PIL import Image
import json
from datetime import datetime
import pandas as pd
import ast
import hashlib
import pyproj
from pyproj import Transformer
import imagehash

from auto_georef.common.map_utils import (
    document_exists,
    extract_gcps_,
    es_search_map,
    prepare_gcps_for_es,
    update_documents,
    saveESData,
    updateGCPs,
    cps_to_transform,
    project_,
    query_gpt4,
    generateCrsListFromGCPs,
    filterCRSList,
    saveTifasCog,
    return_crs,
    calculate_centroid_as_geo_shape,
    create_boundary_polygon,
    calculateCentroid,
    generateCrsListFromPoint,
    rectangleDetection,
    concat_values,
    duplicates,
    boundsFromGCPS,
    convert_to_4326,
)

from auto_georef.common.utils import time_since, load_tiff, upload_s3_file
from shapely import Point
from auto_georef.georef.autogeoreferencer import AutoGeoreferencer
from auto_georef.settings import app_settings

Image.MAX_IMAGE_PIXELS = None

AGR = AutoGeoreferencer()


logger: Logger = logging.getLogger(__name__)
formatter = logging.Formatter(
    "%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
)

file_logger = logging.getLogger("file_logger")
file_logger.setLevel(logging.INFO)
logging_count = uuid.uuid4()
file_handler = logging.FileHandler(
    "scripts/logs/bulk_upload_" + str(logging_count) + ".log"
)

file_handler.setFormatter(formatter)

file_logger.addHandler(file_handler)

# env local
AUTOGEOREF_S3_ENDPOINT_URL = app_settings.s3_endpoint_url
s3_endpoint_url = AUTOGEOREF_S3_ENDPOINT_URL
s3_tiles_bucket: str = app_settings.s3_tiles_bucket
s3_tiles_prefix: str = app_settings.s3_tiles_prefix
s3_tiles_v2 = app_settings.s3_tiles_prefix_v2

es = Elasticsearch(
    [
        app_settings.es_endpoint_url,
    ]
)


def s3_client():
    s3 = boto3.client("s3", endpoint_url=AUTOGEOREF_S3_ENDPOINT_URL, verify=False)
    return s3


def maps():
    maps_loading = perf_counter()
    s3 = s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    itr = paginator.paginate(
        Bucket=s3_tiles_bucket, Prefix=f"{s3_tiles_prefix}/", Delimiter="/"
    )
    tiles = []
    for result in itr:
        for obj in result.get("CommonPrefixes", []):
            p = Path(obj.get("Prefix", "")).name
            if p:
                tiles.append(p)

    time_since(logger, "maps list loaded", maps_loading)
    return {"maps": tiles}


def parseHashFile(filename):
    dict = {}

    # Open the file and read line by line
    with open(filename, "r") as file:
        for line in file:
            try:
                json_object = json.loads(line)
                dict[json_object["name"]] = {
                    "sha256": json_object["sha256"],
                    "size": json_object["size"],
                }
            except json.JSONDecodeError:
                print(f"Error decoding JSON from line: {line}")

    return dict


def get_name(x):
    if x == "nan":
        return ""
    else:
        return x.replace("['", "").replace("']", "").replace(".tif", "")


def parseMetaFile(path):
    df = pd.read_excel(path)
    df["map_name_"] = df["challenge_map_name"].astype(str)
    df["state"] = df["state"].fillna("").astype(str)
    df["pub_link"] = df["pub_link"].fillna("").astype(str)
    df["category"] = df["category"].fillna("").astype(str)
    df["publication_id"] = df["publication_id"].fillna(0).astype(int)

    df["map_name_"] = df["map_name_"].apply(lambda x: get_name(x))
    df["west"] = df["west"].str.replace(",", "")

    df["south"] = pd.to_numeric(df["south"], errors="coerce")
    df["west"] = pd.to_numeric(df["west"], errors="coerce")
    df["east"] = pd.to_numeric(df["east"], errors="coerce")
    df["north"] = pd.to_numeric(df["north"], errors="coerce")

    # only maps that we will use
    # df = df[df['map_name_']!=""]
    return df


def return_meta_info(df, map_name):
    data = {
        "source_url": None,
        "image_url": None,
        "authors": None,
        "publisher": None,
        "organization": None,
        "year": None,
        "scale": None,
        "series_name": None,
        "series_number": None,
        "title": None,
        "category": None,
        "pub_link": None,
        "state": None,
        "gis_data": None,
        "downloads": None,
        "citation": None,
    }
    if "GEO" in map_name:
        file_logger.info(f"Geo found")
        row = df[df["map_name_"] == map_name]
    else:
        file_logger.info(
            f'using publicaiton id {int(map_name.split("_")[1])}, {df.head()}, {df.dtypes}'
        )
        row = df[df["publication_id"] == int(map_name.split("_")[1])]

    if not row.empty:
        try:
            series_obj = ast.literal_eval(row["series"].item())
        except Exception as e:
            series_obj = {"number": "", "name": ""}
        try:
            data["source_url"] = row["url"].item()
            data["publication_id"] = row["publication_id"].item()
            data["publisher"] = row["publisher"].item()
            data["title"] = row["title"].item()
            data["authors"] = row["authors"].item()
            data["year"] = row["year"].item()
            data["scale"] = row["scale"].item()
            data["pub_link"] = row["pub_link"].item()
            data["category"] = row["category"].item()
            data["state"] = row["state"].item()
            data["gis_data"] = row["gis_data"].item() == "yes"
            data["downloads"] = row["downloads"].item() == "yes"
            data["organization"] = row["publisher"].item()
            data["series_name"] = series_obj.get("name", "")
            data["series_number"] = series_obj.get("number", "")
            data["citation"] = row["citation"].item()
            data["bounds"] = create_boundary_polygon(
                south=row["south"].item(),
                west=row["west"].item(),
                east=row["east"].item(),
                north=row["north"].item(),
            )
            data["centroid"] = calculate_centroid_as_geo_shape(
                south=row["south"].item(),
                west=row["west"].item(),
                east=row["east"].item(),
                north=row["north"].item(),
            )
            data[
                "download_url"
            ] = f"https://ngmdb.usgs.gov/ngm-bin/pdp/download.pl?q={map_name}_5"

        except Exception as e:
            file_logger.info(f"Error getting meta data for map {map_name}, {e}")
    file_logger.info(f"Data to check {data}")
    return data


class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        # Let the base class default method raise the TypeError
        return json.JSONEncoder.default(self, obj)


def generate_map_id(file):
    with Image.open(file) as img:
        return str(imagehash.dhash(img, hash_size=16))


if __name__ == "__main__":
    maps = maps()["maps"]

    hashs = parseHashFile("scripts/data/hashs.txt")
    meta = parseMetaFile(
        "scripts/data/NGMDB_USGS_records_with_shared_image_counts_json_extents.xlsx"
    )

    for map_name in maps:
        try:
            file_logger.info(f"starting process {map_name}")
            #  read in map
            s3_key = f"{s3_tiles_prefix}/{map_name}/{map_name}.cog.tif"
            with tempfile.TemporaryDirectory() as tmpdir:
                raw_path = os.path.join(tmpdir, f"{map_name}.cog.tif")

                start_s3_load = perf_counter()

                s3 = s3_client()
                s3.download_file(s3_tiles_bucket, s3_key, raw_path)

                time_since(logger, "cog file loaded", start_s3_load)

                original_wkt = None

                img = Image.open(raw_path)
                width, height = img.size

                map_id = generate_map_id(raw_path)
                s3_cog_key = f"{s3_tiles_v2}/{map_id}/{map_id}.cog.tif"
                upload_s3_file(s3_cog_key, raw_path)

                meta_info = return_meta_info(meta, map_name)
                # Save what we have now. Update later
                saveESData(
                    es=es,
                    index= app_settings.maps_index,
                    info={
                        **meta_info,
                        "map_id": map_id,  # uuid
                        "map_name": map_name,  # basically our current map_id which is it's name
                        "height": height,  # height pixels
                        "width": width,
                        "image_size": [height, width],
                        "file_size": hashs[map_name].get("size", None),
                        "original_wkt": original_wkt,
                        "projection_info": None,
                        "georeferenced": False,
                        "validated": False,
                        "finished_proj_id": None,
                        "modified": datetime.now(),
                        "created": datetime.now(),
                        "finished": None,
                        "cog_url": f"{s3_endpoint_url}/{s3_tiles_bucket}/{s3_tiles_v2}/{map_id}/{map_id}.cog.tif",
                    },
                    id=map_id,
                )

                gcps = extract_gcps_(AGR, img)

                for cp in gcps:
                    # add unique id for gcps
                    cp[
                        "gcp_id"
                    ] = f"{cp['y']}{cp['x']}{cp['coll']}{cp['rowb']}{cp['crs']}"

                gcps_ = prepare_gcps_for_es(
                    gcps=gcps,
                    map_id=map_id,
                    extraction_model="jataware_gcp_extractor",
                    extraction_model_version="0.0.1",
                    provenance="bulk_upload",
                )

                try:
                    for gcp_data in gcps_:
                        saveESData(
                            es=es, index=app_settings.gcps_index, info=gcp_data, id=gcp_data["gcp_id"]
                        )
                        print(f"save_gcps_gcps, {map_id}", gcp_data)
                except Exception as e:
                    print(f"Error indexing gcp data: {e}")

                crs_list = []
                centroid_geojson = None

                if len(gcps) > 0:
                    # calculate centroid
                    centroid_point = calculateCentroid(gcps)
                    file_logger.info(
                        f"POINT TO CHECK {centroid_point} , {centroid_point.x}, {centroid_point.y}"
                    )
                    crs_list = generateCrsListFromPoint(centroid_point)
                    crs_list = filterCRSList(crs_list)

                    if meta_info.get("centroid"):
                        meta_centroid = Point(
                            meta_info.get("centroid").get("coordinates")[0],
                            meta_info.get("centroid").get("coordinates")[1],
                        )

                        crs_list2 = generateCrsListFromPoint(meta_centroid)

                        crs_list2 = filterCRSList(crs_list2)
                        both = crs_list2 + crs_list
                        crs_list = list(set(both))

                    x_4326, y_4326 = convert_to_4326(
                        "EPSG:4267", centroid_point.x, centroid_point.y
                    )
                    centroid_geojson = {
                        "type": "Point",
                        "coordinates": [x_4326, y_4326],
                    }

                if len(gcps) < 4:
                    file_logger.info("Failed to find enough gcps")
                    saveESData(
                        es=es,
                        index=app_settings.maps_index,
                        info={
                            **meta_info,
                            "map_id": map_id,  # uuid
                            "map_name": map_name,  # basically our current map_id which is it's name
                            "height": height,  # height pixels
                            "width": width,
                            "image_size": [height, width],
                            "file_size": hashs[map_name].get("size", None),
                            "original_wkt": original_wkt,
                            "projection_info": None,
                            "georeferenced": False,
                            "validated": False,
                            "finished_proj_id": None,
                            "modified": datetime.now(),
                            "created": datetime.now(),
                            "finished": None,
                            "cog_url": f"{s3_endpoint_url}/{s3_tiles_bucket}/{s3_tiles_v2}/{map_id}/{map_id}.cog.tif",
                            "likely_CRSs": crs_list,
                            "centroid": centroid_geojson,
                        },
                        id=map_id,
                    )
                    continue

                # find best 4 points to use for georeferencing
                # will be removed when we have a real TA1 system
                best_4_points = rectangleDetection(gcps=gcps, pixel_buffer=250)

                # save epsg codes for map
                for crs in crs_list:
                    epsg_id = crs + "bulk_ingest"
                    sorted_cps = sorted(
                        gcps, key=lambda item: (item["rowb"], item["coll"], item["x"])
                    )
                    proj_id = hashlib.sha256(
                        (crs + concat_values(sorted_cps)).encode()
                    ).hexdigest()
                    pro_cog_path = os.path.join(
                        tmpdir, f"{map_id}_{proj_id}.pro.cog.tif"
                    )

                    s3_pro_key = (
                        f"{s3_tiles_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"
                    )
                    # crs_list_and_id.append((crs, crs))
                    s3_key = f"{s3_tiles_v2}/{map_id}/{map_id}.cog.tif"

                    usedBestFour = False
                    if len(best_4_points) == 4:
                        usedBestFour = True
                        logger.info(
                            f"Projecting map with best 4 gcps: {map_name}, Points {best_4_points}"
                        )
                        # fix_gcps(map_id=map, gcps=best_4_points)
                        geo_transform = cps_to_transform(
                            best_4_points, height=height, to_crs=crs
                        )
                        project_(raw_path, pro_cog_path, geo_transform, crs)

                        upload_s3_file(s3_pro_key, pro_cog_path)

                        saveESData(
                            es=es,
                            index=app_settings.proj_files_index,
                            info={
                                "proj_id": proj_id,
                                "map_id": map_id,  # map id
                                "epsg_code": crs,  # epsg_code used for reprojection
                                "epsg_id": epsg_id,  # epsg_id used which is the internal id in the epsg index
                                "created": datetime.now(),
                                "source": f"{AUTOGEOREF_S3_ENDPOINT_URL}/{s3_tiles_bucket}/{s3_pro_key}",
                                "gcps_ids": [gcp["gcp_id"] for gcp in best_4_points],
                                "status": "created",
                                "provenance": "bulk_upload",
                                "transformation": "polynomial_1",
                            },
                            id=proj_id,
                        )
                    else:
                        logger.info(
                            f"Projecting map with all gcps: {map_name}, Points {gcps}"
                        )
                        geo_transform = cps_to_transform(
                            gcps, height=height, to_crs=crs
                        )

                        project_(raw_path, pro_cog_path, geo_transform, crs)

                        upload_s3_file(s3_pro_key, pro_cog_path)
                        saveESData(
                            es=es,
                            index=app_settings.proj_files_index,
                            info={
                                "proj_id": proj_id,
                                "map_id": map_id,  # map id
                                "epsg_code": crs,  # epsg_code used for reprojection
                                "epsg_id": epsg_id,  # epsg_id used which is the internal id in the epsg index
                                "created": datetime.now(),
                                "source": f"{AUTOGEOREF_S3_ENDPOINT_URL}/{s3_tiles_bucket}/{s3_pro_key}",
                                "gcps_ids": [gcp["gcp_id"] for gcp in gcps],
                                "status": "created",
                                "provenance": "bulk_upload",
                                "transformation": "polynomial_1",
                            },
                            id=proj_id,
                        )

                    saveESData(
                        es=es,
                        index=app_settings.epsgs_index,
                        info={
                            "epsg_id": epsg_id,
                            "map_id": map_id,
                            "epsg_code": crs,
                            "created": datetime.now(),
                            "provenance": "bulk_ingest",
                            "extraction_model": None,
                            "extraction_model_version": None,
                        },
                        id=epsg_id,
                    )

                def convertWrapper(gcps):
                    gcp_4367 = []
                    for gcp in gcps:
                        file_logger.info(f'POINTS {gcp}, {gcp["x"]}, {gcp["y"]}')
                        x_4326, y_4326 = convert_to_4326(
                            "EPSG:4267", gcp["x"], gcp["y"]
                        )
                        gcp_4367.append({"x": x_4326, "y": y_4326})
                    return gcp_4367

                def wrapBoundsFromGCPS(usedBestFour, gcps, best_4_points):
                    if usedBestFour:
                        return boundsFromGCPS(convertWrapper(best_4_points))
                    return boundsFromGCPS(convertWrapper(gcps))

                bounds = wrapBoundsFromGCPS(
                    usedBestFour=usedBestFour, gcps=gcps, best_4_points=best_4_points
                )

                saveESData(
                    es=es,
                    index=app_settings.maps_index,
                    info={
                        **meta_info,
                        "map_id": map_id,
                        "map_name": map_name,
                        "height": height,
                        "width": width,
                        "image_size": [height, width],
                        "file_size": hashs[map_name].get("size", None),
                        "original_wkt": original_wkt,
                        "projection_info": None,
                        "georeferenced": True,
                        "validated": False,
                        "finished_proj_id": None,
                        "modified": datetime.now(),
                        "created": datetime.now(),
                        "finished": None,
                        "cog_url": f"{s3_endpoint_url}/{s3_tiles_bucket}/{s3_tiles_v2}/{map_id}/{map_id}.cog.tif",
                        "likely_CRSs": crs_list,
                        "centroid": centroid_geojson,
                        "bounds": bounds,
                    },
                    id=map_id,
                )

        except Exception as e:
            file_logger.info(f"Failed: {map_name}")
            file_logger.info(f"Errors: {e}")
