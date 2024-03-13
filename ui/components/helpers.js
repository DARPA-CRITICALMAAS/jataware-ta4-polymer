// helpers.js

import { register } from 'ol/proj/proj4.js';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS.js';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { transform } from 'ol/proj';
import TileLayer from 'ol/layer/WebGLTile.js';
import axios from "axios";

import proj4 from 'proj4';

// --
// Map helpers

export const provenance_mapper = {
    "bulk_ngmdb_update": "NGMDB",
    "api_endpoint": "Manual",
    "bulk_upload": "Jataware Extraction Model",
    "jataware_extraction": "Jataware Extraction Model",
    "uncharted_bulk_upload": "Uncharted Georeferencing Model",
    "bulk_upload_hackathon": "Uncharted Georeferencing Model"
}
export const provenance_colors = {
    "bulk_ngmdb_update": "#446100",
    "api_endpoint": "#FF0000",
    "bulk_upload": "#690fda",
    "jataware_extraction": "#690fda",
    "uncharted_bulk_upload": "#4B0082",
    "bulk_upload_hackathon": "#4B0082"
}

export function checkIfEdited(gcp) {
    // if there is a gcp_reference_id that means this gcp was edited and used before
    // if just_edited is true the user just edited this gcp and it will make a new gcp when used in georeferencing.
    if (gcp['gcp_reference_id'] !== null && gcp['gcp_reference_id'] !== undefined) {
        return true
    } else if (gcp['just_edited'] === true) {
        return true
    } else {
        return false
    }
}

export function getColorForProvenance(provenance) {
    return provenance_colors[provenance] || "#000000"; // Return black if the key is not found
}

export const handleOpacityChange = function (e, map) {
    const opacity = parseFloat(e.target.value) / 100;
    getLayerById(map, "map-layer").setOpacity(opacity)
}

export const gcp2pt = function ({ coll, rowb, x, y, crs, gcp_id, color, provenance, gcp_provenance_id }, map_crs) {

    let coords = [x, y];  // A point in EPSG:4326

    let coords_transform = transform(coords, crs, map_crs);
    const BUFFER = 150;

    if (coll === undefined) console.log('!!! ERROR')
    if (rowb === undefined) console.log('!!! ERROR')

    return new GeoJSON().readFeature({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: coords_transform
        },
        properties: {
            color: color,
            coll: coll,
            rowb: rowb,
            x: x,
            y: y,
            gcp_id: gcp_id,
            crs: crs,
            minimize: false,
            provenance: provenance,
            gcp_provenance_id: gcp_provenance_id,
            description: 'This is a sample description',
        },
    });
}


export const gcp2box = function ({ coll, rowb, x, y, crs, gcp_id, color, provenance, gcp_provenance_id, just_edited }) {

    const BUFFER = 150;

    if (coll === undefined) console.log('!!! ERROR')
    if (rowb === undefined) console.log('!!! ERROR')

    return new GeoJSON().readFeature({
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [coll - BUFFER, rowb - BUFFER],
                [coll + BUFFER, rowb - BUFFER],
                [coll + BUFFER, rowb + BUFFER],
                [coll - BUFFER, rowb + BUFFER],
                [coll - BUFFER, rowb - BUFFER]]]
        },
        properties: {
            color: color,
            coll: coll,
            rowb: rowb,
            x: x,
            y: y,
            gcp_id: gcp_id,
            crs: crs,
            minimize: false,
            provenance: provenance,
            gcp_provenance_id: gcp_provenance_id,
            just_edited: just_edited,
            description: 'This is a sample description',
        },
    });
}

export const getLayerById = function (map, layerId) {
    let layerFound = null;
    map.getLayers().forEach(function (layer) {
        if (layer.get('id') === layerId) {
            layerFound = layer;
        }
    });

    return layerFound;
}

export const expand_resolutions = function (v, max_steps, min_steps) {
    let out = [...v.resolutions];
    let prefix = [];
    const max_res = v.resolutions[0]
    for (let i = 1; i < max_steps; i++) {
        out.unshift(max_res * Math.pow(2, i));
    }

    let suffix = [];
    const min_res = v.resolutions[v.resolutions.length - 1];
    for (let i = 1; i < min_steps; i++) {
        out.push(min_res / Math.pow(2, i));
    }

    return out;
}

// --
// Decimal <-> DMS helpers

export const dec2dms = function (decimal) {
    // [TODO ] error handling

    const isNegative = decimal < 0;
    const absDecimal = Math.abs(decimal);

    const hours = Math.floor(absDecimal);
    const minutesFloat = (absDecimal - hours) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = Math.round((minutesFloat - minutes) * 60);

    return (isNegative ? '-' : '') + hours + '° ' + minutes + "' " + seconds + '"';
}

export const dms2dec = function (dms) {
    // [TODO] error handling

    const regex = /(-?)(\d+)°\s?(\d+)'?\s?(\d+)?"/;
    const result = dms.match(regex);

    if (!result) {
        throw new Error("Invalid DMS format");
    }

    const sign = result[1] === '-' ? -1 : 1;
    const degrees = parseFloat(result[2]);
    const minutes = parseFloat(result[3]);
    const seconds = parseFloat(result[4] || '0');

    return (sign * (degrees + (minutes / 60) + (seconds / 3600))).toFixed(10);
}

