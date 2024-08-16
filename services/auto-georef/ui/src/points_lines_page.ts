import { Feature as OpenLayersFeature, Map as OpenLayersMap } from "ol";
import {
  LineString as OpenLayersLineString,
  Point as OpenLayersPoint,
  Polygon as OpenLayersPolygon,
} from "ol/geom";
import { Circle, Fill, Stroke, Style } from "ol/style";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import VectorSource from "ol/source/Vector";

import { LineString, Point } from "geojson";

import { calculateRatioHSL } from "./color-contrast";

/* ================= Types ================= */

declare const polymer: {
  cogID: string;
  cogURL: string;
  rawFeatures?: Record<string, RawFeatureResponse[]>;
  features?: Record<string, FeatureResponse[]>;
};

interface TypedResponse<T> extends Response {
  json(): Promise<T>;
}

type PageMode = "view" | "validate";

declare function fetch<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TypedResponse<T>>;

interface FeaturesRequest extends Record<string, string> {
  cog_id: string;
  ftype: string;
  system: string;
  version: string;
}

interface FeatureResponse<T = LineString | Point> {
  geometry: T;
  name: string;
  legendID: string;
  bbox: [number, number, number, number];
}

type RawFeatureResponse = Omit<FeatureResponse, "legendID"> & {
  legend_id: string;
};

/* ================= Elements ================= */

const form = document.querySelector<HTMLFormElement>("#mode-system");
const hideMapButton = document.querySelector("#hide-map");
const hideFeaturesButton = document.querySelector("#hide-features");
const newSessionButton = document.querySelector("#new-session");

/* ================= Functions ================= */

function expandResolutions(
  resolutions: number[],
  maxSteps: number,
  minSteps: number,
) {
  let out = [...resolutions];

  const maxRes = resolutions[0];
  for (let i = 1; i < maxSteps; i++) {
    out.unshift(maxRes * Math.pow(2, i));
  }

  const minRes = resolutions[resolutions.length - 1];
  for (let i = 1; i < minSteps; i++) {
    out.push(minRes / Math.pow(2, i));
  }

  return out;
}

function formValidation(): boolean {
  const data = new FormData(form);

  // Helper function to validate a single field of data
  const validateData = (name: string) => {
    const value = data.get(name);
    const query = `label:has(> input[name='${name}'])`;
    const elements = document.querySelectorAll(query);
    const errorRingClasses = [
      "ring-2",
      "ring-error",
      "ring-offset-2",
      "ring-offset-base-100",
    ];

    if (value === null) {
      elements.forEach((e) => e.classList.add(...errorRingClasses));
      return false;
    } else {
      elements.forEach((e) => e.classList.remove(...errorRingClasses));
      return true;
    }
  };

  const validatedData = ["mode", "system"].map(validateData);

  return validatedData.every(Boolean);
}

async function formSubmit(event: Event) {
  event.preventDefault();

  // While form is not valid, check for form changes and don't submit the form
  form.removeEventListener("change", formValidation);
  if (!formValidation()) {
    form.addEventListener("change", formValidation);
    return;
  }

  // Get the form data
  const data = new FormData(form);
  const mode = data.get("mode") as PageMode;
  const [ftype, system, version] = (data.get("system") as string).split("__");

  console.log(mode, ftype, system, version);

  // TODO: Implement validation mode
  if (mode === "validate") {
    return;
  }

  // Show loading spinner
  const loading = form.querySelector(".loading").classList;
  loading.remove("hidden");

  const requestData: FeaturesRequest = {
    cog_id: polymer.cogID,
    ftype,
    system,
    version,
  };
  const url = `/lines/features?${new URLSearchParams(requestData)}`;
  const templateResponse = await fetch(url);

  // If not success, log response and hide loading spinner
  if (!templateResponse.ok) {
    loading.add("hidden");
    console.error(templateResponse);
    return;
  }

  // Add the feature groups to the page
  const template = await templateResponse.text();
  setInnerHTML(document.querySelector("#groups"), template);
  if (polymer.rawFeatures === undefined) {
    console.error("`polymer.rawFeatures` is not defined");
    return;
  }

  // Format features properly
  polymer.features = {};
  for (const [legendID, features] of Object.entries(polymer.rawFeatures)) {
    polymer.features[legendID] = features.map((feature) => {
      const newFeature = {
        ...feature,
        legendID,
      };
      delete newFeature.legend_id;
      return newFeature;
    });
  }
  console.log(polymer.features);

  // Remove all existing features before adding new ones
  removeAllFeatures();
  addFeatures(ftype, polymer.features);

  // Setup event listeners for the new feature groups
  const masterToggle =
    document.querySelector<HTMLInputElement>("#master-toggle");
  const groupToggles = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "#groups input[name='group-toggle']",
    ),
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
      layer.setVisible(toggle.checked);
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

  // Effectively undoes the `event.preventDefault()` call, thus doing the default.
  form.removeEventListener("submit", formSubmit);
  form.submit();
  form.addEventListener("submit", formSubmit);

  // Hide loading spinner and reset form after submission
  loading.add("hidden");
  form.reset();
}

