import { Map as OpenLayerMap, Feature as OpenLayerFeature, type MapBrowserEvent } from "ol";
import {
  Polygon as OpenLayersPolygon,
  Point as OpenLayersPoint,
  LineString as OpenLayersLineString,
} from "ol/geom";
import { defaults as defaultControls } from "ol/control/defaults";
import { Draw, Select, defaults as defaultsInteraction, DragPan } from "ol/interaction";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/WebGLTile";
import VectorSource from "ol/source/Vector";
import GeoTIFF from "ol/source/GeoTIFF";
import type { Coordinate } from "ol/coordinate";
import type { DrawEvent, GeometryFunction } from "ol/interaction/Draw";

import type * as jsts from "jsts";
// @ts-expect-error: Types are missing
import { BufferOp } from "jsts/org/locationtech/jts/operation/buffer";
// @ts-expect-error: Types are missing
import { Polygonizer } from "jsts/org/locationtech/jts/operation/polygonize";

import type { Polygon, MultiPolygon, LineString, Geometry } from "geojson";

import { createRoot } from "react-dom/client";
import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from "react";

import Cursor from "./modules/Cursor";
import EditHistory from "./modules/EditHistory";
import * as Element from "./modules/Elements";
import * as Convert from "./modules/Convert";
import ModifierKey from "./modules/ModifierKey";
import Mouse from "./modules/Mouse";
import PolygonLayerManager from "./modules/PolygonLayerManager";
import Radius from "./modules/Radius";
import StateManager from "./modules/StateManager";
import * as Style from "./modules/Styles";
import {
  splitLineString,
  union,
  difference,
  exteriorPolygon,
  coordinatePixelDistance,
  emptyMultiPolygon,
  getRandomInt,
  copyTextToClipboard,
  fetchAPI,
} from "./modules/utils";
import type { GlobalObject, Mode, GlobalPolygons, Layer, LegendItem } from "./modules/Types";
import { AlertStore } from "./modules/Alert";
import * as Keybinds from "./modules/Keybinds";
import Options from "./modules/Options";

// ------------------------------------------------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------------------------------------------------

const LASSO_CROP_SIZE = 1024;
const HALF_SIZE = LASSO_CROP_SIZE / 2;
const CLICK_TOLERANCE = 10;
const ANIMATION_TIMEOUT = 50;
const INF = 1 << 16;
const COG_ID = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "Unknown";
console.info(COG_ID);

const noSelectAlert = AlertStore.create({
  message: "There is no selected layer to edit.",
  type: "warning",
});

const selectHiddenAlert = AlertStore.create({
  message: "The selected layer to edit is hidden.",
  type: "warning",
});

const switchAlert = AlertStore.create({
  message: "Switching to another tool will cancel the current operation. Switch again to confirm.",
  type: "warning",
  time: 5000,
});

const legendNotFoundAlert = AlertStore.create({
  message: "No validated legend item was found at that location.",
  type: "error",
  time: 5000,
});

const legendNotSetAlert = AlertStore.create({
  message: "Cannot mark as validated when legend item has not been set.",
  type: "error",
  time: 5000,
});

const copiedToClipboardAlert = AlertStore.create({
  message: "Copied to clipboard.",
  type: "success",
  time: 5000,
});

// ------------------------------------------------------------------------------------------------------------------------------------
// Utilities and Helper Functions
// ------------------------------------------------------------------------------------------------------------------------------------

const startLoading = () => {
  Element.selectedMode.classList.remove("fade-in");
  setTimeout(() => {
    Element.modeLoading.classList.remove("hidden");
    Element.selectedMode.classList.add("fade-in");
  }, ANIMATION_TIMEOUT);
};

const stopLoading = () => {
  Element.selectedMode.classList.remove("fade-in");
  setTimeout(() => {
    Element.modeLoading.classList.add("hidden");
    Element.selectedMode.classList.add("fade-in");
  }, ANIMATION_TIMEOUT);
};

type LabelMode = "positive" | "negative";
const LabelModeSM = new StateManager<LabelMode>({
  defaultState: "positive",
  parentElement: Element.labelMode,
});

type LassoMode = "add" | "erase";
const LassoModeSM = new StateManager<LassoMode>({
  defaultState: "add",
  parentElement: Element.lassoMode,
});

type LassoDrawMode = "magnetic" | "manual";
const LassoDrawModeSM = new StateManager<LassoDrawMode>({
  defaultState: "magnetic",
  parentElement: Element.lassoDrawMode,
});

// Setup the draw mode manager
type DrawMode = "fill" | "no-fill" | "select";
const onDrawModeChange = (drawMode: DrawMode, oldDrawMode: DrawMode) => {
  const mode = ModeSM.get();
  if (mode !== "add" && mode !== "erase") return;

  updateCursor();

  const interaction = mode === "erase" ? eraseDrawInteraction : addDrawInteraction;
  const polygon = mode === "erase" ? GlobalPolygon.erase : GlobalPolygon.add;

  if (drawMode === "select") {
    interaction.finishDrawing();
    polygonSelectInteraction.setActive(true);
    labelLayer.setVisible(false);

    // MultiPolygon to Features
    let polygons: Geometry[] = [];
    if (polygon.type === "MultiPolygon") {
      polygons = polygon.coordinates.map((coordinates) => ({
        type: "Polygon",
        coordinates,
      }));
    } else if (polygon.type === "Polygon") {
      polygons = [polygon];
    }

    const features = polygons.map(
      (geometry) =>
        new OpenLayerFeature({
          name: mode,
          geometry: Convert.jsonToOpen(geometry),
        }),
    );

    userFacingLayerManager.set(features);
    extraLayerManager.getLayer().setVisible(true);
  } else if (oldDrawMode === "select") {
    polygonSelectInteraction.setActive(false);
    labelLayer.setVisible(true);
    updateUserFacingLayer();
    extraLayerManager.getLayer().setVisible(false);
  }

  if (!Mouse.is(Mouse.LEFT)) return;

  // Forcibly update the geometry when switching draw modes
  // TODO!: Don't use this hack
  try {
    // @ts-expect-error: Using private properties
    const coordinates = modeData.interaction.sketchCoords_;
    if (Array.isArray(coordinates) && coordinates.length > 0) {
      const last = coordinates.at(-1);
      interaction.appendCoordinates([last]);
      interaction.removeLastPoint();
    }
  } catch (_error) {} // eslint-disable-line no-empty, @typescript-eslint/no-unused-vars
};
const DrawModeSM = new StateManager<DrawMode>({
  defaultState: "fill",
  cycleStates: ["fill", "no-fill"],
  parentElement: Element.drawMode,
  onChange: onDrawModeChange,
});

// Setup the mode manager
const onModeChange = (mode: Mode, oldMode: Mode) => {
  if (mode !== oldMode) {
    Element.selectedMode.classList.remove("fade-in");
    setTimeout(() => {
      Element.modeName.innerText = mode;
      Element.selectedMode.classList.add("fade-in");
    }, ANIMATION_TIMEOUT);
  }

  if (mode === "lasso") {
    Cursor.set(Cursor.CROSSHAIR);
  } else {
    resetLasso();
    Cursor.reset();
  }

  updateCursor();
  if (mode === "add" || mode === "erase") {
    DrawModeSM.show();
    if (mode === oldMode) DrawModeSM.cycle();
    else DrawModeSM.reset();
  } else {
    eraseDrawInteraction.finishDrawing();
    addDrawInteraction.finishDrawing();

    DrawModeSM.hide();
    if (DrawModeSM.is("select")) {
      labelLayer.setVisible(true);
      extraLayerManager.getLayer().setVisible(false);
      updateUserFacingLayer();
    }
  }

  if (mode === "label") {
    Element.sendLabels.classList.remove("hidden");
  } else {
    Element.sendLabels.classList.add("hidden");
  }

  if (mode === "lasso") {
    LassoModeSM.show();
    LassoDrawModeSM.show();
    if (mode === oldMode) {
      if (ModifierKey.is(ModifierKey.SHIFT)) LassoModeSM.cycle();
      else {
        LassoDrawModeSM.cycle();
        sendLassoStep(Global.mouseCoordinate);
      }
    } else {
      LassoModeSM.reset();
      LassoDrawModeSM.reset();
    }
  } else {
    LassoModeSM.hide();
    LassoDrawModeSM.hide();
  }

  if (mode === "label") {
    LabelModeSM.show();
    if (mode === oldMode) LabelModeSM.cycle();
    else LabelModeSM.reset();
  } else {
    LabelModeSM.hide();
  }

  if (mode === "view") {
    setDeleteElements();
  } else {
    Element.selectDelete.classList.add("hidden");
  }

  if (mode === "erase") {
    const eraseFeature = userFacingLayerManager.get().find((f) => f.get("name") === "erase-hidden");
    if (eraseFeature) eraseFeature.set("name", "erase");
  } else {
    const eraseFeature = userFacingLayerManager.get().find((f) => f.get("name") === "erase");
    if (eraseFeature) eraseFeature.set("name", "erase-hidden");
  }

  if (mode === "add" || mode === "erase") Radius.show();
  else Radius.hide();

  if (mode !== "add") addDrawInteraction.finishDrawing();
  if (mode !== "erase") eraseDrawInteraction.finishDrawing();

  polygonSelectInteraction.setActive(mode === "view");
};

