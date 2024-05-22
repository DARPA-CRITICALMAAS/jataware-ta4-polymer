import hashlib
import logging
import math
import os
import re
import shutil
import tempfile
from logging import Logger

import httpx
import numpy as np
import pyproj
import rasterio as rio
import rasterio.transform as riot
from elasticsearch import helpers
from osgeo import gdal
from pyproj import Transformer
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely.geometry import MultiPoint, Point

from auto_georef.settings import app_settings

logger: Logger = logging.getLogger(__name__)
from cdr_schemas.georeference import GeoreferenceResults
from PIL import Image
from shapely.ops import transform

from auto_georef.common.utils import s3_client
from auto_georef.es import return_ES_doc_by_id

Image.MAX_IMAGE_PIXELS = None

auth = {
    "Authorization": app_settings.cdr_bearer_token,
}


def hash_file_sha256(file_path):
    sha256_hash = hashlib.sha256()

    with open(file_path, "rb") as file:
        for byte_block in iter(lambda: file.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


# def generate_map_id(file):
#     with Image.open(file) as img:
#         return str(imagehash.dhash(img, hash_size=16))


def create_boundary_polygon(south, east, north, west):
    try:
        if not -90 <= south <= 90:
            raise ValueError("South latitude is out of valid range. Must be between -90 and 90.")
        if not -90 <= north <= 90:
            raise ValueError("North latitude is out of valid range. Must be between -90 and 90.")
        if not -180 <= east <= 180:
            raise ValueError("East longitude is out of valid range. Must be between -180 and 180.")
        if not -180 <= west <= 180:
            raise ValueError("West longitude is out of valid range. Must be between -180 and 180.")

        if north <= south:
            raise ValueError("North latitude must be greater than South latitude.")
        coordinates = [
            [west, south],  # Bottom-left
            [east, south],  # Bottom-right
            [east, north],  # Top-right
            [west, north],  # Top-left
            [west, south],  # Close the polygon
        ]
        geo_shape = {"type": "Polygon", "coordinates": [coordinates]}
        return geo_shape
    except Exception as e:
        logger.error(f"failed to create border: {e}")
        return None


def calculate_centroid_as_geo_shape(south: float, west: float, east: float, north: float):
    if not all(isinstance(arg, float) for arg in [south, west, east, north]):
        raise TypeError("All arguments must be of type float")

    try:
        centroid_longitude = (west + east) / 2
        centroid_latitude = (south + north) / 2
        if not math.isnan(centroid_longitude) and not math.isnan(centroid_latitude):
            return {
                "type": "point",
                "coordinates": [centroid_longitude, centroid_latitude],
            }
        else:
            return None
    except Exception as e:
        logger.error(f"failed to create centroid: {e}")
        return None


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


def project_(raw_path, pro_cog_path, geo_transform, crs):
    with rio.open(raw_path) as raw:
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


def update_documents(es, index_name, search_dict, update_body):
    """
    Update documents in an Elasticsearch index based on matching key-value pairs.

    :param index_name: Name of the Elasticsearch index.
    :param search_dict: Dictionary with key-value pairs to match documents.
    :param update_body: Dictionary with key-value pairs to update in matching documents.
    :return: Number of updated documents.
    """
    # Constructing the search query
    must_clauses = [{"match": {k: v}} for k, v in search_dict.items()]
    search_query = {"query": {"bool": {"must": must_clauses}}}
    response = es.search(index=index_name, body=search_query, size=1000)

    doc_ids = [hit["_id"] for hit in response["hits"]["hits"]]

    actions = [{"_op_type": "update", "_index": index_name, "_id": doc_id, "doc": update_body} for doc_id in doc_ids]

    success_count, failed_bulk_operations = helpers.bulk(es, actions)
    if failed_bulk_operations:
        print("Errors encountered during bulk update:", failed_bulk_operations)
    else:
        print(f"Successfully updated {success_count} documents.")

    return


def saveESData(es, index, info, id=None):
    if id != None:
        response = es.index(index=index, id=id, document=info, refresh=True)

    else:
        response = es.index(index=index, document=info, refresh=True)
    return response


def convert_to_4326(epsg_code, x, y):
    # Define transformer to convert from the given EPSG code to EPSG:4326
    # Needed for saving in ES
    transformer = Transformer.from_crs(f"{epsg_code}", "EPSG:4326", always_xy=True)

    x_converted, y_converted = transformer.transform(x, y)

    return x_converted, y_converted


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


def return_crs(temp_file_path):
    ds = gdal.Open(temp_file_path)
    if ds:
        old_crs = ds.GetProjection()
        return old_crs
    else:
        return None


def is_cog(file_path):
    dataset = gdal.Open(file_path)
    tiled = dataset.GetMetadataItem("TIFFTAG_TILEWIDTH") is not None
    overviews = dataset.GetRasterBand(1).GetOverviewCount() > 0
    return tiled and overviews


def saveTifasCog(file_path, cog_path):
    ds = gdal.Open(file_path)

    tiled = ds.GetMetadataItem("TIFFTAG_TILEWIDTH") is not None
    overviews = ds.GetRasterBand(1).GetOverviewCount() > 0
    if tiled and overviews:
        logger.info("Already a cog.")
        shutil.copyfile(file_path, cog_path)
        return
    translate_options = gdal.TranslateOptions(
        format="COG",
        creationOptions=["COMPRESS=DEFLATE", "LEVEL=1"],
    )
    gdal.Translate(cog_path, ds, options=translate_options)


def concat_values(data):
    result = ""
    for item in data:
        for key, value in item.items():
            result += str(value)
    return result


def calculateCentroid(gcps, number_of_points=3):
    """
    Returns the centroid point of an array of ground control points

            Parameters:
                    a (list):A list of gcps

            Returns:
                    centroid point
    """
    # convert points to shapely points
    points = [Point(gps["x"], gps["y"]) for gps in gcps]

    # calucate avg distances
    avg_distances = []

    for point in points:
        distances = [point.distance(other) for other in points if point != other]
        avg_distances.append(np.mean(distances))

    sorted_indices = [index for index, value in sorted(enumerate(avg_distances), key=lambda x: x[1])]

    # Select the closest number_of_points to calculate centroid.
    # The reasoning is that we want to remove any outlier points that might shift the centroid into a different crs:
    lowest_indices = sorted_indices[:number_of_points]
    closest_points = [points[i] for i in lowest_indices]

    # Convert the list of Point objects to a MultiPoint object
    multi_point = MultiPoint(closest_points)

    # Compute the centroid
    centroid = multi_point.centroid
    centroid_point = Point(centroid.x, centroid.y)

    return centroid_point


def duplicates(arr):
    """
    Returns only values that have greater than one occurance

            Parameters:
                    a (list):A list of values

            Returns:
                    only values with more than one occurance
    """
    seen = set()
    dups = set()

    for num in arr:
        if num in seen:
            dups.add(num)
        seen.add(num)
    return list(dups)


def rectangleDetection(gcps, pixel_buffer):
    """
    Returns points found in rectangle shape.
    For every point it checks if there is another point in the same
    x pixel area and if there is another point the in y pixel area.
    If so that is a sign of part of a rectangle.

            Parameters:
                    a (list):A list of gcps

            Returns:
                    Points that were aligned with other points, which makes them better candidates for georeferencing.
    """
    found_gcps = []

    for i, p in enumerate(gcps):
        for i2, compare in enumerate(gcps):
            if i == i2:
                continue
            if abs(p["coll"] - compare["coll"]) < pixel_buffer:
                found_gcps.append(i2)
            if abs(p["rowb"] - compare["rowb"]) < pixel_buffer:
                found_gcps.append(i2)

    indexes_for_georeferencing = duplicates(found_gcps)
    best_4_points = [gcps[i] for i in indexes_for_georeferencing]
    return best_4_points


def generateCrsListFromPoint(centroid):
    try:
        all_crs = pyproj.database.query_crs_info(
            auth_name="EPSG",
            area_of_interest=pyproj.aoi.AreaOfInterest(
                east_lon_degree=centroid.x + 0.05,
                west_lon_degree=centroid.x - 0.05,
                south_lat_degree=centroid.y - 0.05,
                north_lat_degree=centroid.y + 0.05,
            ),
        )
        return all_crs
    except Exception:
        logging.info("Error occurred generating CRS list")
        return []


def boundsFromGCPS(gcps):
    shapely_points = [Point(p["x"], p["y"]) for p in gcps]
    multi_point = MultiPoint(shapely_points)
    west, south, east, north = multi_point.bounds  # returns (minx, miny, maxx, maxy)
    return create_boundary_polygon(south=south, west=west, north=north, east=east)


def generateCrsListFromGCPs(gcps):
    shapely_points = [Point(p["x"], p["y"]) for p in gcps]
    multi_point = MultiPoint(shapely_points)
    west, south, east, north = multi_point.bounds  # returns (minx, miny, maxx, maxy)

    all_crs = pyproj.database.query_crs_info(
        auth_name="EPSG",
        area_of_interest=pyproj.aoi.AreaOfInterest(
            east_lon_degree=east,
            west_lon_degree=west,
            south_lat_degree=south,
            north_lat_degree=north,
        ),
    )
    return all_crs


def filterCRSList(crs_list, max_projections=1):
    codes = []
    for crs in crs_list:
        # currently we are assuming NAD27 but this can change
        if crs.name.startswith("NAD27"):
            # if a utm zone. Good option
            if "/ UTM zone" in crs.name:
                codes.append(f"EPSG:{crs.code}")

            if crs.code.startswith("26"):
                codes.append(f"EPSG:{crs.code}")

    unique_codes = list(set(codes))
    return unique_codes[:max_projections]


def update_document_by_id(es, index_name, doc_id, updates):
    """Update an Elasticsearch document by its ID with the provided updates."""
    try:
        response = es.update(index=index_name, id=doc_id, body={"doc": updates}, refresh=True)
        return response
    except Exception as e:
        print(f"Error updating document: {e}")
        return None


def get_document_id_by_key_value(es, index_name, key, value):
    """Retrieve the internal _id of a document based on key value combo."""
    query = {"query": {"match": {key: value}}}
    response = es.search(index=index_name, body=query)
    # If we found a result, return its _id
    if response["hits"]["total"]["value"] > 0:
        return response["hits"]["hits"][0]["_id"]
    return None


def apply_custom_transform(geom, custom_transform):
    def affine_transform(x, y, z=None):
        x, y = custom_transform * (x, y)
        return x, y

    return transform(affine_transform, geom)


# def project_vector_(es, feature, projection_id, crs):
#     #  look up info for projection
#     proj_info = es.get(index=app_settings.polymer_projections_index, id=projection_id)
#     cog_id = proj_info['_source']['cog_id']
#     map_info = es.get(index=app_settings.maps_index, id=map_id)
#     height = map_info['_source']['height']
#     width = map_info['_source']['width']
#     gcps = []
#     for gcp in proj_info['_source']['gcps_ids']:
#         gcps.append( es.get(index=app_settings.gcps_index, id=gcp)['_source'])

#     geo_transform = cps_to_transform(gcps, height=height, to_crs=crs)
#     bounds = riot.array_bounds(height, width, geo_transform)
#     pro_transform, pro_width, pro_height = calculate_default_transform(
#             crs, crs, width, height, *tuple(bounds)
#         )
#     geom = shape(feature['geometry'])
#     transformed_geom = apply_custom_transform(geom, pro_transform)
#     return to_geojson(transformed_geom)


def inverse_geojson(geojson, image_height):

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


def updateChildFeatures(es, cog_id, new_feature_id, old_feature_id):
    response = es.search(
        index=app_settings.polymer_legend_extractions,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"cog_id": cog_id}},
                        {"match": {"parent_id": old_feature_id}},
                    ],
                    "filter": [
                        {"terms": {"category": ["legend_description"]}},
                    ],
                }
            }
        },
    )
    updates = []
    for hit in response["hits"]["hits"]:
        action = {
            "_op_type": "update",
            "_index": app_settings.polymer_legend_extractions,
            "_id": hit["_source"]["legend_id"],
            "doc": {"parent_id": new_feature_id},
        }
        updates.append(action)
    return updates


