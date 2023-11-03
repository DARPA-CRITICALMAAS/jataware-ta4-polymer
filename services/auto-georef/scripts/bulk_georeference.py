import geopandas as gpd
import json
import io
from datetime import datetime
from elasticsearch import Elasticsearch
import utm
import boto3
from time import perf_counter
from pathlib import Path
from logging import Logger
import logging
from PIL import Image
from shapely.geometry import Point, MultiPoint
import numpy as np
import pyproj
from pyproj import Transformer
import uuid
import tempfile
import os
import rasterio as rio
import rasterio.transform as riot
from rasterio.warp import Resampling, calculate_default_transform, reproject
import random
from icecream import ic
import hashlib

from georef.autogeoreferencer import AutoGeoreferencer

AGR = AutoGeoreferencer(model_root="../auto_georef/models")

logger: Logger = logging.getLogger(__name__)

file_logger = logging.getLogger('file_logger')
file_logger.setLevel(logging.INFO)
logging_count = uuid.uuid4()
ic(logging_count)
file_handler = logging.FileHandler('maps_finished_'+str(logging_count)+'.log')
file_logger.addHandler(file_handler)

AUTOGEOREF_S3_ENDPOINT_URL = "http://s3.amazonaws.com"
s3_tiles_bucket: str = "common.polymer.rocks"
s3_tiles_prefix: str = "tiles"

es = Elasticsearch(["elastic.nyl.on:9200"])
def time_since(logger, msg, start):
    fin = perf_counter() - start
    logger.debug(f"{msg} - completed in %.8f", fin)


def update_document_by_id(index_name, doc_id, updates):
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


def get_document_id_by_key_value( index_name, key, value):
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
    

def s3_client():
    s3 = boto3.client("s3", endpoint_url=AUTOGEOREF_S3_ENDPOINT_URL, verify=False)
    return s3


def upload_s3_file(s3_key, fp):
    s3 = s3_client()
    s3.upload_file(fp, s3_tiles_bucket, s3_key)


def load_tiff(s3_key):
    s3 = s3_client()
    img = s3.get_object(Bucket=s3_tiles_bucket, Key=s3_key)
    img_data = img.get("Body").read()
    return Image.open(io.BytesIO(img_data))


def upload_s3_bytes(s3_key, xs: bytes):
    s3 = s3_client()
    s3.put_object(Body=xs, Bucket=s3_tiles_bucket, Key=s3_key)


def upload_s3_str(s3_key, sz):
    buff = io.BytesIO()
    buff.write(sz.encode())
    upload_s3_bytes(s3_key, buff.getvalue())


#  recreate maps endpoint
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


def save_gcps_in_es(gcps, map_id):
    for gcp in gcps:
        gcp_data={
            "gcp_id": gcp['gcp_id'],             
            "map_id": map_id,                  
            "modified": datetime.now(),            
            "created": datetime.now(),                 
            "provenance":"AI",           
            "extraction_model":"jataware_gcp_extractor",           
            "extraction_model_version":"0.0.1",
            "rowb": gcp['rowb'],
            "coll": gcp['coll'],
            "x": gcp['x'],
            "y": gcp['y'],
            "crs": gcp['crs']  
        }
        try:
            response = es.index(index='gcps',id= gcp['gcp_id'], document=gcp_data, refresh=True)
            ic(f"save_gcps_gcps, {map_id}", gcp_data)

            ic(response)
        except Exception as e:
            print(f"Error indexing map data: {e}")


# recreate point extraction
def extract_gcps(map_name, map_id, img, height):
    
    start_autogeoref = perf_counter()

    cps = AGR.extract_control_points(img)

    if len(cps) < 1:
        return []
    for _, cp in enumerate(cps):
        cp["rowb"] = round(height - cp["row"], 10)
        cp["coll"] = round(cp["col"], 10)
        cp["x"] = round(cp['x'], 10)
        cp["y"] = round(cp['y'], 10)
        cp['gcp_id'] = f"{cp['y']}{cp['x']}{cp['coll']}{cp['rowb']}{cp['crs']}"

        del cp["row"]
        del cp["col"]
        del cp["crop_r"]
        del cp["crop_c"]
        logger.debug(cp)

    save_gcps_in_es(cps, map_id)

    time_since(logger, "autogeoref gcps", start_autogeoref)

    return cps


