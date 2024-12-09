from enum import Enum

from ...settings import app_settings


def format_scale(scale):
    """
    Adds metric scale to numbers. Examples:
    2000 => 2k
    1000000 => 1000K
    1 => 1
    """
    try:
        return "{:,.0f}".format(scale / 1000).replace(",", "") + "K"
    except TypeError:
        return scale


def format_map(m):
    """
    Formats a map entry, for now adds the proper catalog ngmdb url and formats
    scale.
    """
    provider_catalog_url = m["provider_url"]
    cog_id = m["cog_id"]
    provider_name = m.get("provider_name") or "unknown"

    if m["ngmdb_prod"]:
        provider_catalog_url = f"{m['provider_url']}/Prodesc/proddesc_{m['ngmdb_prod']}.htm"
    return m | {
        "provider_catalog_url": provider_catalog_url,
        "fmt_scale": format_scale(m["scale"]),
        "gcp_url": f"/points/{m['cog_id']}",
        "thumbnail": f"{app_settings.cdr_s3_endpoint_url}/{app_settings.cdr_public_bucket}/cogs/thumbnails/{cog_id}_300x300.jpg",
        "provider_name": "ngmdb" if "NGMDB" in provider_name else provider_name,
    }


class Extractions(Enum):
    projections = "projections"
    gcps = "gcps"
    legend_items = "legend_items"
    points = "points"
    lines = "lines"
    polygons = "polygons"
    areas = "areas"


extraction_colors = {
    "projections": "red-500",
    "gcps": "blue-500",
    "legend_items": "lime-500",
    "points": "violet-500",
    "lines": "amber-500",
    "polygons": "teal-500",
}
