import { Fill, Stroke, Style } from "ol/style.js";
import Select from "ol/interaction/Select.js";

import { expandSearchResults } from "./common";

import {
  transformPolygonCoordinates,
  openLayersDefaultProjection,
  cdrDefaultProjection,
  drawPolygonWithLayerID,
  clearSourceByLayerID,
  mapLayerById,
} from "../geo";

/**
 *
 */
const selected = new Style({
  fill: new Fill({
    color: "#eeeeee",
  }),
  stroke: new Stroke({
    color: "rgba(255, 255, 255, 0.7)",
    width: 2,
  }),
});

/**
 *
 */
function selectStyle(feature) {
  const color = feature.get("color") || "#4ade80AA"; // in case we ever want to modify base color instead of replace it
  selected.getFill().setColor(color);

  return selected;
}

/**
 *
 */
const selectSingleClick = new Select({
  style: selectStyle,
  layers: (layer) => layer.get("id") === "all-results",
});

/**
 *
 */
selectSingleClick.on("select", function (e) {
  const map = window.polymer_map;

  const cogResults = document.querySelectorAll(".cog-result-card");

  [].forEach.call(cogResults, function (el) {
    el.classList.remove("border-primary", "dark:border-primary/75");
  });

  const allFeatures = e.target.getFeatures().getArray();

  if (!allFeatures.length) {
    return;
  }

  // TODO deselect previous feature if more than 2 are selected with shift...
  // e.mapBrowserEvent.originalEvent.shiftKey

  const cog_id = allFeatures[allFeatures.length - 1].get("cog_id");

  if (cog_id) {
    const resultsContainer = document.getElementById("map-results-target");
    // If results collapsed, toggle to expand
    if ([...resultsContainer.classList].includes("hidden")) {
      const resultsWrapper = document.getElementById("browse-results");
      const icon = document.getElementById("toggle-search-results").querySelector("svg");

      expandSearchResults(resultsContainer, resultsWrapper, icon);
    }
  }

  // additionally scroll to it
  const cog_card = document.querySelector(
    `.cog-result-card[data-cog_id='${cog_id}']`,
  );

  if (cog_card) {
    cog_card.classList.add("border-primary", "dark:border-primary/75");
    cog_card.scrollIntoView();
  }
});

/**
 *
 */
window.connectMapResultsToMap = function () {
  const map = window.polymer_map;

  map.removeInteraction(selectSingleClick);

  map.addInteraction(selectSingleClick);

  /* Ensure previous result polygons are removed if we paginate */
  clearSourceByLayerID(map, "all-results");

  const cogResults = document.querySelectorAll(".cog-result-card");

  cogResults.forEach((cogCard) => {
    const extent = JSON.parse(cogCard.dataset.extent.replace(/'/g, '"'));

    const destCoordinates = transformPolygonCoordinates(
      extent.coordinates,
      cdrDefaultProjection,
      openLayersDefaultProjection,
    );

    let has_validated_projection = false;

    try {
      has_validated_projection = Boolean(
        parseInt(cogCard.dataset.validated, 10),
      );
    } catch (e) {
      // leave as false
      console.log("Error checking validated projection count:", e);
    }

    const cog_id = cogCard.dataset.cog_id;
    const geoJSON = {
      type: "Feature",
      geometry: {
        type: extent.type,
        coordinates: destCoordinates,
      },
      properties: {
        cog_id,
        validated: has_validated_projection,
      },
    };

    drawPolygonWithLayerID(
      map,
      "all-results", // all-results => purple items
      geoJSON,
      {
        id: cog_id,
        color: has_validated_projection
          ? "rgba(233, 30, 99, 0.40)"
          : "rgba(82,75,222,0.40)",
      },
    );

    // highlight hovered-over result both on map and results, different color
    cogCard.addEventListener("mouseenter", () => {
      [].forEach.call(cogResults, function (el) {
        el.classList.remove("border-primary", "dark:border-primary/75");
      });

      cogCard.classList.add("border-primary", "dark:border-primary/75");

      const resultsLayer = mapLayerById(window.polymer_map, "all-results");
      const source = resultsLayer.getSource();
      const feature = source.getFeatureById(cog_id);
      var selected_collection = selectSingleClick.getFeatures();

      selected_collection.clear();
      selected_collection.push(feature);
    });
  });
};
