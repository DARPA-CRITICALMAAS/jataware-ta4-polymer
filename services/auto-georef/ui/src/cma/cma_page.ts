import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import { getCenter, getArea } from "ol/extent";
import { transparentize } from "color2k";

import "../index/cma_cog_selector";
import "../index/cog_result_focus_extent";

import {
  Chart as ChartJS,
  Tooltip,
  PieController,
  ArcElement,
} from 'chart.js';


import {
  transformPolygonCoordinates,
  openLayersDefaultProjection,
  defaultLayerStyle,
  areaToZoomLevel,
  isCRSRegistered,
  register_proj
} from "../geo";


ChartJS.register(
  Tooltip,
  PieController,
  ArcElement
);

/* Create the background map */

const MAPTILER_KEY = window?.polymer?.MTK;
const MAPS_LAYER_ID = "all-results";
const CMA_LAYER_ID = "cma-layer";

const baseSource = new XYZ({
  url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
  crossOrigin: "",
});

const baseLayer = new TileLayer({
  id: "Satellite",
  source: baseSource,
  visible: true,
});

const cmaSource = new VectorSource();
const mapsSource = new VectorSource();

const mapsLayer = new VectorLayer({
  id: MAPS_LAYER_ID,
  source: mapsSource,
});

const cmaLayer = new VectorLayer({
  id: CMA_LAYER_ID,
  source: cmaSource,
});

const map = new Map({
  layers: [baseLayer, mapsLayer, cmaLayer],
  view: new View({
    center: [-11068546.533293726, 4711971.846945472],
    zoom: 5.3,
  }),
  controls: [],
});

window.polymer_map = map;

/* Set ol/map target to div#map element */
map.setTarget(document.querySelector("#map"));

/*
  Will show CMA extent on background ol map
 */
window.connectMapCMA = async function (cma) {
  cmaSource.clear();

  if (!cma.extent) {
    console.log("CMA does not have an extent. CMA:", cma);
    return;
  }

  // if not pre-pregistered with our js/openlayers app
  // register before trying to call transformPolygonCoordinates
  if (!isCRSRegistered(cma.crs)) {
    await register_proj(cma.crs);
  }

  const transformedExtent = cma.extent.coordinates.map((polygon) => {
    return transformPolygonCoordinates(
      polygon,
      // We trust "known" set of valid crs up-front, under ../geo.ts:
      cma.crs,
      openLayersDefaultProjection,
    );
  });

  const multipolygon = {
    type: cma.extent.type,
    coordinates: transformedExtent,
  };

  const features = new GeoJSON().readFeatures(multipolygon);

  features[0].setStyle(defaultLayerStyle);
  features[0].setId(cma.cma_id);

  cmaSource.addFeatures(features);

  // get center of cma polygon and move map there
  const geometry = features[0].getGeometry();
  const extent = geometry.getExtent();
  const center = getCenter(extent);
  const area = getArea(extent);
  const view = window.polymer_map.getView();

  view.setCenter(center);
  view.setZoom(areaToZoomLevel(area));
};

/**
 * Adds border to selected chart slices, which will act as map filters by
 * extraction state per categories:
 * eg - maps have valid projections
 *    - maps have legend items extracted pending valdiation
 *    - maps have no polygons extracted
 */
function markSelectedFilters(selectedArray, ctx) {
  return selectedArray[ctx.dataIndex] ? 3 : 0; // isSelected border width = 3
}

/**
 * When chart filters applied, "darkens" unselected chart slices for that
 * category to better contrast and hint that filters are applied
 */
function colorDeselectedFilters(selectedArray, ctx) {
  const validGreen = "rgb(117, 222, 98)";
  const pendingYellow = "rgb(247,207,95)"; // rgb(108, 171, 245) blue previously
  const emptyRed = "rgb(229, 91, 91)";

  const backgroundColors = [validGreen, pendingYellow, emptyRed];

  const somefilterEnabled = selectedArray.find(v => v);
  const actualColor = backgroundColors[ctx.dataIndex];

  if (!somefilterEnabled || selectedArray[ctx.dataIndex]) {
    return actualColor;
  }
  const transformed = transparentize(actualColor, 0.6);
  return transformed;
}

const chartEnabledFilters = {};

/**
 * Make union of all selectedArray+Categories to only display those maps on the cma map list
 */
