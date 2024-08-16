import React, { useState, useEffect } from "react";
import axios from "axios";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useParams } from "react-router-dom";
import { pointerMove } from "ol/events/condition";

import Button from "@mui/material/Button";
import Text from "@mui/material/Typography";
import MapPage from "./components/projectionComponents.tsx";
import { dec2dms } from "./components/helpers.js";
import Header from "./components/Header";

import "./css/projection_viewer_wrapper.scss";

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function formatResponseData(response) {
  let mapper = {};
  let crs_name_mapper = {};

  const acc = response.data;

  acc["all_gcps"].forEach((element, index) => {
    let color_ = [
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
    ];
    mapper[element["gcp_id"]] = {
      color: color_,
      x_dms: dec2dms(acc["all_gcps"][index]["longitude"]),
      y_dms: dec2dms(acc["all_gcps"][index]["latitude"]),
    };
  });

  // if item projection is failed or duplicate dont show
  // if it is validated and not in cdr don't show since
  // we have that projection in the cdr which will be the same thing but in_cdr will be true
  acc["proj_info"] = acc["proj_info"].filter(
    (item) =>
      !(item.status === "validated" && item.in_cdr === false) &&
      item.status !== "failed" &&
      item.status !== "duplicate",
  );
  acc["proj_info"].forEach((element, index) => {
    element["provenance"] = element["system"] + "_" + element["system_version"];
    crs_name_mapper[element["crs"]] = null;
    element["gcps"].forEach((point, index_) => {
      crs_name_mapper[point["crs"]] = null;
      point["color"] = mapper[point["gcp_id"]]["color"];
      point["x_dms"] = mapper[point["gcp_id"]]["x_dms"];
      point["y_dms"] = mapper[point["gcp_id"]]["y_dms"];
      point["provenance"] = point["system"] + "_" + point["system_version"];
    });
  });

  return { allData: acc, mapper: crs_name_mapper };
}

function ProjectionViewer() {
  const { cog_id } = useParams();

  const navigate = useNavigate();

  const fetchCog = useQuery({
    // TODO refactor return and reorder this in order to
    //      keep consistent with mapCog, cog_id call and remove the intermediary "projection" key, so as to reuse cache
    queryKey: ["mapCog", "projection", cog_id],
    queryFn: async () => {
      let res;
      try {
        res = await axios({
          method: "GET",
          url: "/api/map/" + cog_id,
          headers: _APP_JSON_HEADER,
        });
      } catch (e) {
        // TODO an handle all http response types here.
        return new Error("No file found for extracted GCPs.");
      }

      // TODO can also throw is data shape is corrupted
      // {data, mapper}
      const formatted = formatResponseData(res);
      return formatted;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const fetchProjectionNames = useQuery({
    queryKey: ["projectionNames", cog_id],
    queryFn: async () => {
      const mapper = fetchCog.data.mapper;
      const validRequests = Object.keys(mapper)
        .map((code) => {
          let code_ = parseInt(code.split("EPSG:")[1]);
          if (isNaN(code_)) return null; // Return null for invalid codes
          return axios.get(`/api/map/get_projection_name/${code_}`, {
            headers: _APP_JSON_HEADER,
          });
          // .catch((error) =>
          //   console.error(`Error fetching data for code ${code_}:`, error),
          // );
        })
        .filter((request) => request !== null);

      const responses = await Promise.all(validRequests);

      responses.forEach((response) => {
        const epsgCode = "EPSG:" + response.config.url.split("/").pop();
        const projectionName = response.data.projection_name;
        mapper[epsgCode] = projectionName;
      });

      return {
        ...fetchCog.data.allData,
        crs_names: mapper,
      };
    },
    enabled: Boolean(fetchCog.data),
  });

  return (
    <div className="projection-viewer-root">
      <Header navigate={navigate} cog_id={cog_id} />
      {fetchCog.isPending || fetchProjectionNames.isPending ? (
        <div className="flex-container"></div>
      ) : fetchCog.isError ? (
        <div className="error-message">
          <Text variant="h4">Error Retrieving Cog Data</Text>
          <br />
          <Text variant="subtitle1">Details: {fetchCog?.error?.message}</Text>
          <div>
            <Button link onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button link onClick={() => navigate("/")}>
              Home
            </Button>
          </div>
        </div>
      ) : fetchProjectionNames.isError ? (
        <div className="error-message">
          <Text variant="h4">Error Retrieving Projection Names</Text>
          <br />
          <Text variant="subtitle1">
            Details: {fetchProjectionNames?.error?.message}
          </Text>
          <div>
            <Button link onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button link onClick={() => navigate("/")}>
              Home
            </Button>
          </div>
        </div>
      ) : (
        fetchCog.data &&
        fetchProjectionNames.data && (
          <MapPage
            key={cog_id}
            cog_id={cog_id}
            mapData={fetchProjectionNames.data}
          />
        )
      )}
    </div>
  );
}

export default ProjectionViewer;