const ModeSM = new StateManager<Mode>({
  defaultState: "view",
  parentElement: Element.mode,
  onChange: onModeChange,
});

// Setup the edit history manager
// @ts-expect-error: TODO! add edit history typing
const onUndo = (type, data) => {
  let queueData;

  if (type === EditHistory.LABEL) {
    const { feature } = data;
    queueData = { feature, point: Global.labelPoints.pop() };

    labelLayer.getSource()!.removeFeature(feature);
  } else if (type === EditHistory.LABEL_DELETE) {
    const { feature, point } = data;
    queueData = { feature };

    labelLayer.getSource()!.addFeature(feature);
    Global.labelPoints.push(point);
  } else if (type === EditHistory.ERASE || type === EditHistory.ADD) {
    const { erase, add } = data;
    queueData = {
      erase: GlobalPolygon.erase,
      add: GlobalPolygon.add,
    };

    GlobalPolygon.erase = erase;
    GlobalPolygon.add = add;
    updateUserFacingLayer();
  } else if (type === EditHistory.BASE_TOTAL) {
    const { baseTotal } = data;
    queueData = { baseTotal: GlobalPolygon.baseTotal };

    GlobalPolygon.baseTotal = baseTotal;
    updateUserFacingLayer();
  } else if (type === EditHistory.BASE_PARTIAL) {
    const { basePartial } = data;
    queueData = { basePartial: GlobalPolygon.basePartial };

    GlobalPolygon.basePartial = basePartial;
    updateUserFacingLayer();
  } else if (type === EditHistory.SELECT_DELETE) {
    const { baseTotal, basePartial, erase, add } = data;
    queueData = {
      baseTotal: GlobalPolygon.baseTotal,
      basePartial: GlobalPolygon.basePartial,
      erase: GlobalPolygon.erase,
      add: GlobalPolygon.add,
    };

    GlobalPolygon.baseTotal = baseTotal;
    GlobalPolygon.basePartial = basePartial;
    GlobalPolygon.erase = erase;
    GlobalPolygon.add = add;
    updateUserFacingLayer();
  } else {
    console.error("Unknown edit type:", type);
    return;
  }

  return queueData;
};

// @ts-expect-error: TODO! add edit history typing
const onRedo = (type, data) => {
  let saveData;

  if (type === EditHistory.LABEL) {
    const { feature, point } = data;
    saveData = { feature };

    labelLayer.getSource()!.addFeature(feature);
    Global.labelPoints.push(point);
  } else if (type === EditHistory.LABEL_DELETE) {
    const { feature } = data;
    saveData = { feature, point: Global.labelPoints.pop() };

    labelLayer.getSource()!.removeFeature(feature);
  } else if (type === EditHistory.ERASE || type === EditHistory.ADD) {
    const { erase, add } = data;
    saveData = {
      erase: GlobalPolygon.erase,
      add: GlobalPolygon.add,
    };

    GlobalPolygon.erase = erase;
    GlobalPolygon.add = add;
    updateUserFacingLayer();
  } else if (type === EditHistory.BASE_TOTAL) {
    const { baseTotal } = data;
    saveData = { baseTotal: GlobalPolygon.baseTotal };

    GlobalPolygon.baseTotal = baseTotal;
    updateUserFacingLayer();
  } else if (type === EditHistory.BASE_PARTIAL) {
    const { basePartial } = data;
    saveData = { basePartial: GlobalPolygon.basePartial };

    GlobalPolygon.basePartial = basePartial;
    updateUserFacingLayer();
  } else if (type === EditHistory.SELECT_DELETE) {
    const { baseTotal, basePartial, erase, add } = data;
    saveData = {
      baseTotal: GlobalPolygon.baseTotal,
      basePartial: GlobalPolygon.basePartial,
      erase: GlobalPolygon.erase,
      add: GlobalPolygon.add,
    };

    GlobalPolygon.baseTotal = baseTotal;
    GlobalPolygon.basePartial = basePartial;
    GlobalPolygon.erase = erase;
    GlobalPolygon.add = add;
    updateUserFacingLayer();
  } else {
    console.error("Unknown edit type:", type);
    return;
  }

  return saveData;
};

EditHistory.init(onUndo, onRedo);

// Setup the radius manager
Radius.init(Element.radius, () => ModeSM.get());

const generateLayerPolygon = (() => {
  const cache: { [key: string]: Polygon | MultiPolygon } = {};

  return () => {
    const cacheKey = JSON.stringify(GlobalPolygon);
    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    console.time("generating");

    const baseImport = Convert.jsonToJSTS(GlobalPolygon.baseImport);
    const baseTotalPoly = Convert.jsonToJSTS(GlobalPolygon.baseTotal);
    const basePartialPoly = Convert.jsonToJSTS(GlobalPolygon.basePartial);
    const addPoly = Convert.jsonToJSTS(GlobalPolygon.add);
    const erasePoly = Convert.jsonToJSTS(GlobalPolygon.erase);

    const positive = union([baseImport, baseTotalPoly, basePartialPoly, addPoly]);
    const total = difference(positive, erasePoly);

    cache[cacheKey] = Convert.jstsToJSON(total) as MultiPolygon;

    console.timeEnd("generating");

    // Set the mean color of the layer only if not cached
    const layerID = LayerSM.get();
    if (layerID) setMeanColor(layerID, cache[cacheKey]);

    return cache[cacheKey];
  };
})();

// Update the user facing layer
const updateUserFacingLayer = () => {
  userFacingLayerManager.reset();

  const layerID = LayerSM.get();
  const query = `input[name=layer-view][value="${layerID}"]`;
  const layerVisible = document.querySelector<HTMLInputElement>(query);
  if (layerVisible && !layerVisible.checked) return;

  const total = generateLayerPolygon();
  // TODO!: fix hack to get polygons as features
  userFacingLayerManager.setJSTS(Convert.jsonToJSTS(total));
};

// Simple draw geometry function
const simpleDrawGeometry = (manager: typeof addLayerManager, mode: Mode) => {
  return ((coordinates: Coordinate[], geometry: OpenLayersLineString) => {
    const drawInteraction = mode === "erase" ? eraseDrawInteraction : addDrawInteraction;

    // Update the geometry
    if (!geometry) geometry = new OpenLayersLineString([]);
    geometry.setCoordinates(coordinates);

    // Early return if not line
    if (coordinates.length < 2) return geometry;

    // Fixes broken behavior when the user switches modes while drawing
    // or when draw mode should be deactivated
    if (!isDrawActivatedFor(mode, Mouse.get()) || drawInteraction.getPointerCount() !== 1) {
      geometry.setCoordinates([]);
      drawInteraction.finishDrawing();
      return geometry;
    }

    // Create the buffer on the line string
    const lineString = Convert.openToJSTS(geometry);
    let buffer = BufferOp.bufferOp(lineString, Radius.get(mode));

    const shouldFill =
      (DrawModeSM.is("fill") && !Mouse.is(Mouse.RIGHT)) ||
      (DrawModeSM.is("no-fill") && Mouse.is(Mouse.RIGHT));
    if (shouldFill) buffer = exteriorPolygon(buffer);

    const feature = new OpenLayerFeature(Convert.jstsToOpen(buffer));
    manager.set(feature);

    // Return the original line string geometry
    return geometry;
  }) as unknown as GeometryFunction;
};

// ------------------------------------------------------------------------------------------------------------------------------------
// Map and Layers
// ------------------------------------------------------------------------------------------------------------------------------------

const mapSource = new GeoTIFF({
  sources: [
    {
      url: `https://s3.amazonaws.com/public.cdr.land/cogs/${COG_ID}.cog.tif`,
    },
  ],
  convertToRGB: true,
  interpolate: false,
});

const mapLayer = new TileLayer({ source: mapSource });
const labelLayer = new VectorLayer({ source: new VectorSource() });

const userFacingLayerManager = PolygonLayerManager({
  style: () => {
    const layerID = LayerSM.get();
    if (!layerID) return Style.custom(255, 0, 255);

    const layer = LayerStore.layers.get(layerID);
    return layer && layer.color
      ? Style.contrastInvHSL(...layer.color, 3, 0.5)
      : Style.customHSL(200, 100, 60);
  },
});

