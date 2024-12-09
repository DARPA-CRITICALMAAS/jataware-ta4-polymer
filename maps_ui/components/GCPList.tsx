import React, { useMemo, useState, useEffect } from "react"; // useEffect,
import axios from "axios";

import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import { useQuery } from "@tanstack/react-query";

import { MapSpinner } from "../Spinner";
import GCPCard from "./GCPCard";

import "../css/GCP_list.scss";

enum DegreeType {
  DD = "DD", // decimal degrees
  DMS = "DMS", // degreees, minutes, seconds
  UTM = "UTM"
}

const identity = (args) => args;

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function returnDegreeType(gcps) {
  for (let gcp of gcps) {

    if (gcp?.["crs_unit"] == "meter" || gcp?.['crs_unit'] == "metre") {
      return DegreeType.UTM
    }
  }
  return DegreeType.DMS
}

function GCPList(props) {
  const {
    gcps,
    cog_id,
    scrollerRef,
    readonly,
    GCPOps = { updateGCP: identity, deleteGCP: identity },
    height,
    ClipComponent,
  } = props;

  // const initialDegreesType = useMemo(() => returnDegreeType(gcps), [gcps]);
  const [degreesType, setDegreesType] = useState(DegreeType.DMS);
  const { updateGCP, deleteGCP } = GCPOps;

  // useEffect(() => {
  //   const newDegreesType = returnDegreeType(gcps);
  //   setDegreesType(newDegreesType); // This will trigger a re-render when gcps changes
  // }, [gcps]);

  const forceCogCache = useQuery({
    queryKey: ["mapCog", cog_id, "cache"],
    queryFn: () => {
      const p = axios({
        method: "GET",
        url: "/api/map/load_tiff_into_cache?cog_id=" + cog_id,
        headers: _APP_JSON_HEADER,
      });
      return p;
    },
    refetchOnWindowFocus: true,
    retry: 1,
  });

  return (
    <>
      <Divider textAlign="left" sx={{ margin: "0.1rem 0" }}>
        Ground Control Points
      </Divider>

      <FormControl className="degrees-selection">
        <FormLabel>Degrees Type</FormLabel>
        &nbsp; &nbsp;
        <RadioGroup
          row
          className="gcp-list-degrees"
          aria-labelledby="degrees-type-selection"
          value={degreesType}
          onChange={(e) => setDegreesType(e.target.value)}
        >
          <FormControlLabel
            value={DegreeType.DMS}
            control={<Radio size="small" />}
            label="DMS"
          />
          <FormControlLabel
            value={DegreeType.DD}
            control={<Radio size="small" />}
            label="DECIMAL"
          />
          <FormControlLabel
            value={DegreeType.UTM}
            control={<Radio size="small" />}
            label="UTM"
          />
        </RadioGroup>
      </FormControl>

      <div className="gcp-list">
        <div ref={scrollerRef}>
          {forceCogCache.isPending ? (
            <div className="loading-tiles">
              <MapSpinner />
            </div>
          ) : (
            gcps.map((gcp, i) => (
              <GCPCard
                key={
                  gcp.gcp_id +
                  gcp.columns_from_left.toString() +
                  gcp.rows_from_top.toString() +
                  degreesType
                }
                gcp={gcp}
                updateGCP={updateGCP}
                deleteGCP={deleteGCP}
                height={height}
                degreesType={degreesType}
                readonly={readonly}
              >
                <ClipComponent
                  cog_id={cog_id}
                  gcp={gcp}
                  updateGCP={updateGCP}
                  height={height}
                />
              </GCPCard>
            ))
          )}
        </div>
      </div>
    </>
  );
}

export default GCPList;
