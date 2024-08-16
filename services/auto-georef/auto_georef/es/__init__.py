import copy
import logging
import uuid
from datetime import datetime
from logging import Logger

import httpx
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
from fastapi import HTTPException, status

from ..settings import app_settings

logger: Logger = logging.getLogger(__name__)


def compare_dicts(dict1, dict2, keys):
    for key in keys:
        if dict1.get(key) != dict2.get(key):
            return False
    return True


def compare_dicts(dict1, dict2, keys):
    for key in keys:
        if dict1.get(key) != dict2.get(key):
            return False
    return True


auth = {
    "Authorization": app_settings.cdr_bearer_token,
}

es = Elasticsearch(
    [
        app_settings.polymer_es_endpoint_url,
    ]
)


def document_exists(index_name, doc_id):
    return es.exists(index=index_name, id=doc_id)


def update_document_by_id(index_name, doc_id, updates):
    """Update an Elasticsearch document by its ID with the provided updates."""
    try:
        response = es.update(index=index_name, id=doc_id, body={"doc": updates}, refresh=True)
        return response
    except Exception:
        logger.exception(f"Error updating document:")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{doc_id} item not found")


def cdr_GCP_by_id(cog_id, gcp_id):
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/gcps/{cog_id}"
    response = httpx.get(url, headers=auth)
    response_data = []
    if response.status_code == 200:
        response_data = response.json()
        if response_data is None:
            response_data = []

    for gcp in response_data:
        if gcp_id == gcp["gcp_id"]:
            return gcp

    return return_ES_doc_by_id(app_settings.polymer_gcps_index, gcp_id)


def return_ES_doc_by_id(index, id):
    try:
        response = es.get(index=index, id=id)
        return response["_source"]

    except Exception:
        logger.exception(f"An error occured looking for {id}")
        return None


def polymer_system_cog_id(index, cog_id):
    try:
        response = es.search(
            index=index,
            body={"query": {"bool": {"must": [{"match": {"cog_id": cog_id}}]}}},
        )
        if len([hit["_source"] for hit in response["hits"]["hits"]]) > 0:
            return app_settings.polymer_auto_georef_system + "_" + app_settings.polymer_auto_georef_system_version
        return None
    except Exception:
        logger.exception("An error occured")
        return None


def search_by_cog_id(index, cog_id):
    try:
        response = es.search(
            index=index,
            body={"query": {"bool": {"must": [{"match": {"cog_id": cog_id}}]}}},
            size=10000,
        )
        return [hit["_source"] for hit in response["hits"]["hits"]]

    except Exception:
        logger.exception("An error occured")
        return []


def delete_by_id(index, id):
    try:
        response = es.delete(index=index, id=id, refresh=True)
    except Exception as e:
        logger.exception(f"Failed to delete {id} from {index}")

    return response


def save_ES_data(index, info, id=None):
    if id != None:
        response = es.index(index=index, id=id, document=info, refresh=True)

    else:
        response = es.index(index=index, document=info, refresh=True)
    return response


def prepare_gcps_for_es(gcps, cog_id):
    gcps_ = []
    for gcp in gcps:
        gcp_data = {
            "gcp_id": gcp.get("gcp_id"),
            "cog_id": cog_id,
            "modified": datetime.now(),
            "created": datetime.now(),
            "system": gcp.get("system", ""),
            "system_version": gcp.get("system_version", ""),
            "registration_id": gcp.get("registration_id", ""),
            "model_id": gcp.get("model_id", ""),
            "model": gcp.get("model", ""),
            "model_version": gcp.get("model_version", ""),
            "rows_from_top": gcp.get("rows_from_top"),
            "columns_from_left": gcp.get("columns_from_left"),
            "latitude": gcp.get("latitude", None),
            "longitude": gcp.get("longitude", None),
            "crs": gcp.get("crs", ""),
            "confidence": gcp.get("confidence", None),
            "reference_id": gcp.get("reference_id", ""),
        }
        gcps_.append(gcp_data)
    return gcps_


