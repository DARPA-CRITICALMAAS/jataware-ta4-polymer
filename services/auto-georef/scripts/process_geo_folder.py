import argparse
import os
import xml.etree.ElementTree as ET
from PIL import Image
import re
from datetime import datetime
import imagehash
import logging
import uuid
from elasticsearch import Elasticsearch
from osgeo import gdal
import pyproj
from pyproj import Transformer
import shutil
import boto3
import hashlib
import rasterio.transform as riot
import rasterio as rio
from rasterio.warp import Resampling, calculate_default_transform, reproject
from wand.image import Image as wandImage

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = None
    open_ai_key: str = None
    s3_tiles_bucket: str = "common.polymer.rocks"
    s3_tiles_prefix: str = "tiles"
    s3_tiles_prefix_v2: str = "cogs"
    es_endpoint_url: str = "http://localhost:9200/"
    maps_index: str = "maps2"
    gcps_index: str = "gcps2"
    epsgs_index: str = "epsgs2"
    proj_files_index: str = "proj_files2"


    class Config:
        case_sensitive = False
        env_prefix = "autogeoref_"
        env_file = "../.env"
        env_file_encoding = "utf-8"


app_settings = Settings()

es = Elasticsearch(
    [
        app_settings.es_endpoint_url,
    ]
)
AUTOGEOREF_S3_ENDPOINT_URL = app_settings.s3_endpoint_url
s3_endpoint_url = AUTOGEOREF_S3_ENDPOINT_URL
s3_tiles_bucket: str = app_settings.s3_tiles_bucket
s3_tiles_v2 = app_settings.s3_tiles_prefix_v2


formatter = logging.Formatter(
    "%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
)
file_logger = logging.getLogger("file_logger")
file_logger.setLevel(logging.INFO)
logging_count = uuid.uuid4()
file_handler = logging.FileHandler("logs/process_geo_folder.log", mode="a")
file_handler.setFormatter(formatter)
file_logger.addHandler(file_handler)


def concat_values(data):
    result = ""
    for item in data:
        for key, value in item.items():
            result += str(value)
    return result


def prepare_gcps_for_es(
    gcps,
    map_id,
    extraction_model=None,
    extraction_model_version=None,
    provenance="api_endpoint",
):
    gcps_ = []
    for gcp in gcps:
        gcp_data = {
            "gcp_id": gcp["gcp_id"],
            "map_id": map_id,
            "modified": datetime.now(),
            "created": datetime.now(),
            "provenance": provenance,
            "extraction_model": extraction_model,
            "extraction_model_version": extraction_model_version,
            "rowb": gcp.get("rowb", None),
            "coll": gcp.get("coll", None),
            "x": gcp.get("x", None),
            "y": gcp.get("y", None),
            "crs": gcp.get("crs", None),
            "confidence": None,
        }
        gcps_.append(gcp_data)
    return gcps_


def convert_to_GCS(from_epsg_code, to_epsg_code, x, y):
    # Define transformer to convert from the given EPSG code to EPSG:4326
    # Needed for saving in ES
    transformer = Transformer.from_crs(from_epsg_code, to_epsg_code, always_xy=True)

    x_converted, y_converted = transformer.transform(x, y)

    return x_converted, y_converted


def get_gcps_pcs_from_geotiff(file_path):
    # Open the GeoTIFF file
    ds = gdal.Open(file_path)

    if ds is None:
        raise IOError("Could not open the file.")

    # Get the GCPs
    gcps = ds.GetGCPs()
    gcp_proj = ds.GetGCPProjection()

    gcs_crs, pcs_crs = extract_epsg_from_crs({"WKT": gcp_proj})

    gcps_info = []
    for gcp in gcps:
        x, y = convert_to_GCS(
            from_epsg_code=pcs_crs, to_epsg_code=gcs_crs, x=gcp.GCPX, y=gcp.GCPY
        )
        # Extract GCP information: ID, pixel location, and geographical coordinates
        info = {
            "id": gcp.Id,
            "coll": gcp.GCPPixel,
            "rowt": gcp.GCPLine,
            "x": x,
            "y": y,
            "crs": gcs_crs,
        }
        gcps_info.append(info)

    return gcps_info, pcs_crs


def get_tif_dimensions_and_id(file_path):
    with Image.open(file_path) as img:
        _, height = img.size
        hash = str(imagehash.dhash(img, hash_size=16))
    return height, hash


def extract_epsg(wkt):
    matchs = re.findall(r'AUTHORITY\["EPSG","(\d+)"\]', wkt)

    if matchs:
        return matchs[-1]
    else:
        return None


