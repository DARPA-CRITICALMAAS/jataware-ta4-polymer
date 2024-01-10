// helpers.js

import { register } from 'ol/proj/proj4.js';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS.js';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { transform } from 'ol/proj';
import TileLayer from 'ol/layer/WebGLTile.js';

import proj4 from 'proj4';

// --
// Map helpers

export const handleOpacityChange = function (e, map) {
    const opacity = parseFloat(e.target.value) / 100;
    getLayerById(map, "map-layer").setOpacity(opacity)
}

export const gcp2pt = function ({ coll, rowb, x, y, crs, gcp_id, color }, map_crs) {

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
            description: 'This is a sample description',
        },
    });
}

export const gcp2box = function ({ coll, rowb, x, y, crs, gcp_id, color }) {
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