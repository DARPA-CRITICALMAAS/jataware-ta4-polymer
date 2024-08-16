import pprint
import pytest
from auto_georef.http.views.index import format_map_stats

pp = pprint.PrettyPrinter(indent=2)

def test_format_map_stats__projections_empty():

    stats_count_data_empty = {
        'georeferenced_count': 0,
        'validated_projection_count': 0,
        'total_gcp_count': 0,
        'total_point_count': 0,
        'total_validated_point_count': 0,
        'total_line_count': 0,
        'total_validated_line_count': 0,
        'total_polygon_count': 0,
        'total_validated_polygon_count': 0,
        'total_area_extractions_count': 0,
        'total_validated_area_extraction_count': 0,
        'total_legend_items_count': 0,
        'total_validated_legend_item_count': 0
    }

    cog_id = "hello-cog-id"

    # list
    all_output = format_map_stats(stats_count_data_empty, cog_id)
    # find dict in list for projections
    projection_output = next(item for item in all_output if item["display_title"] == "Projections")

    assert projection_output["total_count"] == 0, "Empty georeference_count did not result in total_count=0 for projections"
    assert projection_output["disabled"] == True, "Empty georeference_count did not result in disabled projections"


# @pytest.mark.skip(reason="passing")
def test_format_map_stats__projections_count():

    stats_count_data = {
        'georeferenced_count': 3,
        'validated_projection_count': 0,
        'total_gcp_count': 0,
        'total_point_count': 0,
        'total_validated_point_count': 0,
        'total_line_count': 0,
        'total_validated_line_count': 0,
        'total_polygon_count': 0,
        'total_validated_polygon_count': 0,
        'total_area_extractions_count': 0,
        'total_validated_area_extraction_count': 0,
        'total_legend_items_count': 0,
        'total_validated_legend_item_count': 0
    }

    cog_id = "hello-cog-id"

    # list
    all_output = format_map_stats(stats_count_data, cog_id)
    # find dict in list for projections
    projection_output = next(item for item in all_output if item["display_title"] == "Projections")

    # pp.pprint(dict(projection_output))

    assert projection_output["total_count"] == 3, "georeference_count=3 did not result in total_count=3 for projections"
    assert projection_output["disabled"] == False, "georeference_count=3 did not result in enabled projections"
