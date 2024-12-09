import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import MVT from 'ol/format/MVT';

import VectorTileSource from 'ol/source/VectorTile';
import VectorTileLayer from 'ol/layer/VectorTile';

import {
  initAutocomplete as initCMAAutocomplete,
  CMA_LAYER_ID,
} from "../index/cma_autocomplete";
import {
  clearShapeOpenLayers,
  transformPolygonCoordinates,
  openLayersDefaultProjection,
  cdrDefaultProjection,
  drawPolygonWithLayerID,
  centerMapToExtent,
  mapLayerById
} from "../geo";
import { sleep, displayElemTemporarily, generateHexColor } from "../common";
import { toggleLayerVisibility, removeVectorTileLayers, styleFactory, Feature } from "./geo_utils";
import { createPackagingJobs } from "./packaging";
import { createRasterJobs } from "./rasterize";

import "../index/cma_cog_selector";

/* Create the background map */

const MAPTILER_KEY = window?.polymer?.MTK;
const MAPS_LAYER_ID = "all-results";

const boundRadios = document.querySelectorAll("input[name=radio-bounds]");
const cmaContainer = document.getElementById("cma-filter-wrapper");
const mapIDsContainer = document.getElementById("map-ids-wrapper");
const selectedMapIDsElem = document.getElementById("selected-map-ids");
const submitButton = document.getElementById("submit-display-button");
const submitLoading = document.getElementById("updating-tiles-loading");
const cma_autocomplete = document.getElementById("cma-input");
const toast = document.getElementById("error-toast");
const formAlert = document.getElementById("form-update-alert");
const createPackageBtn = document.getElementById("create-package-button");
const createRasterBtn = document.getElementById("create-raster-button");

const cached_maps = {};

let state = {
  submitted: false,
  fetchingTiles: false,
  tilePromises: [],
  layerUrls: []
  // didReset: false
};

// mode used on name= attributes of Search-By radio buttons in form
enum SearchMode {
  CMA = "cma",
  MAP = "map_ids"
}

/**
 *
 *
 */
function isFormValid() {
  const atLeastOneFeature = Boolean(document.querySelector('.feature-checkbox[type="checkbox"]:checked'));

  const enabledFeatureFilters = document.querySelectorAll('.feature-filters:not(.hidden)');

  const hasMissingTerms = [...enabledFeatureFilters]
      .find(filterSection => {
        return filterSection.querySelectorAll('.selected-terms').length === 0;
      });

  let requiredFieldsCompleted =  atLeastOneFeature && !hasMissingTerms;
  const atLeastCMAorMaps = Boolean(cma_autocomplete.value || selectedMapIDsElem?.children.length);
  requiredFieldsCompleted = requiredFieldsCompleted && atLeastCMAorMaps;

  return requiredFieldsCompleted;
}

/**
 * Start Tile Processor code
 * fetchingTiles processor (loading state)
 */
async function checkFinishedTiles() {
  submitLoading.classList.remove("hidden");
  submitButton.textContent = "Loading Features";
  submitButton.disabled = true;

  // In case the calls are related to each other, let's not get the length yet
  await sleep(1000);
  const prevTilePromisesCount = state.tilePromises.length;

  await Promise.allSettled(state.tilePromises)

  // user zoomed/panned and created new calls since last check..
  if (state.tilePromises.length > prevTilePromisesCount) {
    // need to recur and wait for the new zoom/pan feature promises
    return await checkFinishedTiles();
  }

  // No more files have been queued, clear fetch/queue state for next time user
  // updates features query or modifies the map zoom/pan state
  state.fetchingTiles = false;
  submitButton.textContent = "Display";

  submitButton.disabled = !isFormValid();

  state.tilePromises = [];
  submitLoading.classList.add("hidden");
}

let fetching_handler = {
  set(target, property, value, receiver) {
    const currentVal = target[property];

    // if changing from false to true only
    if (property === "fetchingTiles" && currentVal === false && value === true) {
      checkFinishedTiles();
    }
    return Reflect.set(target, property, value, receiver);
  }
};

