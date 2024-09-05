import { Map as OpenLayersMap, Feature as OpenLayersFeature } from "ol";
import {
  LineString as OpenLayersLineString,
  Point as OpenLayersPoint,
  Polygon as OpenLayersPolygon,
} from "ol/geom";
import { Circle, Fill, Stroke, Style } from "ol/style";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type { GeoTIFF } from "ol/source";
import type { Coordinate } from "ol/coordinate";

import type { LineString, Point } from "geojson";

import { replaceProperties } from "@/utils/property-replace";
import { Failure, Success } from "@/utils/result";

import MouseWheelZoom from "@/utils/openlayers/mouse-wheel-zoom";
import DoubleClickZoom from "@/utils/openlayers/double-click-zoom";
import { randint } from "@/utils/random";
import { type Color, colorContrast, colorString, HSL } from "@/utils/color";
import ModifierKey from "@/utils/modifier-key";
import { defaultResolution } from "@/utils/resolution";

import FeatureMarker from "@/points-lines/feature-marker";
import * as E from "@/points-lines/elements";
import * as K from "@/points-lines/constants";

/**
 * Removes all features from the map.
 */
export function removeAllFeatures(map: OpenLayersMap) {
  const layersToRemove = [];
  for (const layer of map.getLayers().getArray()) {
    if (layer instanceof VectorLayer) {
      layersToRemove.push(layer);
    }
  }
  for (const layer of layersToRemove) {
    layer.getSource().clear();
    map.removeLayer(layer);
  }
}

/**
 * Formats the raw features groups to the correct format.
 * @param rawFeatures - The raw features to format.
 * @returns The formatted features.
 */
export function formatRawFeatures(
  rawFeatures: FeatureGroup<RawFeatureResponse>,
) {
  const features: FeatureGroup = {};
  for (const [legendID, rawFeature] of Object.entries(rawFeatures)) {
    features[legendID] = rawFeature.map((feature) =>
      replaceProperties(feature, [
        { from: "feature_id", to: "featureID" },
        { from: "legend_id", to: "legendID" },
        { from: "is_validated", to: "isValidated" },
      ]),
    );
  }
  console.log(features);
  return features;
}

/**
 * Sets the page mode to the specified mode.
 * @param mode - The mode to set.
 */
export function setMode(mode: PageMode | undefined) {
  polymer.mode = mode;

  const groupSidebar = E.query("#group-sidebar").classList;
  const validateControls = E.validateControls.classList;
  const sidebarToggle = E.query<HTMLInputElement>("#sidebar-toggle");
  const switchGroup = E.switchGroup.classList;

  if (mode === "view") {
    groupSidebar.remove("hidden");
    validateControls.add("hidden");
    switchGroup.add("hidden");
  } else if (mode === "validate") {
    groupSidebar.add("hidden");
    switchGroup.remove("hidden");
    sidebarToggle.checked = false;
  }
}

/**
 * Shows a modal dialog.
 * @param modal - The modal dialog to show.
 */
