import { MapBrowserEvent, type MapEvent, Map as OpenLayersMap } from "ol";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import { defaults as defaultControls } from "ol/control/defaults";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import Translate, { TranslateEvent } from "ol/interaction/Translate";

import { Success, Failure } from "@/utils/result";
import { defaultResolution, expandResolutions } from "@/utils/resolution";
import { handleMouseDownUp } from "@/utils/down-up";
import { setInnerHTML } from "@/utils/set-html";

import MouseWheelZoom from "@/utils/openlayers/mouse-wheel-zoom";
import DoubleClickZoom from "@/utils/openlayers/double-click-zoom";

import FeatureMarker from "@/points-lines/feature-marker";
import FeatureCreator from "@/points-lines/feature-creator";
import * as U from "@/points-lines/utils";
import * as E from "@/points-lines/elements";
import * as K from "@/points-lines/constants";
import { Point as OpenLayersPoint } from "ol/geom";
import Spline from "@/utils/openlayers/spline";

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

/**
 * Represents the OpenLayers Translate interaction.
 */
const translate = new Translate({
  filter: (feature, _layer) => {
    const result = FeatureMarker.getCurrent();

    // Do not allow translation if there is no feature selected
    if (!result.success) return false;

    // Do not allow translation if feature has not been created yet
    if (polymer.mode === "create" && U.getCreateMiscButtonState() === "start")
      return false;

    // Do not allow translation if the feature is not a point
    if (!U.isMarkedPoint(result.value)) return false;

    console.log(result.value, U.isMarkedPoint(result.value));

    // Allow translation if the feature is the selected feature
    return result.value.feature.featureID === feature.getId();
  },
});

