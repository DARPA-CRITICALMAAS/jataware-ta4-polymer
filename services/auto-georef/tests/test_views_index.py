import pprint
import pytest
from auto_georef.http.views.index import format_map_stats, update_selected_CMAs

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


def test_update_selected_CMAs_empty():
    cog_meta = {}
    cma_list = {}

    update_selected_CMAs(cog_meta, cma_list)


def test_update_selected_CMAs_base():
    cog_meta = {
        "cog_id": "cog-id-test-mock1",
        "cmas": [{"mineral": "zinc-mock", "cma_id": "cma-id-mock1"}]
    }
    cma_list = [{"mineral": "zinc-mock", "cma_id": "cma-id-mock1"}, {"mineral": "nickel-mock", "cma_id": "cma-id-mock2"}]

    out = update_selected_CMAs(cog_meta, cma_list)

    # does not mutate input list
    assert cma_list[0].get("selected") == None
    assert cma_list[1].get("selected") == None

    assert out[0].get("selected") == True
    assert out[1].get("selected") == False