def update_GCPs(cog_id, gcps):
    # get current gcps from cdr for this cog.
    url = app_settings.cdr_endpoint_url + f"/v1/maps/cog/gcps/{cog_id}"
    response = httpx.get(url, headers=auth)
    cdr_gcps = []
    if response.status_code == 200:
        cdr_gcps = response.json()

    if cdr_gcps is None:
        cdr_gcps = []

    all_gcps = {}
    for gcp in cdr_gcps:
        all_gcps[gcp["gcp_id"]] = gcp

    # get current gcps from polymer for this cog.
    query_body = {"query": {"term": {"cog_id": cog_id}}}
    response = es.search(index=app_settings.polymer_gcps_index, body=query_body, size=1000)
    for hit in response["hits"]["hits"]:
        all_gcps[hit["_source"]["gcp_id"]] = {
            "gcp_id": hit["_source"]["gcp_id"],
            "cog_id": hit["_source"].get("cog_id"),
            "latitude": hit["_source"].get("latitude"),
            "longitude": hit["_source"].get("longitude"),
            "rows_from_top": hit["_source"].get("rows_from_top"),
            "columns_from_left": hit["_source"].get("columns_from_left"),
            "confidence": hit["_source"].get("confidence"),
            "model": hit["_source"].get("model", ""),
            "model_id": hit["_source"].get("model_id", ""),
            "model_version": hit["_source"].get("model_version", ""),
            "crs": hit["_source"].get("crs"),
            "reference_id": hit["_source"].get("reference_id"),
            "system": hit["_source"].get("system"),
            "system_version": hit["_source"].get("system"),
            "registration_id": hit["_source"].get("registration_id"),
            "created": hit["_source"].get("created", datetime.now()),
            "modified": hit["_source"].get("modified", datetime.now()),
        }

    # now loop over each point that was used in projection
    # see if that gcp_id is already accounted for,
    # if all the values are the same we leave it alone just save id with proj_info index
    # If values are different at all or "manual" found in gcp_id,
    #  create new id and save new point with updated values

    gcp_ids = []
    new_gcps = []
    for gcp in gcps:
        new_gcp = copy.deepcopy(gcp)
        if gcp["gcp_id"] in all_gcps.keys():
            if compare_dicts(
                gcp,
                all_gcps[gcp["gcp_id"]],
                ["latitude", "longitude", "rows_from_top", "columns_from_left", "crs"],
            ):
                logger.info("Point has stayed the same")
                gcp_ids.append(gcp["gcp_id"])
                continue

            # Only want to set this once to point to the original gcp for provenance. We aren't tracking edits on edits.
            if new_gcp["reference_id"] == "" or new_gcp["reference_id"] is None:
                new_gcp["reference_id"] = new_gcp.get("gcp_id", "")
            new_gcp["model_id"] = ""
            new_gcp["model"] = ""
            new_gcp["model_version"] = ""

        print("New point being created/saved")
        logger.info("New point being created/saved")

        new_gcp["gcp_id"] = uuid.uuid4()
        gcp_ids.append(new_gcp["gcp_id"])
        new_gcps.append(new_gcp)

    gcps_ = prepare_gcps_for_es(gcps=new_gcps, cog_id=cog_id)
    for gcp in gcps_:
        save_ES_data(index=app_settings.polymer_gcps_index, info=gcp, id=gcp["gcp_id"])
    return gcp_ids


def es_bulk_process_actions(index, actions):
    try:
        bulk(es, actions)
        es.indices.refresh(index=index)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def legend_categories_by_cog_id(index, cog_id, category):
    response = es.search(
        index=index,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"cog_id": cog_id}},
                        {"match": {"category": category}},
                        {"match": {"status": "validated"}},
                    ]
                }
            }
        },
        size=10000,
    )

    return [hit["_source"] for hit in response["hits"]["hits"]]


def legend_by_cog_id_status(index, cog_id, status):
    response = es.search(
        index=index,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"cog_id": cog_id}},
                        {"match": {"status": status}},
                    ]
                }
            }
        },
        size=10000,
    )
    return [hit["_source"] for hit in response["hits"]["hits"]]
