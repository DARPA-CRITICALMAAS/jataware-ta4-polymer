import type { MultiPolygon, Polygon } from "geojson";
import type { Feature } from "ol";
import type { Coordinate } from "ol/coordinate";

export type Mode = "view" | "label" | "erase" | "add" | "lasso";

interface LabelPoint {
  coordinate: Coordinate;
  feature: Feature;
  type: "positive" | "negative";
}

interface LassoPoint {
  coordinate: Coordinate;
  feature: Feature;
  index: number;
}

interface LassoEdge {
  feature: Feature;
  index: number;
  coordinates: Coordinate[];
}

export interface Layer {
  name: string;
  polygon: MultiPolygon | Polygon;
}

export interface GlobalPolygons {
  baseImport: MultiPolygon | Polygon;
  baseTotal: MultiPolygon | Polygon;
  basePartial: MultiPolygon | Polygon;
  erase: MultiPolygon | Polygon;
  add: MultiPolygon | Polygon;
}

export interface GlobalObject {
  labelState: "off" | "waiting";
  labelPoints: LabelPoint[];
  selectedFeatures: Set<Feature>;
  lassoTimestamp: number;
  lassoState: "waiting" | "off" | "active";
  lassoStartCoordinate: Coordinate | null;
  lassoPoints: LassoPoint[];
  lassoEdges: LassoEdge[];
  mouseCoordinate: Coordinate;
}

interface EraseEdit {
  type: "erase";
  data: { erase: MultiPolygon; add: MultiPolygon };
}

interface AddEdit {
  type: "add";
  data: { erase: MultiPolygon; add: MultiPolygon };
}

interface BaseTotalEdit {
  type: "base-total";
  data: { baseTotal: MultiPolygon };
}

interface BasePartialEdit {
  type: "base-partial";
  data: { basePartial: MultiPolygon };
}

interface RadiusEdit {
  type: "radius";
  data: { mode: Mode; radius: number };
}
interface SelectDelete {
  type: "select-delete";
  data: {
    baseTotal: MultiPolygon;
    basePartial: MultiPolygon;
    erase: MultiPolygon;
    add: MultiPolygon;
  };
}

interface LabelUndo {
  type: "label";
  data: { feature: Feature };
}

interface LabelDeleteUndo {
  type: "label-delete";
  data: { feature: Feature; point: LabelPoint };
}

interface LabelRedo {
  type: "label";
  data: { feature: Feature; point: LabelPoint };
}

interface LabelDeleteRedo {
  type: "label-delete";
  data: { feature: Feature };
}

export type EditHistoryUndoArg =
  | EraseEdit
  | AddEdit
  | BaseTotalEdit
  | BasePartialEdit
  | RadiusEdit
  | SelectDelete
  | LabelUndo
  | LabelDeleteUndo;
export type EditHistoryRedoArg =
  | EraseEdit
  | AddEdit
  | BaseTotalEdit
  | BasePartialEdit
  | RadiusEdit
  | SelectDelete
  | LabelRedo
  | LabelDeleteRedo;

export type OnUndo = (arg: EditHistoryUndoArg) => EditHistoryRedoArg | undefined;
export type OnRedo = (arg: EditHistoryRedoArg) => EditHistoryUndoArg | undefined;

export interface Layer {
  id: string;
  name: string;
  polygon: Polygon | MultiPolygon;
  color?: [number, number, number];
  legendItem?: LegendItem;
  isValidated?: boolean;
}

export interface LegendItem {
  id: string;
  bbox: [number, number, number, number];
  name: string;
}
