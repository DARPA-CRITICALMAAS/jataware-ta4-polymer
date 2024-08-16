import hashlib
import json


def hash_map_area(map_area: dict) -> str:
    hash_obj = hashlib.sha256()
    hash_obj.update(json.dumps(map_area, sort_keys=True).encode("utf-8"))  # Encode the JSON string to bytes
    hex_digest = hash_obj.hexdigest()
    return hex_digest


def generate_map_area_id(cog_id: str, map_area: dict):
    hashed_map_area = hash_map_area(map_area)
    return f"""{cog_id}_{hashed_map_area}"""


def generate_geom_id(cog_id, system, system_version, geometry):
    geom = hash_map_area(geometry)
    return f"{cog_id}_{system}_{system_version}_{geom}"


def generate_legend_id(cog_id, system, system_version, geometry, label):
    label = label[:150]
    return generate_geom_id(cog_id, system, system_version, geometry) + "_" + label
