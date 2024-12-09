// helpers.js

import { register } from "ol/proj/proj4";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import GeoJSON from "ol/format/GeoJSON";
import { transform } from "ol/proj";
import TileLayer from "ol/layer/WebGLTile";
import axios from "axios";
import { useConfig } from '../ConfigContext';
import proj4 from "proj4";

// const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
// const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;

// const POLYMER_COG_URL = import.meta.env.VITE_POLYMER_COG_URL;
// const POLYMER_PUBLIC_BUCKET = import.meta.env.VITE_POLYMER_PUBLIC_BUCKET;

// const CDR_S3_COG_PRO_PREFEX = import.meta.env.VITE_CDR_S3_COG_PRO_PREFEX;
// const POLYMER_S3_COG_PRO_PREFEX = import.meta.env
//   .VITE_POLYMER_S3_COG_PRO_PREFEX;
// --
// Map helpers

export const provenance_colors = {
  "ngmdb_2.0": "var(--mui-palette-success-main)",
  "polymer_0.0.1": "var(--mui-palette-Alert-infoColor)",
  "uncharted-process_0.0.2": "#4B0082",
  "jataware_georef_0.1.0": "#690fda",
};

export function checkIfEdited(gcp) {
  // GCP was edited and used before
  const hasBeenUsed = ![null, undefined].includes(gcp["reference_id"]);
  // GCP edited, will make a new gcp when used in georeferencing
  const { just_edited: justEdited } = gcp;

  return hasBeenUsed || justEdited;
}

export function getColorForProvenance(provenance) {
  return provenance_colors[provenance] || "#000000"; // Return black if the key is not found
}

export const handleOpacityChange = function (e, map) {
  const opacity = parseFloat(e.target.value) / 100;
  getLayerById(map, "map-layer").setOpacity(opacity);
};

export const gcp2box = function (
  {
    columns_from_left,
    rows_from_top,
    longitude,
    latitude,
    crs,
    gcp_id,
    color,
    system,
    system_version,
    provenance,
    model,
    model_version,
    just_edited,
  },
  height,
) {
  const BUFFER = 150;

  if (columns_from_left === undefined) console.log("!!! ERROR");
  if (rows_from_top === undefined) console.log("!!! ERROR");

  return new GeoJSON().readFeature({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [columns_from_left - BUFFER, height - rows_from_top - BUFFER],
          [columns_from_left + BUFFER, height - rows_from_top - BUFFER],
          [columns_from_left + BUFFER, height - rows_from_top + BUFFER],
          [columns_from_left - BUFFER, height - rows_from_top + BUFFER],
          [columns_from_left - BUFFER, height - rows_from_top - BUFFER],
        ],
      ],
    },
    properties: {
      color: color,
      columns_from_left: columns_from_left,
      rows_from_top: rows_from_top,
      longitude: longitude,
      latitude: latitude,
      gcp_id: gcp_id,
      crs: crs,
      minimize: false,
      system: system,
      system_version: system_version,
      provenance: provenance,
      model: model,
      model_version: model_version,
      just_edited: just_edited,
      description: "This is a sample description",
    },
  });
};

export const getLayerById = function (map, layerId) {
  let layerFound = null;
  map.getLayers().forEach(function (layer) {
    if (layer.get("id") === layerId) {
      layerFound = layer;
    }
  });

  return layerFound;
};

export const expand_resolutions = function (v, max_steps, min_steps) {
  let out = [...v.resolutions];
  let prefix = [];
  const max_res = v.resolutions[0];
  for (let i = 1; i < max_steps; i++) {
    out.unshift(max_res * Math.pow(2, i));
  }

  let suffix = [];
  const min_res = v.resolutions[v.resolutions.length - 1];
  for (let i = 1; i < min_steps; i++) {
    out.push(min_res / Math.pow(2, i));
  }

  return out;
};

// --
// Decimal <-> DMS helpers