function filterMapsFromChartSelections(categoryName, selectedArray) {

  const mapCards = document.querySelectorAll(".cog-result-card");

  // categoryName like projections OR legends
  // selectedArray is like [true, true, false] ; represents [validated, pending, empty]
  chartEnabledFilters[categoryName] = selectedArray;

  const someFilter = Object.keys(chartEnabledFilters)
    .find(cat => chartEnabledFilters[cat].find(isSelected => isSelected));

  const mapCountElem = document.getElementById("cma-map-count");
  const mapCount = mapCountElem.dataset.count;

  // If there are any filters, first hide all maps since we'll pick and choose
  // which to show later below
  if (Boolean(someFilter)) {
    mapCards.forEach(card => {
      card.classList.add("filtered");
    });
  // There are no filters, force-show all maps and return
  } else {
    mapCards.forEach(card => {
      card.classList.remove("filtered");
    });
    mapCountElem.innerHTML = `Total: ${mapCount}`;
    return;
  }

  // if there are filters,
  // then anything selected category=true is shown the rest remains hidden
  // results in displays the union of selected chart slices across all charts
  Object.keys(chartEnabledFilters)
    .forEach((category, idx, inArr) => {

      const categorySelections = chartEnabledFilters[category];

      mapCards.forEach(card => {
        // find values with data-category
        const statContainer = card.querySelector(`[data-category="${category}"]`);
        const validatedElem = statContainer.querySelector('[data-validated]');
        const totalElem = statContainer.querySelector('[data-total]');

        let validated = validatedElem.dataset.validated;
        let pending = totalElem.dataset.total;

        let empty = false;
        validated = Boolean(parseInt(validated, 10));
        pending = Boolean(parseInt(pending, 10));

        if (!(validated || pending)) {
          empty = true;
        }
        if (validated) {
          pending = false
        }

        const extractionState = [validated, pending, empty];

        // now we have two array of len(3) of bools, and we can check
        // if any filters == true and if we're looking at the same category in card
        // virtually applying a binary AND operation matching the category selection
        extractionState.forEach((hasExtractionType, idx) => {
          const isCategorySelected = categorySelections[idx];
          // we only care if a selection == true as well:
          if (isCategorySelected && hasExtractionType === isCategorySelected) {
            card.classList.remove("filtered");
          }
        });

      });
    });

  const totalMapsFiltered = document.querySelectorAll(".cog-result-card.filtered");
  mapCountElem.innerHTML = `Showing: ${mapCount - totalMapsFiltered.length} of ${mapCount}`;
}

/**
 * `data` is either empty or an object describing the dataset label, color, categories + data itself
 * length of data itself in data is of length 3 -> one for each category (validated, pending, empty)
 * to explain how many extracted features of a given category have at least 1 validated extraction,
 * or if no validated, at least 1 created/pending-review extraction, or no extractions at all.
 */
window.createChart = function createChart(elem, data, categoryName) {
  // save state of selected chart so that elements are painted on creation
  const selected = [false, false, false];

  const config = {
    type: 'pie',
    data: data,
    options: {
      onHover: (event, chartElement) => {
        // Only use pointer cursor if hovering over a pie chart slice, not any
        // other part of the chart canvas (title, empty space, etc)
        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
      },
      onClick: (e, elements, chart) => {
        if (!elements[0]) {
          console.log("clicked on chart canvas but not on a element::slice. Returning.");
          return;
        }

        const statIndex = elements[0].index;
        // Clicks toggle selection of chart slice (either adds white border, or removes it)
        selected[statIndex] = !selected[statIndex];
        chart.update(); // update immediately to change white border as soon as click occurs
        filterMapsFromChartSelections(categoryName, selected); // filter CMA maps list accordingly
      },
      responsive: true,
      plugins: {
        legend: {
          display: false,
        },
      },
      elements: {
        arc: {
          // chartjs allows using functions to set some properties, called
          // "Scriptable Options"
          // last arg for handler will be `ctx`, passed in by Chartjs
          borderWidth: markSelectedFilters.bind(null, selected),
          borderAlign: "center",
          backgroundColor: colorDeselectedFilters.bind(null, selected),
        }
      }
    },
  };

  new ChartJS(elem, config);
}


const fallbackCopyTextToClipboard = (text) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
};

window.copyTextToClipboard = (text: string) => {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    function () {
      console.log("Copying to clipboard was successful!");
    },
    function (err) {
      console.error("Could not copy text: ", err);
    },
  );
};
