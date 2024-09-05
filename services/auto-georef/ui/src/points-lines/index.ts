import { type MapEvent, Map as OpenLayersMap } from "ol";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import { defaults as defaultControls } from "ol/control/defaults";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import Translate, { TranslateEvent } from "ol/interaction/Translate";

import { Success, Failure } from "@/utils/result";
import { defaultResolution, expandResolutions } from "@/utils/resolution";
import { handleKeyDownUp, handleMouseDownUp } from "@/utils/down-up";
import { setInnerHTML } from "@/utils/set-html";

import MouseWheelZoom from "@/utils/openlayers/mouse-wheel-zoom";
import DoubleClickZoom from "@/utils/openlayers/double-click-zoom";

import FeatureMarker from "@/points-lines/feature-marker";
import * as utils from "@/points-lines/utils";
import * as E from "@/points-lines/elements";
import * as K from "@/points-lines/constants";
import { Point as OpenLayersPoint } from "ol/geom";

/* ================================== Globals ================================== */

/**
 * Represents the OpenLayers GeoTIFF source.
 */
const mapSource = new GeoTIFF({
  sources: [{ url: polymer.cogURL, nodata: -1 }],
  convertToRGB: true,
  interpolate: false,
});

/**
 * Represents the OpenLayers TileLayer with the GeoTIFF source.
 */
const mapLayer = new TileLayer({ source: mapSource });

const translate = new Translate({
  filter: (feature, _layer) => {
    const result = FeatureMarker.getCurrent();

    if (!result.success) return false;

    return result.value.feature.featureID === feature.getId();
  },
});

/**
 * Represents the OpenLayers Map with the GeoTIFF layer.
 */
const map = new OpenLayersMap({
  target: "map",
  layers: [mapLayer],
  controls: defaultControls({ zoom: false, rotate: false, attribution: false }),
  interactions: defaultInteractions({
    keyboard: false,
    mouseWheelZoom: false, // Replaced with custom MouseWheelZoom
    doubleClickZoom: false, // Replaced with custom DoubleClickZoom
    altShiftDragRotate: false,
    shiftDragZoom: false,
    pinchRotate: false,
  }).extend([
    translate,
    new MouseWheelZoom(), // Custom MouseWheelZoom
    new DoubleClickZoom(), // Custom DoubleClickZoom
  ]),
  view: mapSource.getView().then((viewOptions) => {
    if (viewOptions.resolutions === undefined) {
      throw new Error("`viewOptions.resolutions` is not defined");
    }

    if (viewOptions.extent === undefined) {
      throw new Error("`viewOptions.extent` is not defined");
    }

    return {
      ...viewOptions,
      constrainOnlyCenter: true,
      resolution: defaultResolution(viewOptions.extent),
      resolutions: expandResolutions(viewOptions.resolutions, 1, 7),
    };
  }),
});

/* ================================== Functions ================================== */

/**
 * Handles if the view mode was selected in the session form.
 * @param ftype - The feature type.
 * @param system - The system.
 * @param version - The version.
 * @returns A success response with a callback or a failure response with an error message.
 */
async function onView(ftype: string, system: string, version: string) {
  const requestData: GetFeaturesRequest = {
    cog_id: polymer.cogID,
    ftype,
    system,
    version,
  };
  const url = `/lines/view-features?${new URLSearchParams(requestData)}`;
  const templateResult = await utils.fetchTemplate(url);
  if (!templateResult.success) {
    return Failure(templateResult.error);
  }

  // Add the feature groups to the page
  const template = templateResult.value;
  setInnerHTML(E.query("#groups"), template);
  if (polymer.rawFeatures === undefined) {
    return Failure("`polymer.rawFeatures` is not defined");
  }

  // Format features properly
  polymer.features = utils.formatRawFeatures(polymer.rawFeatures);

  // Remove all existing features before adding new ones
  utils.removeAllFeatures(map);
  await utils.addFeatures(map, ftype, polymer.features);

  // Setup event listeners for the new feature groups
  const masterToggle = E.query<HTMLInputElement>("#master-toggle");
  const groupToggles = E.queryAll<HTMLInputElement>(
    "#groups input[name='group-toggle']",
  );
  const updateMasterToggle = () => {
    const allChecked = groupToggles.every((toggle) => toggle.checked);
    const noneChecked = groupToggles.every((toggle) => !toggle.checked);
    masterToggle.checked = !noneChecked;
    masterToggle.indeterminate = !allChecked && !noneChecked;
  };

  for (const toggle of groupToggles) {
    toggle.addEventListener("change", () => {
      const legendID = toggle.value;
      const layer = map
        .getLayers()
        .getArray()
        .filter((l) => l instanceof VectorLayer)
        .find((l) => l.get("legendID") === legendID);
      layer?.setVisible(toggle.checked);
      updateMasterToggle();
    });
  }

  masterToggle.addEventListener("change", () => {
    const checked = masterToggle.checked;
    for (const toggle of groupToggles) {
      toggle.checked = checked;
      toggle.dispatchEvent(new Event("change"));
    }
  });

  // Succeed with an empty callback
  return Success(() => {});
}

