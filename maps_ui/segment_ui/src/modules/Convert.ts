/**
 * @module Convert
 * @description Utility functions to convert between OpenLayers, JSTS, and GeoJSON geometries
 */

import type * as jsts from "jsts";
// @ts-expect-error types are missing
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader";
// @ts-expect-error types are missing
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter";
import OpenLayersGeoJSON from "ol/format/GeoJSON";
import type { Geometry as OpenLayersGeometry } from "ol/geom";
import type { Feature as OpenLayersFeature } from "ol";
import type { Geometry } from "geojson";

const reader: jsts.io.GeoJSONReader = new GeoJSONReader();
const writer: jsts.io.GeoJSONWriter = new GeoJSONWriter();

/**
 * Converts an OpenLayers geometry or feature to GeoJSON.
 * @param {OpenLayersGeometry | OpenLayersFeature} ol - The OpenLayers geometry or feature to convert.
 * @returns {Geometry} The converted GeoJSON geometry.
 * @throws {Error} If the feature has no geometry.
 */
export const openToJSON = (ol: OpenLayersGeometry | OpenLayersFeature): Geometry => {
  const geometry = "getGeometry" in ol ? ol.getGeometry() : ol;

  if (geometry == null) throw new Error("Feature has no geometry");

  const string = new OpenLayersGeoJSON().writeGeometry(geometry!);
  return JSON.parse(string);
};

/**
 * Converts a GeoJSON geometry to OpenLayers geometry.
 * @param {Geometry} json - The GeoJSON geometry to convert.
 * @returns {OpenLayersGeometry} The converted OpenLayers geometry.
 */
export const jsonToOpen = (json: Geometry): OpenLayersGeometry => {
  const geometry = new OpenLayersGeoJSON().readGeometry(json);
  return geometry;
};

/**
 * Converts a JSTS geometry to GeoJSON.
 * @param {jsts.geom.Geometry} jsts - The JSTS geometry to convert.
 * @returns {Geometry} The converted GeoJSON geometry.
 */
export const jstsToJSON = (jsts: jsts.geom.Geometry): Geometry => {
  const json = writer.write(jsts) as Geometry;
  return json;
};

/**
 * Converts a GeoJSON geometry to JSTS.
 * @param {Geometry} json - The GeoJSON geometry to convert.
 * @returns {jsts.geom.Geometry} The converted JSTS geometry.
 */
export const jsonToJSTS = (json: Geometry): jsts.geom.Geometry => {
  const jsts = reader.read(json);
  return jsts;
};

/**
 * Converts an OpenLayers geometry or feature to JSTS.
 * @param {OpenLayersGeometry | OpenLayersFeature} ol - The OpenLayers geometry or feature to convert.
 * @returns {jsts.geom.Geometry} The converted JSTS geometry.
 */
export const openToJSTS = (ol: OpenLayersGeometry | OpenLayersFeature): jsts.geom.Geometry => {
  const json = openToJSON(ol);
  const jsts = jsonToJSTS(json);
  return jsts;
};

/**
 * Converts a JSTS geometry to OpenLayers.
 * @param {jsts.geom.Geometry} jsts - The JSTS geometry to convert.
 * @returns {OpenLayersGeometry} The converted OpenLayers geometry.
 */
export const jstsToOpen = (jsts: jsts.geom.Geometry): OpenLayersGeometry => {
  const json = jstsToJSON(jsts);
  const ol = jsonToOpen(json);
  return ol;
};
