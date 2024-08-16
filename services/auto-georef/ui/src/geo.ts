import GeoJSON from "ol/format/GeoJSON";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import proj4 from "proj4";

export const openLayersDefaultProjection = "EPSG:3857";
export const cdrDefaultProjection = "EPSG:4326";

// Custom projections
proj4.defs("EPSG:4267", 'GEOGCS["NAD27",DATUM["North_American_Datum_1927",SPHEROID["Clarke 1866",6378206.4,294.978698213898],EXTENSION["PROJ4_GRIDS","NTv2_0.gsb"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4267"]]');

proj4.defs("ESRI:102008","+proj=aea +lat_0=40 +lon_0=-96 +lat_1=20 +lat_2=60 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs");

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
 * Assumes geoJSONMultiPolygon is already converted to correct ol projection
 */
export function drawMultiPolygonOpenLayers(map, geoJSONMultiPolygon, layerID) {

  const vectorSource = new VectorSource({
    features: new GeoJSON().readFeatures(geoJSONMultiPolygon),
  });
  const vectorLayer = new VectorLayer({
    id: layerID,
    source: vectorSource,
  });
  map.addLayer(vectorLayer);

  // TODO use center of coordinates, not first coordinate (corner...)
  const firstCoordinate = geoJSONMultiPolygon.coordinates[0][0][0];

  const view = map.getView();
  view.setCenter(firstCoordinate);
  // TODO base zoom on area of multipolygon?
  view.setZoom(5.8);
}


export function clearShapeOpenLayers(layerID) {
  window.polymer_map.getLayers()
    .forEach(layer => {
      if (layer.get("id") === layerID) {
        window.polymer_map.removeLayer(layer);
      }
    });
}