const eraseLayerManager = PolygonLayerManager({ style: Style.red });
const addLayerManager = PolygonLayerManager({ style: Style.green });
const extraLayerManager = PolygonLayerManager({ style: Style.darken });
extraLayerManager.set(
  new OpenLayerFeature(
    new OpenLayersPolygon([
      [
        [-INF, -INF],
        [+INF, -INF],
        [+INF, +INF],
        [-INF, +INF],
        [-INF, -INF],
      ],
    ]),
  ),
);
extraLayerManager.getLayer().setVisible(false);

const lassoLayerManager = PolygonLayerManager();
const viewLayerManager = PolygonLayerManager();

const polygonSelectInteraction = new Select({
  layers: [userFacingLayerManager.getLayer()],
  style: Style.white,
});

const isDrawActivatedFor = (mode: Mode, button: number) =>
  ModeSM.is(mode) && !DrawModeSM.is("select") && button !== Mouse.MIDDLE;
const eraseDrawInteraction = new Draw({
  type: "LineString",
  style: Style.clear,
  // Determines when the layer is active
  freehandCondition: (event) => isDrawActivatedFor("erase", event.originalEvent.button),
  geometryFunction: simpleDrawGeometry(eraseLayerManager, "erase"),
});

const addDrawInteraction = new Draw({
  type: "LineString",
  style: Style.clear,
  // Determines when the layer is active
  freehandCondition: (event) => isDrawActivatedFor("add", event.originalEvent.button),
  geometryFunction: simpleDrawGeometry(addLayerManager, "add"),
});

const map = new OpenLayerMap({
  layers: [
    mapLayer,
    labelLayer,
    userFacingLayerManager.getLayer(),
    eraseLayerManager.getLayer(),
    addLayerManager.getLayer(),
    lassoLayerManager.getLayer(),
    extraLayerManager.getLayer(),
    viewLayerManager.getLayer(),
  ],
  controls: defaultControls({ zoom: false }),
  interactions: defaultsInteraction().extend([
    new DragPan({
      condition: (event) => {
        return event.originalEvent.button === Mouse.MIDDLE;
      },
    }),
  ]),
  target: "map",
  view: mapSource.getView().then((viewOptions) => {
    // Calculate the max resolution.
    // TODO!: Should adjust the maxResolution on window resize
    const [width, height] = viewOptions.extent!.slice(2, 4);
    const maxResWidth = width / window.innerWidth;
    const maxResHeight = height / window.innerHeight;
    const maxResolution = Math.max(maxResWidth, maxResHeight);

    return {
      ...viewOptions,
      resolutions: undefined,
      minResolution: 0.025,
      maxResolution: maxResolution * 2,
      resolution: maxResolution * 1.25,
      constrainOnlyCenter: true,
    };
  }),
});

map.addInteraction(polygonSelectInteraction);
map.addInteraction(eraseDrawInteraction);
map.addInteraction(addDrawInteraction);

extraLayerManager.getLayer().setZIndex(0);
eraseDrawInteraction.getOverlay().setZIndex(0);
addDrawInteraction.getOverlay().setZIndex(0);
viewLayerManager.getLayer().setZIndex(1);
userFacingLayerManager.getLayer().setZIndex(2);
eraseLayerManager.getLayer().setZIndex(100);
addLayerManager.getLayer().setZIndex(100);
lassoLayerManager.getLayer().setZIndex(100);
labelLayer.setZIndex(1000);

// ------------------------------------------------------------------------------------------------------------------------------------
// Interaction Logic
// ------------------------------------------------------------------------------------------------------------------------------------

const getInitialPolygon = (): GlobalPolygons => ({
  baseImport: emptyMultiPolygon(),
  baseTotal: emptyMultiPolygon(),
  basePartial: emptyMultiPolygon(),
  erase: emptyMultiPolygon(),
  add: emptyMultiPolygon(),
});

let GlobalPolygon = getInitialPolygon();

const getInitialGlobal = (): GlobalObject => ({
  labelState: "off",
  labelPoints: [],
  selectedFeatures: new Set(),
  lassoState: "off",
  lassoStartCoordinate: null,
  lassoPoints: [],
  lassoEdges: [],
  mouseCoordinate: [0, 0],
});

let Global = getInitialGlobal();
// @ts-expect-error: DEBUG!
window.Global = Global;

document.addEventListener("keydown", (event) => {
  const { code, ctrlKey, metaKey, altKey, shiftKey } = event;

  if (
    Global.lassoState !== "off" &&
    [...Keybinds.view, ...Keybinds.label, ...Keybinds.add, ...Keybinds.erase].includes(code)
  ) {
    if (AlertStore.alerts.has(switchAlert.id)) {
      AlertStore.close(switchAlert.id);
    } else {
      AlertStore.show(switchAlert);
      return;
    }
  }

  if (
    ModeSM.is("add") &&
    Mouse.is(Mouse.LEFT) &&
    [...Keybinds.view, ...Keybinds.label, ...Keybinds.lasso, ...Keybinds.erase].includes(code)
  ) {
    if (AlertStore.alerts.has(switchAlert.id)) {
      AlertStore.close(switchAlert.id);
    } else {
      AlertStore.show(switchAlert);
      return;
    }
  }

  if (
    ModeSM.is("erase") &&
    Mouse.is(Mouse.LEFT) &&
    [...Keybinds.view, ...Keybinds.label, ...Keybinds.lasso, ...Keybinds.add].includes(code)
  ) {
    if (AlertStore.alerts.has(switchAlert.id)) {
      AlertStore.close(switchAlert.id);
    } else {
      AlertStore.show(switchAlert);
      return;
    }
  }

  if (Keybinds.view.includes(code) && !(metaKey || ctrlKey)) ModeSM.set("view");
  if (Keybinds.label.includes(code) && !(metaKey || ctrlKey)) ModeSM.set("label");
  if (Keybinds.lasso.includes(code) && !(metaKey || ctrlKey)) ModeSM.set("lasso");
  if (Keybinds.add.includes(code) && !(metaKey || ctrlKey)) ModeSM.set("add");
  if (Keybinds.erase.includes(code) && !(metaKey || ctrlKey)) ModeSM.set("erase");

  // DEBUG! controls
  if (code === "Backslash" && altKey) updateUserFacingLayer();
  if (code === "Digit9" && altKey) userFacingLayerManager.setJSON(GlobalPolygon.baseTotal);
  if (code === "Digit0" && altKey) userFacingLayerManager.setJSON(GlobalPolygon.basePartial);
  if (code === "Minus" && altKey) userFacingLayerManager.setJSON(GlobalPolygon.erase);
  if (code === "Equal" && altKey) userFacingLayerManager.setJSON(GlobalPolygon.add);

  // Radius controls
  if (Keybinds.decreaseRadius.includes(code)) {
    Radius.decrease();
    updateCursor();
  }
  if (Keybinds.increaseRadius.includes(code)) {
    Radius.increase();
    updateCursor();
  }

  if (Keybinds.hidePolygons.includes(code)) {
    event.preventDefault();
    Element.hidePolygons.dispatchEvent(new Event("mousedown"));
  }

  if (Keybinds.hideMap.includes(code)) {
    event.preventDefault();
    Element.hideMap.dispatchEvent(new Event("mousedown"));
  }

  // Edit history controls
  if ((ctrlKey || metaKey) && code === "KeyZ") {
    if (shiftKey) EditHistory.redo();
    else EditHistory.undo();
  }

  if (code === "KeyH") Element.helpDialog.showModal();

  if (
    ModeSM.is("view") ||
    (ModeSM.is("add") && DrawModeSM.is("select")) ||
    (ModeSM.is("erase") && DrawModeSM.is("select"))
  ) {
    if (code === "Backspace" || code === "Delete") polygonDelete();
  }
  if (ModeSM.is("label")) {
    if (code === "Space" || code === "Enter") {
      sendLabelsToServer();
    }
  }
});

document.addEventListener("keyup", (event) => {
  const { code } = event;

  if (Keybinds.hidePolygons.includes(code)) {
    Element.hidePolygons.dispatchEvent(new Event("mouseup"));
  }
  if (Keybinds.hideMap.includes(code)) {
    Element.hideMap.dispatchEvent(new Event("mouseup"));
  }
});

map.on("click", (event) => {
  if (ModeSM.is("label")) {
    onClickLabel(event);
  } else if (ModeSM.is("lasso")) {
    sendLassoStart(event.coordinate);
  }
});

