import { BlobReader, ZipReader } from "@zip.js/zip.js";

import { open as shape_open } from "shapefile";

import GeoJSON from "ol/format/GeoJSON";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import { getCenter, getArea } from 'ol/extent.js';

import {
  clearShapeOpenLayers,
  transformPolygonCoordinates,
  defaultLayerStyle,
  areaToZoomLevel
} from "../geo";

import { displayElemTemporarily } from "../common";

/**
 * This file parses a selected .zip file from landing page shapefile input
 * to search maps within the polygons described in the zip. We only wish to
 * support shapes that describe closed areas, ie Polygon, MultiPolygon .
 */

export const SHAPEFILE_LAYER_ID = "from-shapefiles";
const openLayersDefaultProjection = "EPSG:3857";
const cdrDefaultProjection = "EPSG:4326";

const multiPolygonElem = document.querySelector(
  'input[name="multi_polygons_intersect"]',
);

enum FileOutput {
  Text = "text",
  ArrayBuffer = "arrayBuffer",
}

/**
 * Given a zip reference blob from zip.js, returns a promise of
 * the file contents using expected readAs FileOutput parameter.
 **/
async function readZipFileAs(
  zipFileReferenceObj,
  readAs: FileOutput = FileOutput.Text,
) {
  const transformStream = new TransformStream();
  const readContentsResponse = new Response(transformStream.readable);
  const readContentsPromise = readContentsResponse[readAs]();

  await zipFileReferenceObj.getData(transformStream.writable);

  const fileContents = await readContentsPromise;

  return fileContents;
}

/**
 * Reads data from zips and returns geoJSON + projection data for each shape
 * Anything that isn't a [Multi]Polygon will be ignored later on.
 **/
async function readShapeFile(allShapeData) {
  const [shpFile, dbfFile, prjFile] = allShapeData;

  if (!prjFile) {
    // TODO More advanced version where we only skip .shp with no .prj,
    //      but other .shp+.prj shapes are parsed (More involved user info/warning).
    const noPrjError = new Error(
      `Unable to detect projection. Missing .prj file for shape: ${shpFile.filename}`,
    );
    noPrjError.name = "noPrjError";
    throw noPrjError;
  }

  const shp = await readZipFileAs(shpFile, FileOutput.ArrayBuffer);

  let dbf = undefined;
  let prj = undefined;
  if (dbfFile) {
    dbf = await readZipFileAs(dbfFile, FileOutput.ArrayBuffer);
  }
  if (prjFile) {
    prj = await readZipFileAs(prjFile, FileOutput.Text);
  }

  const source = await shape_open(shp, dbf);

  let data = await source.read();

  const acc = [data.value];

  while (!data.done) {
    data = await source.read();
    if (data.value) {
      acc.push(data.value);
    } else {
      console.log("Skipping this open shapefile data with no value:", data);
    }
  }

  return [acc, prj];
}

/**
 * Reused between parsing a polygon or parsing a list of polygons (MultiPolygon)
 * from_prj is a WKT string which proj4 knows to use without pre-registering
 * if providing the WKT while transforming coordinates.
 **/
function parsePolygon(shape, coordinates, from_prj, to_prj, formatFn) {
  let updated_coordinates = transformPolygonCoordinates(
    coordinates,
    from_prj,
    to_prj,
  );

  if (formatFn) {
    updated_coordinates = formatFn(shape, updated_coordinates);
  }

  return updated_coordinates;
}

/**
 * Parse shape array into geoJSON converted to input projection + format.
 * This can be refactored, as it was initially implemented as supporting Polygons
 * only, and MultiPolygons were tacked-on as visible from conditional formatting.
 * The end result is that MultiPolygons are converted into separate
 * Polygon Features for most purposes of this file (except when grouping Polygons
 * as MultiPolygons for use in cdr search).
 **/
export function parseShapeCoordinates(shapeArrays, to_prj, formatFn) {
  return shapeArrays.reduce((acc, curr) => {
    const shapes = curr[0];
    const prj = curr[1]; // loaded file prj is from_prj (for conversion)

    shapes.forEach((shape) => {
      const { coordinates, type } = shape.geometry;

      if (type === "MultiPolygon") {
        const updated_coordinates = coordinates.map((c) =>
          parsePolygon(shape, c, prj, to_prj, formatFn),
        );
        acc = [
          ...acc,
          ...updated_coordinates, // spread these individual Polygons; we explode MultiPolygons into Polygon features
        ];
      } else if (type === "Polygon") {
        const updated_coordinates = parsePolygon(
          shape,
          coordinates,
          prj,
          to_prj,
          formatFn,
        );
        acc = [...acc, updated_coordinates];
      } else {
        // Skip shape, but continue looping over other shapes if available
        console.log("Detected a non-[Multi]Polygon shape:", type);
        return;
      }
    });

    return acc;
  }, []);
}

/**
 * Uses zip file shape data to populate form input/data for cdr search request
 **/
function parseCoordinatesForCDR(shapeArrays) {
  const multiPolygonCoordinates = parseShapeCoordinates(
    shapeArrays,
    cdrDefaultProjection,
  );

  multiPolygonElem.value = JSON.stringify({
    coordinates: multiPolygonCoordinates,
    type: "MultiPolygon",
  });
}

/**
 * Receives zip file shape data and updates ol/Map on page
 * to display said [Polygon] shapes on Map
 **/