export function showModal(modal: HTMLDialogElement) {
  modal.showModal();

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/**
 * Calculates the color of the outer stroke based on the HSL color.
 * @param hsl - The HSL color to calculate the outer color for.
 * @returns The color of the outer stroke.
 */
function getOuterColor(hsl: Color) {
  const blackContrast = colorContrast(hsl, HSL(0, 0, 0));
  const whiteContrast = colorContrast(hsl, HSL(0, 0, 100));
  return blackContrast > whiteContrast ? "black" : "white";
}

/**
 * Adds the features to the map.
 * @param ftype - The feature type.
 * @param features - The features to add.
 */
export async function addFeatures(
  map: OpenLayersMap,
  ftype: string,
  features: FeatureGroup,
) {
  const fn =
    ftype === "line" ? addLines : ftype === "point" ? addPoints : addBBoxes;

  return Promise.all(
    // @ts-expect-error - Complicated features typing, ignore for now
    Object.entries(features).map(([lid, fs]) => fn(map, lid, fs)),
  );
}

/**
 * Adds lines to the map.
 * @param legendID - The legend ID of the lines.
 * @param lines - The lines to add to the map.
 */
async function addLines(
  map: OpenLayersMap,
  legendID: string,
  lines: Feature<LineString>[],
) {
  const hue = await randint(0, 360, legendID);
  const { width, border, alpha } = K.LINE_STYLE;

  const features = lines.map((line) => {
    const feature = new OpenLayersFeature({
      geometry: new OpenLayersLineString(line.geometry.coordinates),
      properties: { featureID: line.featureID },
    });

    feature.setId(line.featureID);

    if (polymer.mode === "validate") {
      setMarkedFeature(map, {
        feature,
        options: {
          isValidated: line.isValidated,
          width,
          border,
          alpha,
        },
      });
    }

    return feature;
  });

  const hsl = HSL(hue, 100, 50);
  const color = colorString(hsl, alpha);
  const outerColor = getOuterColor(hsl);

  const styleOuter = new Style({
    stroke: new Stroke({ color: outerColor, width }),
  });

  const styleInner = new Style({
    stroke: new Stroke({ color, width: width - border }),
  });

  const lineLayer = new VectorLayer({
    source: new VectorSource({ features }),
    style: [styleOuter, styleInner],
    properties: { legendID },
    updateWhileInteracting: true, // May have performance issues
  });

  map.addLayer(lineLayer);
}

/**
 * Adds points to the map.
 * @param legendID - The legend ID of the points.
 * @param points - The points to add to the map.
 */
async function addPoints(
  map: OpenLayersMap,
  legendID: string,
  points: Feature<Point>[],
) {
  const hue = await randint(0, 360, legendID);
  const { width, border, alpha } = K.POINT_STYLE;

  const features = points.map((point) => {
    const feature = new OpenLayersFeature({
      geometry: new OpenLayersPoint(point.geometry.coordinates),
      properties: { featureID: point.featureID },
    });

    feature.setId(point.featureID);

    if (polymer.mode === "validate") {
      setMarkedFeature(map, {
        feature,
        options: {
          isValidated: point.isValidated,
          width,
          border,
          alpha,
        },
      });
    }

    return feature;
  });

  const hsl = HSL(hue, 100, 50);
  const color = colorString(hsl, alpha);
  const outerColor = getOuterColor(hsl);

  const style = new Style({
    image: new Circle({
      radius: width / 2,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: outerColor, width: border }),
    }),
  });

  const pointLayer = new VectorLayer({
    source: new VectorSource({ features }),
    style,
    properties: { legendID },
    updateWhileInteracting: true, // May have performance issues
  });

  map.addLayer(pointLayer);
}

/**
 * Adds bounding boxes to the map.
 * @param legendID - The legend ID of the bounding boxes.
 * @param features - The features to add to the map.
 */
function addBBoxes(map: OpenLayersMap, legendID: string, features: Feature[]) {
  const newFeatures = features.map((f) => {
    const [x1, y1, x2, y2] = f.bbox;
    const feature = new OpenLayersFeature({
      geometry: new OpenLayersPolygon([
        [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1],
        ],
      ]),
    });
    return feature;
  });

  const bboxLayer = new VectorLayer({
    source: new VectorSource({ features: newFeatures }),
    properties: { legendID },
    updateWhileInteracting: true, // May have performance issues
  });

  map.addLayer(bboxLayer);
}

/**
 * Gets the color of the feature based on its validation status.
 * @param feature - The feature to get the color for.
 * @returns The HSL color of the feature.
 */
function getValidationColor(isValidated?: boolean | null): Color<"HSL"> {
  if (isValidated === true) return HSL(120, 100, 50);
  if (isValidated === false) return HSL(0, 100, 50);
  return HSL(0, 0, 50);
}

/**
 * Gets the feature from the legend ID and feature ID.
 * @param map - The map to get the feature from.
 * @param legendID - The legend ID of the feature.
 * @param featureID - The feature ID of the feature.
 * @returns The feature.
 * @throws An error if the feature is not found.
 */
export function getFeatureFromLegendIDAndFeatureID(
  map: OpenLayersMap,
  legendID: string,
  featureID: string,
) {
  const layer = map
    .getLayers()
    .getArray()
    .find((layer) => layer.get("legendID") === legendID);

  const vectorLayer = layer instanceof VectorLayer ? layer : null;
  const source = vectorLayer?.getSource() as VectorSource | null;
  const vectorSource = source instanceof VectorSource ? source : null;

  const feature = vectorSource?.getFeatureById(featureID);

  if (feature == null) {
    throw new Error(`Feature not found for feature ID: ${featureID}`);
  }

  return feature;
}

type OnlyFeature = {
  feature: OpenLayersFeature;
  legendID?: never;
  featureID?: never;
};