// @ts-expect-error: Working contextmenu not in typing
map.on("contextmenu", (event) => {
  if (ModeSM.is("label")) {
    event.preventDefault();
    onClickLabel(event);
  } else if (ModeSM.is("lasso")) {
    sendLassoStart(event.coordinate);
  }
});

map.on("pointermove", (event) => {
  const { coordinate } = event;
  Global.mouseCoordinate = coordinate;

  if (ModeSM.is("lasso")) {
    if (Global.lassoState === "waiting") {
      Cursor.set(Cursor.PROGRESS);
    } else {
      Cursor.set(Cursor.CROSSHAIR);
    }

    if (Global.lassoState === "active" && LassoDrawModeSM.is("magnetic")) {
      sendLassoStep(coordinate);
    } else if (Global.lassoState !== "off" && LassoDrawModeSM.is("manual")) {
      updateLassoEdge(coordinate);
    }
  } else if (ModeSM.is("label")) {
    if (Global.labelState === "waiting") {
      Cursor.set(Cursor.PROGRESS);
    } else {
      Cursor.reset();
    }
  } else {
    Cursor.reset();
  }
});

map.on("error", (event) => {
  console.info("error", event);
});

let initialRadiusMousePos: [number, number] | null = null;
let initialRadiusSize: number = NaN;
Element.map.addEventListener("mousedown", () => {
  // Mousedown logic
  if (ModifierKey.is(ModifierKey.ALT) && (ModeSM.is("erase") || ModeSM.is("add"))) {
    initialRadiusMousePos = Mouse.position;
    initialRadiusSize = Radius.get();
    eraseDrawInteraction.finishDrawing();
    addDrawInteraction.finishDrawing();
  }

  // Ensures that the mouseup event will trigger even when the mouse is released outside the element
  const handleMouseUp = () => {
    initialRadiusMousePos = null;
    updateCursor();

    document.removeEventListener("mouseup", handleMouseUp);
  };

  Element.map.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp);
});

// Setup on "move" event
(() => {
  let isMoving = false;
  const animationFrame = () => {
    map.dispatchEvent("move");
    if (isMoving) {
      requestAnimationFrame(animationFrame);
    }
  };

  // Start the animation loop
  map.on("movestart", () => {
    isMoving = true;
    animationFrame();
  });

  // Stop the animation loop
  map.on("moveend", () => {
    isMoving = false;
  });
})();

const updateCursor = () => {
  // Show the regular cursor when not in add or erase mode
  if ((!ModeSM.is("add") && !ModeSM.is("erase")) || DrawModeSM.is("select")) {
    Cursor.reset();
    Element.cursor.classList.add("hidden");
    return;
  }

  // Find the current radius and position
  const [x, y] = initialRadiusMousePos ?? Mouse.position;
  const resolution = map.getView().getResolution() ?? 1;
  if (initialRadiusMousePos) {
    const difference = Mouse.position[0] - initialRadiusMousePos[0];
    Radius.set(initialRadiusSize + difference * resolution);
  }
  const radius = Radius.get();
  const diameter = (4 * radius) / resolution;

  // Ensure the cursor is visible by setting a minimum diameter
  const visibleDiameter = Math.max(10, diameter);

  // Update the cursor position and size
  Cursor.set(Cursor.NONE);
  Element.cursor.classList.remove("hidden");
  Element.cursor.style.left = `${x}px`;
  Element.cursor.style.top = `${y}px`;
  Element.cursor.style.width = `${visibleDiameter}px`;
};

// @ts-expect-error: Custom move event
map.on("move", updateCursor);
map.on("pointermove", updateCursor);
document.addEventListener("mousemove", updateCursor);

Element.hidePolygons.addEventListener("mousedown", () => {
  // Mousedown logic
  userFacingLayerManager.getLayer().setVisible(false);
  viewLayerManager.getLayer().setVisible(false);
  eraseLayerManager.getLayer().setVisible(false);
  addLayerManager.getLayer().setVisible(false);
  lassoLayerManager.getLayer().setVisible(false);
  labelLayer.setVisible(false);
  Element.hidePolygons.classList.add("swap-active");

  // Ensures that the mouseup event will trigger even when the mouse is released outside the button
  const handleMouseUp = () => {
    userFacingLayerManager.getLayer().setVisible(true);
    viewLayerManager.getLayer().setVisible(true);
    eraseLayerManager.getLayer().setVisible(true);
    addLayerManager.getLayer().setVisible(true);
    lassoLayerManager.getLayer().setVisible(true);
    labelLayer.setVisible(true);
    Element.hidePolygons.classList.remove("swap-active");

    document.removeEventListener("mouseup", handleMouseUp);
  };

  Element.hidePolygons.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp);
});

Element.hideMap.addEventListener("mousedown", () => {
  // Mousedown logic
  mapLayer.setVisible(false);
  Element.hideMap.classList.add("swap-active");

  // Ensures that the event will trigger even when the mouse is released outside the button
  const handleMouseUp = () => {
    mapLayer.setVisible(true);
    Element.hideMap.classList.remove("swap-active");

    document.removeEventListener("mouseup", handleMouseUp);
  };

  Element.hideMap.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp);
});

Element.undo.addEventListener("click", EditHistory.undo);
Element.redo.addEventListener("click", EditHistory.redo);

const resetData = () => {
  EditHistory.clear();
  Global = getInitialGlobal();
  GlobalPolygon = getInitialPolygon();
};

const resetUI = () => {
  ModeSM.set("view");
  labelLayer.getSource()!.clear();
  lassoLayerManager.reset();
  updateUserFacingLayer();
};

Element.clear.addEventListener("click", () => {
  resetData();
  resetUI();
});

// Label interaction
const sendLabelsToServer = async () => {
  try {
    if (Global.labelState === "waiting") return;

    Global.labelState = "waiting";
    Cursor.set(Cursor.PROGRESS);
    startLoading();

    console.time("fetching");

    const response = await fetchAPI<{
      geometry: MultiPolygon;
      layer_id: string;
    }>("labels", {
      method: "POST",
      body: {
        cog_id: COG_ID,
        points: Global.labelPoints,
        layer_id: LayerSM.get(),
      },
    });

    if (!response.ok) {
      const json = (await response.json()) as { detail?: string };
      throw new Error(json?.detail ?? "Error sending labels to server.");
    }

    const { geometry, layer_id } = await response.json();

    console.timeEnd("fetching");

    if (layer_id == LayerSM.get()) {
      const baseTotal = GlobalPolygon.baseTotal;
      EditHistory.save(EditHistory.BASE_TOTAL, { baseTotal });
      GlobalPolygon.baseTotal = geometry;
    } else {
      console.info("Layer ID mismatch:", layer_id, LayerSM.get());
      throw new Error("Error sending labels to server.");
    }

    updateUserFacingLayer();
    Cursor.reset();
    stopLoading();

    Global.labelState = "off";
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error sending labels to server. Please try again later.";

    AlertStore.show(
      AlertStore.create({
        message: message,
        type: "error",
        time: 5000,
      }),
    );
    console.error("Error fetching data:", message);

    Cursor.reset();
    stopLoading();
    Global.labelState = "off";
  }
};

Element.sendLabels.addEventListener("click", sendLabelsToServer);

const onClickLabel = (event: MapBrowserEvent<MouseEvent>) => {
  let type = LabelModeSM.get();

  const { coordinate } = event;

  let didDelete = false;
  Global.labelPoints = Global.labelPoints.filter((point) => {
    const { coordinate: existingCoordinate, feature } = point;
    const distance = coordinatePixelDistance(existingCoordinate, coordinate, map);

    if (distance < CLICK_TOLERANCE && !didDelete) {
      labelLayer.getSource()!.removeFeature(feature);
      didDelete = true;
      EditHistory.save(EditHistory.LABEL_DELETE, { feature, point });
      return false;
    }

    return true;
  });

  if (didDelete) return;

  if (Mouse.is(Mouse.RIGHT)) {
    type = type === "positive" ? "negative" : "positive";
  }

  const feature = new OpenLayerFeature({
    name: type,
    geometry: new OpenLayersPoint(coordinate),
  });

  feature.setStyle(Style.label(type === "positive"));

  labelLayer.getSource()!.addFeature(feature);

  Global.labelPoints.push({ coordinate, type, feature });
  EditHistory.save(EditHistory.LABEL, { feature });
};

