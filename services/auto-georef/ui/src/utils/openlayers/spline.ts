import PointerInteraction, { type Options } from "ol/interaction/Pointer";
import {
  Point as OpenLayersPoint,
  LineString as OpenLayersLineString,
  Geometry as OpenLayersGeometry,
} from "ol/geom";
import {
  Map as OpenLayersMap,
  Feature as OpenLayersFeature,
  type MapBrowserEvent,
} from "ol";
import VectorSource from "ol/source/Vector";
import Style, { createEditingStyle, type StyleFunction } from "ol/style/Style";
import VectorLayer from "ol/layer/Vector";
import Translate from "ol/interaction/Translate";

import * as turf from "@turf/turf";
import type { Point } from "geojson";

type StyleMap = Record<ReturnType<OpenLayersGeometry["getType"]>, Style[]>;
type UpdateFinish = (
  spline: OpenLayersFeature<OpenLayersLineString>,
  controlPoints: OpenLayersFeature<OpenLayersPoint>[],
) => void;
type SplineOptions = Options & { onUpdateFinish?: UpdateFinish };

class Spline extends PointerInteraction {
  static styles = (() => {
    const styles: StyleMap = createEditingStyle();

    // Ensure points are always on top
    styles["Point"] = styles["Point"].map((style) => {
      style.setZIndex(Infinity);
      return style;
    });

    return styles;
  })();

  overlaySource: VectorSource;
  overlay: VectorLayer;

  source: VectorSource;
  layer: VectorLayer;

  translate: Translate;

  splineID: string;
  controlPoints: OpenLayersFeature<OpenLayersPoint>[];

  onUpdateFinish: () => void;

  constructor(options: SplineOptions = {}) {
    super(options);

    // @ts-expect-error - Ignore type error, it's fine
    const style: StyleFunction = (feature: OpenLayersFeature) => {
      const type = feature.getGeometry()?.getType();
      if (type === undefined) throw new Error("Invalid geometry type");
      return Spline.styles[type];
    };

    // Vector layer and source for finished splines
    this.source = new VectorSource();
    this.layer = new VectorLayer({ source: this.source, style });

    // Vector layer and source for the current spline
    this.overlaySource = new VectorSource();
    this.overlay = new VectorLayer({ source: this.overlaySource, style });

    this.translate = new Translate({
      // @ts-expect-error - Unspecified Feature type
      filter: (feature) => this.controlPoints.includes(feature),
    });
    this.translate.on("translating", () => this.updateSpline());
    this.translate.on("translateend", () => this.onUpdateFinish());

    this.splineID = crypto.randomUUID();
    this.controlPoints = [];

    const onUpdateFinish = options.onUpdateFinish ?? (() => {});
    this.onUpdateFinish = () =>
      onUpdateFinish(this.getSpline(), this.controlPoints);

    this.setActive(true);
  }

  setActive(active: boolean): void {
    this.overlay?.setVisible(active);
    this.layer?.setVisible(active);
    this.translate?.setActive(active);

    super.setActive(active);
  }

  setVisible(isVisible: boolean): void {
    this.overlay.setVisible(isVisible);
    this.layer.setVisible(isVisible);
  }

  private updateMap(map: OpenLayersMap) {
    // Ensure the overlay and layer is on the map
    this.overlay.setMap(map);
    this.layer.setMap(map);

    // Add the translate interaction to the map
    map.addInteraction(this.translate);
  }

  private addPoint(point: Point["coordinates"]) {
    const geometry = new OpenLayersPoint(point);
    const feature = new OpenLayersFeature(geometry);
    feature.setId(crypto.randomUUID());

    this.overlaySource.addFeature(feature);
    this.controlPoints.push(feature);
  }

  getSpline(): OpenLayersFeature<OpenLayersLineString> {
    // Either create a new empty feature or get the existing one

    const spline = this.overlaySource
      .getFeatures()
      .find((feature) => feature.getId() === this.splineID);

    if (spline === undefined) {
      const splineFeature = new OpenLayersFeature(new OpenLayersLineString([]));
      splineFeature.setId(this.splineID);
      this.overlaySource.addFeature(splineFeature);
      return splineFeature;
    }

    return spline as OpenLayersFeature<OpenLayersLineString>;
  }

  private updateSpline() {
    console.log("updateSpline");

    const spline = this.getSpline();

    // Generate a new spline from the control points
    const coordinates = this.controlPoints
      .map((point) => point.getGeometry()?.getCoordinates())
      .filter((p) => p !== undefined);

    if (this.controlPoints.length < 2) {
      spline.setGeometry(new OpenLayersLineString(coordinates));
    } else {
      // Generate a spline from the control points

      const line = turf.lineString(coordinates);
      const curved = turf.bezierSpline(line);
      const geometry = new OpenLayersLineString(curved.geometry.coordinates);

      spline.setGeometry(geometry);
    }
  }

  handleEvent(event: MapBrowserEvent<MouseEvent>): boolean {
    this.updateMap(event.map);

    if (event.type === "dblclick") {
      this.addPoint(event.coordinate);
      this.updateSpline();
      this.onUpdateFinish();
    }

    return super.handleEvent(event);
  }

  handleMoveEvent(event: MapBrowserEvent<MouseEvent>) {
    // @ts-expect-error - Private `Translate` method
    const features = this.translate.featuresAtPixel_(event.pixel, event.map);
    // @ts-expect-error - Private `Translate` property
    const isGrabbing = this.translate.lastCoordinate_ != null;

    const viewport = event.map.getViewport().classList;
    viewport.remove("cursor-grab", "cursor-grabbing");

    if (features) {
      viewport.add(isGrabbing ? "cursor-grabbing" : "cursor-grab");
    }

    return super.handleMoveEvent(event);
  }

  reset(isHardReset = false) {
    this.overlaySource.clear();
    if (isHardReset) this.source.clear();

    this.splineID = crypto.randomUUID();
    this.controlPoints = [];
  }

  finish() {
    this.source.addFeature(this.getSpline());
    this.reset();
  }
}

export default Spline;