type OnlyLegendIDAndFeatureID = {
  feature?: never;
  legendID: string;
  featureID: string;
};

/**
 * Sets the style of a marked feature. Supplies either the feature or the legend ID and feature ID.
 * @param map - The map to set the marked feature on.
 * @param args - The arguments to set the marked feature.
 * @param args.feature - The feature to set the style for.
 * @param args.legendID - The legend ID of the feature.
 * @param args.featureID - The feature ID of the feature.
 * @param args.options - The options to set the style with.
 * @param args.options.isValidated - Whether the feature is validated.
 * @param args.options.isFocused - Whether the feature is focused.
 * @param args.options.width - The width of the feature.
 * @param args.options.border - The border of the feature.
 * @param args.options.alpha - The alpha of the feature.
 */
export function setMarkedFeature(
  map: OpenLayersMap,
  args: (OnlyFeature | OnlyLegendIDAndFeatureID) & {
    options: {
      isValidated: boolean | null;
      isBold?: boolean;
      width: number;
      border: number;
      alpha: number;
    };
  },
) {
  const {
    feature: potentialFeature,
    legendID,
    featureID,
    options: { isValidated, isBold: isFocused, width, border, alpha },
  } = args;

  const feature =
    potentialFeature === undefined
      ? getFeatureFromLegendIDAndFeatureID(map, legendID, featureID)
      : potentialFeature;

  const hsl = getValidationColor(isValidated);
  const color = colorString(hsl, alpha);
  const outerColor = getOuterColor(hsl);
  const styles = (() => {
    if (feature.getGeometry() instanceof OpenLayersPoint) {
      const style = new Style({
        image: new Circle({
          radius: (width / 2) * (isFocused ? 1.5 : 1),
          fill: new Fill({ color }),
          stroke: new Stroke({
            color: outerColor,
            width: border * (isFocused ? 2 : 1),
          }),
        }),
      });

      const styleBold = new Style({
        image: new Circle({
          radius: (width / 2) * (isFocused ? 1.5 : 1),
          fill: new Fill({ color }),
          stroke: new Stroke({
            color: outerColor === "black" ? "white" : "black",
            width: border * (isFocused ? 4 : 1),
          }),
        }),
      });

      return [styleBold, style];
    } else if (feature.getGeometry() instanceof OpenLayersLineString) {
      const innerStyle = new Style({
        stroke: new Stroke({
          color,
          width: (width - border) * (isFocused ? 1.5 : 1),
        }),
      });

      const outerStyle = new Style({
        stroke: new Stroke({
          color: outerColor,
          width: width * (isFocused ? 2 : 1),
        }),
      });

      return [outerStyle, innerStyle];
    } else {
      throw new Error("Unsupported geometry type");
    }
  })();

  feature.setStyle(styles);
}

/**
 * Visually bold styles a feature on the map.
 * @param map - The map to focus the feature on.
 * @param feature - The feature to focus.
 */
export function setFeatureBold(
  map: OpenLayersMap,
  feature: Feature,
  isBold: boolean,
) {
  const featureID = feature.featureID;
  const legendID = feature.legendID;

  const otherOptions =
    feature.geometry.type === "LineString" ? K.LINE_STYLE : K.POINT_STYLE;

  setMarkedFeature(map, {
    featureID,
    legendID,
    options: {
      isValidated: feature.isValidated,
      isBold,
      ...otherOptions,
    },
  });
}

/**
 * Shows a feature on the map.
 * @param map - The map to show the feature on.
 * @param feature - The feature to show.
 * @param shouldZoom - Whether to zoom in/out to the feature.
 */
export function showFeature(
  map: OpenLayersMap,
  feature: Feature,
  shouldZoom: boolean = false,
) {
  const ftype = feature.geometry.type;

  if (ftype === "Point") {
    const coordinate = feature.geometry.coordinates;
    map.getView().setCenter(coordinate);
    if (shouldZoom) map.getView().setResolution(0.1);
  } else if (ftype === "LineString") {
    // TODO: better fit for LineString with better padding
    map.getView().fit(feature.bbox, {
      padding: Array.from({ length: 4 }, () => 350),
    });
  }

  setFeatureBold(map, feature, true);
}

/**
 * Tries to shows the next feature on the map.
 * @param shouldZoom - Whether to zoom in/out to the next feature.
 * @returns A success response with the boolean representing marking completion,
 * or a failure response with an error message.
 */
