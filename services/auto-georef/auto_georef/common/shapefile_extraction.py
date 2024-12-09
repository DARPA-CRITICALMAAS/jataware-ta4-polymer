import json
import logging
import os
import zipfile
from logging import Logger

import geopandas as gpd
import pandas as pd
import rasterio.transform as riot
from fastapi import HTTPException
from pyproj import Transformer
from shapely import to_geojson
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, Polygon

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

required_column_names = {
    "point": ["DIP", "DIP_DIRECT", "ABBRV", "DESCR"],
    "line": ["ABBRV", "DESCR", "DASH_PATT", "SYMBOL"],
    "polygon": ["ABBRV", "DESCR", "PATTERN", "COLOR", "MU_TEXT", "MU_B_AGE", "MU_LITH", "MU_T_AGE"],
    "required": ["LABEL"],
}


def unzip_file(zip_file_path, extract_to):
    if not os.path.exists(extract_to):
        os.makedirs(extract_to)

    with zipfile.ZipFile(zip_file_path, "r") as zip_ref:
        zip_ref.extractall(extract_to)
        logger.info(f"Extracted all files to {extract_to}")


def walk_shp_prj_files(extracted_folder):
    shapefile_paths = []

    for dirpath, dirnames, filenames in os.walk(extracted_folder):
        for filename in filenames:
            if filename.endswith(".shp"):
                shp_path = os.path.join(dirpath, filename)
                prj_path = os.path.join(dirpath, filename.split(".shp")[0] + ".prj")

                if os.path.exists(prj_path):
                    shapefile_paths.append(shp_path)
                else:
                    raise HTTPException(status_code=400, detail=f"Failed to find associated prj file with {filename}")
    return shapefile_paths


def load_shapefiles(shapefiles):
    geodataframes = []
    target_crs = ""
    if shapefiles:
        gdf_crs = gpd.read_file(shapefiles[0])
        target_crs = gdf_crs.crs
    else:
        raise ValueError(f"Shapefiles not found.")

    if not target_crs:
        raise ValueError(f"Shapefile {shp_file} does not have a CRS. All shapefiles must have a valid CRS.")

    for shp_file in shapefiles:
        gdf = gpd.read_file(shp_file)

        if gdf.crs is None:
            raise ValueError(f"Shapefile {shp_file} does not have a CRS. All shapefiles must have a valid CRS.")

        if gdf.crs != target_crs:
            logger.info(f"Reprojecting {shp_file} from {gdf.crs} to {target_crs}")
            gdf = gdf.to_crs(target_crs)  # Reproject to the target CRS
        gdf["geometry_type"] = gdf.geometry.geom_type

        geodataframes.append(gdf)

    if geodataframes:
        combined_gdf = pd.concat(geodataframes, ignore_index=True, sort=True)
        point_gdf = combined_gdf[combined_gdf.geometry_type == "Point"]
        linestring_gdf = combined_gdf[combined_gdf.geometry_type == "LineString"]
        polygon_gdf = combined_gdf[combined_gdf.geometry_type == "Polygon"]

        point_gdf = point_gdf if not point_gdf.empty else None
        linestring_gdf = linestring_gdf if not linestring_gdf.empty else None
        polygon_gdf = polygon_gdf if not polygon_gdf.empty else None

        return point_gdf, linestring_gdf, polygon_gdf, target_crs
    else:
        logger.info("No shapefiles found in the zip.")
        return None, None, None, None


def validate_columns(columns, feature_type, df):
    required_columns = columns["required"]
    df_columns = [x for x in df.columns]
    for required in required_columns:
        if required not in df_columns:
            raise ValueError(
                f"A {feature_type} shapefile does not have a {required} column. All {feature_type} shapefiles must have that column in the attribute table."
            )
    recommended_columns = columns[feature_type]
    for rec in recommended_columns:
        if rec not in df_columns:
            logger.error(
                f"A {feature_type} shapefile does not have a {rec} column. All {feature_type} shapefiles should have that column in the attribute table, but not required."
            )
    has_null_or_empty = df["LABEL"].isnull() | (df["LABEL"] == "")

    # If you need to know if any of these exist
    if has_null_or_empty.any():
        raise ValueError(
                f"A {feature_type} does not have a LABEL column value"
            )



