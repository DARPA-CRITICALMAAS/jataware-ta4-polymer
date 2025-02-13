import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import Draw, { createBox } from "ol/interaction/Draw";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";

import "./rSlider";
import "./uploadMap";
import { initAutocomplete as initStateAutocomplete } from "./state_autocomplete";
import { initAutocomplete as initRockUnitsAutocomplete } from "./rock_units_autocomplete";
import {
  initAutocomplete as initCMAAutocomplete,
  CMA_LAYER_ID,
} from "./cma_autocomplete";
import { setUpZipFileHandler, SHAPEFILE_LAYER_ID } from "./shapefile_parser";
import {
  clearShapeOpenLayers,
  transformPolygonCoordinates,
  openLayersDefaultProjection,
  cdrDefaultProjection,
  defaultLayerStyle,
  mapLayerById
} from "../geo";

import { expandSearchResults, expandMetricPrefix } from "../common";

import "./cma_cog_selector";
import "./cog_result_focus_extent";
import "./browse_by_id";

/* Create the background map */

const MAPTILER_KEY = window?.polymer?.MTK;

const base_source = new XYZ({
  url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
  crossOrigin: "",
});

const base_layer = new TileLayer({
  id: "Satellite",
  source: base_source,
  visible: true,
});

const clip_source = new VectorSource({ wrapX: false });
const clip_layer = new VectorLayer({
  id: "bounding-box",
  source: clip_source,
  style: defaultLayerStyle,
});

const map = new Map({
  layers: [base_layer, clip_layer],
  view: new View({
    center: [-11068546.533293726, 4711971.846945472],
    zoom: 5.3,
  }),
  controls: [],
});

window.polymer_map = map; // set globally for other htmx-fragments/js-files to use

/* Polygon Drawing Controls */
function remove_old_clip() {
  let feature_source = mapLayerById(map, "bounding-box").getSource();
  let features = feature_source.getFeatures();

  if (features.length == 1) {
    feature_source.removeFeature(features[0]);
  }
}

const draw = new Draw({
  source: clip_source,
  type: "Circle",
  geometryFunction: createBox(),
});

// Mostly copied over from V1 implementation
draw.on("drawend", function ({ feature }) {
  remove_old_clip();

  let bbox = feature;

  let convertedGeojsonFeature;

  const geojsonFormat = new GeoJSON();

  if (bbox !== undefined) {
    let sourceCoordinates;
    let destCoordinates;

    if (bbox.getGeometry().getType() == "Polygon") {
      convertedGeojsonFeature = geojsonFormat.writeFeatureObject(bbox);
      sourceCoordinates = convertedGeojsonFeature.geometry.coordinates;
      let new_coords = [];
      destCoordinates = transformPolygonCoordinates(
        sourceCoordinates,
        openLayersDefaultProjection,
        cdrDefaultProjection,
      );
      new_coords.push(destCoordinates);
      convertedGeojsonFeature.geometry.coordinates = new_coords;
    } else if (bbox.getGeometry().getType() == "MultiPolygon") {
      convertedGeojsonFeature = geojsonFormat.writeFeatureObject(bbox);
      sourceCoordinates = convertedGeojsonFeature.geometry.coordinates;
      let new_coords = [];
      for (let poly of sourceCoordinates) {
        new_coords.push(
          transformPolygonCoordinates(
            poly,
            openLayersDefaultProjection,
            cdrDefaultProjection,
          ),
        );
      }
      convertedGeojsonFeature.geometry.coordinates = new_coords;
    }

    multiPolygonElem.value = JSON.stringify({
      coordinates: convertedGeojsonFeature.geometry.coordinates,
      type: "MultiPolygon",
    });
  }
});

// Besides change, when clicking on this once disabled, it should re-enable it
document
  .getElementById("draw-on-map-enable")
  .addEventListener("mouseup", (e) => {
    draw.setActive(true);
  });

draw.setActive(false);
map.addInteraction(draw);

/* Set ol/map target to div#map element */
map.setTarget(document.querySelector("#map"));

/* Scale/Year slider js setup */

new rSlider({
  target: "#scale",
  values: [0, "10k", "25k", "50k", "100k", "10m", "max"],
  range: true,
  tooltip: false,
  scale: true,
  labels: true,
  set: [0, "max"],
  outFormatter: (value) => {
    const [start, end] = value.split(",");
    return [expandMetricPrefix(start), expandMetricPrefix(end)];
  },
});

const currentYear = new Date().toLocaleString(undefined, {
  year: "numeric",
});