export function tryShowNextFeature(
  map: OpenLayersMap,
  shouldZoom: boolean = false,
) {
  const oldResult = FeatureMarker.getCurrent();

  const result = FeatureMarker.getNew(false);
  if (!result.success) return result;

  // Unbold the old feature
  if (oldResult.success) {
    setFeatureBold(map, oldResult.value.feature, false);
  }

  const markedFeature = result.value;

  // If there are no more features to mark, return a success response
  if (markedFeature === null) return Success(true);

  showFeature(map, markedFeature.feature, shouldZoom);
  setCanMark(map, true);

  return Success(false);
}

/**
 * Validates the data for an element or elements and adds an error ring if invalid.
 * @param elementOrElements - The element or elements to validate.
 * @param isValid - Whether the data is valid.
 * @returns Whether the data is valid.
 */
function validateData(
  elementOrElements: Element | NodeListOf<Element> | Element[],
  isValid: boolean,
) {
  const errorRingClasses = [
    "ring-2",
    "ring-error",
    "ring-offset-2",
    "ring-offset-base-100",
  ];

  const elements =
    elementOrElements instanceof Element
      ? [elementOrElements]
      : elementOrElements;

  if (isValid) {
    elements.forEach((e) => e.classList.remove(...errorRingClasses));
    return true;
  } else {
    elements.forEach((e) => e.classList.add(...errorRingClasses));
    return false;
  }
}

/**
 * Sets the error state of the session form if an error occurs on fetch.
 * @param isError - Whether to show the error.
 * @param message - The optional error message to show.
 */
export function setSessionFormSubmitError(isError: boolean, message?: string) {
  const query = "label:has(> input[type='submit'])";
  const submit = E.query(E.sessionForm, query);
  const submitInput = E.query<HTMLInputElement>(submit, "input");
  const submitText = E.query(submit, "span");

  if (isError) {
    submitInput.disabled = true;
    submit.classList.add("pointer-events-none");
    submit.classList.add("!btn-error");

    if (submitText.dataset.originalText === undefined) {
      submitText.dataset.originalText = submitText.innerText;
      submitText.innerText = message ?? "Internal Server Error";
    }
  } else {
    submitInput.disabled = false;
    submit.classList.remove("pointer-events-none");
    submit.classList.remove("!btn-error");

    if (submitText.dataset.originalText !== undefined) {
      submitText.innerText = submitText.dataset.originalText;
      delete submitText.dataset.originalText;
    }
  }
}

/**
 * Validates the session form, adding error rings to invalid elements.
 * @returns Whether the session form is valid.
 */
export function sessionFormValidation(): boolean {
  const data = new FormData(E.sessionForm);
  setSessionFormSubmitError(false);

  const isValid = (name: string) => data.get(name) !== null;
  const elements = (name: string) => {
    const query = `label:has(> input[name='${name}'])`;
    return E.queryAll(query);
  };

  const names = ["mode", "system"];

  const areValids = names.map((name) => {
    return validateData(elements(name), isValid(name));
  });

  return areValids.every(Boolean);
}

/**
 * Validates the validation form, adding error rings to invalid elements.
 * @returns Whether the validation form is valid.
 */
export function validationFormValidation(): boolean {
  const data = new FormData(E.validationForm);

  const isValid = (element: Element, value: string) =>
    Array.from(E.queryAll<HTMLOptionElement>(element, "option"))
      .filter((option) => !option.disabled)
      .map((option) => option.value)
      .includes(value);
  const element = (name: string) => E.query(`select[name='${name}']`);

  const names = ["group", "legend"];

  const areValids = names.map((name) => {
    const value = data.get(name) as string;
    const select = element(name);
    return validateData(select, isValid(select, value));
  });

  return areValids.every(Boolean);
}

/**
 * Sets the zoom anchor to the specified coordinate.
 * @param map - The map to set the zoom anchor on.
 * @param anchor - The anchor coordinate to set.
 */
export function setZoomAnchor(
  map: OpenLayersMap,
  anchor: Coordinate | undefined,
) {
  for (const i of map.getInteractions().getArray()) {
    if (i instanceof MouseWheelZoom || i instanceof DoubleClickZoom) {
      i.setAnchorCoordinate(anchor);
    }
  }
}

export type SkipButtonState =
  | "start"
  | "skip"
  | "unset"
  | "recenter"
  | "reset"
  | "complete";

/**
 * Sets the skip button to the specified state.
 * @param alternate - Whether the skip button should be in the alternate state.
 */