async def post_results(files, data):
    async with httpx.AsyncClient(timeout=None) as client:
        data_ = {"georef_result": data}  # Marking the part as JSON
        print(data_)
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


def get_gcp_from_cdr(gcp_id):
    endpoint = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/gcp/{gcp_id}"
    response = httpx.get(endpoint, headers=auth)
    if response.status_code == 200:
        return response.json()

    return None


def get_projections_from_cdr(cog_id):
    endpoint = f"{app_settings.cdr_endpoint_url}/v1/maps/cog/projections/{cog_id}"
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
        logging.info(f's3_key {s3_key}')
        all_files = []

        with tempfile.TemporaryDirectory() as tmpdir:
            proj_file_name = f"{s3_key.split('/')[-1]}"
            raw_path = os.path.join(tmpdir, proj_file_name)
            s3 = s3_client()
            s3.download_file(app_settings.polymer_public_bucket, s3_key, raw_path)
            pro_cog_path = os.path.join(tmpdir, proj_file_name)

            all_files.append((pro_cog_path, proj_file_name))

            result = await post_results(files=all_files, data=data)

            logging.info("Finished")


async def send_legend_extractions(cog_id):
    logging.ingo(cog_id)


import json


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


async def send_feature_results_to_cdr(data):
    await post_feature_results(data)
    return