const drawPolygons = (mode: Mode) => {
  const layerManager = mode === "erase" ? eraseLayerManager : addLayerManager;
  const editMode = mode === "erase" ? EditHistory.ERASE : EditHistory.ADD;
  return (event: DrawEvent) => {
    // Do nothing if the radius is being resized
    const geometry = event.feature.getGeometry();

    if (geometry == null) return;
    if (!(geometry instanceof OpenLayersLineString)) return;

    if (geometry.getCoordinates().length === 1) {
      geometry.setCoordinates([]);
      layerManager.reset();
      return;
    }

    if (ModeSM.get() !== mode || DrawModeSM.is("select")) {
      geometry.setCoordinates([]);
      layerManager.reset();
      return;
    }

    // TODO!: Check if the basePoly and negPoly are disjoint, then neither do operation nor add it to edit history

    // Save the current state to edit history
    const erase = GlobalPolygon.erase;
    const add = GlobalPolygon.add;
    EditHistory.save(editMode, { erase, add });

    // Get the drawn polygon on layer
    const mainPoly = layerManager.getJSTS();
    let newAdd, newErase;

    if (mode === "erase") {
      // Merge it with the other polygons on the erase layer
      newErase = union([mainPoly, Convert.jsonToJSTS(erase)]);

      // Remove any portion from add layer
      newAdd = difference(Convert.jsonToJSTS(add), mainPoly);
    } else {
      // Merge it with the other polygons on the add layer
      newAdd = union([mainPoly, Convert.jsonToJSTS(add)]);

      // Remove any portion from add layer
      newErase = difference(Convert.jsonToJSTS(erase), mainPoly);
    }

    GlobalPolygon.add = Convert.jstsToJSON(newAdd) as MultiPolygon;
    GlobalPolygon.erase = Convert.jstsToJSON(newErase) as MultiPolygon;

    updateUserFacingLayer();
    layerManager.reset();
  };
};

eraseDrawInteraction.on("drawabort", drawPolygons("erase"));
eraseDrawInteraction.on("drawend", drawPolygons("erase"));

addDrawInteraction.on("drawabort", drawPolygons("add"));
addDrawInteraction.on("drawend", drawPolygons("add"));

const resetLasso = () => {
  lassoLayerManager.reset();
  Global.lassoState = "off";
  Global.lassoStartCoordinate = null;
  Global.lassoPoints = [];
  Global.lassoEdges = [];
};

const closeLasso = () => {
  // Convert edges to linear ring
  const edges = Global.lassoEdges;
  edges.sort((a, b) => a.index - b.index);
  const coordinateGroups = edges.map((edge) => edge.coordinates);
  const coordinates = ([] as Coordinate[]).concat(...coordinateGroups);
  const linearRing = Convert.jsonToJSTS({
    type: "LineString",
    coordinates: [...coordinates, coordinates[0]],
  }) as jsts.geom.LineString;

  // Polygonize the linear ring
  const segments = splitLineString(linearRing);
  const polygonizer = new Polygonizer();
  polygonizer.add(union(segments));
  const polygons = polygonizer.getPolygons().toArray();
  const polygon = union(polygons);

  // Save the current state to edit history
  const shouldErase =
    (LassoModeSM.is("erase") && !Mouse.is(Mouse.RIGHT)) ||
    (LassoModeSM.is("add") && Mouse.is(Mouse.RIGHT));
  if (shouldErase) {
    const erase = GlobalPolygon.erase;
    const newErase = union([Convert.jsonToJSTS(erase), polygon]);

    const add = GlobalPolygon.add;
    const newAdd = difference(Convert.jsonToJSTS(add), polygon);

    EditHistory.save(EditHistory.ERASE, { erase, add });
    GlobalPolygon.erase = Convert.jstsToJSON(newErase) as MultiPolygon;
    GlobalPolygon.add = Convert.jstsToJSON(newAdd) as MultiPolygon;
  } else {
    const basePartial = GlobalPolygon.basePartial;
    const newBasePartial = union([Convert.jsonToJSTS(basePartial), polygon]);
    EditHistory.save(EditHistory.BASE_PARTIAL, { basePartial });
    GlobalPolygon.basePartial = Convert.jstsToJSON(newBasePartial) as MultiPolygon;
  }

  updateUserFacingLayer();

  // Reset the lasso layer
  resetLasso();
};

const updateLassoEdge = (coordinate: Coordinate, geometry?: OpenLayersLineString) => {
  const pointCount = Global.lassoPoints.length;

  // Remove any old edges for the current point (all edges after the current point)
  const oldEdges = Global.lassoEdges.slice(pointCount - 1);
  for (const { feature } of oldEdges) {
    lassoLayerManager.remove(feature);
  }
  Global.lassoEdges = Global.lassoEdges.slice(0, pointCount - 1);

  geometry ??= new OpenLayersLineString([Global.lassoPoints.at(-1)!.coordinate, coordinate]);

  // Add the new edge
  const feature = new OpenLayerFeature({ name: "edge", geometry });
  feature.setStyle(Style.custom(255, 255, 0, 5, 0.85));
  const index = Global.lassoEdges.length;
  const coordinates = feature.getGeometry()!.getCoordinates();
  Global.lassoEdges.push({ feature, index, coordinates });
  lassoLayerManager.add(feature);
};

const makeLassoGuides = () => {
  if (Global.lassoState !== "active") return;
  if (Global.lassoStartCoordinate == null) return;

  const [x, y] = Global.lassoStartCoordinate;

  const polygon = new OpenLayerFeature({
    name: "guide",
    geometry: new OpenLayersPolygon([
      [
        [-INF, -INF],
        [+INF, -INF],
        [+INF, +INF],
        [-INF, +INF],
        [-INF, -INF],
      ],
      [
        [x - HALF_SIZE, y - HALF_SIZE],
        [x + HALF_SIZE, y - HALF_SIZE],
        [x + HALF_SIZE, y + HALF_SIZE],
        [x - HALF_SIZE, y + HALF_SIZE],
        [x - HALF_SIZE, y - HALF_SIZE],
      ],
    ]),
  });
  polygon.setStyle(Style.darken);

  if (!ModeSM.is("lasso")) return;

  const features = lassoLayerManager.get();
  const guideFeatures = features.filter((f) => f.get("name") === "guide");
  guideFeatures.forEach((f) => lassoLayerManager.remove(f));
  lassoLayerManager.add(polygon);
};

const sendLassoStart = async (coordinate: Coordinate) => {
  try {
    if (Global.lassoState === "waiting") return;

    Global.lassoState = "waiting";
    Cursor.set(Cursor.PROGRESS);
    startLoading();

    // Ensure the coordinate is within the crop size by setting it to the
    // endpoint of the last edge
    if (Global.lassoPoints.length > 0) {
      const lastEdge = Global.lassoEdges.at(-1);
      coordinate = lastEdge!.coordinates.at(-1)!;
    }

    // Check if removing the last point
    let didRemove = false;
    if (Global.lassoPoints.length > 0) {
      const lastCoordinate = Global.lassoPoints.at(-1)!.coordinate;
      const distance = coordinatePixelDistance(lastCoordinate, coordinate, map);

      if (distance < CLICK_TOLERANCE) {
        lassoLayerManager.remove(Global.lassoPoints.pop()!.feature);

        // Remove the last two edges or reset the lasso layer
        if (Global.lassoPoints.length > 0) {
          lassoLayerManager.remove(Global.lassoEdges.pop()!.feature);
          lassoLayerManager.remove(Global.lassoEdges.pop()!.feature);
        } else {
          resetLasso();
          Cursor.set(Cursor.CROSSHAIR);
          stopLoading();
          return;
        }

        didRemove = true;

        // Also reset the coordinate to the last point
        coordinate = Global.lassoPoints.at(-1)!.coordinate;
      }
    }

    // Check if the lasso is finished and can be closed
    if (Global.lassoPoints.length > 2) {
      const firstCoordinate = Global.lassoPoints[0].coordinate;
      const distance = coordinatePixelDistance(firstCoordinate, coordinate, map);

      if (distance < CLICK_TOLERANCE) {
        closeLasso();
        Cursor.set(Cursor.CROSSHAIR);
        stopLoading();
        return;
      }
    }

    // Add the new point is one was not removed
    if (!didRemove) {
      const newPoint = new OpenLayerFeature({
        name: "point",
        geometry: new OpenLayersPoint(coordinate),
      });
      newPoint.setStyle(Style.point);
      lassoLayerManager.add(newPoint);

      const index = Global.lassoPoints.length;
      Global.lassoPoints.push({ coordinate, index, feature: newPoint });
    }

    const response = await fetchAPI<{ layer_id: string }>("lasso-start", {
      method: "POST",
      body: {
        cog_id: COG_ID,
        coordinate,
        crop_size: LASSO_CROP_SIZE,
        layer_id: LayerSM.get(),
      },
      timeout: 15000,
    });

    if (!response.ok) throw new Error("Error sending lasso start to server.");

    const { layer_id } = await response.json();

    if (layer_id === LayerSM.get()) {
      Global.lassoState = "active";
      Global.lassoStartCoordinate = coordinate;

      makeLassoGuides();
      sendLassoStep(Global.mouseCoordinate);
    } else {
      console.info("Layer ID mismatch:", layer_id, LayerSM.get());
      resetLasso();
    }

    Cursor.set(Cursor.CROSSHAIR);
    stopLoading();
  } catch (error) {
    resetLasso();
    Cursor.set(Cursor.CROSSHAIR);
    stopLoading();
    AlertStore.show(
      AlertStore.create({
        message: "Error getting lasso data from the server. Please try again later.",
        type: "error",
        showAlertType: false,
        time: 5000,
      }),
    );
    console.error("Error fetching data:", error);
  }
};