export function setSkipState(state: SkipButtonState, force: boolean = false) {
  if (getSkipState() === "complete" && !force) return;

  E.skipButton.dataset.state = state;

  const skipTextElement = E.query(E.skipButton, "span");
  const skipIconElement = E.query(E.skipButton, "i");

  const stateData: Record<SkipButtonState, [string, string]> = {
    start: ["Start", "fa-play"],
    skip: ["Skip", "fa-forward"],
    unset: ["Unset Validation", "fa-backward-step"],
    recenter: ["Recenter", "fa-arrows-to-dot"],
    reset: ["Reset Position", "fa-rotate-left"],
    complete: ["Complete", "fa-check"],
  };

  const allIcons = Object.values(stateData).map(([, icon]) => icon);

  const [text, icon] = stateData[state];
  skipIconElement.classList.remove(...allIcons);
  skipIconElement.classList.add(icon);
  skipTextElement.innerText = text;

  if (state === "recenter" || state === "start" || state === "complete") {
    E.goodButton.disabled = true;
    E.badButton.disabled = true;
  } else if (state === "reset") {
    E.badButton.disabled = true;
    E.goodButton.disabled = false;
  } else {
    E.goodButton.disabled = false;
    E.badButton.disabled = false;
  }

  if (state === "complete") {
    E.skipButton.classList.add("pointer-events-none");
  } else {
    E.skipButton.classList.remove("pointer-events-none");
  }
}

/**
 * Gets the state of the skip button.
 * @returns The state of the skip button.
 */
export function getSkipState() {
  return E.skipButton.dataset.state as SkipButtonState;
}

/**
 * Fetches a template from the specified URL.
 *
 * @param url - The URL to fetch the template from.
 * @param init - The optional request init to use.
 * @returns A success response with the template, or a failure response with an error message.
 */
export async function fetchTemplate(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init);

    if (!response.ok) {
      throw new Error("Failed to fetch template");
    }

    return Success(await response.text());
  } catch (error) {
    return Failure(error);
  }
}

/**
 * Checks if the feature is a point.
 * @param feature - The feature to check.
 * @returns Whether the feature is a point.
 */
export function isPoint(feature: Feature): feature is Feature<Point> {
  return feature.geometry.type === "Point";
}

/**
 * Checks if the marked feature is a point.
 * @param markedFeature - The marked feature to check.
 * @returns Whether the marked feature is a point.
 */
export function isMarkedPoint(
  markedFeature: MarkedFeature,
): markedFeature is MarkedFeature<Point> {
  return markedFeature?.feature.geometry.type === "Point";
}

/**
 * Sets the can mark state of the map.
 * @param map - The map to set the can mark state on.
 * @param canMark - Whether the map can be marked.
 */
export function setCanMark(map: OpenLayersMap, canMark: boolean) {
  const result = FeatureMarker.getCurrent();
  if (!result.success) return;

  const markedFeature = result.value;
  if (!isMarkedPoint(markedFeature)) return;

  // Mark the global state
  polymer.canMark = canMark;

  // Lock zoom to or unlock zoom from the marked feature
  const coordinate = markedFeature.feature.geometry.coordinates;
  setZoomAnchor(map, canMark ? coordinate : undefined);

  const isOriginalPosition = (() => {
    const result = FeatureMarker.getCurrent();
    if (!result.success) return false;

    const markedFeature = result.value;

    return (
      markedFeature.originalCoordinates ===
      markedFeature.feature.geometry.coordinates
    );
  })();

  const state =
    ModifierKey.is("Meta") || ModifierKey.is("Control")
      ? "unset"
      : canMark
        ? isOriginalPosition
          ? "skip"
          : "reset"
        : "recenter";
  setSkipState(state);
}

/**
 * Sets the map view to the default view.
 * @param map - The map to set the view on.
 * @param mapSource - The map source to set the view on.
 */
export async function resetMapView(map: OpenLayersMap, mapSource: GeoTIFF) {
  const extent = await mapSource.getView().then((view) => view.extent);

  if (extent === undefined) {
    throw new Error("`extent` is not defined");
  }

  const resolution = defaultResolution(extent);
  const [x1, y1, x2, y2] = extent;
  const center = [(x1 + x2) / 2, (y1 + y2) / 2];

  map.getView().setCenter(center);
  map.getView().setResolution(resolution);

  console.info("Resetting map view");
}
