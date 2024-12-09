import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import VectorSource from "ol/source/Vector.js";
import { Vector as VectorLayer } from "ol/layer";
import { getCenter, getArea } from 'ol/extent.js';
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import proj4 from "proj4";
import { register } from "ol/proj/proj4";

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

/**
 *
 */
export function isCRSRegistered(crs) {
  try {
    proj4(crs);
  } catch(e) {
    return false;
  }
  return true;
}

// if more than 1 in a line, it is an alias and its supported
// Unused for now, as we check isCRSRegistered to fail instead of checking our
// manually tracked list. Useful ofr the future, though.
// const knownCRS = [
//   "EPSG:4267",           // Some for maps we ran into in shapefiles, etc
//   "ESRI:102008",         // some pre-existing CMAs use this
//   "EPSG:4326", "WGS84",  // default for CDR
//   "EPSG:3857",           // default for openlayers
//   "EPSG:4269",           // included in proj4 by default
//   // other aliases for the openlayers one, included by proj4:
//   "EPSG:3785", "GOOGLE", "EPSG:900913", "EPSG:102113",
// ];

export const defaultLayerStyle = new Style({
  fill: new Fill({
    color: "rgba(255,255,255,0.15)",
  }),
  stroke: new Stroke({
    color: "#3399CC",
    width: 3,
  }),
});

/**
 * Use proj4 to loop and transform any coordinates found from->to projections
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
  { id, color = "#eeeeee", width = 2.75 },
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
        width,
        color,
      }),
      fill: new Fill({
        color: color.replace("1.0", "0.075"),
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

export function areaToZoomLevel(area) {
    const minZoom = 5.3;
    const maxZoom = 14.5;
    const minArea = 100000;        // smallest area
    const maxArea = 8000000000000; // largest area

    // zoom level inversely proportional to area
    const zoom = minZoom + (maxZoom - minZoom) * (1 - (Math.log(area) - Math.log(minArea)) / (Math.log(maxArea) - Math.log(minArea)));

    return Math.round(zoom * 100) / 100; // round to 2 decimal places
}

export function centerMapToExtent(extent) {
  const center = getCenter(extent);
  const area = getArea(extent);
  const view = window.polymer_map.getView();

  view.setCenter(center);
  view.setZoom(areaToZoomLevel(area));
}

/**
 * Assumes geoJSONMultiPolygon is already converted to correct ol projection
 * Only used on CMA Selection map search filter for now
 */
export function drawMultiPolygonOpenLayers(map, geoJSONMultiPolygon, layerID) {
  const features = new GeoJSON().readFeatures(geoJSONMultiPolygon);

  const vectorSource = new VectorSource({
    features,
  });
  const vectorLayer = new VectorLayer({
    id: layerID,
    source: vectorSource,
    style: defaultLayerStyle,
  });
  map.addLayer(vectorLayer);

  const geometry = features[0].getGeometry();
  const extent = geometry.getExtent();

  const center = getCenter(extent);
  const area = getArea(extent);

  const view = map.getView();

  view.setCenter(center);
  view.setZoom(areaToZoomLevel(area));
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
  } else {
    console.log("Called clearSourceByLayerID but no layer was found. layer:", layer, "map:", map, "layerID:", layerID);
  }
}

/**
 * Used in uploaded shapefile zip
 */
export function clearShapeOpenLayers(layerID) {
  window.polymer_map.getLayers().forEach((layer) => {
    if (layer?.get("id") === layerID) {
      window.polymer_map.removeLayer(layer);
    }
  });
}


// --
// Projection helpers


/**
 *
 */
export const register_proj = async function (query) {
  const response = await fetch("https://epsg.io/?format=json&q=" + query);
  const json = await response.json();
  const results = json["results"];
  if (results && results.length > 0) {
    const results = json["results"];
    if (results && results.length > 0) {
      for (let i = 0, ii = results.length; i < ii; i++) {
        const result = results[i];
        if (result) {
          // const auth = result["authority"];
          // const code = result["code"];
          const wkt = result["wkt"];

          proj4.defs(query, wkt);
        }
      }
    }
  }

  return true;
};
