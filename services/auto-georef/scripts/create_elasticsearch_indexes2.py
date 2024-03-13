from elasticsearch import Elasticsearch, exceptions
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = None
    open_ai_key: str = None
    s3_tiles_bucket: str = "common.polymer.rocks"
    s3_tiles_prefix: str = "tiles"
    s3_tiles_prefix_v2: str = "cogs"
    es_endpoint_url: str = "http://localhost:9200/"

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

maps_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            # schema
            "map_id": {"type": "keyword"},
            "publication_id": {"type": "text"},  # uuid
            "map_name": {
                "type": "text"
            },  # basically our current map_id which is it's name
            "source_url": {"type": "text"},
            "download_url": {"type": "text"},
            "image_url": {"type": "text"},
            "height": {"type": "integer"},  # height pixels
            "width": {"type": "integer"},
            "image_size": {"type": "integer"},
            "file_size": {"type": "integer"},
            "authors": {"type": "text"},
            "publisher": {"type": "text"},
            "year": {"type": "integer"},
            "organization": {"type": "text"},
            "scale": {"type": "integer"},
            "bounds": {"type": "geo_shape"},
            "centroid": {"type": "geo_shape"},
            "original_wkt": {"type": "text"},
            "original_transformation": {"type": "text"},
            "projection_info": {"type": "text"},
            # internal
            "georeferenced": {"type": "boolean"},  # has been georeferenced
            "validated": {"type": "boolean"},  # validated by an expert
            "finished_proj_id": {"type": "keyword"},  # final proj_id.
            "modified": {"type": "date"},  # latest modification
            "created": {"type": "date"},  # creation date
            "finished": {
                "type": "date"
            },  # when map has been finished being georeferenced/validated
            "cog_url": {"type": "text"},  # where we save the cog
            "likely_CRSs": {"type": "text"},
            # extra
            "series_name": {"type": "text"},
            "series_number": {"type": "text"},
            "title": {"type": "text"},
            "category": {"type": "text"},
            "pub_link": {"type": "text"},
            "state": {"type": "text"},
            "gis_data": {"type": "boolean"},
            "downloads": {"type": "boolean"},
            "citation": {"type": "text"},
            "south": {"type": "float"},
            "west": {"type": "float"},
            "north": {"type": "float"},
            "east": {"type": "float"},
        }
    },
}

gcps__mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "gcp_id": {"type": "keyword"},  # individual point id
            "map_id": {"type": "keyword"},  # which map are these gcp refering to
            "modified": {"type": "date"},  # last edited
            "created": {"type": "date"},  # creation date
            "provenance": {"type": "text"},  # how was this gcp created? manually, AI
            "extraction_model": {
                "type": "text"
            },  # optional which model produced it? Jataware, TA1?
            "extraction_model_version": {
                "type": "text"
            },  # optional which model produced it? Jataware, TA1?
            "rowb": {"type": "integer"},
            "coll": {"type": "integer"},
            "x": {"type": "float"},
            "y": {"type": "float"},
            "crs": {"type": "text"},
            "confidence": {"type": "float"},
        }
    },
}

epsg__mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "epsg_id": {"type": "keyword"},  # individual epsg id
            "map_id": {"type": "keyword"},  # map id
            "epsg_code": {"type": "text"},  # EPGS:4679
            "created": {"type": "date"},  # creation date
            "provenance": {
                "type": "text"
            },  # how was this epgs_code created? manually, AI, guess?
            "extraction_model": {
                "type": "text"
            },  # optional which model produced it? Jataware, TA1?
            "extraction_model_version": {
                "type": "text"
            },  # optional which model produced it? Jataware, TA1?
        }
    },
}

projection_file_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "map_id": {"type": "keyword"},
            "proj_id": {
                "type": "keyword"
            },  # projection file id. There can be more than one projection file with the same epsg code.
            "epsg_code": {"type": "text"},  # epsg_code used for reprojection
            "epsg_id": {
                "type": "keyword"
            },  # epsg_id used which is the internal id in the epsg index
            "gcps_ids": {"type": "text"},  # gcps used in reprojection
            "created": {"type": "date"},  # when file was created
            "status": {"type": "text"},  # (created, failed, passed)
            # Created means not reviewed yet.
            # Failed means the user decied it was not good.
            # Passed means it was a good projection. Doesn't mean it cant be better.
            "source": {"type": "text"},
            "provenance": {"type": "text"},
            "transformation": {"type": "text"},
        }
    },
}


features_mapping = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "map_id": {"type": "keyword"},
            "parent_id":{"type":"keyword"}, # optional - for swatch descriptions can connect to swatch legend item
            "feature_id": {"type": "keyword"},
            "reference_id":{"type":"keyword"},
            "image_url": {"type": "text"},
            "extent_from_bottom": {"type": "float"},
            "points_from_top": {"type": "float"},  
            "geom_pixel_from_bottom": {"type": "geo_shape"},
            "text": {"type": "text"},
            "provenance": {"type": "text"}, 
            "model": {"type": "text"},  
            "model_version": {"type": "text"},  
            "category": {"type": "text"},   # legend_swatch, legend_description, legend_area, 
            "confidence": {"type": "float"},
            "status":{"type":"text"},
            "notes": {"type":"text"}
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


def main():
    # Check if connected
    if not es.ping():
        raise ValueError(
            "Couldn't connect to Elasticsearch. Ensure it's running and accessible."
        )

    indices_to_create = [
        # ("maps2", maps_mapping),
        # ("gcps2", gcps__mapping),
        # ("epsgs2", epsg__mapping),
        # ("proj_files2", projection_file_mapping),
        ("features", features_mapping)
    ]

    for index, mapping in indices_to_create:
        create_index(es, index, mapping)


if __name__ == "__main__":
    main()
