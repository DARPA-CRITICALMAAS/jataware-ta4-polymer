/// Manages the features of a single polygon layer.

import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import FormatGeoJSON from "ol/format/GeoJSON";

import * as Style from "./Styles";
import * as Convert from "./Convert";
import { multiPolygonToFeatures } from "./utils";
import type { Feature } from "ol";
import type { Geometry as OpenLayersGeometry } from "ol/geom";
import type { Options } from "ol/layer/BaseVector";
import type { GeoJSON, MultiPolygon } from "geojson";

import type * as jsts from "jsts";

const PolygonLayerManager = (
  layerOptions: Options<VectorSource<Feature<OpenLayersGeometry>>> = {},
) => {
  const defaultLayerOptions = {
    source: new VectorSource(),
    style: Style.clear,
    updateWhileInteracting: true, // May have performance issues
    animateWhileInteracting: true, // May have performance issues
  };
  const layer = new VectorLayer({ ...defaultLayerOptions, ...layerOptions });

  const getLayer = () => layer;
  const getSource = () => layer.getSource()!;

  const get = () => {
    return getSource().getFeatures();
  };

  const set = (features: Feature | Feature[]) => {
    reset();

    if (features == null) return;

    add(features);
  };

  const reset = () => {
    getSource().clear();
  };

  const add = (features: Feature | Feature[]) => {
    if (Array.isArray(features)) {
      getSource().addFeatures(features);
    } else {
      getSource().addFeature(features);
    }
  };

  const remove = (features: Feature | Feature[]) => {
    if (Array.isArray(features)) {
      features.forEach((f) => getSource().removeFeature(f));
    } else {
      getSource().removeFeature(features);
    }
  };

  // TODO!: Implement a way to set the type to "MultiPolygon" or "FeatureCollection"
  const getJSON = () => {
    const features = get();
    const json = {
      type: "MultiPolygon",
      coordinates: features.map((f) => {
        const json = Convert.openToJSON(f);
        if (json.type == "GeometryCollection") throw new Error("Feature has no coordinates");
        return json.coordinates;
      }),
    };

    return json as MultiPolygon;
  };

  const jsonModify = (json: GeoJSON, fn: (features: Feature | Feature[]) => void) => {
    if (json.type === "FeatureCollection") {
      const features = new FormatGeoJSON().readFeatures(json) as Feature[];
      fn(features);
    } else if (json.type === "MultiPolygon") {
      const features = multiPolygonToFeatures(json);
      const collection = { type: "FeatureCollection", features };
      const newFeatures = new FormatGeoJSON().readFeatures(collection) as Feature[];
      fn(newFeatures);
    } else if (json.type === "Polygon") {
      if (json.coordinates.length === 0 || json.coordinates[0].length === 0) {
        fn([]);
        return;
      }
      const feature = new FormatGeoJSON().readFeature(json) as Feature;
      fn(feature);
    } else if (json.type === "LineString") {
      if (json.coordinates.length === 0) {
        fn([]);
        return;
      }
      const feature = new FormatGeoJSON().readFeature(json) as Feature;
      fn(feature);
    } else {
      console.error("Unknown JSON type:", json.type);
      console.error(json);
    }
  };

  const setJSON = (json: GeoJSON) => jsonModify(json, set);

  const addJSON = (json: GeoJSON) => jsonModify(json, add);

  const getJSTS = () => {
    const json = getJSON();
    const jsts = Convert.jsonToJSTS(json);
    return jsts;
  };

  const setJSTS = (jsts: jsts.geom.Geometry) => {
    const json = Convert.jstsToJSON(jsts);
    setJSON(json);
  };

  return Object.freeze({
    getLayer,
    getSource,
    get,
    set,
    reset,
    add,
    remove,
    getJSON,
    addJSON,
    setJSON,
    getJSTS,
    setJSTS,
  });
};

export default PolygonLayerManager;
