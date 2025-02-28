import React, { useEffect, useState, useRef } from "react";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import XYZ from "ol/source/XYZ";
import { Typography, Slider } from "@mui/material";
import {
  determineMapSourceURL,
  getColorForProvenance,
  valuetext,
  handleOpacityChange,
  getLayerById,
} from "./helpers";
import View from "ol/View";
import { transformExtent, get as getProjection } from "ol/proj";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { useConfig } from '../ConfigContext';

// const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

function SmallProjectionClipped({
  cog_id,
  proj_info,
  clippedState,
  baseMapSources,
  parentBaseMap,
  crs_names,
}) {
  const config = useConfig();

  let bbox = clippedState["clipExentRef"];
  let center = clippedState["clippedCenter"];
  let sourceProjection = clippedState["clippedProjection"];
  const mapTargetElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef();
  const mapExtent = useRef();
  var targetProjection = getProjection(proj_info["crs"]);
  const [baseMapSelected, setBaseMapSelected] = useState(true);

  const map_source = new GeoTIFF({
    sources: [
      {
        url: determineMapSourceURL(proj_info, cog_id, config),
        nodata: -1,
      },
    ],
    convertToRGB: true,
    interpolate: false,
  });

  const map_layer = new TileLayer({
    id: "map-layer",
    source: map_source,
  });

  // --
  const base_source = new XYZ({
    // projection: mapData['proj_info'][proj_index.current]['epsg_code'],
    url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${config.MAPTILER_KEY}`,
    crossOrigin: "",
  });

  const base_layer = new TileLayer({
    id: "base-layer",
    source: base_source,
    visible: true,
  });

  // historic base layer
  const wmts_layer = new TileLayer({
    id: "historic-layer",
  });
  if (parentBaseMap != "Satellite") {
    wmts_layer.setSource(baseMapSources[parentBaseMap]);
    wmts_layer.setVisible(true);
    base_layer.setVisible(false);
  } else {
    wmts_layer.setSource(baseMapSources["USGSTopo"]);
    wmts_layer.setVisible(false);
  }

  useEffect(() => {
    map_layer.setOpacity(0.4);
    const map = new Map({
      layers: [base_layer, wmts_layer, map_layer],
      controls: [],
      view: new View({
        center: center,
        zoom: 10,
        projection: proj_info["crs"],
      }),
    });
    map.setTarget(mapTargetElement.current || "");
    mapRef.current = map;
    mapExtent.current = transformExtent(
      bbox,
      sourceProjection,
      targetProjection,
    );
    map.getView().fit(mapExtent.current);

    return () => map.setTarget("");
  }, []);

  useEffect(() => {
    mapExtent.current = transformExtent(
      bbox,
      sourceProjection,
      targetProjection,
    );
    mapRef.current.getView().fit(mapExtent.current);
  }, [clippedState]);

  function switchBaseMap() {
    if (baseMapSelected) {
      getLayerById(mapRef.current, "base-layer").setVisible(true);
      getLayerById(mapRef.current, "historic-layer").setVisible(false);
    } else {
      getLayerById(mapRef.current, "base-layer").setVisible(false);
      getLayerById(mapRef.current, "historic-layer").setVisible(true);
    }

    setBaseMapSelected(!baseMapSelected);
  }

  return (
    <>
      <div
        className="borderBox"
        style={{
          justifySelf: "center",
          alignSelf: "center",
          margin: "10px",
        }}
      >
        <Typography id="continuous-slider" gutterBottom>
          Provenance:
          <span
            style={{
              marginLeft: "5px",
              marginTop: "5px",
              color: getColorForProvenance(proj_info["provenance"]),
            }}
          >
            {proj_info["provenance"]}
          </span>
        </Typography>
        <Typography
          id="continuous-slider"
          gutterBottom
          style={{ minWidth: "350px", maxWidth: "350px" }}
        >
          Map Projection:
          <span style={{ marginLeft: "5px" }}>
            {crs_names[proj_info["crs"]]}
          </span>
          <span style={{ marginLeft: "5px" }}>({proj_info["crs"]})</span>
        </Typography>
        <Typography id="continuous-slider" gutterBottom>
          GCPs: {proj_info["gcps"].length}
        </Typography>

        <Slider
          aria-label="Continuous slider"
          defaultValue={40}
          step={10}
          valueLabelDisplay="auto"
          onChange={(e) => handleOpacityChange(e, mapRef.current)}
          valueLabelFormat={valuetext}
        />
        <FormControlLabel
          control={
            <Switch
              checked={baseMapSelected}
              onChange={() => {
                switchBaseMap();
              }}
            />
          }
          label="Change baselayer"
        />

        <div
          ref={mapTargetElement}
          className="map"
          style={{
            border: "1px solid",
            borderColor: "red",
            minWidth: "280px",
            height: "260px",
            position: "relative",
          }}
        ></div>
      </div>
    </>
  );
}
export default SmallProjectionClipped;