/**
 * Handles if the validation mode was selected in the session form.
 * @param ftype - The feature type.
 * @param system - The system.
 * @param version - The version.
 * @returns A success response with a callback or a failure response with an error message.
 */
async function onValidate(ftype: string, system: string, version: string) {
  const requestData: GetFeaturesRequest = {
    cog_id: polymer.cogID,
    ftype,
    system,
    version,
  };
  const url = `/lines/validate-features?${new URLSearchParams(requestData)}`;
  const templateResult = await utils.fetchTemplate(url);
  if (!templateResult.success) {
    return Failure(templateResult.error);
  }

  // Add the feature groups to the page
  const template = templateResult.value;
  setInnerHTML(E.query("#group-select"), template);
  if (
    polymer.rawFeatures === undefined ||
    polymer.rawPolymerFeatures === undefined
  ) {
    return Failure("`polymer.rawFeatures` is not defined");
  }

  // Format features properly
  polymer.features = utils.formatRawFeatures(polymer.rawFeatures);
  polymer.polymerFeatures = utils.formatRawFeatures(polymer.rawPolymerFeatures);

  // Remove all existing features before adding new ones
  utils.removeAllFeatures(map);

  // Succeed with a callback to show the validation modal
  return Success(() => utils.showModal(E.validationModal));
}

/**
 * Sets the visibility of the map.
 * @param visible - Whether the map should be visible.
 */
function setMapVisibility(visible: boolean) {
  if (visible) {
    E.hideMapButton.dispatchEvent(new MouseEvent("mouseup"));
  } else {
    E.hideMapButton.dispatchEvent(new MouseEvent("mousedown"));
  }
}

/**
 * Sets the visibility of the features.
 * @param visible - Whether the features should be visible.
 */
function setFeaturesVisibility(visible: boolean) {
  if (visible) {
    E.hideFeaturesButton.dispatchEvent(new MouseEvent("mouseup"));
  } else {
    E.hideFeaturesButton.dispatchEvent(new MouseEvent("mousedown"));
  }
}

/**
 * Shows the next feature on the map.
 * @param shouldZoom - Whether to zoom in/out to the next feature.
 */
async function showNextFeature(shouldZoom: boolean = false) {
  const result = utils.tryShowNextFeature(map, shouldZoom);
  if (!result.success) {
    console.error(result.error);
    return;
  }

  const isComplete = result.value;
  if (!isComplete) return;

  console.info("All features have been marked");

  polymer.markedFeatures = undefined;

  utils.resetMapView(map, mapSource);
  utils.setSkipState("complete");
}

/* ================================== Event Listeners ================================== */

/**
 * Handles the submission of the session form.
 * @param event - The form submission event.
 */
async function sessionFormSubmit(event: Event) {
  event.preventDefault();

  // While form is not valid, check for form changes and don't submit the form
  E.sessionForm.removeEventListener("change", utils.sessionFormValidation);
  if (!utils.sessionFormValidation()) {
    E.sessionForm.addEventListener("change", utils.sessionFormValidation);
    return;
  }

  // Get the form data
  const data = new FormData(E.sessionForm);
  const mode = data.get("mode") as PageMode;
  const [ftype, system, version] = (data.get("system") as string).split("__");

  if (ftype === "line" && mode === "validate") {
    // Show the form submit error to be removed on next form change
    const message = "Validation is Not Available for Lines";
    utils.setSessionFormSubmitError(true, message);
    E.sessionForm.addEventListener("change", utils.sessionFormValidation);
    return;
  }

  console.log(mode, ftype, system, version);

  // Show loading spinner
  const formSpinner = E.query(E.sessionForm, ".loading").classList;
  formSpinner.remove("hidden");

  // Set the page mode, hiding/showing the appropriate elements
  utils.setMode(mode);

  const fn = mode === "view" ? onView : onValidate;
  const result = await fn(ftype, system, version);

  if (!result.success) {
    console.error(result.error);
    formSpinner.add("hidden");

    // Show the form submit error to be removed on next form change
    utils.setSessionFormSubmitError(true);
    E.sessionForm.addEventListener("change", utils.sessionFormValidation);

    // Unset the page mode, hiding/showing the appropriate elements
    utils.setMode(undefined);
    return;
  }

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  E.sessionForm.removeEventListener("submit", sessionFormSubmit);
  E.sessionForm.submit();
  E.sessionForm.addEventListener("submit", sessionFormSubmit);

  // Call the callback success function
  result.value();

  // Hide loading spinner and reset form after submission
  formSpinner.add("hidden");
  E.sessionForm.reset();
}