const spline = new Spline({
  onUpdateFinish: async (spline, controlPoints) => {
    const coordinates = spline.getGeometry()?.getCoordinates() ?? [];
    const id = spline.getId()?.toString();

    if (id === undefined) {
      console.error("Spline ID is undefined");
      return;
    }

    const result = await FeatureCreator.createLine(coordinates, id);
    if (!result.success) {
      console.error(result.error);
      return;
    }

    // if (K.AUTO_RECENTER) {
    //   createMiscHandler("recenter");
    //   U.setCreateMiscButtonState("remove");
    // } else {
    //   U.setCreateMiscButtonState("recenter");
    // }

    // No AUTO_RECENTER for lines
    U.setCreateMiscButtonState("recenter");

    // Manually set spline bold
    U.setFeatureBold(map, result.value.feature, true);

    // Set control points bold
    for (const point of controlPoints) {
      const coordinates = point.getGeometry()?.getCoordinates();
      if (coordinates === undefined) continue;

      const id = point.getId()?.toString();
      if (id === undefined) continue;

      const result = await FeatureCreator.createPoint(
        coordinates,
        undefined,
        id,
      );
      if (!result.success) continue;
      U.setFeatureBold(map, result.value.feature, true);
    }
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
    spline,
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
async function onView(ftype: FType, system: string, version: string) {
  const requestData: GetFeaturesRequest = {
    cog_id: polymer.cogID,
    ftype,
    system,
    version,
  };
  const url = `/lines/view-features?${new URLSearchParams(requestData)}`;
  const templateResult = await U.fetchTemplate(url);
  if (!templateResult.success) {
    return Failure(templateResult.error);
  }

  // Add the feature groups to the page
  const template = templateResult.value;
  setInnerHTML(E.query("#groups"), template);
  if (polymer.rawFeatures === undefined) {
    return Failure("`polymer.rawFeatures` is not defined");
  }

  // Set feature type
  polymer.ftype = ftype;

  // Format features properly
  polymer.features = U.formatRawFeatures(polymer.rawFeatures);

  // Remove all existing features before adding new ones
  U.removeAllFeatures(map);
  await U.addFeatures(map, ftype, polymer.features);

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
  return Success(() => { });
}

/**
 * Handles if the validation mode was selected in the session form.
 * @param ftype - The feature type.
 * @param system - The system.
 * @param version - The version.
 * @returns A success response with a callback or a failure response with an error message.
 */
async function onValidate(ftype: FType, system: string, version: string) {
  const requestData: GetFeaturesRequest = {
    cog_id: polymer.cogID,
    ftype,
    system,
    version,
  };
  const url = `/lines/validate-features?${new URLSearchParams(requestData)}`;
  const templateResult = await U.fetchTemplate(url);
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

  // Set feature type
  polymer.ftype = ftype;

  // Format features properly
  polymer.features = U.formatRawFeatures(polymer.rawFeatures);
  polymer.polymerFeatures = U.formatRawFeatures(polymer.rawPolymerFeatures);

  // Remove all existing features before adding new ones
  U.removeAllFeatures(map);

  // Succeed with a callback to show the validation modal
  return Success(() => U.showModal(E.validateModal));
}

/**
 * Handles if the create mode was selected in the session form.
 * @param ftype - The feature type.
 * @returns A success response with a callback or a failure response with an error message.
 */
async function onCreate(ftype: FType) {
  const requestData = {
    cog_id: polymer.cogID,
    ftype,
  };
  const url = `/lines/create-features?${new URLSearchParams(requestData)}`;
  const templateResult = await U.fetchTemplate(url);
  if (!templateResult.success) {
    return Failure(templateResult.error);
  }

  // Add the feature groups to the page
  const template = templateResult.value;
  setInnerHTML(E.query("#create-select"), template);
  if (polymer.rawPolymerFeatures === undefined) {
    return Failure("`polymer.rawPolymerFeatures` is not defined");
  }

  // Set the feature type
  polymer.ftype = ftype;
  map.getInteractions().forEach((interaction) => {
    if (interaction instanceof Spline) {
      interaction.setActive(ftype === "line");
    }
  });

  // Format features properly
  polymer.polymerFeatures = U.formatRawFeatures(polymer.rawPolymerFeatures);

  // Remove all existing features before creating new ones
  U.removeAllFeatures(map);

  // Succeed with an empty callback
  return Success(() => U.showModal(E.createModal));
}

/**
 * Handles the mode selected in the session form.
 * @param mode - The mode selected in the session form.
 * @param data - The form data.
 * @returns A success response with a callback or a failure response with an error message.
 */
async function handleOnMode(mode: PageMode, data: FormData) {
  // Check if the mode is create and call the create function
  if (mode === "create") {
    const ftype = data.get("feature-type") as FType;
    console.log(mode, ftype);

    // Call the create function
    return onCreate(ftype);
  }

  // Get all the information needed from the form for the view and validate modes
  const [ftype, system, version] = (data.get("system") as string).split("__");
  console.log(mode, ftype, system, version);

  if (ftype === undefined || system === undefined || version === undefined) {
    return Failure("Invalid form data");
  }

  if (mode === "view") {
    // Call the view function
    return onView(ftype as FType, system, version);
  }

  if (mode === "validate") {
    // Call the validate function
    return onValidate(ftype as FType, system, version);
  }

  // Return a failure if the mode is invalid
  return Failure("Invalid mode");
}

/**
 * Sets the visibility of the map.
 * @param isVisible - Whether the map should be visible.
 */
function setMapVisibility(isVisible: boolean) {
  if (isVisible) {
    E.hideMapButton.dispatchEvent(new MouseEvent("mouseup"));
  } else {
    E.hideMapButton.dispatchEvent(new MouseEvent("mousedown"));
  }
}

/**
 * Sets the visibility of the features.
 * @param isVisible - Whether the features should be visible.
 */
function setFeaturesVisibility(isVisible: boolean) {
  if (isVisible) {
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
  const result = U.tryShowNextFeature(map, shouldZoom);
  if (!result.success) {
    console.error(result.error);
    return;
  }

  const isComplete = result.value;
  if (!isComplete) return;

  console.info("All features have been marked");

  polymer.markedFeatures = undefined;

  U.resetMapView(map, mapSource);
  U.setValidateMiscButtonState("complete");
}

/* ================================== Event Handlers ================================== */

/**
 * Handles the submission of the session form.
 * @param event - The form submission event.
 */
async function sessionFormSubmit(event: Event) {
  event.preventDefault();

  // If the session form is not valid, return
  if (!U.didValidateSessionForm()) return;

  // Get the form data
  const data = new FormData(E.sessionForm);
  const mode = data.get("mode") as PageMode;

  // Show loading spinner
  const formSpinner = E.query(E.sessionForm, ".loading").classList;
  formSpinner.remove("hidden");

  // Set the page mode, hiding/showing the appropriate elements
  U.setMode(map, mode);

  const result = await handleOnMode(mode, data);

  if (!result.success) {
    console.error(result.error);
    formSpinner.add("hidden");

    // Show the form submit error to be removed on next form change
    const message =
      typeof result.error === "string" ? result.error : "Internal server error";
    U.setSessionFormError(true, message);

    // Unset the page mode, hiding/showing the appropriate elements
    U.setMode(map, undefined);
    return;
  }

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  E.sessionForm.removeEventListener("submit", sessionFormSubmit);
  E.sessionForm.submit();
  E.sessionForm.addEventListener("submit", sessionFormSubmit);

  // Call the callback success function
  result.value();

  // Set the system version badge
  U.setSystemVersionBadge(polymer.system, polymer.version);

  // Hide loading spinner and reset form after submission
  formSpinner.add("hidden");
  E.sessionForm.reset();
}

/**
 * Handles the submission of the validate form.
 * @param event - The form submission event.
 */
async function validateFormSubmit(event: Event) {
  event.preventDefault();

  if (polymer.features === undefined || polymer.polymerFeatures === undefined) {
    throw new Error(
      "`polymer.features` or `polymer.polymerFeatures` is not defined",
    );
  }

  // If the validation form is not valid, return
  if (!U.didValidateValidateForm()) return;

  const data = new FormData(E.validateForm);
  const group = data.get("group") as string;
  const legend = data.get("legend") as string;
  const features = polymer.features[group];

  if (features === undefined) {
    console.error("Features are undefined for group:", group);
    return;
  }

  const polymerFeatures = polymer.polymerFeatures[legend];

  const markedFeatures: MarkedFeature[] = features.map((feature) => ({
    feature,
    originalCoordinates: feature.geometry.coordinates,
    isComplete: false,
  }));

  polymer.association = [group, legend];
  polymer.markedFeatures = markedFeatures;

  // Remove all existing features before adding new ones
  U.removeAllFeatures(map);

  const [feature] = features;

  if (feature === undefined) {
    console.error("Feature is undefined");
    return;
  }

  const ftype = polymer.ftype;
  if (ftype === undefined) {
    console.error("`polymer.ftype` is not defined");
    return;
  }

  await U.addFeatures(map, ftype, { [group]: features });

  if (polymerFeatures !== undefined) {
    await U.addFeatures(map, ftype, { [legend]: polymerFeatures });
  }

  U.resetMapView(map, mapSource);

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  E.validateForm.removeEventListener("submit", validateFormSubmit);
  E.validateForm.submit();
  E.validateForm.addEventListener("submit", validateFormSubmit);

  // Reset the form after submission
  E.validateForm.reset();

  // Set validate controls
  E.progress.max = markedFeatures.length;
  E.progress.value = 0;
  U.setValidateMiscButtonState("start", true);

  // Set the legend item
  const legendItem = polymer.legendMapping?.[polymer.association?.[1] ?? -1];
  U.setLegendItemBadge(legendItem);

  // Show controls
  E.validateControls.classList.remove("hidden");
  if (polymer.ftype === "line") {
    E.linePattern.classList.remove("hidden");
  }
}

async function createFormSubmit(event: Event) {
  event.preventDefault();

  if (polymer.polymerFeatures === undefined) {
    throw new Error("`polymer.polymerFeatures` is not defined");
  }

  // If the create form is not valid, return
  if (!U.didValidateCreateForm()) return;

  const data = new FormData(E.createForm);
  const legend = data.get("legend") as string;

  polymer.association = [legend, legend];

  // Remove all existing features before adding new ones
  U.removeAllFeatures(map);

  const polymerFeatures = polymer.polymerFeatures[legend];
  const [feature] = polymerFeatures ?? [];

  if (feature !== undefined) {
    const ftype = polymer.ftype;
    if (ftype === undefined) {
      throw new Error("`polymer.ftype` is not defined");
    }

    if (polymerFeatures !== undefined) {
      await U.addFeatures(map, ftype, { [legend]: polymerFeatures });
    }
  }

  U.resetMapView(map, mapSource);

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  E.createForm.removeEventListener("submit", createFormSubmit);
  E.createForm.submit();
  E.createForm.addEventListener("submit", createFormSubmit);

  // Reset the form after submission
  E.createForm.reset();

  U.setCreateMiscButtonState("start");

  // Set the legend item
  const legendItem = polymer.legendMapping?.[polymer.association?.[1] ?? -1];
  U.setLegendItemBadge(legendItem);

  // Show controls
  E.createControls.classList.remove("hidden");
  if (polymer.ftype === "line") {
    E.linePattern.classList.remove("hidden");
  }
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

    for (const interaction of map.getInteractions().getArray()) {
      if (interaction instanceof Spline) {
        interaction.setVisible(visible);
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
 * Handles a temporary validation miscellaneous button event to set the state to `reset`
 * @param isActive - Whether the button is active.
 */
function temporaryValidationMiscButtonHandler(isActive: boolean) {
  return ({ key }: KeyboardEvent) => {
    if (
      U.getValidateMiscButtonState() !== "unset" &&
      U.getValidateMiscButtonState() !== "skip"
    )
      return;

    if (isActive === (key === "Meta" || key === "Control"))
      U.setValidateMiscButtonState("unset");
    else U.setValidateMiscButtonState("skip");
  };
}

/**
 * Handles the miscellaneous validation button actions.
 * @param manualState - The manual state of the button.
 */
async function validateMiscHandler(manualState?: U.ValidateMiscButtonState) {
  const state = manualState ?? U.getValidateMiscButtonState();

  if (state === "start") {
    await showNextFeature(true);
  }

  const featureResult = FeatureMarker.getCurrent();
  if (!featureResult.success) {
    console.error(featureResult.error);
    return;
  }

  const markedFeature = featureResult.value;

  if (state === "recenter" || state === "start") {
    const shouldZoom = state === "start";
    U.showFeature(map, markedFeature.feature, shouldZoom);
    U.setCanMark(map, true);
    return;
  }

  if (state === "reset") {
    if (!U.isMarkedPoint(markedFeature)) {
      console.error("Feature is not a point:", markedFeature);
      return;
    }

    const feature = U.getFeatureFromLegendIDAndFeatureID(
      map,
      markedFeature.feature.legendID,
      markedFeature.feature.featureID,
    );

    feature.setGeometry(new OpenLayersPoint(markedFeature.originalCoordinates));
    markedFeature.feature.geometry.coordinates =
      markedFeature.originalCoordinates;

    if (K.AUTO_RECENTER && polymer.canMark) {
      validateMiscHandler("recenter");
    } else {
      U.setValidateMiscButtonState("recenter");
    }

    return;
  }

  if (state === "skip" || state === "unset") {
    markFeatureHandler(state);
    return;
  }
}

/**
 * Handles the miscellaneous create button actions.
 * @param manualState - The manual state of the button.
 */
async function createMiscHandler(manualState?: U.CreateMiscButtonState) {
  const state = manualState ?? U.getCreateMiscButtonState();

  const featureResult = FeatureMarker.getCurrent();
  if (!featureResult.success) {
    console.error(featureResult.error);
    return;
  }

  const markedFeature = featureResult.value;

  if (state === "recenter") {
    U.showFeature(map, markedFeature.feature, false);
    U.setCanMark(map, true);
    return;
  }

  if (state === "remove") {
    if (U.isMarkedPoint(markedFeature)) {
      await FeatureCreator.removeFeature(map);
    }

    if (U.isMarkedLine(markedFeature)) {
      const spline = map
        .getInteractions()
        .getArray()
        .find((i) => i instanceof Spline);

      spline?.reset();
    }

    U.setCanMark(map, false);
    U.setZoomAnchor(map, undefined);

    U.setCreateMiscButtonState("start");

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

    if (polymer.ftype === "line") {
      const dashPattern = E.linePatternSelect.value as Feature["dashPattern"];
      markedFeature.feature.dashPattern = dashPattern;
    }

    // TODO: Add logic to validate the feature into the CDR
    const response = await fetch("/lines/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cog_id: polymer.cogID,
        geometry: markedFeature.feature.geometry,
        feature_id: markedFeature.feature.featureID,
        legend_id: legendID,
        dash_pattern: markedFeature.feature.dashPattern,
      }),
    });

    if (!response.ok) {
      console.error("Failed to validate feature:", response.statusText);
      return;
    }
  }

  const isNotSkip = type !== "skip";

  if (isNotSkip) {
    const ftype = polymer.ftype;
    if (ftype === undefined) {
      console.error("`polymer.ftype` is not defined");
      return;
    }

    // markedFeature.feature.isValidated =
    //   type === "good" ? true : type === "bad" ? false : null;
    markedFeature.feature.isValidated =
      type === "good"
        ? true
        : type === "bad"
          ? false
          : type === "unset"
            ? null
            : false;

    const response = await fetch("/lines/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_id: markedFeature.feature.featureID,
        ftype: ftype,
        is_validated: markedFeature.feature.isValidated,
      }),
    });

    if (!response.ok) {
      console.error("Failed to update feature status:", response.statusText);
      return;
    }

    U.setMarkedFeature(map, {
      legendID: markedFeature.feature.legendID,
      featureID: markedFeature.feature.featureID,
      options: {
        isValidated: markedFeature.feature.isValidated,
        ...{ point: K.POINT_STYLE, line: K.LINE_STYLE }[ftype],
      },
    });

    E.progress.value += 1;
  }

  markedFeature.isComplete = isNotSkip;
  console.info(`Marked feature as ${type}:`, markedFeature);

  if (polymer.mode === "validate") {
    await showNextFeature();
  } else if (polymer.mode === "create") {
    if (U.isMarkedLine(markedFeature)) {
      const spline = map
        .getInteractions()
        .getArray()
        .find((i) => i instanceof Spline);

      spline?.finish();
    }

    U.setCanMark(map, false);
    U.setCreateMiscButtonState("start");
  }
}

/**
 * Sets the map to not allow marking when the map is moved.
 * @param _event - The map event.
 */
function mapMoveSetCanMark(_event: MapEvent) {
  // Return if not user caused
  if (!map.getView().getInteracting()) return;

  // Validate miscellaneous button state
  if (polymer.mode === "validate") {
    const state = U.getValidateMiscButtonState();
    if (state !== "start" && state !== "complete") {
      U.setCanMark(map, false);
    }
  }

  // Create miscellaneous button state
  if (polymer.mode === "create") {
    const state = U.getCreateMiscButtonState();
    if (state !== "start") {
      U.setCanMark(map, false);
    }
  }
}

/**
 * Handles the end of a feature translation, updating the feature coordinates.
 * @param event - The translate event.
 */
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

    if (!U.isMarkedPoint(markedFeature)) {
      console.error("Feature is not a point:", markedFeature);
      return;
    }

    markedFeature.feature.geometry.coordinates = event.coordinate;
    if (polymer.mode === "validate") {
      if (K.AUTO_RECENTER && polymer.canMark) {
        validateMiscHandler("recenter");
      } else {
        U.setCanMark(map, false);
        U.setValidateMiscButtonState("recenter");
      }
    } else if (polymer.mode === "create") {
      if (K.AUTO_RECENTER && polymer.canMark) {
        createMiscHandler("recenter");
      } else {
        U.setCanMark(map, false);
        U.setCreateMiscButtonState("recenter");
      }
    }
  }
}

