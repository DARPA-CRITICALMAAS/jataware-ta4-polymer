from elasticsearch.helpers import bulk, scan

from ..es import es
from ..settings import app_settings

index_name = app_settings.polymer_legend_extractions


def process_docs():
    docs = scan(es, index=index_name, query={"query": {"match_all": {}}})

    actions = []

    for doc in docs:
        doc_id = doc["_id"]
        source = doc["_source"]

        if "age_text" in source and source["age_text"]:
            age_texts = [source["age_text"]]
        else:
            age_texts = []

        action = {"_op_type": "update", "_index": index_name, "_id": doc_id, "doc": {"age_texts": age_texts}}

        actions.append(action)

        print(f"Updating doc_id {doc_id}: age_texts = {age_texts}")

    if actions:
        bulk(es, actions)


if __name__ == "__main__":
    process_docs()