export const dec2dms = function (decimal) {
  // [TODO ] error handling

  const isNegative = decimal < 0;
  const absDecimal = Math.abs(decimal);

  const hours = Math.floor(absDecimal);
  const minutesFloat = (absDecimal - hours) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60);
  if (seconds == 60) {
    minutes = minutes + 1
    seconds = 0
  }
  return (
    (isNegative ? "-" : "") + hours + "° " + minutes + "' " + seconds + '"'
  );
};

export const dms2dec = function (dms) {
  // [TODO] error handling

  // const regex = /(-?)(\d+)°\s?(\d+)'?\s?(\d+)?"/;
  // const result = dms.match(regex);
  const regex = /^(-)?(\d{1,3})°\s?(\d{1,2})'?\s?(?:(\d{1,2}(\.\d+)?)")?$/;

  // Match the input against the regex
  const result = dms.trim().match(regex);

  if (!result) {
    throw new Error(
      "Invalid DMS format. Expected format: {degrees}° {minutes}' {seconds}\""
    );
  }
  console.log(result)
  if (!result) {
    throw new Error("Invalid DMS format");
  }

  const sign = result[1] === "-" ? -1 : 1;
  const degrees = parseFloat(result[2]);
  const minutes = parseFloat(result[3]);
  const seconds = parseFloat(result[4] || "0");

  return (sign * (degrees + minutes / 60 + seconds / 3600)).toFixed(10);
};

// --
// Projection helpers

function modifyProj4String(input) {
  if (input.includes("+ellps=clrk66")) {
    const params = input.split(" ");
    // Filter out the '+nadgrids=' parameter and value
    const filteredParams = params.filter(
      (param) => !param.startsWith("+nadgrids="),
    );
    // add '+towgs84=-8,160,176,0,0,0,0'
    return filteredParams.join(" ") + " +towgs84=-8,160,176,0,0,0,0";
  }
  return input;
}
function _register_proj(code, wkt, bbox, proj4_) {
  let extent_wgs = [bbox[1], bbox[2], bbox[3], bbox[0]];
  if (bbox[1] > bbox[3])
    extent_wgs = [bbox[1], bbox[2], bbox[3] + 360, bbox[0]];

  proj4_ = modifyProj4String(proj4_);
  proj4.defs(code, proj4_);
  register(proj4);
}

export const register_proj = async function (query) {
  const response = await fetch("https://epsg.io/?format=json&q=" + query);
  const json = await response.json();
  const results = json["results"];
  if (results && results.length > 0) {
    const results = json["results"];
    if (results && results.length > 0) {
      for (let i = 0, ii = results.length; i < ii; i++) {
        const result = results[i];
        if (result) {
          const auth = result["authority"];
          const code = result["code"];
          const wkt = result["wkt"];
          const proj4_ = result["proj4"];
          const bbox = result["bbox"];
          if (
            code &&
            code.length > 0 &&
            wkt &&
            wkt.length > 0 &&
            bbox &&
            bbox.length == 4
          ) {
            await _register_proj(`${auth}:${code}`, wkt, bbox, proj4_);
          }
        }
      }
    }
  }
};
export const valuetext = function (value) {
  return `${Math.round(value)}%`;
};

export const basemapURLS = [
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
  // "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
];

const WMTSParser = new WMTSCapabilities();

export async function loadWMTSLayer(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();

    // Parse the WMTS capabilities
    const result = WMTSParser.read(text);

    let layers_ = {};
    let sources_ = {};
    for (let layer_ of result["Contents"]["Layer"]) {
      let Layers_ = {};

      Layers_["layer"] = layer_["Identifier"];
      const options = optionsFromCapabilities(result, Layers_);
      // Set additional options
      options.attributions = "USGS" + new Date().getFullYear();
      options.crossOrigin = "";
      options.projection = "EPSG:3857";
      options.wrapX = false;

      // Set the WMTS source
      let layer = new TileLayer({
        id: layer_["Identifier"],
        visible: false,
      });
      let layer_source = new WMTS(options);
      layer.setSource(layer_source);
      layers_[layer_["Identifier"]] = layer;
      sources_[layer_["Identifier"]] = layer_source;
    }

    return [layers_, sources_];
  } catch (error) {
    console.error("Error loading WMTS layer:", error);
    return {};
  }
}

