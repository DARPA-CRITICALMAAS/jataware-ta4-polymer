// smallMap.tsx

import React, { useEffect, useState, useRef } from "react";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import GeoJSON from "ol/format/GeoJSON";
import { Circle as CircleStyle, Stroke, Style } from "ol/style";
import { Vector as VectorLayer } from "ol/layer";
import { Button } from "@mui/material";

import { returnImageBufferUrl, expand_resolutions } from "./helpers";


const BUFFER = 250;
import Progress from "@mui/material/CircularProgress";
import { useConfig } from '../ConfigContext';

import { MapSpinner } from "../Spinner";

import "../css/small_map.scss";

function SmallMap({ cog_id, gcp, updateGCP, height }) {
  const config = useConfig();

  const mapTargetElement = useRef<HTMLDivElement>(null);

  const [showMap, setShowMap] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [clipUrl, setClipUrl] = useState(
    returnImageBufferUrl(cog_id, gcp, height),
  );
  const [isLoading, setLoading] = useState(true);
  // --
  // MAP layer

  const map_source = new GeoTIFF({
    sources: [
      {
        url: `${config.CDR_COG_URL}/${config.CDR_PUBLIC_BUCKET}/${config.CDR_S3_COG_PREFEX}/${cog_id}.cog.tif`,
        nodata: -1,
      },
    ],
    convertToRGB: true,
    interpolate: false,
  });

  const map_layer = new TileLayer({
    source: map_source,
  });

  // --
  // VECTOR layer

  const vector_styles = {
    Point: new Style({
      image: new CircleStyle({
        radius: 1,
        stroke: new Stroke({ color: "red", width: 5 }),
      }),
    }),
  };
  const vector_source = new VectorSource({
    features: new GeoJSON().readFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [gcp.columns_from_left, height - gcp.rows_from_top],
            properties: {
              color_: "red",
            },
          },
        },
      ],
    }),
  });

  const vector_layer = new VectorLayer({
    source: vector_source,
    style: function (feature) {
      return vector_styles[feature.getGeometry().getType()];
    },
  });

  useEffect(() => {
    const map = new Map({
      layers: [map_layer, vector_layer],
      controls: [],
      view: map_source.getView().then((v) => {
        v.resolutions = expand_resolutions(v, 0, 7);
        v.extent = [
          gcp.columns_from_left - BUFFER,
          height - gcp.rows_from_top - BUFFER,
          gcp.columns_from_left + BUFFER,
          height - gcp.rows_from_top + BUFFER,
        ];
        return v;
      }),
    });
    map.setTarget(mapTargetElement.current || "");
    map.on("click", (e) => {
      let new_gcp = { ...gcp };
      new_gcp["columns_from_left"] = e.coordinate[0];
      new_gcp["rows_from_top"] = height - e.coordinate[1];
      new_gcp["just_edited"] = true;
      updateGCP(new_gcp, height);
    });

    return () => map.setTarget("");
  }, [gcp]);

  function returnColor(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]} )`;
  }
  function show_rerender() {
    let new_gcp = { ...gcp };
    setClicked(true);
    updateGCP(new_gcp, height);
    setShowMap(true);
  }
  function finishEdit() {
    setShowMap(false);
    setClicked(false);
  }
  function returnHeight() {
    if (showMap) return "250px";
    return "200px";
  }
  function returnHeightMap() {
    if (showMap) return "180px";
    return "200px";
  }

  function onError() {
    setLoading(false);
  }
  function onLoad() {
    setLoading(false);
  }

  if (!clipUrl || !gcp) {
    return (
      <div className="small-map-loading">
        <Progress disableShrink size="10" />
      </div>
    );
  }

  return showMap ? (
    <div
      style={{
        border: `3px solid ${returnColor(gcp.color)}`,
        height: "100%",
        width: "100%",
        display: "grid",
        gridTemplateRows: "4fr 0fr",
      }}
    >
      <div
        ref={mapTargetElement}
        className="map"
        style={{
          border: "5px solid red",
          borderRadius: 5,
          width: "100%",
        }}
      ></div>
      <Button variant="contained" color="success" onClick={finishEdit}>
        Finish Edits
      </Button>
    </div>
  ) : (
    <div
      className="small-map-image-root"
      style={{
        border: `5px solid ${returnColor(gcp.color)}`,
      }}
    >
      {isLoading && (
        <div className="small-map-spinner">
          <MapSpinner />
        </div>
      )}
      <img
        src={clipUrl}
        onError={onError}
        onLoad={onLoad}
        alt="Loading Clipped Map..."
        className={"small-map-image"}
        style={isLoading ? { visibility: "hidden" } : {}}
        onClick={show_rerender}
      />
    </div>
  );
}
export default SmallMap;