function getRandomNumber(seed: string): number {
  const cyrb53 = (str: string, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  const hash = cyrb53(seed);
  return hash / Math.pow(10, Math.ceil(Math.log10(hash)));
}

function addFeatures(ftype: string, features: typeof polymer.features) {
  if (ftype === "line") {
    for (const [lid, fs] of Object.entries(features)) {
      addLines(lid, fs as FeatureResponse<LineString>[]);
    }
  } else if (ftype === "point") {
    for (const [lid, fs] of Object.entries(features)) {
      addPoints(lid, fs as FeatureResponse<Point>[]);
    }
  } else {
    for (const [lid, fs] of Object.entries(features)) {
      addBBoxes(lid, fs);
    }
  }
}

function removeAllFeatures() {
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

function getOuterColor(hsl: number[]) {
  const blackContrast = calculateRatioHSL(hsl, [0, 0, 0]);
  const whiteContrast = calculateRatioHSL(hsl, [0, 0, 100]);
  return blackContrast / 2 > whiteContrast ? "black" : "white";
}

function addLines(legendID: string, lines: FeatureResponse<LineString>[]) {
  const features = lines.map((line) => {
    return new OpenLayersFeature({
      geometry: new OpenLayersLineString(line.geometry.coordinates),
    });
  });

  const hue = getRandomNumber(legendID) * 360;
  const width = 5;
  const border = 2;

  const hsl = [hue, 100, 50];
  const color = `hsl(${hsl[0]}deg ${hsl[1]}% ${hsl[2]}%)`;
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
  });

  map.addLayer(lineLayer);
}

function addPoints(legendID: string, points: FeatureResponse<Point>[]) {
  const features = points.map((point) => {
    return new OpenLayersFeature({
      geometry: new OpenLayersPoint(point.geometry.coordinates),
    });
  });

  const hue = getRandomNumber(legendID) * 360;
  const width = 10;
  const border = 1;

  const hsl = [hue, 100, 50];
  const color = `hsl(${hsl[0]}deg ${hsl[1]}% ${hsl[2]}% / 0.75)`;
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
  });

  map.addLayer(pointLayer);
}

function addBBoxes(legendID: string, features: FeatureResponse[]) {
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
  });

  map.addLayer(bboxLayer);
}

function handleMouseDownUp<T extends HTMLElement>(
  target: T,
  downFn: () => void,
  upFn: () => void,
) {
  // Mousedown logic
  downFn.call(target);
  target.classList.add("swap-active");

  // Ensures that the event will trigger even when the mouse is released outside the button
  const handleMouseUp = () => {
    upFn.call(target);
    target.classList.remove("swap-active");

    document.removeEventListener("mouseup", handleMouseUp);
  };

  target.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp);
}

function hideMapHandler(this: HTMLElement) {
  handleMouseDownUp(
    this,
    () => mapLayer.setVisible(false),
    () => mapLayer.setVisible(true),
  );
}

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

function setMapVisibility(visible: boolean) {
  if (visible) {
    hideMapButton.dispatchEvent(new MouseEvent("mouseup"));
  } else {
    hideMapButton.dispatchEvent(new MouseEvent("mousedown"));
  }
}

function setFeaturesVisibility(visible: boolean) {
  if (visible) {
    hideFeaturesButton.dispatchEvent(new MouseEvent("mouseup"));
  } else {
    hideFeaturesButton.dispatchEvent(new MouseEvent("mousedown"));
  }
}

function showSessionStartModal() {
  const modal = document.querySelector<HTMLDialogElement>("#session-start");
  modal.showModal();

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function setInnerHTML(element: Element, html: string) {
  element.innerHTML = html;
  element.querySelectorAll("script").forEach((oldScript) => {
    const newScript = document.createElement("script");

    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });

    const scriptText = document.createTextNode(oldScript.innerHTML);
    newScript.appendChild(scriptText);

    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

/* ================= Event Listeners ================= */

form.addEventListener("submit", formSubmit);
hideMapButton.addEventListener("mousedown", hideMapHandler);
hideFeaturesButton.addEventListener("mousedown", hideFeaturesHandler);
newSessionButton.addEventListener("click", showSessionStartModal);

document.addEventListener("keydown", ({ code }) => {
  if (code === "Period") setMapVisibility(false);
  else if (code === "Comma") setFeaturesVisibility(false);
});

document.addEventListener("keyup", ({ code }) => {
  if (code === "Period") setMapVisibility(true);
  else if (code === "Comma") setFeaturesVisibility(true);
});

/* ================= Main ================= */

showSessionStartModal();

const mapSource = new GeoTIFF({
  sources: [{ url: polymer.cogURL, nodata: -1 }],
  convertToRGB: true,
  interpolate: false,
});
const mapLayer = new TileLayer({ source: mapSource });
const map = new OpenLayersMap({
  target: "map",
  layers: [mapLayer],
  controls: [],
  view: mapSource.getView().then((viewOptions) => {
    // Calculate the max resolution.
    // TODO!: Should adjust the maxResolution on window resize
    const [width, height] = viewOptions.extent!.slice(2, 4);
    const maxResWidth = width / window.innerWidth;
    const maxResHeight = height / window.innerHeight;
    const maxResolution = Math.max(maxResWidth, maxResHeight);

    return {
      ...viewOptions,
      constrainOnlyCenter: true,
      resolution: maxResolution * 1.25,
      resolutions: expandResolutions(viewOptions.resolutions, 1, 7),
    };
  }),
});