export function sortByGcpId(arrayOfGCPs) {
  return arrayOfGCPs.slice().sort((a, b) => {
    const gcpIdA = a.gcp_id;
    const gcpIdB = b.gcp_id;
    return gcpIdA.localeCompare(gcpIdB); // Use localeCompare for string comparison
  });
}

export function returnImageBufferUrl(cog_id, gcp, height) {
  return (
    "/api/map/clip-tiff?cog_id=" +
    cog_id +
    "&coll=" +
    parseInt(gcp["columns_from_left"]) +
    "&rowb=" +
    parseInt(height - gcp["rows_from_top"])
  );
}

export function determineMapSourceURL(projection_info, cog_id, config) {

  if (projection_info?.in_cdr) {
    return `${config.CDR_COG_URL}/${config.CDR_PUBLIC_BUCKET}/${config.CDR_S3_COG_PRO_PREFEX}/${cog_id}/${projection_info["system"]}/${projection_info["system_version"]}/${projection_info["projection_id"]}`;
  } else {
    return `${config.POLYMER_COG_URL}/${config.POLYMER_PUBLIC_BUCKET}/${config.POLYMER_S3_COG_PRO_PREFEX}/${cog_id}/${projection_info["projection_id"]}`;
  }
}

export function createPath(status, dir) {
  let path = dir + "/projections/";
  if (status == "not_georeferenced") {
    path = dir + "/points/";
  }
  if (status == "not_a_map") {
    path = dir + "/points/";
  }
  if (status == "legendAnnotation") {
    path = dir + "/legendAnnotation/";
  }
  return path;
}

export const oneMap = async (status, navigate, nav_path) => {
  let path;
  if (status == "not_georeferenced") path = "false";
  if (status == "georeferenced") path = "true";

  try {
    let { data } = await axios({
      method: "get",
      url: "/api/map/search/random_cog?georeferenced=" + path,
    });
    if (data) {
      console.log(data);
      navigate(nav_path + data[0]["cog_id"]);
      navigate(0);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }
};

export const findFeatureByAttribute = function (
  source,
  attributeName,
  attributeValue,
) {
  return source
    .getFeatures()
    .find((feature) => feature.get(attributeName) === attributeValue);
};

export const returnImageUrl = function (cog_id, extent) {
  if (extent == null || (Array.isArray(extent) && extent.length === 0)) {
    return "";
  }

  return (
    "/api/map/clip-bbox?cog_id=" +
    cog_id +
    "&minx=" +
    parseInt(extent[0]) +
    "&miny=" +
    parseInt(extent[1]) +
    "&maxx=" +
    parseInt(extent[2]) +
    "&maxy=" +
    parseInt(extent[3])
  );
};

export const validateExtent = function (extent) {
  if (extent == null || (Array.isArray(extent) && extent.length === 0)) {
    return false;
  }
  return true;
};

export const returnInCDR = function (in_cdr) {
  if (in_cdr) {
    return "TRUE";
  }
  return "FALSE";
};

export const returnInCDRStyle = function (in_cdr) {
  if (in_cdr) {
    return {
      marginRight: "5px",
      background: "var(--mui-palette-success-light)",
    };
  }
  return { marginRight: "5px" };
};

export function getShapeCenterPoint(coordinatesArray) {
  const pointsCount = coordinatesArray.length;
  // add up lon(s), lat(s), output new point like: [100, 200]
  const lon = 0;
  const lat = 1;
  const [avgLon, avgLat] = coordinatesArray.reduce(
    (acc, curr) => [acc[lon] + curr[lon], acc[lat] + curr[lat]],
    [0, 0],
  );
  // average by dividing each lon/lat by pointsCount
  return [avgLon / pointsCount, avgLat / pointsCount];
}

export function numberToFixed(latOrLon) {
  return latOrLon ? latOrLon.toFixed(4) : "";
}