def apply_transform_to_gdf(gdf, transform):
    inverse_transform = ~transform

    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: affine_transform(
            geom,
            [
                inverse_transform.a,
                inverse_transform.b,
                inverse_transform.d,
                inverse_transform.e,
                inverse_transform.xoff,
                inverse_transform.yoff,
            ],
        )
    )

    return gdf


def cps_to_transform(cps, to_crs):
    cps_p = []
    for cp in cps:
        proj = Transformer.from_crs(cp["crs"], to_crs, always_xy=True)
        x_p, y_p = proj.transform(xx=float(cp["longitude"]), yy=float(cp["latitude"]))
        cps_p.append(riot.GroundControlPoint(row=cp["rows_from_top"], col=cp["columns_from_left"], x=x_p, y=y_p))

    return riot.from_gcps(cps_p)


def get_transform(projection):
    crs = projection.get("crs")
    geo_transform = cps_to_transform(projection.get("gcps", []), to_crs=crs)
    return geo_transform


def fill_column_na(column, fill_value, df):
    if column not in df.columns:
        df[column] = fill_value
    df[column] = df[column].fillna(fill_value)


def fill_column_string(column, fill_value, df):
    if column not in df.columns:
        df[column] = fill_value

    df[column] = df[column].astype(str)

    df[column] = df[column].fillna(fill_value)


def prepare_point_data(required_column_names, point_df, geo_transform):
    validate_columns(required_column_names, "point", point_df)
    point_df_pixel = apply_transform_to_gdf(point_df, geo_transform)

    point_df_pixel.set_crs(None, allow_override=True)
    fill_column_na("ABBRV", "", point_df_pixel)
    fill_column_na("LABEL", "", point_df_pixel)
    fill_column_na("DESCR", "", point_df_pixel)
    fill_column_na("DIP", pd.NA, point_df_pixel)
    fill_column_na("DIP_DIRECT", pd.NA, point_df_pixel)
    point_df_pixel["LabelAbbrv"] = point_df_pixel["LABEL"].astype(str) + "_" + point_df_pixel["ABBRV"].astype(str)
    grouped_legends = point_df_pixel.groupby("LabelAbbrv")

    point_legend_results = []
    for label_abbr, group in grouped_legends:
        group_desc = ", ".join(sorted(set(group["DESCR"])))
        label = label_abbr.split("_")[0]
        abbr = label_abbr.split("_")[1]

        point_features = []
        for idx, row in group.iterrows():
            geometry = Point(row["geometry"])

            dip = None
            try:
                dip = int(row["DIP"])
            except Exception:
                logger.info(f'Error with dip {row["DIP"]}')

            dip_dir = None
            try:
                dip_dir = int(row["DIP_DIRECT"])
            except Exception:
                logger.info(f'Error with dip direction {row["DIP_DIRECT"]}')

            point_features.append(
                {
                    "type": "Feature",
                    "id": str(idx),
                    "geometry": json.loads(to_geojson(geometry)),
                    "properties": {
                        "model": "",
                        "model_version": "",
                        "dip": dip,
                        "dip_direction": dip_dir,
                        "validated": False,
                    },
                }
            )
        collection = {"type": "FeatureCollection", "features": point_features}
        point_legend_results.append(
            {
                "id": label_abbr,
                "abbreviation": abbr,
                "description": group_desc,
                "name": label,
                "validated": False,
                "point_features": collection,
            }
        )
    return point_legend_results