state = new Proxy(state, fetching_handler);
/** End Tile Processor code */

const { token } = window;

const base_source = new XYZ({
  url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
  crossOrigin: "",
});

const base_layer = new TileLayer({
  id: "Satellite",
  source: base_source,
  visible: true,
});

const mapsSource = new VectorSource();
const mapsLayer = new VectorLayer({
  id: MAPS_LAYER_ID,
  source: mapsSource,
});

function tileLoadFunction(tile, url) {
  tile.setLoader(function (extent, resolution, projection) {

    const promise = fetch(url, {
      headers: {
        'Authorization': token,
      }
    }).then(function (response) {
      return response.arrayBuffer().then(function (data) {
        const format = tile.getFormat();  // ol/format/MVT configured as source format
        const features = format.readFeatures(data, {
          extent: extent,
          featureProjection: projection
        });

        tile.setFeatures(features);
        return true;
      });
    });

    state.fetchingTiles = true;
    state.tilePromises.push(promise);
  });
}


const createLayerStyles = (color: string) =>
  [Feature.Polygon, Feature.Point, Feature.Line].map(f => styleFactory(f, color));

// Use a custom tileLoadFunction function when creating this vectorTile Source
// as we need to use an authorization header.
// adding cog_ids filters on both cma_id and cog_ids, would show only those cogs within the CMA
// if we skip cma, but send cog ids, only for those cogs not part of any cma_id necessarily


/**
 * 
 * @returns 
 */
function addNewMapSourceLayer(id: string, url: string, color: string) {
  // Should not be the case as caller should remove previous layers, but just in case.
  const layerExists = mapLayerById(map, id);
  if (layerExists) {
    return;
  }

  const tileserver_source = new VectorTileSource({
    // Something like:
    // url: `<host>/v1/tiles/tile/{z}/{x}/{y}?feature_type=polygon&validated=false&cma_id=ESRI:101...longid`,
    url: url,
    format: new MVT(),
    tileLoadFunction,
    crossOrigin: "",
  });

  const tileserver_layer = new VectorTileLayer({
    id,
    source: tileserver_source,
    visible: true,
    style: createLayerStyles(color),
  });

  // Add to map
  map.addLayer(tileserver_layer);
}

function toggleTermLayersToggleIcon(show) {
  const action = show ? "remove" : "add";
  [...document.querySelectorAll(".toggle-term-visibility")].forEach(eyeIcon => {
    eyeIcon.classList[action]("hidden");

    const checkbox = eyeIcon.querySelector("input");
    // re-showing means state had changed, we're resetting ol layers and 
    // we need to reset these eye icon state to unchecked
    if (show) {
      checkbox.checked = false;
    }
  });
}


/**
 *
 */
function updateFormState() {
  if (state.submitted) {
    // changed form, remove previous layers until next display/update
    removeVectorTileLayers();
    createPackageBtn.disabled = true;
    createRasterBtn.disabled = true;
    toggleTermLayersToggleIcon(false);
    formAlert.classList.remove("hidden");
    formAlert.querySelector("span").textContent = "Updated search criteria. Clearing map results.";
    submitButton.textContent = "Update";
  }

  if (!state.fetchingTiles) {
    submitButton.disabled = !isFormValid();
  }
}

function enablePackageCreation() {
  createPackageBtn.classList.remove("hidden");
  createPackageBtn.disabled = false;
  submitButton?.classList.remove("mr-2");
  submitButton?.classList.add("join-item");
}

/**
 *
 */
function enableRasterLayerCreation(mode) {
  const method = mode === SearchMode.CMA ? "remove" : "add";
  createRasterBtn.classList[method]("hidden");
  createRasterBtn.disabled = mode !== SearchMode.CMA;
}

