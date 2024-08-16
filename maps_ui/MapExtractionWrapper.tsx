import React, { useState, useEffect } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Typography from "@mui/material/Typography";

import { dec2dms } from "./components/helpers.js";
import MapExtraction from "./components/MapExtraction.tsx";
import Header from "./components/Header";
import Footer from "./components/Footer";
import "./css/map_extraction_wrapper.scss";

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
};

// TODO use memo fn if this causes perf issues
export function processCogResponse(resIn) {
  const response = { ...resIn };

  let mapper = {};
  response["provenances"] = [];
  response["all_gcps"].forEach((element, index) => {
    element["provenance"] = element["system"] + "_" + element["system_version"];
    element["height"] = response["cog_info"]["height"];
    let color_ = [
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
      Math.floor(Math.random() * 255),
    ];
    mapper[element["gcp_id"]] = {
      color: color_,
      x_dms: dec2dms(response["all_gcps"][index]["longitude"]),
      y_dms: dec2dms(response["all_gcps"][index]["latitude"]),
    };
    response["all_gcps"][index]["color"] = color_;
    response["all_gcps"][index]["x_dms"] = dec2dms(
      response["all_gcps"][index]["longitude"],
    );
    response["all_gcps"][index]["y_dms"] = dec2dms(
      response["all_gcps"][index]["latitude"],
    );

    response["all_gcps"][index]["just_edited"] = false;

    if (response["provenances"].includes(element["provenance"])) {
      // pass
    } else {
      response["provenances"].push(element["provenance"]);
    }
  });

  return response;
}

function GeoreferencePage() {
  const { cog_id } = useParams();
  const navigate = useNavigate();

  // server loads cog into memory here
  // request map metadata
  const { isPending, isError, error, data } = useQuery({
    queryKey: ["mapCog", cog_id],
    queryFn: async () => {
      const res = await axios({
        method: "GET",
        url: "/api/map/" + cog_id,
        headers: _APP_JSON_HEADER,
      });

      return res.data;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="points-root">
      <Header navigate={navigate} cog_id={cog_id} />
      {isPending ? (
        <div className="flex-container"></div>
      ) : isError ? (
        <div className="error-message">
          <Typography variant="h4">Error Retrieving Map Image</Typography>
          <br />
          <Typography variant="subtitle1">{error.message}</Typography>
        </div>
      ) : (
        data && <MapExtraction mapDataInit={processCogResponse(data)} />
      )}
      <Footer />
    </div>
  );
}

export default GeoreferencePage;
