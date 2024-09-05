import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import VectorSource from "ol/source/Vector.js";
import { Vector as VectorLayer } from "ol/layer";
// import { getCenter } from 'ol/extent.js';
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import proj4 from "proj4";

export const openLayersDefaultProjection = "EPSG:3857";
export const cdrDefaultProjection = "EPSG:4326";

// Custom projections
proj4.defs(
  "EPSG:4267",
  'GEOGCS["NAD27",DATUM["North_American_Datum_1927",SPHEROID["Clarke 1866",6378206.4,294.978698213898],EXTENSION["PROJ4_GRIDS","NTv2_0.gsb"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4267"]]',
);

proj4.defs(
  "ESRI:102008",
  "+proj=aea +lat_0=40 +lon_0=-96 +lat_1=20 +lat_2=60 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs",
);

/* By default proj4 has the following projections predefined:
'EPSG:4326', which has the following alias
'WGS84'

'EPSG:4269'
'EPSG:3857', which has the following aliases
'EPSG:3785'
'GOOGLE'
'EPSG:900913'
'EPSG:102113'
*/

export const defaultLayerStyle = new Style({
  fill: new Fill({
    color: 'rgba(255,255,255,0.15)',
  }),
  stroke: new Stroke({
    color: '#3399CC',
    width: 3,
  }),
});

/**
 * Use proj4 to loop and transform any coordinates found from->to projections
  TODO if from_prj is unknown, catch the exception and use the epsg.io website/API
  like so: https://epsg.io/?format=json&q=epsg:4267 in order to grab the proj or wkt
  string and register new projections dynamically, as needed...
 **/
export const transformPolygonCoordinates = (coordinates, from_prj, to_prj) => {
  let new_coords = [];
  for (let arr of coordinates) {
    let new_arr = [];
    for (let x of arr) {
      new_arr.push(proj4(from_prj, to_prj, x));
    }
    new_coords.push(new_arr);
  }
  return new_coords;
};

/**
 *
 */
function random_rgba() {
  var o = Math.round,
    r = Math.random,
    s = 255;
  return (
    "rgba(" +
    o(r() * s) +
    "," +
    o(r() * s) +
    "," +
    o(r() * s) +
    "," +
    0.75 +
    ")"
  );
}

/**
 *
 */
export function addFeatureToLayer(layer, feature) {
  const source = layer.getSource();
  source.addFeature(feature);
}

/**
 *
 */
export function createLayer(layerID, zIndex) {
  const source = new VectorSource();

  const vectorLayer = new VectorLayer({
    id: layerID,
    source,
  });

  vectorLayer.setZIndex(zIndex || 10);

  return vectorLayer;
}

const UUIDGenerator = () =>
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16),
  );

/**
 *
 */
export function drawPolygonWithLayerID(
  map,
  layerID,
  polygon,
  { id, color = "#eeeeee" },
) {
  let layer = map
    .getLayers()
    .getArray()
    .find((l) => l.get("id") === layerID);

  if (!layer) {
    layer = createLayer(layerID);
    map.addLayer(layer);
  }

  const feature = new GeoJSON().readFeature(polygon);

  feature.setStyle(
    new Style({
      stroke: new Stroke({
        width: 2,
        color,
      }),
      fill: new Fill({
        color,
      }),
    }),
  );

  feature.setId(id || UUIDGenerator());

  addFeatureToLayer(layer, feature);
}

export function mapLayerById(map, layerID) {
  let found;
  map.getLayers().forEach((layer) => {
    const id = layer.get("id");
    if (id === layerID) {
      found = layer;
    }
  });
  return found;
}

/**
 * Assumes geoJSONMultiPolygon is already converted to correct ol projection
 */
export function drawMultiPolygonOpenLayers(map, geoJSONMultiPolygon, layerID) {
  const vectorSource = new VectorSource({
    features: new GeoJSON().readFeatures(geoJSONMultiPolygon),
  });
  const vectorLayer = new VectorLayer({
    id: layerID,
    source: vectorSource,
    style: defaultLayerStyle
  });
  map.addLayer(vectorLayer);

  // TODO use center of coordinates, not first coordinate (corner...)
  const firstCoordinate = geoJSONMultiPolygon.coordinates[0][0][0];

  const view = map.getView();
  view.setCenter(firstCoordinate);
  // TODO base zoom on area of multipolygon
  // Polygon.getArea()
  view.setZoom(5.8);
}

/**
 *
 */
export function clearLayerSource(layer) {
  layer.getSource().clear();
}

export function clearSourceByLayerID(map, layerID) {
  const layer = mapLayerById(map, layerID);
  if (layer) {
    clearLayerSource(layer);
  }
}

/**
 * Used in uploaded shapefile zip
 */
export function clearShapeOpenLayers(layerID) {
  window.polymer_map.getLayers().forEach((layer) => {
    if (layer.get("id") === layerID) {
      window.polymer_map.removeLayer(layer);
    }
  });
}