def prepare_line_data(required_column_names, line_df, geo_transform):
    validate_columns(required_column_names, "line", line_df)
    line_df_pixel = apply_transform_to_gdf(line_df, geo_transform)

    line_df_pixel.set_crs(None, allow_override=True)
    fill_column_na("ABBRV", "", line_df_pixel)
    fill_column_na("LABEL", "", line_df_pixel)
    fill_column_na("DESCR", "", line_df_pixel)
    fill_column_na("DASH_PATT", "", line_df_pixel)
    fill_column_string("SYMBOL", "", line_df_pixel)
    line_df_pixel["LabelAbbrv"] = line_df_pixel["LABEL"].astype(str) + "_" + line_df_pixel["ABBRV"].astype(str)
    grouped_legends = line_df_pixel.groupby("LabelAbbrv")

    line_legend_results = []
    for label_abbr, group in grouped_legends:
        group_desc = ", ".join(sorted(set(group["DESCR"])))
        label = label_abbr.split("_")[0]
        abbr = label_abbr.split("_")[1]

        line_features = []
        for idx, row in group.iterrows():
            geometry = LineString(row["geometry"])

            pattern = ""
            try:
                pattern = row["DASH_PATT"]
            except Exception:
                logger.info(f'Error with dash patter {row["DASH_PATT"]}')

            symbol = ""
            try:
                symbol = row["SYMBOL"]
            except Exception:
                logger.info("issue with symbol")
            line_features.append(
                {
                    "type": "Feature",
                    "id": str(idx),
                    "geometry": json.loads(to_geojson(geometry)),
                    "properties": {
                        "model": "",
                        "model_version": "",
                        "dash_pattern": pattern,
                        "symbol": symbol,
                        "validated": False,
                    },
                }
            )
        collection = {"type": "FeatureCollection", "features": line_features}
        line_legend_results.append(
            {
                "id": label_abbr,
                "abbreviation": abbr,
                "description": group_desc,
                "name": label,
                "validated": False,
                "line_features": collection,
            }
        )
    return line_legend_results


def prepare_polygon_data(required_column_names, df, geo_transform):
    validate_columns(required_column_names, "polygon", df)
    df_pixel = apply_transform_to_gdf(df, geo_transform)

    df_pixel.set_crs(None, allow_override=True)
    fill_column_string("MU_T_AGE", "", df_pixel)
    fill_column_string("MU_B_AGE", "", df_pixel)

    for x in ["MU_TEXT", "MU_LITH", "DESCR", "LABEL", "ABBRV", "DASH_PATT", "SYMBOL"]:
        fill_column_na(x, "", df_pixel)
    df_pixel["LabelAbbrv"] = df_pixel["LABEL"].astype(str) + "_" + df_pixel["ABBRV"].astype(str)
    grouped_legends = df_pixel.groupby("LabelAbbrv")

    polygon_legend_results = []
    for label_abbr, group in grouped_legends:
        map_units = []
        mu_groups = group.groupby(["MU_TEXT", "MU_B_AGE", "MU_LITH", "MU_T_AGE"])
        for mu_key, mu_group in mu_groups:  # 'mu_key' holds the groupby keys (MU_TEXT, MU_B_AGE, etc.)
            for idx, row in mu_group.iterrows():  # Iterate over 'mu_group', not 'mu_groups'
                # Append map unit
                b_age = row.get("MU_B_AGE", None)
                if b_age == "":
                    b_age = None
                if b_age:
                    try:
                        b_age = int(b_age)
                    except Exception:
                        b_age = None

                t_age = row.get("MU_T_AGE", None)
                if t_age == "":
                    t_age = None
                try:
                    t_age = int(t_age)
                except Exception:
                    t_age = None
                map_units.append(
                    {
                        "age_text": row.get("MU_TEXT", ""),
                        "b_age": b_age,
                        "lithology": row.get("MU_LITH", ""),
                        "t_age": t_age,
                    }
                )
                break

        group_desc = ", ".join(sorted(set(group["DESCR"])))
        label = label_abbr.split("_")[0]
        abbr = group.get("ABBRV", pd.Series([])).mode()[0] if not group.get("ABBRV", pd.Series([])).mode().empty else ""

        pattern = group.get("PATTERN", pd.Series([])).mode()[0] if not group.get("PATTERN", pd.Series([])).mode().empty else ""
        color = group.get("COLOR", pd.Series([])).mode()[0] if not group.get("COLOR", pd.Series([])).mode().empty else ""
        polygon_features = []
        for idx, row in group.iterrows():
            geometry = Polygon(row["geometry"])

            polygon_features.append(
                {
                    "type": "Feature",
                    "id": str(idx),
                    "geometry": json.loads(to_geojson(geometry)),
                    "properties": {"model": "", "model_version": "", "validated": False},
                }
            )
        collection = {"type": "FeatureCollection", "features": polygon_features}
        polygon_legend_results.append(
            {
                "id": label_abbr,
                "abbreviation": abbr,
                "description": group_desc,
                "label": label,
                "pattern": pattern,
                "color": color,
                "map_unit": map_units,
                "validated": False,
                "polygon_features": collection,
            }
        )
    return polygon_legend_results
