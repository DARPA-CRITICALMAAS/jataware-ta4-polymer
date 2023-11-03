from elasticsearch import Elasticsearch, exceptions


maps_mapping = {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0
        },
        "mappings": {
            "properties": {
                "map_id": {"type": "keyword"},               # uuid
                "map_name": {"type": "text"},             # basically our current map_id which is it's name
                "height": {"type": "integer"},            # height pixels
                "width": {"type": "integer"},             # width pixels
                "georeferenced": {"type": "boolean"},     # has been georeferenced
                "validated": {"type": "boolean"},         # validated by an expert
                "finished_proj_id": {"type":"keyword"},   # final proj_id.
                "modified": {"type": "date"},             # latest modification
                "created": {"type": "date"},              # creation date
                "finished": {"type":"date"},              # when map has been finished being georeferenced/validated
                "source": {"type":"text"},                # where the map came from?    
            }
        }
    }

gcps__mapping = {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0
        },
        "mappings": {
            "properties": {
                "gcp_id": {"type": "keyword"},                   # individual point id
                "map_id": {"type": "keyword"},                   # which map are these gcp refering to
                "modified": {"type": "date"},                 # last edited
                "created": {"type": "date"},                  # creation date
                "provenance":{"type":"text"},                 # how was this gcp created? manually, AI
                "extraction_model":{"type":"text"},           # optional which model produced it? Jataware, TA1?
                "extraction_model_version":{"type":"text"},    # optional which model produced it? Jataware, TA1?
                "rowb": {"type":"integer"},
                "coll": {"type":"integer"},
                "x": {"type":"float"},
                "y": {"type":"float"},
                "crs": {"type":"text"}  
            }
        }
    }

epsg__mapping = {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0
        },
        "mappings": {
            "properties": {
                "epsg_id": {"type": "keyword"},                  # individual epsg id
                "map_id": {"type": "keyword"},                   # map id
                "epsg_code": {"type": "text"},                # EPGS:4679 
                "created": {"type": "date"},                  # creation date
                "provenance":{"type":"text"},                 # how was this epgs_code created? manually, AI, guess?
                "extraction_model":{"type":"text"},           # optional which model produced it? Jataware, TA1?
                "extraction_model_version":{"type":"text"}    # optional which model produced it? Jataware, TA1?
            }
        }
    }

projection_file_mapping = {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0
        },
        "mappings": {
            "properties": {            
                "map_id": {"type": "keyword"},  
                "proj_id": {"type": "keyword"},            # projection file id. There can be more than one projection file with the same epsg code.       
                "epsg_code": {"type": "text"},          # epsg_code used for reprojection
                "epsg_id": {"type": "keyword"},            # epsg_id used which is the internal id in the epsg index
                "gcps_ids":{"type":"keyword"},             # gcps used in reprojection
                "created": {"type": "date"},            # when file was created
                "status":{"type":"text"},               # (created, failed, passed) 
                                                        # Created means not reviewed yet. 
                                                        # Failed means the user decied it was not good. 
                                                        # Passed means it was a good projection. Doesn't mean it cant be better.
                "source": {"type":"text"}
            }
        }
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
    # Connect to Elasticsearch
    # Assuming Elasticsearch is running on 'localhost' and on the default port 9200
    # You might want to adjust these values based on your setup
    es = Elasticsearch(["elastic.nyl.on:9200"])

    # Check if connected
    if not es.ping():
        raise ValueError("Couldn't connect to Elasticsearch. Ensure it's running and accessible.")

    indices_to_create = [
                        ("maps",maps_mapping),
                        ("gcps", gcps__mapping),
                        ("epsgs", epsg__mapping),
                        ("proj_files", projection_file_mapping)
                        ]

    for index, mapping in indices_to_create:
        create_index(es, index, mapping)

if __name__ == '__main__':
    main()