/**
 * Handles the submission of the validation form.
 * @param event - The form submission event.
 */
async function validationFormSubmit(event: Event) {
  event.preventDefault();

  if (polymer.features === undefined || polymer.polymerFeatures === undefined) {
    throw new Error(
      "`polymer.features` or `polymer.polymerFeatures` is not defined",
    );
  }

  // While form is not valid, check for form changes and don't submit the form
  E.validationForm.removeEventListener(
    "change",
    utils.validationFormValidation,
  );
  if (!utils.validationFormValidation()) {
    E.validationForm.addEventListener("change", utils.validationFormValidation);
    return;
  }

  const data = new FormData(E.validationForm);
  const group = data.get("group") as string;
  const legend = data.get("legend") as string;
  const features = polymer.features[group];
  const polymerFeatures = polymer.polymerFeatures[legend];

  const markedFeatures: MarkedFeature[] = features.map((feature) => ({
    feature,
    originalCoordinates: feature.geometry.coordinates,
    isComplete: false,
  }));

  polymer.association = [group, legend];
  polymer.markedFeatures = markedFeatures;

  // Remove all existing features before adding new ones
  utils.removeAllFeatures(map);

  const gtype = features[0].geometry.type;
  const ftype =
    gtype === "LineString" ? "line" : gtype === "Point" ? "point" : "bbox";
  await utils.addFeatures(map, ftype, { [group]: features });

  if (polymerFeatures !== undefined) {
    await utils.addFeatures(map, ftype, { [legend]: polymerFeatures });
  }

  utils.resetMapView(map, mapSource);

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  E.validationForm.removeEventListener("submit", validationFormSubmit);
  E.validationForm.submit();
  E.validationForm.addEventListener("submit", validationFormSubmit);

  // Reset the form after submission
  E.validationForm.reset();

  // Set validate controls
  E.progress.max = markedFeatures.length;
  E.progress.value = 0;
  utils.setSkipState("start", true);

  // Show controls
  E.validateControls.classList.remove("hidden");
}

/**
 * Handles the hide map button mouse events.
 * @param this - The hide map button element.
 */
function hideMapHandler(this: HTMLElement) {
  handleMouseDownUp(
    this,
    () => mapLayer.setVisible(false),
    () => mapLayer.setVisible(true),
  );
}

/**
 * Handles the hide features button mouse events.
 * @param this - The hide features button element.
 */
function hideFeaturesHandler(this: HTMLElement) {
  const setVisible = (visible: boolean) => {
    for (const layer of map.getLayers().getArray()) {
      if (layer instanceof VectorLayer) {
        layer.setVisible(visible);
      }
    }
  };

  handleMouseDownUp(
    this,
    () => setVisible(false),
    () => setVisible(true),
  );
}

/**
 * Handles a temporary skip button keyboard event to set the skip button state to reset.
 * @param event - The mouse event.
 * @param newState - The new state of the skip button.
 */
function temporarySkipHandler(event: KeyboardEvent) {
  if (utils.getSkipState() !== "skip") return;

  const isActive = ({ metaKey, ctrlKey }: KeyboardEvent) => metaKey || ctrlKey;
  const oldState = utils.getSkipState();

  handleKeyDownUp(
    event,
    (event) => {
      if (isActive(event)) utils.setSkipState("unset");
    },
    (event) => {
      if (!isActive(event)) utils.setSkipState(oldState);
    },
  );
}

async function skipHandler(manualState?: utils.SkipButtonState) {
  const skipState = manualState ?? utils.getSkipState();

  if (skipState === "start") {
    await showNextFeature(true);
  }

  const featureResult = FeatureMarker.getCurrent();
  if (!featureResult.success) {
    console.error(featureResult.error);
    return;
  }

  const markedFeature = featureResult.value;

  if (skipState === "recenter" || skipState === "start") {
    const shouldZoom = skipState === "start";
    utils.showFeature(map, markedFeature.feature, shouldZoom);
    utils.setCanMark(map, true);
    return;
  }

  if (skipState === "reset") {
    if (!utils.isMarkedPoint(markedFeature)) {
      console.error("Feature is not a point:", markedFeature);
      return;
    }

    const feature = utils.getFeatureFromLegendIDAndFeatureID(
      map,
      markedFeature.feature.legendID,
      markedFeature.feature.featureID,
    );

    feature.setGeometry(new OpenLayersPoint(markedFeature.originalCoordinates));
    markedFeature.feature.geometry.coordinates =
      markedFeature.originalCoordinates;

    if (K.AUTO_RECENTER && polymer.canMark) {
      skipHandler("recenter");
    } else {
      utils.setSkipState("recenter");
    }

    return;
  }

  if (skipState === "skip" || skipState === "unset") {
    markFeatureHandler(skipState);
    return;
  }
}