/**
 * Handles the keyboard events for the map and features visibility.
 * @param isVisible - Whether the key is up or down.
 */
function visibilityHandler(isVisible: boolean) {
  return ({ code }: KeyboardEvent) => {
    if (code === "Period") setMapVisibility(isVisible);
    else if (code === "Comma") setFeaturesVisibility(isVisible);
  };
}

async function createPoint(event: MapBrowserEvent<MouseEvent>) {
  if (polymer.mode !== "create") return;
  if (U.getCreateMiscButtonState() !== "start") return;
  if (polymer.ftype !== "point") return;

  const result = await FeatureCreator.createPoint(event.coordinate, map);
  if (!result.success) {
    console.error(result.error);
    return;
  }

  if (K.AUTO_RECENTER) {
    createMiscHandler("recenter");
    U.setCreateMiscButtonState("remove");
  } else {
    U.setCreateMiscButtonState("recenter");
  }
}

/* ================================== Event Handlers Setup ================================== */

E.sessionForm.addEventListener("submit", sessionFormSubmit);
E.validateForm.addEventListener("submit", validateFormSubmit);
E.createForm.addEventListener("submit", createFormSubmit);

E.sessionForm.addEventListener("change", () => U.updateSessionForm());
E.sessionModal.addEventListener("close", () =>
  setTimeout(() => U.updateSessionForm(true), 200),
);