submitButton
  ?.addEventListener("click", () => {
    toggleTermLayersToggleIcon(true);
    submitLoading.classList.remove("hidden");

    // TODO make it tile base url instead of tile host..?
    const baseUrl = `${window.tileHost}/v1/tiles/tile/{z}/{x}/{y}`;
    const cmaPolygonElem = document.querySelector("[name='multi_polygons_intersect']");

    state.layerUrls.length = 0;
    const colors = [];

    var selectedRadio = Array.from(boundRadios).find(radio => radio.checked);
    const mode = selectedRadio.value; // cma || map_ids

    const featureCheckboxes = document.querySelectorAll(".feature-checkbox");
    const selectedFeatures = [...featureCheckboxes].filter(c => c.checked).map(c => c.id.replace("-checkbox", ""));

    selectedFeatures.forEach(feature => {
      const termElems = document.querySelectorAll(`.${feature}-terms`);

      [...termElems].forEach(featureTerm => {
        const color = featureTerm.querySelector("input").value;
        colors.push(color);
        const terms = featureTerm.querySelectorAll(".selected-terms");
        [...terms].forEach(term => {
          let url = baseUrl + "?"; // start of query params

          // if a term  === "*", instead of split|join, we just dont add &search_terms to search
          if(term.textContent.trim() !== "*") {
            let formatted = term.textContent?.split(/\s+/).filter(i => i);
            formatted = formatted.join("&search_terms=");
            url += `search_terms=${formatted}&`;
          }

          url += `feature_type=${feature}`;

          const validated = document.getElementById(`validated_selection_${feature}`).value;
          if (validated === "true" || validated === "false") {
            url += `&validated=${validated}`;
          }
          // cma or map_id
          if (mode === SearchMode.CMA) {
            const cmaId = cmaPolygonElem?.dataset?.id;
            url += `&cma_id=${cmaId}`;
          } else {
            // map_ids
            const mapIdsContainer = selectedMapIDsElem;
            const mapIDs = [...mapIdsContainer.children].map(dom => dom.id.replace("selected-map-", ""));
            url += "&cog_ids=" + mapIDs.join("&cog_ids=");
          }
          state.layerUrls.push(url);
        });
      });
    });

    removeVectorTileLayers();

    state.layerUrls.forEach((uri, idx) => {
      const color = colors[idx];
      addNewMapSourceLayer(uri, uri, color);
    });

    state.submitted = true;
    submitButton.disabled = true;
    formAlert.classList.remove("hidden");
    formAlert.querySelector("span").textContent = "Updating search will clear previous results.";

    enablePackageCreation();
    enableRasterLayerCreation(mode);
  });

// Initialize ol Map and set globally (window)
const map = new Map({
  layers: [base_layer, mapsLayer],
  view: new View({
    center: [-11068546.533293726, 4711971.846945472],
    zoom: 5.3,
  }),
  controls: [],
});
window.polymer_map = map;
/* Set ol/map target to div#map element */
map.setTarget(document.querySelector("#map"));


/* === Setup CMA Autocomplete === */
// Various boundix box search update this input to send to server
const multiPolygonElem = document.querySelector(
  "input[name='multi_polygons_intersect']",
);
initCMAAutocomplete(
  cma_autocomplete,
  multiPolygonElem,
  document.getElementById("cma-autocomplete-results"),
  updateFormState
);


boundRadios.forEach((radioInput) => {
  radioInput.addEventListener("change", (evt) => {
    const { value } = evt.target;

    if (value === "cma") {
      cmaContainer?.classList.remove("hidden");
      mapIDsContainer?.classList.add("hidden");
      // clear map layer and selected maps
      mapsSource.clear();
      while (selectedMapIDsElem.firstChild) {
        selectedMapIDsElem.removeChild(selectedMapIDsElem.firstChild);
      }
      selectedMapIDsElem.classList.add("hidden");
    } else { // maps mode
      // remove selected from CMA input
      cma_autocomplete.value = '';
      multiPolygonElem.value = '';
      multiPolygonElem.dataset.label = '';
      multiPolygonElem.dataset.id = '';

      enableRasterLayerCreation(SearchMode.MAP);

      cmaContainer?.classList.add("hidden");
      mapIDsContainer?.classList.remove("hidden");
      selectedMapIDsElem.classList.remove("hidden");
      clearShapeOpenLayers(CMA_LAYER_ID);
    }

    updateFormState();
  });
});