def calculateCentroid(gcps):
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

    # Select the closest 3 points to calculate centroid.
    # The reasoning is that we want to remove any outlier points that might shift the centroid into a different crs:
    lowest_3_indices = sorted_indices[:3]
    closest_3_points = [points[i] for i in lowest_3_indices]

    # Convert the list of Point objects to a MultiPoint object
    multi_point = MultiPoint(closest_3_points)

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

def most_left_points(gcps):
    #coll
    
    gcps_=gcps.copy()
    while gcps_>4:
        remove_= max([gcp['coll'] for gcp in gcps_])
        for i,gcp in enumerate(gcps_):
            if gcp['coll']==remove_:
                gcps_.pop(i)
    return gcps_


def most_left_points(gcps):
    # If more than 4 points found and we didn't find 4 in a rectangle take most left 4
    gcps_=gcps.copy()
    while len(gcps_)>4:
        remove_= max([gcp['coll'] for gcp in gcps_])
        for i,gcp in enumerate(gcps_):
            if gcp['coll']==remove_:
                gcps_.pop(i)
    return gcps_

def most_top_points(gcps):
    # If more than 4 points found and we didn't find 4 in a rectangle take most top 4

    gcps_=gcps.copy()
    while len(gcps_)>4:
        remove_= min([gcp['rowb'] for gcp in gcps_])
        for i,gcp in enumerate(gcps_):
            if gcp['rowb']==remove_:
                gcps_.pop(i)
    return gcps_


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


def generateCrsList(centroid):
    # all_crs = pyproj.database.query_crs_info(
    #     auth_name="EPSG",
    #     area_of_interest=pyproj.aoi.AreaOfInterest(
    #         east_lon_degree=centroid.x + 0.05,
    #         west_lon_degree=centroid.x - 0.05,
    #         south_lat_degree=centroid.y - 0.05,
    #         north_lat_degree=centroid.y + 0.05,
    #     ),
    # )
    codes = ["EPSG:4267", "EPSG:4326"]
    # for crs in all_crs:
    #     if "WGS 84 / UTM zone" in crs.name or "NAD27 / UTM zone" in crs.name:
    #         codes.append(f"EPSG:{crs.code}")
    return codes

def concat_values(data):
    result = ''
    for item in data:
        for key, value in item.items():
            result += str(value)
    return result

def project(
    map_id, map_name, gcps, CRSs, height
):

    s3_key = f"{s3_tiles_prefix}/{map_name}/{map_name}.cog.tif"
    # s3_pro_key = f"{s3_tiles_prefix}/{map_id}/{map_id}.pro.cog.tif"

    start_proj = perf_counter()

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = os.path.join(tmpdir, f"{map_name}.cog.tif")

        start_s3_load = perf_counter()
        
        s3 = s3_client()
        s3.download_file(s3_tiles_bucket, s3_key, raw_path)

        time_since(logger, "proj file loaded", start_s3_load)

        start_transform = perf_counter()
        
        cps = [
            {
                "row": height - float(cp["rowb"]),
                "col": float(cp["coll"]),
                "x": float(cp["x"]),
                "y": float(cp["y"]),
                "crs": cp["crs"],
            }
            for cp in gcps
        ]

        for crs_id, crs in CRSs:
            # create proj_id hash
            # sort gcps by x, y?
            # add gcps ids to proj_id and proj_crs code
            sorted_cps = sorted(gcps, key=lambda item: (item['rowb'], item['coll'], item['x'] ))

            proj_id = hashlib.sha256((crs_id + concat_values(sorted_cps)).encode()).hexdigest()
            ic(proj_id)
            pro_cog_path = os.path.join(tmpdir, f"{map_name}_{proj_id}.pro.cog.tif")
            ic(pro_cog_path)
            cps_p = []
            for cp in cps:
                proj = Transformer.from_crs(cp["crs"], crs, always_xy=True)
                x_p, y_p = proj.transform(xx=cp["x"], yy=cp["y"])
                cps_p.append(
                    riot.GroundControlPoint(row=cp["row"], col=cp["col"], x=x_p, y=y_p)
                )

            geo_transform = riot.from_gcps(cps_p)

            time_since(logger, "geo_transform loaded", start_transform)

            start_reproj = perf_counter()

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

            time_since(logger, "reprojection file created", start_reproj)
            s3_pro_key = f"{s3_tiles_prefix}/{map_name}/{map_name}_{proj_id}.pro.cog.tif"

            upload_s3_file(s3_pro_key, pro_cog_path)

            saveESData("proj_files", proj_id, {
                "proj_id":   proj_id,
                "map_id":    map_id,            # map id
                "epsg_code": crs,               # epsg_code used for reprojection
                "epsg_id":   crs_id,            # epsg_id used which is the internal id in the epsg index
                "created":   datetime.now(),
                "source":    f"{AUTOGEOREF_S3_ENDPOINT_URL}/{s3_tiles_bucket}/{s3_pro_key}",
                "gcps_ids":  [gcp['gcp_id'] for gcp in gcps],
                "status":    "created"
            })

    time_since(logger, "total projection took", start_proj)

    return {"pro_cog_path": s3_pro_key}