const sendLassoStep = async (coordinate: Coordinate) => {
  try {
    if (Global.lassoState === "off" || Global.lassoState === "waiting") return;

    const response = await fetchAPI<{
      geometry: LineString;
      layer_id: string;
    }>("lasso-step", {
      method: "POST",
      body: {
        cog_id: COG_ID,
        coordinate,
        layer_id: LayerSM.get(),
      },
      timeout: 5000,
    });

    if (!response.ok) throw new Error("Error sending lasso step to server.");

    const { geometry, layer_id } = await response.json();

    if (!LassoDrawModeSM.is("magnetic")) {
      Cursor.set(Cursor.CROSSHAIR);
      stopLoading();
    }

    if (!ModeSM.is("lasso") || LayerSM.get() !== layer_id) {
      resetLasso();
      Cursor.set(Cursor.CROSSHAIR);
      stopLoading();
    } else if (LassoDrawModeSM.is("magnetic")) {
      updateLassoEdge(coordinate, Convert.jsonToOpen(geometry) as OpenLayersLineString);
    }
  } catch (error) {
    if (error instanceof Object) {
      const { name } = error as { name?: string };
      if (["TimeoutError", "AbortError"].includes(name ?? "")) {
        console.warn(error);
        return;
      }
    }

    console.error(error);
  }
};

const setMeanColor = async (layerID: string, polygon?: Geometry) => {
  try {
    polygon ??= generateLayerPolygon();

    const response = await fetchAPI<{
      color: [number, number, number];
      error: boolean;
      layer_id: string;
    }>("mean-color", {
      method: "POST",
      body: {
        cog_id: COG_ID,
        geometry: polygon,
        layer_id: layerID,
      },
    });

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const { color, layer_id: responseLayerID } = await response.json();

    const layer = LayerStore.layers.get(responseLayerID);
    if (!layer) return;

    layer.color = color;

    LayerStore.setLayer(layer);
  } catch (error) {
    const layer = LayerStore.layers.get(layerID);
    if (layer) {
      delete layer.color;
      LayerStore.setLayer(layer);
    }

    console.error(error);
  }
};

// Polygon selection interaction
const polygonDelete = () => {
  if (Global.selectedFeatures.size === 0) return;

  EditHistory.save(EditHistory.SELECT_DELETE, {
    baseTotal: GlobalPolygon.baseTotal,
    basePartial: GlobalPolygon.basePartial,
    erase: GlobalPolygon.erase,
    add: GlobalPolygon.add,
  });

  if (ModeSM.is("view")) {
    const selectedPolygons = Array.from(Global.selectedFeatures.values()).map((f) =>
      Convert.openToJSTS(f.getGeometry()!),
    );

    // Add selected polygons to the erase layer and remove them from the polygon layers
    const erase = Convert.jsonToJSTS(GlobalPolygon.erase);
    const newErase = union([erase, ...selectedPolygons]);
    GlobalPolygon.erase = Convert.jstsToJSON(newErase) as MultiPolygon;

    const add = Convert.jsonToJSTS(GlobalPolygon.add);
    const newAdd = difference(add, newErase);
    GlobalPolygon.add = Convert.jstsToJSON(newAdd) as MultiPolygon;
    updateUserFacingLayer();
  } else {
    userFacingLayerManager.remove(Array.from(Global.selectedFeatures.values()));
    const result = userFacingLayerManager.getJSON() as MultiPolygon;

    if (ModeSM.is("add")) {
      GlobalPolygon.add = result;
    } else if (ModeSM.is("erase")) {
      GlobalPolygon.erase = result;
    } else {
      console.error("Unknown mode:", ModeSM.get());
    }
  }

  Global.selectedFeatures = new Set();
  setDeleteElements();
};

Element.selectDelete.addEventListener("click", polygonDelete);
Element.drawDelete.addEventListener("click", polygonDelete);

const setDeleteElements = () => {
  const deleteElement = ModeSM.is("view") ? Element.selectDelete : Element.drawDelete;

  if (Global.selectedFeatures.size === 0) {
    deleteElement.classList.add("hidden");
  } else {
    deleteElement.classList.remove("hidden");
  }
};

polygonSelectInteraction.on("select", ({ selected, deselected }) => {
  if (selected.length > 0) {
    selected.forEach((f) => Global.selectedFeatures.add(f));
  }

  if (deselected.length > 0) {
    deselected.forEach((f) => Global.selectedFeatures.delete(f));
  }

  setDeleteElements();
});

// Mode selection
ModeSM.set("view");

// ------------------------------------------------------------------------------------------------------------------------------------
// React
// ------------------------------------------------------------------------------------------------------------------------------------

const LayerStore = {
  layers: new Map<string, Layer>(),
  subscribers: new Set<() => void>(),
  savedIDs: new Set<string>(),
  getSnapshot: () => LayerStore.layers,
  subscribe: (callback: () => void) => {
    LayerStore.subscribers.add(callback);
    return () => LayerStore.subscribers.delete(callback);
  },
  notify: () => {
    LayerStore.layers = new Map(LayerStore.layers);
    LayerStore.subscribers.forEach((callback) => callback());
  },
  getNewID: (): string => {
    let id = 0;
    while (LayerStore.savedIDs.has(id.toString())) {
      id = getRandomInt(0, Number.MAX_SAFE_INTEGER);
    }
    const newID = id.toString();
    LayerStore.savedIDs.add(newID);
    return newID;
  },
  setLayer: (layer: Layer, initial = false) => {
    LayerStore.layers.set(layer.id, layer);
    if (initial && !layer.color) setMeanColor(layer.id, layer.polygon);

    LayerStore.notify();
  },
  removeLayer: (id: string) => {
    LayerStore.layers.delete(id);

    // Reset the data and UI if the current layer is removed
    if (LayerSM.get() === id) {
      LayerStore.selectLayer(null);
    }

    LayerStore.notify();
  },
  selectLayer: (id: string | null) => {
    // Save the current layer if one is selected and exists
    LayerStore.updateCurrentLayer();

    if (id == null) {
      LayerSM.set(null);
      resetData();
      resetUI();
      return;
    }

    // Set the new layer if it exists
    resetData();
    const newLayer = LayerStore.layers.get(id);
    if (newLayer) GlobalPolygon.baseImport = newLayer.polygon;
    LayerSM.set(id);
    resetUI();
  },
  updateCurrentLayer: () => {
    const polygon = generateLayerPolygon();
    const layerID = LayerSM.get();
    if (layerID) {
      const layer = LayerStore.layers.get(layerID)!;
      if (layer) {
        layer.polygon = polygon;
        LayerStore.setLayer(layer);
      }
    }
  },
};

export type LayerStore = typeof LayerStore;

Element.root.style.setProperty("--side-bar-width", "min(40vw, 32rem)");

const preventFocusScroll = (event: React.FocusEvent<HTMLElement>) => {
  event.preventDefault();
  event.target.focus({ preventScroll: true });
};