def extract_epsg_from_crs(crs_info):
    # Mapping of datum names to EPSG codes
    datum_to_epsg = {
        "D_North_American_1927": "EPSG:4267",
        "North_American_Datum_1927": "EPSG:4267",
        "NAD27": "EPSG:4267",
        "WGS_1984": "EPSG:4326",
        "World_Geodetic_System_1984": "EPSG:4326",
        "WGS 84": "EPSG:4326",
    }
    gps_crs = None
    if "WKT" in crs_info:
        wkt = crs_info["WKT"]

        # Search for the DATUM pattern
        match = re.search(r'DATUM\["([^"]+)"', wkt)
        if match:
            datum_name = match.group(1)
            if datum_name in datum_to_epsg:
                gps_crs = datum_to_epsg[datum_name]
            else:
                gps_crs = "EPSG:4267"
        try:
            code = extract_epsg(wkt=wkt)
            if code is not None:
                pcs_crs = f"EPSG:{code}"
            else:
                pcs_crs = None
        except Exception as e:
            file_logger.info(f"eeeee {e}")
            pcs_crs = None

    return gps_crs, pcs_crs


def parse_xml(file_path):
    tree = ET.parse(file_path)
    root = tree.getroot()

    spatial_ref = root.find(".//SpatialReference")
    crs_info = {}
    if spatial_ref is not None:
        for child in spatial_ref:
            if child.tag == "WKT":
                crs_info["WKT"] = child.text
            elif child.tag == "WKID":
                crs_info["WKID"] = child.text

    polynomial = find_polynomial_order(root)
    if polynomial is not None:
        polynomial_str = f"polynomial_{polynomial}"

    return crs_info, polynomial_str


def find_polynomial_order(root):
    polynomial_order_elem = root.find(".//PolynomialOrder")
    if polynomial_order_elem is not None:
        return polynomial_order_elem.text
    else:
        return None


def update_gcps(gcps, map_id, height):
    for gcp in gcps:
        # gcp['crs'] = gcp_crs
        gcp["rowb"] = height - gcp["rowt"]
        gcp["gcp_id"] = f"{map_id}{gcp['y']}{gcp['x']}{gcp['crs']}"
        del gcp["rowt"]
    return gcps


def generate_map_id(file):
    with Image.open(file) as img:
        return str(imagehash.dhash(img, hash_size=16))


def saveESData(es, index, info, id=None):
    if id != None:
        response = es.index(index=index, id=id, document=info, refresh=True)
    else:
        response = es.index(index=index, document=info, refresh=True)
    return response


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


def strip_tif(file_path, output_path):
    with open(file_path, "rb") as file:
        image_blob = file.read()
    with wandImage(blob=image_blob) as img:
        img.strip()
        img.save(filename=output_path)


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


def saveTifasCog(file_path, cog_path):
    output_path = cog_path.split(".cog.tif")[0] + ".tif"
    file_logger.info(f"file_path {file_path}, {output_path}")
    strip_tif(file_path=file_path, output_path=output_path)

    file_logger.info(file_path)
    ds = gdal.Open(output_path)

    tiled = ds.GetMetadataItem("TIFFTAG_TILEWIDTH") is not None
    overviews = ds.GetRasterBand(1).GetOverviewCount() > 0
    if tiled and overviews:
        file_logger.info("Already a cog...............................")
        shutil.copyfile(file_path, cog_path)
        return
    translate_options = gdal.TranslateOptions(
        format="COG", creationOptions=["COMPRESS=LZW"]
    )
    gdal.Translate(cog_path, ds, options=translate_options)


def s3_client():
    s3 = boto3.client("s3", endpoint_url=s3_endpoint_url, verify=False)
    return s3


def upload_s3_file(s3_key, fp):
    s3 = s3_client()
    s3.upload_file(fp, s3_tiles_bucket, s3_key)


def update_document_by_id(es, index_name, doc_id, updates):
    """Update an Elasticsearch document by its ID with the provided updates."""
    try:
        response = es.update(
            index=index_name, id=doc_id, body={"doc": updates}, refresh=True
        )
        return response
    except Exception as e:
        print(f"Error updating document: {e}")
        return None