def saveESData(index,id, info):
    try:
        response = es.index(index=index,id=id, document=info, refresh=True)
        return response
    except Exception as e:
        print(f"Error indexing map data: {e}")
        return None


if __name__ == "__main__":

    maps = maps()["maps"]
    print("started")
    # loop over maps
    for map in maps[4900:5000]:
        try:
            ic("starting process", map)
            map_id = map
            #  read in map
            s3_key = f"{s3_tiles_prefix}/{map}/{map}.cog.tif"
            logger.debug("extract_gcps - loading: %s", s3_key)
            img = load_tiff(s3_key)

            width, height = img.size
            logger.debug("w: %s, h: %s", width, height)

            gcps = extract_gcps(map, map_id, img, height)
            if len(gcps) < 4:
                ic("Failed to find enough gcps")

                saveESData("maps",map_id,{
                    "map_id":map_id,
                    "map_name":map,
                    "height":height,
                    "width":width,
                    "finished_proj_id":None,
                    "georeferenced":False,
                    "validated":False,
                    "modified":datetime.now(),
                    "created":datetime.now(),
                    "finished":None,
                    "source":f"{AUTOGEOREF_S3_ENDPOINT_URL}/{s3_tiles_bucket}/{s3_tiles_prefix}/{map}/{map}.cog.tif"
                })
                continue
            # calculate centroid
            centroid_point = calculateCentroid(gcps)
            crs_list = generateCrsList(centroid_point)

            # find best 4 points to use for georeferencing
            # will be removed when we have a real TA1 system
            best_4_points = rectangleDetection(gcps=gcps, pixel_buffer=250)

            # save epsg codes for map
            crs_list_and_id=[]
            for crs in crs_list:
                crs_list_and_id.append((crs, crs))
                saveESData("epsgs",crs+"bulk_ingest",{
                    "epsg_id": crs ,
                    "map_id": map_id,                   
                    "epsg_code": crs,               
                    "created": datetime.now(),                  
                    "provenance":"bulk_ingest",                 
                    "extraction_model":None,          
                    "extraction_model_version":None   
                })

            if len(best_4_points) == 4:
                ic(f"Projecting map with best 4 gcps: {map}, Points {best_4_points}")

                # fix_gcps(map_id=map, gcps=best_4_points)
                
                project(map_id= map_id,map_name=map, gcps= best_4_points, CRSs= crs_list_and_id, height= height)


            else:
                ic(f"Projecting map with all gcps: {map}, Points {gcps}")
                most_left_points_ = most_left_points(gcps=gcps)

                most_top_points_ = most_top_points(gcps=gcps)

                project(map_id= map_id,map_name=map, gcps= most_top_points_, CRSs= crs_list_and_id, height= height)
                project(map_id= map_id,map_name=map, gcps= most_left_points_, CRSs= crs_list_and_id, height= height)

            # save map info
            saveESData("maps",map_id,{
                    "map_id":map_id,
                    "map_name":map,
                    "height":height,
                    "width":width,
                    "finished_proj_id":None,
                    "georeferenced":True,
                    "validated":False,
                    "modified":datetime.now(),
                    "created":datetime.now(),
                    "finished":None,
                    "source":f"{AUTOGEOREF_S3_ENDPOINT_URL}/{s3_tiles_bucket}/{s3_tiles_prefix}/{map}/{map}.cog.tif"
                })
            file_logger.info(map_id)
        except Exception as e:
            file_logger.info("failed: "+ map_id)
        
        