const LayerCard = forwardRef(
  (
    {
      layer,
      handleLayerViewChange,
    }: {
      layer: Layer;
      handleLayerViewChange: () => void;
    },
    ref: React.ForwardedRef<HTMLInputElement>,
  ) => {
    const inputTextRef = useRef<HTMLInputElement>(null);
    const inputSelectedRef = useRef<HTMLInputElement>(null);

    // Run every render
    useEffect(() => {
      if (layer.isValidated && LayerSM.get() === layer.id) {
        LayerStore.selectLayer(null);
        if (inputSelectedRef.current) inputSelectedRef.current.checked = false;
      }
    });

    const preventKeyboardPropagation = (event: React.KeyboardEvent) => {
      event.stopPropagation();
    };

    return (
      <div
        className={`card card-compact w-full bg-base-300 shadow-inner has-[[type=radio]:checked]:outline has-[[type=radio]:checked]:[outline-offset:2px] has-[[type=radio]:checked]:[outline-width:2px] ${!layer.isValidated && "cursor-pointer"}`}
        onClick={() => {
          if (layer.isValidated) return;
          LayerStore.selectLayer(layer.id);
        }}
      >
        <div
          className="card-body flex-row items-center gap-2"
          onClick={(event: React.MouseEvent) => {
            if (!inputTextRef.current) return;
            if (
              !layer.legendItem &&
              (event.detail > 1 || inputTextRef.current === document.activeElement)
            ) {
              inputTextRef.current.inert = false;
              inputTextRef.current.focus();
            } else {
              inputTextRef.current.inert = true;
            }
          }}
        >
          {layer.color && (
            <div
              className="btn btn-square btn-sm pointer-events-none border-none"
              style={{
                backgroundColor: `hsl(${layer.color[0]}deg ${layer.color[1]}% ${layer.color[2]}%)`,
              }}
            ></div>
          )}

          {layer.isValidated && layer.legendItem ? (
            <div className="mr-auto flex flex-col px-2">
              <h2 className="card-title !m-0 font-extrabold">{layer.legendItem.name}</h2>
              <h3 className="font-semibold uppercase opacity-65">Validated</h3>
            </div>
          ) : layer.legendItem ? (
            <div className="mr-auto flex flex-col px-2">
              <h2 className="card-title !m-0 font-extrabold">{layer.legendItem.name}</h2>
              <h3 className="font-semibold uppercase opacity-65">Associated</h3>
            </div>
          ) : (
            <input
              type="text"
              className="input card-title !mb-0 mr-auto w-full max-w-xs cursor-pointer bg-transparent px-2 focus:cursor-text"
              value={layer.name}
              ref={inputTextRef}
              // @ts-expect-error: `inert` will be supported in React 19
              inert={true.toString()}
              onKeyDown={preventKeyboardPropagation}
              onKeyUp={preventKeyboardPropagation}
              onInput={(event: React.ChangeEvent<HTMLInputElement>) => {
                layer.name = event.currentTarget.value;
                LayerStore.setLayer(layer);
              }}
            />
          )}

          <input
            type="radio"
            name="layer-select"
            value={layer.id}
            ref={inputSelectedRef}
            className="hidden"
          />

          {/* Fix for daisyUI join group bug. Only use join group if there is not exactly one element. */}
          <div className="pointer-events-auto [&:not(&:has(>:last-child:nth-child(1)))]:join">
            {layer.legendItem && (
              <div className="tooltip tooltip-top before:z-30" data-tip="Show Legend Item">
                <button
                  className="btn btn-square btn-ghost join-item btn-sm relative text-lg hover:btn-warning focus-visible:z-10"
                  onClick={(event) => {
                    event.stopPropagation();

                    if (!layer.legendItem) return;

                    // TODO: Make better zoom in
                    const isWindowWider = window.innerWidth > window.innerHeight;
                    const padding = isWindowWider ? [350, 0, 350, 0] : [0, 200, 0, 200];
                    // const padding = [50, 50, 50, 50];

                    map.getView().fit(layer.legendItem.bbox, {
                      duration: 500,
                      padding,
                    });
                  }}
                >
                  <i className="fa-solid fa-binoculars"></i>
                </button>
              </div>
            )}

            {layer.legendItem && !layer.isValidated && (
              <div className="tooltip tooltip-top before:z-30" data-tip="Clear Legend Item">
                <button
                  className="btn btn-square btn-ghost join-item btn-sm relative text-lg focus-visible:z-10"
                  onClick={(event) => {
                    event.stopPropagation();
                    const newLayer = { ...layer, legendItem: undefined };
                    LayerStore.setLayer(newLayer);
                  }}
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            )}

            {!layer.isValidated && (
              <div className="tooltip tooltip-top before:z-30" data-tip="Set Legend Item">
                <button
                  className="btn btn-square btn-ghost join-item btn-sm relative text-lg focus-visible:z-10"
                  onClick={(event) => {
                    event.stopPropagation();

                    const clickAlert = AlertStore.create({
                      message: `Click legend swatch to associate '${layer.legendItem?.name ?? layer.name}' to a validated legend item.`,
                      type: "info",
                    });
                    AlertStore.show(clickAlert);

                    const allLegendIDs = Array.from(
                      LayerStore.layers.values(),
                      (layer) => layer.legendItem?.id,
                    ).filter(Boolean);

                    map.once("click", async (event) => {
                      AlertStore.close(clickAlert.id);
                      const point = event.coordinate;
                      const response = await fetchAPI<LegendItem>("select_legend_item_point", {
                        method: "POST",
                        body: {
                          cog_id: COG_ID,
                          point,
                        },
                      });

                      if (!response.ok) {
                        console.error("Error selecting legend item:", response.statusText);
                        AlertStore.show(legendNotFoundAlert);
                        LayerStore.setLayer({ ...layer, legendItem: undefined });
                        return;
                      }

                      const legendItem = (await response.json()) as LegendItem;

                      if (allLegendIDs.some((id) => legendItem.id === id)) {
                        const legendExistsAlert = AlertStore.create({
                          message: `Legend item '${legendItem.name}' has already been associated with another layer. Please select a different legend item.`,
                          type: "warning",
                          time: 7500,
                        });
                        AlertStore.show(legendExistsAlert);
                        LayerStore.setLayer({ ...layer, legendItem: undefined });
                        return;
                      }

                      const newLayer = { ...layer, legendItem };
                      const foundAlert = AlertStore.create({
                        message: `Legend item '${legendItem.name}' found.`,
                        type: "success",
                        time: 5000,
                      });
                      AlertStore.show(foundAlert);
                      LayerStore.setLayer(newLayer);
                    });
                  }}
                >
                  <i className="fa-solid fa-crosshairs"></i>
                </button>
              </div>
            )}
          </div>

          {layer.legendItem && (
            <button className="join pointer-events-auto">
              <div
                className="swap-off tooltip tooltip-top before:z-30"
                data-tip="Mark as Validated"
                onClick={(event) => {
                  if (!layer.legendItem) {
                    AlertStore.show(legendNotSetAlert);
                    return;
                  }

                  LayerStore.setLayer({ ...layer, isValidated: true });
                  event.stopPropagation();
                }}
              >
                <div
                  className={`btn btn-outline join-item btn-sm relative w-12 items-center text-lg focus-visible:z-10 ${layer.isValidated ? "btn-active" : "hover:opacity-50"}`}
                >
                  <i className="fa-solid fa-user-check"></i>
                </div>
              </div>

              <div
                className="swap-off tooltip tooltip-top before:z-30"
                data-tip="Mark as Not Validated"
                onClick={(event) => {
                  LayerStore.setLayer({ ...layer, isValidated: false });
                  event.stopPropagation();
                }}
              >
                <div
                  className={`btn btn-outline join-item btn-sm relative w-12 items-center text-lg focus-visible:z-10 ${layer.isValidated ? "hover:opacity-50" : "btn-active"}`}
                >
                  <i className="fa-solid fa-triangle-exclamation"></i>
                </div>
              </div>
            </button>
          )}

          <div
            className="tooltip tooltip-top leading-none before:-translate-x-2/3"
            data-tip="Layer Visibility"
          >
            <input
              type="checkbox"
              name="layer-view"
              value={layer.id}
              ref={ref}
              className="checkbox"
              onClick={(event) => {
                event.stopPropagation();
                handleLayerViewChange();
              }}
            />
          </div>
        </div>
      </div>
    );
  },
);