new rSlider({
  target: "#publish_year",
  values: [0, "1900", "1925", "1950", "1975", "2000", currentYear],
  range: true,
  tooltip: false,
  scale: true,
  labels: true,
  set: [0, currentYear],
  outFormatter: (value) => {
    const [start, end] = value.split(",");
    let outEndVal = end;
    if (end === currentYear) {
      // send the max "default" of 0 to server
      // which knows what to do with this
      // Important to ensure maps with no year set are found when default 
      // of `currentYear` (eg 2024 as of today) is left in on UI range
      outEndVal = 0;
    }
    return [start, outEndVal];
  },
});


/* === Setup US State, RockUnits Autocomplete(s) === */

const state_autocomplete = document.getElementById("state_input");
// Various boundix box search update this input to send to server
const multiPolygonElem = document.querySelector(
  "input[name='multi_polygons_intersect']",
);
const cma_autocomplete = document.getElementById("cma-input");

initStateAutocomplete(
  state_autocomplete,
  multiPolygonElem,
  document.getElementById("state-autocomplete-results"),
);

initRockUnitsAutocomplete(
  document.getElementById("rock-units-autocomplete"),
  document.getElementById("rock-units-autocomplete-results"),
);

initCMAAutocomplete(
  cma_autocomplete,
  multiPolygonElem,
  document.getElementById("cma-autocomplete-results"),
);


const boundRadios = document.querySelectorAll("input[name=radio-bounds]");
const zipFileContainer = document.getElementById("shapefiles-input-wrapper");
const cmaContainer = document.getElementById("cma-filter-wrapper");

/* Toggle between draw bounds mode, select state mode, shapefile, cma extent */

boundRadios.forEach((radioInput) => {
  radioInput.addEventListener("change", (evt) => {
    const { value } = evt.target;

    // radio changed, we should reset hidden field value
    // until user sets one explicitly
    multiPolygonElem.value = null;
    multiPolygonElem.dataset.label = "";

    // reset drawing
    remove_old_clip();
    draw.setActive(false);

    // reset state selection
    state_autocomplete.value = null;
    state_autocomplete.classList.add("hidden");

    // reset shapefile zip data
    zipFileContainer.classList.add("hidden");
    clearShapeOpenLayers(SHAPEFILE_LAYER_ID);
    document.getElementById("shapefiles-file-input").value = null;

    // reset cma selection
    cma_autocomplete.value = null;
    cmaContainer.classList.add("hidden");
    clearShapeOpenLayers(CMA_LAYER_ID);

    if (value === "state") {
      state_autocomplete.classList.remove("hidden");
    } else if (value === "draw") {
      draw.setActive(true);
    } else if (value === "upload") {
      // == "upload"
      zipFileContainer.classList.remove("hidden");
    } else {
      // == cma
      cmaContainer.classList.remove("hidden");
    }
  });
});

// allow button to collapse/expand search results on right of landing page to
// make more space to explore background map if user requires it
document
  .getElementById("toggle-search-results")
  .addEventListener("click", (e) => {
    const resultsWrapper = document.getElementById("browse-results");
    const resultsContainer = document.getElementById("map-results-target");
    const icon = e.target.querySelector("svg");

    const collapsed = [...resultsContainer.classList].includes("hidden");

    expandSearchResults(resultsContainer, resultsWrapper, icon, { invert: !collapsed });

    e.preventDefault();
  });

// Add count and toggle some areas upon pressing `search` to get new maps
document
  .getElementById("submit-search-button")
  .addEventListener("click", (e) => {
    const { target } = e;

    document.getElementById("maps-results-count").classList.add("hidden");

    if (target.dataset.mode === "ocr") {
      document.getElementById("browse-results").classList.remove("hidden");
      return;
    }

    // In case we were in drawing bounding box mode.
    // User should re-enable explicitly
    draw.setActive(false);

    const form = document.getElementById("search-maps-form");
    const body = new FormData(form);
    body.append("count", true);

    fetch(`${window.template_prefix}/search-maps`, {
      method: "POST",
      body,
    })
      .then((r) => {
        if (r.status === 200) {
          return r.json();
        }
      })
      .then((asJson) => {
        if (typeof asJson === "number") {
          document.getElementById("maps-results-count").innerText =
            `of ${asJson} matches`;
          document
            .getElementById("maps-results-count")
            .classList.remove("hidden");
        }
      })
      .catch((e) => {
        document
          .getElementById("maps-results-count-total")
          .classList.add("hidden");
      });

    document.getElementById("browse-results").classList.remove("hidden");
  });

// for selecting shapefile to use for bounding box for search
setUpZipFileHandler();