function parseCoordinatesForOpenLayers(shapeArrays) {
  const formatFn = (shape, updatedCoordinates) => ({
    type: shape.type, // Feature
    properties: shape.properties, // Loaded DBF properties
    geometry: {
      type: "Polygon", // Force MultiPolygon to Polygon as well
      coordinates: updatedCoordinates,
    },
  });

  const draw_features = parseShapeCoordinates(
    shapeArrays,
    openLayersDefaultProjection,
    formatFn,
  );

  if (!draw_features.length) {
    const noPolygonsError = new Error(
      "Shapefile zip did not contain any Polygons.",
    );
    noPolygonsError.name = "NoPolygonsError";
    throw noPolygonsError;
  }

  const geojsonObject = {
    type: "FeatureCollection",
    features: draw_features,
  };

  const features = new GeoJSON().readFeatures(geojsonObject);
  const vectorSource = new VectorSource({
    features,
  });
  const vectorLayer = new VectorLayer({
    id: SHAPEFILE_LAYER_ID,
    source: vectorSource,
    style: defaultLayerStyle,
  });
  vectorLayer.setZIndex(2);
  window.polymer_map.addLayer(vectorLayer);

  const geometry = features[0].getGeometry();
  const extent = geometry.getExtent();
  const center = getCenter(extent);
  const area = getArea(extent);
  const view = window.polymer_map.getView();

  view.setCenter(center);
  view.setZoom(areaToZoomLevel(area));
}

/**
 * Strips any folder path eg: /reference/filename.shp => filename.shp
 */
function stripFilePath(fullFilePath) {
  return /[^/]*$/.exec(fullFilePath)[0];
}

/**
 * Given zipfile blob contents, if it is a shapefile (which contains shp, dbf, prj, etc)
 * It will parse them and group as [[name1_shp, name1_dbf, name1_prj], [[nameN_shp, nameN_dbf, nameN_prj]]]
 * In order for later on to parse this related data to geojson
 */
export function groupShapeFiles(zipFileEntries) {
  const shape_entries = zipFileEntries.filter((f) =>
    f.filename.endsWith(".shp"),
  );

  return shape_entries.map((sf_dataFile) => {
    // remove folder path + extension to match other corresponding files by name
    const shp_name_without_ext = stripFilePath(sf_dataFile.filename).replace(
      /\.shp$/,
      "",
    );

    const dbf_dataFile = zipFileEntries.find(
      (file_data) =>
        stripFilePath(file_data.filename) === `${shp_name_without_ext}.dbf`,
    );
    const prj_dataFile = zipFileEntries.find(
      (file_data) =>
        stripFilePath(file_data.filename) === `${shp_name_without_ext}.prj`,
    );

    return [sf_dataFile, dbf_dataFile, prj_dataFile];
  });
}


const toast = document.getElementById("shapefile-error-toast");
const shapefileWrapper = document.getElementById("shapefiles-input-wrapper");
let processing;
let fileInput;

if (import.meta.env) {
  processing = shapefileWrapper.querySelector(".loading-xs");
  fileInput = shapefileWrapper.querySelector("input");
}

/**
 * Given grouped shp|dbf|prj files (by name),
 * load these shapes as geojson if they describe Polygons
 * and populate both the multiPolygon hidden form input (for cdr search)
 * plus render the polygon shapes in the ol/Map for search params preview
 **/
function updateMultiPolygon(shapeArrays) {
  parseCoordinatesForCDR(shapeArrays);
  parseCoordinatesForOpenLayers(shapeArrays);
}

/**
 * Read zip from file selected, parse as shapes, then call
 * fn to update the ol/Map and the form input tag.
 * Full function integrated with browser dom elements.
 **/
async function readZipFile(evt) {
  // Remove old data if there was a previous selection
  clearShapeOpenLayers(SHAPEFILE_LAYER_ID);
  multiPolygonElem.value = null;
  multiPolygonElem.dataset.label = "";

  const fileBlob = evt.target.files[0];
  const zipReader = new ZipReader(new BlobReader(fileBlob));

  processing.classList.remove("hidden");
  fileInput.disabled = true;

  try {
    let allEntries;
    try {
      allEntries = await zipReader.getEntries();
    } catch (e) {
      const notAZipError = new Error(
        "No zip file selected. Select a valid zip file.",
      );
      notAZipError.name = "NotAZipError";
      throw notAZipError;
    }
    const groupedByName = groupShapeFiles(allEntries);

    if (!groupedByName.length) {
      const invalidZipError = new Error(
        "No shapes (.sph) detected in zipfile.",
      );
      invalidZipError.name = "NoSHPFilesError";
      throw invalidZipError;
    }

    const shapePromises = groupedByName.map(readShapeFile);
    await zipReader.close();
    const shapes = await Promise.all(shapePromises);

    updateMultiPolygon(shapes);
  } catch (e) {
    console.log("e", e);
    toast.querySelector("span").innerText = e.message;
    displayElemTemporarily(toast);
    multiPolygonElem.value = null;
    multiPolygonElem.dataset.label = "";
  } finally {
    processing.classList.add("hidden");
    fileInput.disabled = false;
  }
}

export function setUpZipFileHandler() {
  document
    .getElementById("shapefiles-file-input")
    .addEventListener("change", readZipFile);
}
