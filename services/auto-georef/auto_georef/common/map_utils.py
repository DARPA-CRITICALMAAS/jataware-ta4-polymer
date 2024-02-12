from logging import Logger
import logging
import pyproj
from pyproj import Transformer
import rasterio.transform as riot
import rasterio as rio
from rasterio.warp import Resampling, calculate_default_transform, reproject
from datetime import datetime
from elasticsearch import helpers
import copy
from auto_georef.settings import app_settings
import uuid
import requests
import re
from osgeo import gdal
from shapely.geometry import Point, MultiPoint
import numpy as np
import hashlib
import math
import shutil
logger: Logger = logging.getLogger(__name__)
from PIL import Image
import imagehash
from shapely.geometry import shape
from shapely.ops import transform
from shapely import to_geojson

Image.MAX_IMAGE_PIXELS = None


def hash_file_sha256(file_path):
    sha256_hash = hashlib.sha256()

    with open(file_path, "rb") as file:
        for byte_block in iter(lambda: file.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def generate_map_id(file):
    with Image.open(file) as img:
        return str(imagehash.dhash(img, hash_size=16))
    

def create_boundary_polygon(south, east, north, west):
    try:
        coordinates = [
            [west, south],  # Bottom-left
            [east, south],  # Bottom-right
            [east, north],  # Top-right
            [west, north],  # Top-left
            [west, south]   # Close the polygon
        ]
        geo_shape = {
        "type": "Polygon",
        "coordinates": [coordinates]
        }
        return geo_shape
    except Exception as e:
        logger.error(f"failed to create border: {e}")
        return None


def calculate_centroid_as_geo_shape(south:float, west:float, east:float, north:float):
    if not all(isinstance(arg, float) for arg in [south, west, east, north]):
        raise TypeError("All arguments must be of type float")

    try:

        centroid_longitude = (west + east) / 2
        centroid_latitude = (south + north) / 2
        if not math.isnan(centroid_longitude) and not math.isnan(centroid_latitude):
            return {
                "type": "point",
                "coordinates": [centroid_longitude, centroid_latitude]
            }
        else:
            return None
    except Exception as e:
        logger.error(f"failed to create centroid: {e}")
        return None
    

# es check if id exists
def document_exists(es, index_name, doc_id):
    return es.exists(index=index_name, id=doc_id)


def extract_gcps_(AGR, img):
    width, height = img.size

    cps = AGR.extract_control_points(img)
    for cp in cps:
        cp["rowb"] = height - cp["row"]
        cp["coll"] = cp["col"]
        cp['provenance'] = "jataware_extraction"
        cp['gcp_reference_id'] = None

        del cp["row"]
        del cp["col"]
        del cp["crop_r"]
        del cp["crop_c"]
    return cps


def es_search_map(es, index, map_id):
    query = {"query": {"match": {"map_id": map_id}}}
    response = es.search(index=index, body=query, size=100)
    if not response["hits"]["hits"]:
        return []
    return [x["_source"] for x in response["hits"]["hits"]]


def cps_to_transform(cps, height, to_crs):
    cps = [
        {
            "row": height - float(cp["rowb"]),
            "col": float(cp["coll"]),
            "x": float(cp["x"]),
            "y": float(cp["y"]),
            "crs": cp["crs"],
        }
        for cp in cps
    ]
    cps_p = []
    for cp in cps:
        proj = Transformer.from_crs(cp["crs"], to_crs, always_xy=True)
        x_p, y_p = proj.transform(xx=cp["x"], yy=cp["y"])
        cps_p.append(
            riot.GroundControlPoint(row=cp["row"], col=cp["col"], x=x_p, y=y_p)
        )

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


def prepare_gcps_for_es(
    gcps, map_id, extraction_model=None, extraction_model_version=None, provenance="api_endpoint"
):
    gcps_=[]
    for gcp in gcps:
        gcp_data = {
            "gcp_id": gcp["gcp_id"],
            "map_id": map_id,
            "modified": datetime.now(),
            "created": datetime.now(),
            "gcp_reference_id": gcp.get("gcp_reference_id",None),
            "provenance": gcp.get("provenance",provenance),
            "extraction_model": extraction_model,
            "extraction_model_version": extraction_model_version,
            "rowb": float(gcp["rowb"]),
            "coll": float(gcp["coll"]),
            "x": float(gcp["x"]),
            "y": float(gcp["y"]),
            "crs": gcp["crs"],
            "confidence":None
        }
        gcps_.append(gcp_data)
    return gcps_
        


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

    actions = [
        {"_op_type": "update", "_index": index_name, "_id": doc_id, "doc": update_body}
        for doc_id in doc_ids
    ]

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


def updateGCPs(es, map_id, gcps):
    # get current gcps for this map.
    query_body = {"query": {"term": {"map_id": map_id}}}
    response = es.search(index=app_settings.gcps_index, body=query_body, size=1000)
    all_gcps = {}
    for hit in response["hits"]["hits"]:
        all_gcps[hit["_source"]["gcp_id"]] = hit["_source"]

    # now loop over each point that was used in projection
    # see if that gcp_id is already accounted for,
    # if all the values are the same we leave it alone just save id wiht proj_info index
    # If values are different at all or "manual" found in gcp_id,
    #  create new id and save new point with updated values

    gcp_ids = []
    new_gcps = []
    for gcp in gcps:            
        new_gcp = copy.deepcopy(gcp)

        if gcp["gcp_id"] in all_gcps.keys():
            
            if compare_dicts(
                gcp, all_gcps[gcp["gcp_id"]], ["x", "y", "rowb", "coll", "crs"]
            ):
                print("Point has stayed the same")
                gcp_ids.append(gcp["gcp_id"])
                continue
            
            new_gcp['gcp_reference_id']=new_gcp.get("gcp_id",None)
        

        print("New point being created/saved")
        
        new_gcp["gcp_id"] = uuid.uuid4()
        gcp_ids.append(new_gcp["gcp_id"])
        new_gcps.append(new_gcp)

    gcps_ =  prepare_gcps_for_es(gcps=new_gcps, map_id=map_id)
    for gcp in gcps_:
        saveESData(
            es=es, 
            index=app_settings.gcps_index,
            info=gcp,
            id=gcp['gcp_id']
        )
    return gcp_ids


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

    response = requests.post(endpoint, headers=headers, json=data)

    if response.status_code == 200:
        choices = response.json()["choices"]
        print(choices)
        first_message = choices[0]["message"]["content"]
        matches = re.findall(r"EPSG:\d+", first_message)

        return {"matches": matches, "reasoning": first_message}
    else:
        raise Exception(
            f"API call failed with status code {response.status_code}: {response.text}"
        )


def return_crs(temp_file_path):
    ds = gdal.Open(temp_file_path)
    if ds:
        old_crs = ds.GetProjection()
        return old_crs
    else:
        return None


def is_cog(file_path):
    dataset = gdal.Open(file_path)
    tiled = dataset.GetMetadataItem('TIFFTAG_TILEWIDTH') is not None
    overviews = dataset.GetRasterBand(1).GetOverviewCount() > 0
    return tiled and overviews


def saveTifasCog(file_path, cog_path):
    ds = gdal.Open(file_path)
    
    tiled = ds.GetMetadataItem('TIFFTAG_TILEWIDTH') is not None
    overviews = ds.GetRasterBand(1).GetOverviewCount() > 0
    if tiled and overviews:
        logger.info('Already a cog.')
        shutil.copyfile(file_path, cog_path)
        return
    translate_options = gdal.TranslateOptions(
        format="COG", creationOptions=["COMPRESS=LZW"]
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

    sorted_indices = [
        index for index, value in sorted(enumerate(avg_distances), key=lambda x: x[1])
    ]

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
    except Exception as e:
        logging.info('Error occurred generating CRS list')
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
        response = es.update(
            index=index_name, 
            id=doc_id,
            body={
                "doc": updates
            },
            refresh=True
        )
        return response
    except Exception as e:
        print(f"Error updating document: {e}")
        return None


def get_document_id_by_key_value( es,index_name, key, value):
    """Retrieve the internal _id of a document based on key value combo."""
    query = {
        "query": {
            "match": {
                key: value
            }
        }
    }
    response = es.search(index=index_name, body=query)
    # If we found a result, return its _id
    if response['hits']['total']['value'] > 0:
        return response['hits']['hits'][0]['_id']
    return None
    
def apply_custom_transform(geom, custom_transform):
    def affine_transform(x, y, z=None):
        x, y = custom_transform * (x, y)
        return x, y
    
    return transform(affine_transform, geom)

def project_vector_(es, feature, projection_id, crs):
    #  look up info for projection
    proj_info = es.get(index=app_settings.proj_files_index, id=projection_id)
    map_id = proj_info['_source']['map_id']
    map_info = es.get(index=app_settings.maps_index, id=map_id)
    height = map_info['_source']['height']
    width = map_info['_source']['width']
    gcps = []
    for gcp in proj_info['_source']['gcps_ids']:
        gcps.append( es.get(index=app_settings.gcps_index, id=gcp)['_source'])

    geo_transform = cps_to_transform(gcps, height=height, to_crs=crs)
    bounds = riot.array_bounds(height, width, geo_transform)
    pro_transform, pro_width, pro_height = calculate_default_transform(
            crs, crs, width, height, *tuple(bounds)
        )
    geom = shape(feature['geometry'])
    transformed_geom = apply_custom_transform(geom, pro_transform)
    return to_geojson(transformed_geom)