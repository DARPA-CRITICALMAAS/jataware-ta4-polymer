from logging import Logger
import logging
import pyproj
from pyproj import Transformer
import rasterio.transform as riot
import rasterio as rio
from rasterio.warp import Resampling, calculate_default_transform, reproject
from datetime import datetime
from jataware_georef.settings import app_settings
from PIL import Image
from osgeo import gdal
from shapely.geometry import Point, MultiPoint
import shutil

logger: Logger = logging.getLogger(__name__)


Image.MAX_IMAGE_PIXELS = None


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


def convert_to_4326(epsg_code, x, y):
    # Define transformer to convert from the given EPSG code to EPSG:4326
    # Needed for saving in ES
    transformer = Transformer.from_crs(f"{epsg_code}", "EPSG:4326", always_xy=True)

    x_converted, y_converted = transformer.transform(x, y)

    return x_converted, y_converted



def return_crs(temp_file_path):
    ds = gdal.Open(temp_file_path)
    if ds:
        old_crs = ds.GetProjection()
        return old_crs
    else:
        return None


def concat_values(data):
    result = ""
    for item in data:
        for key, value in item.items():
            result += str(value)
    return result


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



def inverse_geojson(geojson, image_height):

    geom_type = geojson['type']

    def transform_coord(coord):
        return [coord[0], image_height - coord[1]]

    if geom_type == 'Point':
        geojson['coordinates'] = transform_coord(geojson['coordinates'])
    elif geom_type in ['LineString', 'MultiPoint']:
        geojson['coordinates'] = [transform_coord(coord) for coord in geojson['coordinates']]
    elif geom_type in ['Polygon', 'MultiLineString']:
        geojson['coordinates'] = [[transform_coord(coord) for coord in ring] for ring in geojson['coordinates']]
    elif geom_type == 'MultiPolygon':
        geojson['coordinates'] = [[[transform_coord(coord) for coord in ring] for ring in polygon] for polygon in geojson['coordinates']]
    elif geom_type == 'GeometryCollection':
        for geometry in geojson['geometries']:
            inverse_geojson(geometry, image_height)
    else:
        raise ValueError(f"Unsupported geometry type: {geom_type}")
    return geojson