// could also be named *seen, as we don't want duplicates
const terms_cache = {};

window.removeSearchTerm = (id) => {
  const elementToRemove = document.getElementById(id);
  if (elementToRemove) {
    elementToRemove.parentElement.removeChild(elementToRemove);
    terms_cache[id] = false;
    updateFormState();
  }
}

window.toggleLayerVisibility = toggleLayerVisibility;

function addNewTerm(featureType, termText) {
  let initialColor = generateHexColor();

  // check if term was already added/exists
  const termKey = `${featureType}-${termText}`;

  if (terms_cache[termKey]) {
    return;
  } else {
    terms_cache[termKey] = true;
  }

  let terms = termText.split(/\s+/).map(i => `
    <span class="px-2 py-1 dark:bg-neutral/[0.30] text-slate-500 dark:text-slate-300">
      ${i}
    </span>
  `).join("&nbsp;");

  const termMarkup = `
    <div class="flex items-center ${featureType}-terms" id="${termKey}">
      <div class="flex flex-[2] px-2 items-center gap-1">
        <input class="w-6 bg-transparent cursor-pointer" type="color" value="${'#' + initialColor}" />
        <div class="selected-terms">
          ${terms}
        </div>
      </div>
      <div class="flex flex-1 items-center gap-1 justify-end">
        <label 
        class="swap swap-rotate hidden toggle-term-visibility"
        >
          <!-- this hidden checkbox controls the state -->
          <input type="checkbox" 
            onchange="toggleLayerVisibility(event, '${termKey}')"
          />

          <!-- eye icon -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 swap-off">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path fill-rule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clip-rule="evenodd" />
          </svg>

          <!-- closed eye slash icon -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="text-error size-5 swap-on">
            <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
            <path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
            <path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
          </svg>
        </label>

        <button class="btn btn-sm btn-square btn-ghost text-error" onclick="removeSearchTerm('${termKey}')">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
            stroke="currentColor" class="size-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  `;

  const featureForm = document.getElementById(`search-terms-form-${featureType}`);
  const wrapper = featureForm?.parentElement;
  wrapper.insertAdjacentHTML('beforeend', termMarkup);
  updateFormState();
}

document.querySelectorAll(".add-search-term-button")
  .forEach(addButton => {
    addButton.addEventListener("click", () => {
      const parent = addButton.parentElement;
      const featureType = parent.dataset.feature;
      const input = parent.querySelector(".search-term-input");
      const text = input.value;
      addNewTerm(featureType, text);
      input.value = "";
    });
  })

document.querySelectorAll(".search-term-input")
  .forEach(termsInput => {
    termsInput.addEventListener("keyup", (e) => {

      const button = termsInput.parentElement?.querySelector("button");
      if (termsInput.value) {
        button?.classList.remove("btn-disabled");
      } else {
        button?.classList.add("btn-disabled");
      }

      if (e.key === 'Enter') {
          const parent = termsInput.parentElement;
          const featureType = parent.dataset.feature;
          const text = termsInput.value;
          addNewTerm(featureType, text);
          termsInput.value = "";
          button?.classList.add("btn-disabled");
        }
    });
  });


document.querySelectorAll(".feature-checkbox")
  .forEach(elem => {
    elem.addEventListener("change", (e) => {
      const { checked } = e.target;
      const wrapper = elem.parentElement?.parentElement;
      const filters = wrapper?.querySelector(".feature-filters");
      const op = checked ? "remove" : "add";
      filters.classList[op]("hidden");
      updateFormState();
    })
  });

const mapIdsInput = document.getElementById("map-ids-input");

window.removeSelectedMapID = function(elemID) {
  const elem = document.getElementById(elemID)
  elem?.parentElement?.removeChild(elem);
  updateFormState();
  // Remove extent shape from map
  const mapID = elemID.replace("selected-map-", "");
  const targetFeature = mapsSource.getFeatureById(mapID);
  if (targetFeature) {
    mapsSource.removeFeature(targetFeature);
  }
}

