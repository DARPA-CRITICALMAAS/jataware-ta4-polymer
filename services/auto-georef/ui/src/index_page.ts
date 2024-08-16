import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import Draw, { createBox } from "ol/interaction/Draw";
import { transform } from "ol/proj";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import "./rSlider.js";
import { handleMapUpload } from "./uploadMap"
import { initAutocomplete as initStateAutocomplete } from "./state_autocomplete";
import { initAutocomplete as initRockUnitsAutocomplete } from "./rock_units_autocomplete";
import { initAutocomplete as initCMAAutocomplete, CMA_LAYER_ID } from "./cma_autocomplete";
import { setUpZipFileHandler, SHAPEFILE_LAYER_ID } from "./shapefile_parser";
import { clearShapeOpenLayers } from "./geo";

/* Create the background map */

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

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
});

const map = new Map({
  layers: [base_layer, clip_layer],
  view: new View({
    center: [-11068546.533293726, 4711971.846945472],
    zoom: 5.3,
  }),
  controls: [],
});

window.polymer_map = map;


/* Polygon Drawing Controls */

const getLayerById = function (map, layerId) {
  let layerFound = null;
  map.getLayers().forEach(function (layer) {
    if (layer.get("id") === layerId) {
      layerFound = layer;
    }
  });

  return layerFound;
};

function remove_old_clip() {
  let feature_source = getLayerById(
    map,
    "bounding-box",
  ).getSource();
  let features = feature_source.getFeatures();

  if (features.length == 1) {
    feature_source.removeFeature(features[0]);
  }
}

const state_autocomplete = document.getElementById("state_input");
const multiPolygonElem = document.querySelector("input[name='multi_polygons_intersect']");
const cma_autocomplete = document.getElementById("cma-input");

const draw = new Draw({
  source: clip_source,
  type: "Circle",
  geometryFunction: createBox(),
});

draw.setActive(false);
map.addInteraction(draw);


const transformPolygonCoordinates = (coordinates, source, dest) => {
  let new_coords = [];
  for (let arr of coordinates) {
    let new_arr = [];
    for (let x of arr) {
      new_arr.push(transform(x, source, dest));
    }
    new_coords.push(new_arr);
  }
  return new_coords;
};


draw.on("drawend", function ({feature}) {

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
        "EPSG:3857",
        "EPSG:4326",
      );
      new_coords.push(destCoordinates);
      convertedGeojsonFeature.geometry.coordinates = new_coords;
    } else if (bbox.getGeometry().getType() == "MultiPolygon") {
      convertedGeojsonFeature = geojsonFormat.writeFeatureObject(bbox);
      sourceCoordinates = convertedGeojsonFeature.geometry.coordinates;
      let new_coords = [];
      for (let poly of sourceCoordinates) {
        new_coords.push(
          transformPolygonCoordinates(poly, "EPSG:3857", "EPSG:4326"),
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


/* Set ol/map target to div#map element */
map.setTarget(document.querySelector("#map"));



/* Expand 10k -> 10,000 ; 10m -> 10,000,000 */
function expandMetricPrefix(input) {
  const metricPrefixes = {
    k: 1e3,
    m: 1e6,
  };

  const value = parseFloat(input);
  if (isNaN(value)) {
    return 0;
  }
  const prefix = input.charAt(input.length - 1).toLowerCase();

  if (metricPrefixes.hasOwnProperty(prefix)) {
    return value * metricPrefixes[prefix];
  } else {
    return value;
  }
}

/* Scale/Year slider js setup */

let scaleSlider = new rSlider({
  target: '#scale',
  values: [0, "10k", "25k", "50k", "100k", "10m", "max"],
  range: true,
  tooltip: false,
  scale: true,
  labels: true,
  set: [0, "max"],
  outFormatter: (value) => {
    const [start, end] = value.split(",");
    return [expandMetricPrefix(start), expandMetricPrefix(end)];
  }

});

const currentYear = new Date().toLocaleString(undefined, {
  year: "numeric"
});

let yearSlider = new rSlider({
  target: '#publish_year',
  values: [0, "1900", "1925", "1950", "1975", "2000", currentYear],
  range: true,
  tooltip: false,
  scale: true,
  labels: true,
  set: [0, currentYear],
});


/* Setup US State, RockUnits Autocomplete(s) */

initStateAutocomplete(
  state_autocomplete,
  multiPolygonElem,
  document.getElementById('state-autocomplete-results'),
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

/* Upload Map to CDR and polling for map-processing job status */

document
  .getElementById('upload-button')
  .addEventListener('click', handleMapUpload);

function handleUploadCancel(e) {
  e.preventDefault();
  document.getElementById('map-upload-details').classList.add('hidden');
  document.getElementById('cdr-map-file-input').value = null;
}

document
  .getElementById('upload-cancel-button')
  .addEventListener('click', handleUploadCancel);


/* Toggle between draw bounds mode and select state mode for filtering search */

const boundRadios = document.querySelectorAll('input[name=radio-bounds]');
const zipFileContainer = document.getElementById("shapefiles-input-wrapper");
const cmaContainer = document.getElementById("cma-filter-wrapper");

boundRadios.forEach(radioInput => {
  radioInput
    .addEventListener('change', evt => {

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
        state_autocomplete.classList.remove('hidden');
      } else if (value === "draw") {
        draw.setActive(true);
      } else if (value === "upload") { // == "upload"
        zipFileContainer.classList.remove("hidden");
      } else { // == cma
        cmaContainer.classList.remove("hidden");
      }

    });
});

document.getElementById("clear-search-results")
  .addEventListener("click", () => {
    document.getElementById("browse-results").classList.add("hidden");
  });


document.getElementById('submit-search-button')
  .addEventListener("click", () => {

    document.getElementById("maps-results-count").classList.add("hidden");

    const form = document.getElementById("search-maps-form");
    const body = new FormData(form);
    body.append("count", true);

    fetch(`${window.template_prefix}/search-maps`, {
      method: "POST",
      body
    }).then(r => {
      if (r.status === 200) {
        return r.json();
      }
    })
      .then(asJson => {
        if (typeof asJson === "number") {
          document.getElementById("maps-results-count").innerText = `of ${asJson} matches`;
          document.getElementById("maps-results-count").classList.remove("hidden");
        }
      })
      .catch(e => {
        document.getElementById("maps-results-count-total").classList.add("hidden");
      });

    document.getElementById('browse-results').classList.remove("hidden");

  });

setUpZipFileHandler();