// --
// Projection helpers

function modifyProj4String(input) {
    if (input.includes('+ellps=clrk66')) {
        const params = input.split(' ');
        // Filter out the '+nadgrids=' parameter and value
        const filteredParams = params.filter(param => !param.startsWith('+nadgrids='));
        // add '+towgs84=-8,160,176,0,0,0,0'
        return filteredParams.join(' ') + ' +towgs84=-8,160,176,0,0,0,0';
    }
    return input;
}
function _register_proj(code, wkt, bbox, proj4_) {
    let extent_wgs = [bbox[1], bbox[2], bbox[3], bbox[0]];
    if (bbox[1] > bbox[3])
        extent_wgs = [bbox[1], bbox[2], bbox[3] + 360, bbox[0]];

    proj4_ = modifyProj4String(proj4_)
    proj4.defs(code, proj4_);
    register(proj4)
}

export const register_proj = async function (query) {

    const response = await fetch('https://epsg.io/?format=json&q=' + query);
    const json = await response.json();
    const results = json['results'];
    if (results && results.length > 0) {
        const results = json['results'];
        if (results && results.length > 0) {
            for (let i = 0, ii = results.length; i < ii; i++) {
                const result = results[i];
                if (result) {
                    const auth = result['authority'];
                    const code = result['code'];
                    const wkt = result['wkt'];
                    const proj4_ = result['proj4']
                    const bbox = result['bbox'];
                    if (
                        code && code.length > 0 &&
                        wkt && wkt.length > 0 &&
                        bbox && bbox.length == 4
                    ) {
                        await _register_proj(`${auth}:${code}`, wkt, bbox, proj4_);
                    }
                }
            }
        }
    }
}
export const valuetext = function (value) {
    return `${Math.round(value)}%`;
}

export const basemapURLS = [
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
    // "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/WMTS/1.0.0/WMTSCapabilities.xml",
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/WMTS/1.0.0/WMTSCapabilities.xml"

]

const WMTSParser = new WMTSCapabilities();


export async function loadWMTSLayer(url) {
    try {

        const response = await fetch(url);
        const text = await response.text();

        // Parse the WMTS capabilities
        const result = WMTSParser.read(text);

        let layers_ = {}
        let sources_ = {}
        for (let layer_ of result["Contents"]['Layer']) {
            let Layers_ = {}

            Layers_['layer'] = layer_['Identifier']
            const options = optionsFromCapabilities(result, Layers_);
            // Set additional options
            options.attributions = 'USGS' + new Date().getFullYear();
            options.crossOrigin = '';
            options.projection = 'EPSG:3857';
            options.wrapX = false;

            // Set the WMTS source
            let layer = new TileLayer({
                id: layer_['Identifier'],
                visible: false
            });
            let layer_source = new WMTS(options)
            layer.setSource(layer_source);
            layers_[layer_['Identifier']] = layer
            sources_[layer_['Identifier']] = layer_source
        }

        return [layers_, sources_]
    } catch (error) {
        console.error('Error loading WMTS layer:', error);
        return {}
    }
}


export function sortByGcpId(arrayOfGCPs) {
    return arrayOfGCPs.slice().sort((a, b) => {
        const gcpIdA = a.gcp_id;
        const gcpIdB = b.gcp_id;
        return gcpIdA.localeCompare(gcpIdB); // Use localeCompare for string comparison
    });
}

export function returnImageBufferUrl(map_id, gcp) {
    return "/api/map/clip-tiff?map_id=" + map_id + "&coll=" + parseInt(gcp['coll']) + "&rowb=" + parseInt(gcp['rowb'])
}

export function createPath(status, dir) {
    console.log(status)
    let path = dir + '/projections/'
    if (status == "not_georeferenced") {
        path = dir + '/points/'
    }
    if (status == "not_a_map") {
        path = dir + '/points/'
    }
    if (status == "legendAnnotation") {
        path = dir + '/legendAnnotation/'
    }
    return path
}

export const oneMap = async (status, navigate, nav_path) => {
    let post_data = {
        "query": "",
        "page": 1,
        "size": 1,
        "georeferenced": true,
        "validated": false,
        "not_a_map": false,
        "random": true
    }
    // let nav_path = './projections/'
    if (status == "not_georeferenced") {
        post_data["georeferenced"] = false
    }
    if (status == "validated") {
        post_data["validated"] = true
    }
    if (status == "not_a_map") {
        post_data["georeferenced"] = false
        post_data["not_a_map"] = true
    }

    try {
        let { data } = await axios({
            method: "post",
            url: "/api/map/maps_search",
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            data: post_data
        })
        if (data['results'].length > 0) {
            navigate(nav_path + data["results"][0]['map_id'])
            navigate(0);
        }

    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

export const findFeatureByAttribute = function (source, attributeName, attributeValue) {
    return source.getFeatures().find(feature => feature.get(attributeName) === attributeValue);
}

export const returnImageUrl = function (map_id, extent) {
    return "/api/map/clip-bbox?map_id=" + map_id + "&minx=" + parseInt(extent[0]) + "&miny=" + parseInt(extent[1]) + "&maxx=" + parseInt(extent[2]) + "&maxy=" + parseInt(extent[3])
}