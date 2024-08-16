from elasticsearch import exceptions

from ..es import es

gcps__mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "gcp_id": {"type": "keyword"},
            "cog_id": {"type": "keyword"},
            "modified": {"type": "date"},
            "created": {"type": "date"},
            "system": {"type": "text"},
            "system_version": {"type": "text"},
            "registration_id": {"type": "text"},
            "model_id": {"type": "text"},
            "model": {"type": "text"},
            "model_version": {"type": "text"},
            "rows_from_top": {"type": "float"},
            "columns_from_left": {"type": "float"},
            "latitude": {"type": "float"},
            "longitude": {"type": "float"},
            "crs": {"type": "text"},
            "confidence": {"type": "float"},
            "reference_id": {"type": "text"},
        }
    },
}


projection_file_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "cog_id": {"type": "keyword"},
            "projection_id": {"type": "keyword"},
            "crs": {"type": "text"},  # epsg_code used for reprojection
            "gcps_ids": {"type": "text"},  # gcps used in reprojection
            "created": {"type": "date"},  # when file was created
            "status": {"type": "text"},  # (created, failed, validated)
            "download_url": {"type": "text"},  # url in polymer s3 or cdr s3
            "map_area_id": {"type": "text"},
            "system": {"type": "text"},
            "system_version": {"type": "text"},
            "registration_id": {"type": "text"},
            "transformation": {"type": "text"},
            "from_cdr": {"type": "boolean"},
        }
    },
}


def create_index(es_instance, index_name, mapping):
    """Creates an index in Elasticsearch if it doesn't exist."""
    if not es_instance.indices.exists(index=index_name):
        try:
            response = es_instance.indices.create(index=index_name, body=mapping)
            print(f"Successfully created index: {index_name}")
        except exceptions.RequestError as re:
            print(f"Error while creating index: {index_name}. Details: {re}")
    else:
        print(f"Index {index_name} already exists.")


legend_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "cog_id": {"type": "keyword"},
            "descriptions": {"type": "nested"},
            "label_coordinates": {"type": "nested"},  # label info. text + bounding box
            "label_coordinates_from_bottom": {"type": "nested"},
            "label": {"type": "text"},
            "legend_id": {"type": "keyword"},
            "image_url": {"type": "text"},
            "bbox": {"type": "float"},
            "extent_from_bottom": {"type": "float"},
            "coordinates": {"type": "nested"},
            "coordinates_from_bottom": {"type": "nested"},
            "text": {"type": "text"},
            "system": {"type": "text"},
            "system_version": {"type": "text"},
            "model": {"type": "text"},
            "model_version": {"type": "text"},
            "category": {"type": "text"},  # polygon, line, point
            "confidence": {"type": "float"},
            "status": {"type": "text"},
            "notes": {"type": "text"},
            "edited": {"type": "boolean"},
            "pattern": {"type": "text"},
            "color": {"type": "text"},
            "map_unit_id": {"type": "keyword"},
            "polygon_features": {"type": "nested"},
        }
    },
}

area_extractions_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "cog_id": {"type": "keyword"},
            "area_id": {"type": "keyword"},
            "reference_id": {"type": "keyword"},
            "coordinates": {"type": "geo_shape"},
            "coordinates_from_bottom": {"type": "geo_shape"},
            "bbox": {"type": "float"},
            "extent_from_bottom": {"type": "float"},
            "text": {"type": "text"},
            "system": {"type": "text"},
            "system_version": {"type": "text"},
            "model": {"type": "text"},
            "model_version": {"type": "text"},
            "category": {"type": "text"},  # map_area, legend_area, ...
            "confidence": {"type": "float"},
            "status": {"type": "text"},
        }
    },
}


def main():
    # Check if connected
    if not es.ping():
        raise ValueError("Couldn't connect to Elasticsearch. Ensure it's running and accessible.")

    indices_to_create = [
        ("polymer_gcps", gcps__mapping),
        ("polymer_projections", projection_file_mapping),
        ("polymer_legend_extractions", legend_mapping),
        ("polymer_area_extractions", area_extractions_mapping),
    ]

    for index, mapping in indices_to_create:
        create_index(es, index, mapping)


if __name__ == "__main__":
    main()