const SidebarContents = () => {
  // Run once after render to DOM
  useEffect(() => LayerSM.set(initialLayer.id), []);

  // Update on layers change
  const layers = useSyncExternalStore(LayerStore.subscribe, LayerStore.getSnapshot);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Get the main checkbox
  const mainCheckboxRef = useRef<HTMLInputElement>(null);

  // Get the checkboxes for the layer views
  const checkboxesRef = useRef<Map<string, HTMLInputElement> | null>(null);
  const getCheckboxesMap = () => {
    if (!checkboxesRef.current) checkboxesRef.current = new Map();
    return checkboxesRef.current;
  };

  // Bottom of layers ref
  const bottomRef = useRef<HTMLDivElement>(null);
  const [shouldScrollDown, setShouldScrollDown] = useState(false);
  useEffect(() => {
    if (shouldScrollDown) {
      bottomRef.current?.scrollIntoView();
      document.body.scrollIntoView();
      setShouldScrollDown(false);
    }
  }, [shouldScrollDown]);

  // Add and remove layer callbacks
  const addNewLayer = () => {
    LayerStore.setLayer({
      id: LayerStore.getNewID(),
      name: `Layer ${layers.size + 1}`,
      polygon: emptyMultiPolygon(),
    });
    setShouldScrollDown(true);
  };
  const removeLayer = () => {
    const layerID = LayerSM.get();
    if (layerID) LayerStore.removeLayer(layerID);
  };

  // Visible layer change callback
  const handleLayerViewChange = () => {
    // Get the checkboxes and main checkbox
    const checkboxes = Array.from(getCheckboxesMap().values());
    const mainCheckbox = mainCheckboxRef.current;
    if (!mainCheckbox) return;

    const allChecked = checkboxes.every((checkbox) => checkbox.checked);
    const noneChecked = checkboxes.every((checkbox) => !checkbox.checked);

    mainCheckbox.checked = !noneChecked;
    mainCheckbox.indeterminate = !allChecked && !noneChecked;

    // Reset the visible layers
    updateUserFacingLayer();
    viewLayerManager.reset();

    // Find the visible layers
    const visibleLayers = checkboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value);

    // Show alert if the selected layer is hidden
    const selectedLayerID = LayerSM.get();
    if (selectedLayerID && !visibleLayers.includes(selectedLayerID)) {
      AlertStore.show(selectHiddenAlert);
    } else {
      AlertStore.close(selectHiddenAlert.id);
    }

    // Add the visible layers to the view
    for (const [id, layer] of layers.entries()) {
      const layerVisible = visibleLayers.includes(id);

      // Skip the selected layer and any non-visible layers
      if (!layerVisible || id === selectedLayerID) continue;

      // Add the layer to the view, if it is a valid polygon
      try {
        if (!layer.polygon.coordinates.length || !layer.polygon.coordinates[0].length) continue;

        const feature = new OpenLayerFeature({
          geometry: Convert.jsonToOpen(layer.polygon),
        });

        // Set the color of the polygon layer
        const hsl = layer.color ?? [200, 100, 60];
        feature.setStyle(Style.contrastHSL(...hsl, 3, 0.5));

        viewLayerManager.add(feature);
      } catch (error) {
        console.info(`Error adding layer ${id} to view with polygon:`, layer.polygon);
      }
    }
  };

  // Run after every render to DOM
  useEffect(handleLayerViewChange);

  return (
    <div className="group pointer-events-none absolute inset-0 z-30 ml-auto flex w-fit flex-row gap-2 overflow-clip pl-[100vw]">
      <div className="flex flex-col justify-between">
        <div
          className={`tooltip tooltip-left my-2 size-fit transition-transform duration-[350ms]`}
          style={{
            transform: isSidebarOpen ? "translateX(0)" : `translateX(var(--side-bar-width))`,
          }}
          data-tip="Toggle Layers"
        >
          <label className="btn btn-square swap pointer-events-auto text-lg shadow-md has-[:focus-visible]:outline has-[:focus-visible]:[outline-offset:2px] has-[:focus-visible]:[outline-width:2px]">
            <input
              type="checkbox"
              id="layer-toggle"
              className="size-full focus-visible:outline-none"
              tabIndex={0}
              onInput={() => setIsSidebarOpen(!isSidebarOpen)}
            />
            <i className="fa-solid fa-layer-group swap-off fill-current"></i>
            <i className="fa-solid fa-angles-right swap-on fill-current"></i>
          </label>
        </div>

        <div
          className={`tooltip tooltip-left my-2 size-fit transition-all duration-[350ms]`}
          style={{
            transform: isSidebarOpen
              ? "translateX(calc(100% + 1rem))"
              : `translateX(var(--side-bar-width))`,
            opacity: isSidebarOpen ? 0 : 1,
          }}
          data-tip="More Options"
        >
          <button
            className="btn btn-square pointer-events-auto shadow-md"
            onClick={() => Element.options.showModal()}
            onFocus={preventFocusScroll}
          >
            <i className="fa-solid fa-wrench"></i>
          </button>
        </div>
      </div>

      <div
        className={`pointer-events-auto flex h-full w-[--side-bar-width] flex-col bg-base-200 shadow-2xl transition-[transform,opacity] duration-[350ms] ${isSidebarOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}`}
      >
        <div className="flex items-center justify-between bg-base-300 px-8 py-5">
          <h2 className="text-3xl font-bold">Layers</h2>
          <div className="tooltip tooltip-left" data-tip="All Layer Visibility">
            <label className="flex flex-row items-center justify-center gap-2">
              <i className="fa-solid fa-eye text-2xl"></i>
              <input
                type="checkbox"
                name="all-layer-view"
                id="all-layer-view"
                ref={mainCheckboxRef}
                className="checkbox"
                onClick={(event) => {
                  const input = event.currentTarget;
                  for (const checkbox of getCheckboxesMap().values()) {
                    checkbox.checked = input.checked;
                  }
                  handleLayerViewChange();
                }}
              />
            </label>
          </div>
        </div>
        <div
          className="relative flex size-full flex-col gap-3 overflow-y-auto overflow-x-hidden scroll-smooth p-4"
          style={{
            scrollbarGutter: "auto",
          }}
        >
          {Array.from(layers.values(), (layer) => (
            <LayerCard
              key={layer.id}
              layer={layer}
              handleLayerViewChange={handleLayerViewChange}
              ref={(input) => {
                const checkboxes = getCheckboxesMap();
                if (input) checkboxes.set(layer.id, input);
                else checkboxes.delete(layer.id);
              }}
            />
          ))}
          <div ref={bottomRef}></div>
        </div>
        <div className="relative bottom-0 right-0 flex flex-row-reverse gap-2 bg-base-300 p-2">
          <div className="tooltip tooltip-top before:-translate-x-2/3" data-tip="New Layer">
            <button
              className="btn btn-circle hover:!btn-primary [&:not(:hover)]:btn-ghost"
              onClick={addNewLayer}
              onFocus={preventFocusScroll}
            >
              <i className="fa-solid fa-plus"></i>
            </button>
          </div>
          <div className="tooltip tooltip-top" data-tip="Remove Layer">
            <button
              className="btn btn-circle hover:!btn-error [&:not(:hover)]:btn-ghost"
              onClick={removeLayer}
              onFocus={preventFocusScroll}
            >
              <i className="fa-solid fa-trash-can"></i>
            </button>
          </div>
          <div className="tooltip tooltip-top mr-auto" data-tip="More Options">
            <button
              className="btn btn-circle btn-ghost"
              onClick={() => Element.options.showModal()}
              onFocus={preventFocusScroll}
            >
              <i className="fa-solid fa-wrench"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const initialLayer = {
  id: LayerStore.getNewID(),
  name: "Layer 1",
  polygon: emptyMultiPolygon(),
};
LayerStore.setLayer(initialLayer);

const LayerSM = new StateManager<string | null>({
  defaultState: null,
  parentElement: Element.layerSidebar,
  inputName: "layer-select",
  onChange: (layerID, _oldLayerID) => {
    // Select the layer in the layer sidebar
    const query = `input[name=layer-view][value="${layerID}"]`;
    const checkbox = document.querySelector<HTMLInputElement>(query);
    if (checkbox) checkbox.checked = true;

    // Check if there is a selected layer and show an alert if not
    if (layerID === null) AlertStore.show(noSelectAlert);
    else AlertStore.close(noSelectAlert.id);
  },
});

const layerSidebarRoot = createRoot(Element.layerSidebar);
layerSidebarRoot.render(<SidebarContents />);

const allLayersOptionsRoot = createRoot(Element.options);
allLayersOptionsRoot.render(
  <Options AlertStore={AlertStore} LayerStore={LayerStore} cog_id={COG_ID} />,
);

if (!sessionStorage.getItem("hasLoaded")) {
  sessionStorage.setItem("hasLoaded", "true");
  AlertStore.show(
    AlertStore.create({
      message: "Welcome to Polymer's Polygon Editor",
      time: 7500,
    }),
  );

  setTimeout(
    () =>
      AlertStore.show(
        AlertStore.create({
          message: "See the help menu in the bottom left for more information",
          time: 7500,
          type: "info",
        }),
      ),
    5000,
  );
}

Element.pointsLink.href = `/points/${COG_ID}`;
Element.projLink.href = `/projections/${COG_ID}`;
Element.legendLink.href = `/swatchannotation/${COG_ID}`;
Element.linesLink.href = `/lines/${COG_ID}`;
Element.polyLink.href = `/segment/${COG_ID}`;
Element.cogIDBadge.textContent = COG_ID;
Element.cogIDBadge.addEventListener("click", () => {
  AlertStore.show(copiedToClipboardAlert);
  copyTextToClipboard(COG_ID);
});

try {
  const response = await fetchAPI("load_segment", { method: "POST", query: { cog_id: COG_ID } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
} catch (error) {
  console.error(error);
}

try {
  const response = await fetchAPI("load_lasso", { method: "POST", query: { cog_id: COG_ID } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
} catch (error) {
  console.error(error);
}
