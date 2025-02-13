import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import MVT from 'ol/format/MVT';

import VectorTileSource from 'ol/source/VectorTile';
import VectorTileLayer from 'ol/layer/VectorTile';

import {
    initAutocomplete as initCMAAutocomplete,
} from "../index/cma_autocomplete";
import {
    mapLayerById
} from "../geo";
import { sleep } from "../common";
import { removeVectorTileLayers, styleFactory } from "./geo_utils";
import { createPackagingJobs } from "./packaging";
import { createRasterJobs } from "./rasterize";
import { initAutocomplete as initRockUnitsAutocomplete } from "./rock_units_autocomplete";

/* Create the background map */

const MAPTILER_KEY = window?.polymer?.MTK;
const MAPS_LAYER_ID = "all-results";

const boundRadios = document.querySelectorAll("input[name=radio-bounds]");
const submitButton = document.getElementById("submit-display-button");

const submitLoading = document.getElementById("updating-tiles-loading");
const cma_autocomplete = document.getElementById("cma-input");
const toast = document.getElementById("error-toast");
const formAlert = document.getElementById("form-update-alert");
const createPackageBtn = document.getElementById("create-package-button");
const createRasterBtn = document.getElementById("create-raster-button");
submitButton.disabled = true

let state = {
    submitted: false,
    fetchingTiles: false,
    tilePromises: [],
    layerUrls: []
};

// mode used on name= attributes of Search-By radio buttons in form
enum SearchMode {
    CMA = "cma",
}


initRockUnitsAutocomplete(
    document.getElementById("rock-units-autocomplete"),
    document.getElementById("rock-units-autocomplete-results")
);

/**
 *
 *
 */
function isFormValid() {
    // const atLeastOneFeature = Boolean(document.querySelector('.feature-checkbox[type="checkbox"]:checked'));
    const selectedRockUnitsElem = document.getElementById("selected-rock-units");
    const listItems = selectedRockUnitsElem.querySelectorAll("li");

    if (listItems.length == 0) return false
    // const enabledFeatureFilters = document.querySelectorAll('.feature-filters:not(.hidden)');

    // const hasMissingTerms = [...enabledFeatureFilters]
    //     .find(filterSection => {
    //         return filterSection.querySelectorAll('.selected-terms').length === 0;
    //     });

    // let requiredFieldsCompleted = atLeastOneFeature && !hasMissingTerms;
    // const atLeastCMAorMaps = Boolean(cma_autocomplete.value || selectedMapIDsElem?.children.length);
    // requiredFieldsCompleted = requiredFieldsCompleted && atLeastCMAorMaps;

    // return requiredFieldsCompleted;
    return true
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
        style: styleFactory(color),
    });

    // Add to map
    map.addLayer(tileserver_layer);
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
        submitLoading.classList.remove("hidden");

        // TODO make it tile base url instead of tile host..?
        const baseUrl = `${window.tileHost}/v1/tiles/tile/sgmc/{z}/{x}/{y}`;

        const cmaPolygonElem = document.querySelector("[name='multi_polygons_intersect']");

        const cmaId = cmaPolygonElem?.dataset?.id;

        state.layerUrls.length = 0;
        const colors = [];

        var selectedRadio = Array.from(boundRadios).find(radio => radio.checked);
        const mode = selectedRadio.value; // cma || map_ids

        const selectedRockUnitsElem = document.getElementById("selected-rock-units");
        const listItems = selectedRockUnitsElem.querySelectorAll("li");
        let url;
        if (listItems.length > 0) {
            listItems.forEach((li) => {
                url = baseUrl + "?"; // start of query params
                if (cmaId != undefined) {
                    url += `&cma_id=${cmaId}`;
                }
                let category;
                let colorValue;
                let inputColor;
                li.childNodes.forEach((i) => {
                    category = i?.childNodes[3].textContent.trim().replace(":", "");
                    inputColor = i.querySelector('div .flex input[type="color"]');
                    colorValue = inputColor ? inputColor.value : null;
                })
                colors.push(colorValue)

                const value = li.querySelector("span")?.textContent.trim();
                if (category == "Major1") {
                    url += `&sgmc_geology_major_1=${value}`;
                } else if (category == "Major2") {
                    url += `&sgmc_geology_major_2=${value}`;
                } else if (category == "Major3") {
                    url += `&sgmc_geology_major_3=${value}`;
                } else if (category == "Minor1") {
                    url += `&sgmc_geology_minor_1=${value}`;
                } else if (category == "Minor2") {
                    url += `&sgmc_geology_minor_2=${value}`;
                } else if (category == "Minor3") {
                    url += `&sgmc_geology_minor_3=${value}`;
                } else if (category == "Minor4") {
                    url += `&sgmc_geology_minor_4=${value}`;
                } else if (category == "Minor5") {
                    url += `&sgmc_geology_minor_5=${value}`;
                }
                state.layerUrls.push(url)
            });
        }
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


createPackageBtn
    .addEventListener("click", createPackagingJobs.bind(null, state.layerUrls)); // receives event

createRasterBtn
    .addEventListener("click", createRasterJobs.bind(null, state.layerUrls));