def main(folder, map_path):
    map_name = map_path.split("/")[-1].replace(".zip", "")
    if not os.path.exists(folder):
        return

    if not os.path.isdir(folder):
        return

    # List all files in the directory
    print(f"Files in '{folder}':")
    for file in os.listdir(folder):
        print(
            f"###############################{file}###################################"
        )
        file_path = os.path.join(folder, file)

        if os.path.isfile(file_path):
            if file == "README.txt":
                continue

            if file.endswith(".txt"):
                continue

            if file.endswith(".xml"):
                crs_info, polynomial = parse_xml(file_path)

            if file.endswith(".tif"):
                height, map_id = get_tif_dimensions_and_id(file_path)

                gcps_info, pcs_crs = get_gcps_pcs_from_geotiff(file_path=file_path)

                cog_path = (
                    "server_data/zip/"
                    + folder.split("/")[-1].strip()
                    + "/"
                    + file.split(".tif")[0]
                    + ".cog.tif"
                )
                # convert tif to cog
                saveTifasCog(file_path=file_path, cog_path=cog_path)

    epsg_id = pcs_crs + map_id

    saveESData(
        es=es,
        index=app_settings.epsgs_index,
        info={
            "epsg_id": epsg_id,
            "map_id": map_id,
            "epsg_code": pcs_crs,
            "created": datetime.now(),
            "provenance": "bulk_ngmdb_update",
            "extraction_model": None,
            "extraction_model_version": None,
        },
        id=epsg_id,
    )

    gcps_final = update_gcps(gcps_info, map_id, height)

    geo_transform = cps_to_transform(gcps_final, height=height, to_crs=pcs_crs)

    pro_cog_path = (
        "server_data/zip/"
        + folder.split("/")[-1].strip()
        + "/"
        + file.split(".tif")[0]
        + "pro.cog.tif"
    )

    project_(cog_path, pro_cog_path, geo_transform, pcs_crs)

    gcps_ = prepare_gcps_for_es(
        gcps=gcps_final,
        map_id=map_id,
        extraction_model=None,
        extraction_model_version=None,
        provenance="bulk_ngmdb_update",
    )

    sorted_cps = sorted(
        gcps_final, key=lambda item: (item["rowb"], item["coll"], item["x"])
    )

    proj_id = hashlib.sha256((pcs_crs + concat_values(sorted_cps)).encode()).hexdigest()
    s3_pro_key = f"{s3_tiles_v2}/{map_id}/{map_id}_{proj_id}.pro.cog.tif"
    # save cog file to s3
    upload_s3_file(s3_pro_key, pro_cog_path)
    saveESData(
        es=es,
        index=app_settings.proj_files_index,
        info={
            "proj_id": proj_id,
            "map_id": map_id,  # map id
            "epsg_code": pcs_crs,  # epsg_code used for reprojection
            "epsg_id": epsg_id,  # epsg_id used which is the internal id in the epsg index
            "created": datetime.now(),
            "source": f"{s3_endpoint_url}/{s3_tiles_bucket}/{s3_pro_key}",
            "gcps_ids": [gcp["gcp_id"] for gcp in gcps_],
            "status": "created",
            "provenance": "bulk_ngmdb_update",
            "transformation": "polynomial_1",
        },
        id=proj_id,
    )

    try:
        update_document_by_id(
            es=es,
            index_name=app_settings.maps_index,
            doc_id=map_id,
            updates={
                "modified": datetime.now(),
                "georeferenced":True,
                "original_wkt": crs_info.get("WKT", None),
                "original_transformation": polynomial,
                "source_url": f"https://ngmdb.usgs.gov/ngm-bin/pdp/download.pl?q={folder.split('/')[-1].strip()}_5",
            },
        )
    except Exception as e:
        file_logger.info(f"Failed to save map info {map_name}, {map_id}")

    try:
        for gcp_data in gcps_:
            saveESData(es=es, index=app_settings.gcps_index, info=gcp_data, id=gcp_data["gcp_id"])
    except Exception as e:
        file_logger.info(f"Failed to save Point info {map_name}, {map_id}, {gcp_data}")


if __name__ == "__main__":
    # This script is suppose to loop over ngmdb file that are georeferenced
    # We already have the new maps id's saved to elasticsearch from the bulk_georef2 file
    # This will loop over georeferenced tif files convert them to cogs and save them as a projection file
    # Also we will save GCPS and update the map info based on this information

    parser = argparse.ArgumentParser(description="Process a folder.")
    parser.add_argument("--folder", required=True, help="The folder to process.")
    parser.add_argument("--map_name", required=True)
    # Parse arguments
    args = parser.parse_args()
    print(f"args, {args}")
    # Run main function
    file_logger.info(f"Starting {args.map_name}")
    if args.map_name == "":
        print("Map name not found")
    else:
        main(args.folder, args.map_name)