/**
 * Handles the marking of a feature as good, bad, or skipped.
 * @param type - The type of marking to perform.
 */
async function markFeatureHandler(type: "good" | "bad" | "skip" | "unset") {
  const featureResult = FeatureMarker.getCurrent();
  if (!featureResult.success) {
    console.error(featureResult.error);
    return;
  }

  const markedFeature = featureResult.value;

  if (type === "good") {
    if (polymer.association === undefined) {
      console.error("Group and legend association is undefined");
      return;
    }

    const [_groupID, legendID] = polymer.association;

    // TODO: Add logic to validate the feature into the CDR
    const response = await fetch("/lines/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cog_id: polymer.cogID,
        geometry: markedFeature.feature.geometry,
        feature_id: markedFeature.feature.featureID,
        legend_id: legendID,
      }),
    });

    if (!response.ok) {
      console.error("Failed to validate feature:", response.statusText);
      return;
    }
  }

  const isNotSkip = type !== "skip";

  if (isNotSkip) {
    const isPoint = markedFeature.feature.geometry.type === "Point";
    markedFeature.feature.isValidated =
      type === "good" ? true : type === "bad" ? false : null;

    const response = await fetch("/lines/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_id: markedFeature.feature.featureID,
        ftype: isPoint ? "point" : "line",
        is_validated: type === "unset" ? null : false,
      }),
    });

    if (!response.ok) {
      console.error("Failed to update feature status:", response.statusText);
      return;
    }

    utils.setMarkedFeature(map, {
      legendID: markedFeature.feature.legendID,
      featureID: markedFeature.feature.featureID,
      options: {
        isValidated: markedFeature.feature.isValidated,
        ...(isPoint ? K.POINT_STYLE : K.LINE_STYLE),
      },
    });

    E.progress.value += 1;
  }

  markedFeature.isComplete = isNotSkip;
  console.info(`Marked feature as ${type}:`, markedFeature);

  await showNextFeature();
}

/**
 * Sets the map to not allow marking when the map is moved.
 * @param _event - The map event.
 */
function mapMoveSetCanMark(_event: MapEvent) {
  // Return if not user caused
  if (!map.getView().getInteracting()) return;

  // Return if not in marking mode
  const state = utils.getSkipState();
  if (state === "start" || state === "complete") return;

  utils.setCanMark(map, false);
}

function onTranslateEnd(event: TranslateEvent) {
  for (const feature of event.features.getArray()) {
    const featureID = feature.getId();
    const markedFeature = polymer.markedFeatures?.find(
      (mf) => mf.feature.featureID === featureID,
    );

    if (markedFeature === undefined) {
      console.error("Could not find marked feature with ID:", featureID);
      return;
    }

    if (markedFeature.feature.geometry.type !== "Point") {
      console.error("Feature is not a point:", markedFeature);
      return;
    }

    markedFeature.feature.geometry.coordinates = event.coordinate;
    if (K.AUTO_RECENTER && polymer.canMark) {
      skipHandler("recenter");
    } else {
      utils.setCanMark(map, false);
      utils.setSkipState("recenter");
    }
  }
}

translate.on("translateend", onTranslateEnd);

map.on("movestart", mapMoveSetCanMark);
map.on("moveend", mapMoveSetCanMark);

E.sessionForm.addEventListener("submit", sessionFormSubmit);
E.validationForm.addEventListener("submit", validationFormSubmit);
E.hideMapButton.addEventListener("mousedown", hideMapHandler);
E.hideFeaturesButton.addEventListener("mousedown", hideFeaturesHandler);
E.newSessionButton.addEventListener("click", () =>
  utils.showModal(E.sessionModal),
);
E.goodButton.addEventListener("click", () => markFeatureHandler("good"));
E.skipButton.addEventListener("click", () => skipHandler());
E.badButton.addEventListener("click", () => markFeatureHandler("bad"));
E.switchGroup.addEventListener("click", () =>
  utils.showModal(E.validationModal),
);

addEventListener("keydown", temporarySkipHandler);

addEventListener("keydown", ({ code }) => {
  if (code === "Period") setMapVisibility(false);
  else if (code === "Comma") setFeaturesVisibility(false);
});

addEventListener("keyup", ({ code }) => {
  if (code === "Period") setMapVisibility(true);
  else if (code === "Comma") setFeaturesVisibility(true);
});

/* ================================== Main ================================== */

utils.showModal(E.sessionModal);