E.hideMapButton.addEventListener("mousedown", hideMapHandler);
E.hideFeaturesButton.addEventListener("mousedown", hideFeaturesHandler);

E.newSessionButton.addEventListener("click", () => U.showModal(E.sessionModal));
E.newValidateButton.addEventListener("click", () =>
  U.showModal(E.validateModal),
);
E.newCreateButton.addEventListener("click", () => U.showModal(E.createModal));

E.validateGoodButton.addEventListener("click", () =>
  markFeatureHandler("good"),
);
E.validateMiscButton.addEventListener("click", () => validateMiscHandler());
E.validateBadButton.addEventListener("click", () => markFeatureHandler("bad"));

E.createGoodButton.addEventListener("click", () => markFeatureHandler("good"));
E.createMiscButton.addEventListener("click", () => createMiscHandler());

E.linePatternSelect.addEventListener("change", () => {
  if (polymer.mode !== "create") return;
  spline.onUpdateFinish();
});

addEventListener("keydown", temporaryValidationMiscButtonHandler(true));
addEventListener("keyup", temporaryValidationMiscButtonHandler(false));
addEventListener("keydown", visibilityHandler(false));
addEventListener("keyup", visibilityHandler(true));

map.on("movestart", mapMoveSetCanMark);
map.on("moveend", mapMoveSetCanMark);
map.on("dblclick", createPoint);

translate.on("translateend", onTranslateEnd);

/* ================================== Main ================================== */

U.showModal(E.sessionModal);