/**
 * 
 */
window.centerSelectedMapID = function(mapID) {

  const map = cached_maps[mapID];

  if (map.cog_id && !map.best_bounds) {
    const noBoundsError = new Error("Map has no best bounds. Centering on map won't work until projections refresh is called.");
    noBoundsError.name = "MissingBestBounds";
    throw noBoundsError;
  }

  const {coordinates, type} = map.best_bounds;

  const destCoordinates = transformPolygonCoordinates(
    coordinates,
    cdrDefaultProjection,
    openLayersDefaultProjection,
  );

  const geoJSON = {
    type: type,
    coordinates: destCoordinates,
  }

  const features = new GeoJSON().readFeatures(geoJSON);
  const geometry = features[0].getGeometry();
  const extent = geometry.getExtent();
  centerMapToExtent(extent);
}

/**
 * Draw map(cog) extent on ol map and save data to memory cache
 */
async function storeMapData(mapID) {
  let json = null;
  // TODO if cached map, don't refetch?
  const response = await fetch(window.map_meta_uri + `?cog_id=${mapID}`);

  if (response.status === 200) {
    json = await response.json();
  } else if (response.status === 404) {
    const jsonDetail = await response.json();
    throw new Error(jsonDetail.detail);
  } else {
    throw new Error(await response.text())
  }

  const { cog_id } = json;

  if (!cached_maps[cog_id]) {
    cached_maps[cog_id] = json;
  }

  const extent = json.best_bounds;

  if (extent) {
    const destCoordinates = transformPolygonCoordinates(
      extent.coordinates,
      cdrDefaultProjection,
      openLayersDefaultProjection,
    );

    const geoJSON = {
      type: "Feature",
      geometry: {
        type: extent.type,
        coordinates: destCoordinates,
      },
      properties: {},
    };

    drawPolygonWithLayerID(
      map,
      MAPS_LAYER_ID,
      geoJSON,
      {
        id: cog_id,
        color: "rgba(92, 115, 239, 1.0)",
        width: 1.5
      },
    );
  }

  return json;
}


mapIdsInput
  ?.addEventListener("keydown", e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      let ids = mapIdsInput.value.split(/\s+/);
      const container = selectedMapIDsElem;

      ids = [...new Set(ids.filter(mid => !!mid))];

      for (let id of ids) {

        const elemID = `selected-map-${id}`;
        let mapMarkup = `
          <div class="flex mb-1" id="${elemID}">
            <span title="${id}" class="px-2 py-1 mr-1 dark:bg-neutral/[0.30] text-slate-500 dark:text-slate-300 max-w-1/2 overflow-x-hidden whitespace-nowrap inline-block text-ellipsis">
              ${id}
            </span>

            <div class="flex flex-1 items-center gap-1 justify-end">
              <button class="btn btn-sm btn-square btn-ghost" onclick="centerSelectedMapID('${id}')">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6" />
                </svg>
              </button>
              <button class="btn btn-sm btn-square btn-ghost text-error" onclick="removeSelectedMapID('${elemID}')">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                  stroke="currentColor" class="size-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        `;

        container.insertAdjacentHTML('beforeend', mapMarkup);
        updateFormState();

        //  fetch the map id to get extent and display on map,
        //    store as I state in order to zoom-to it, etc
        storeMapData(id)
          .then(() => {
            if (ids.length === 1) {
              const onlyID = ids[0];
              centerSelectedMapID(onlyID);
            }
          }).catch(err => {

            if (err.name !== "MissingBestBounds") {
              // map isn't valid, revert addition
              removeSelectedMapID(elemID);
            }

            // show error toast
            toast.querySelector("span").textContent = err;
            displayElemTemporarily(toast, 8);
          });
      }
      e.preventDefault(); // prevent entering a newline..
      mapIdsInput.value = null;
    }
  });

createPackageBtn
  .addEventListener("click", createPackagingJobs.bind(null, state.layerUrls)); // receives event

createRasterBtn
  .addEventListener("click", createRasterJobs.bind(null, state.layerUrls));
