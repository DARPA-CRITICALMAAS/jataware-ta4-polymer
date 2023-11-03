// helpers.js

import { register } from 'ol/proj/proj4.js';
import { applyTransform } from 'ol/extent.js';
import { get as getProjection, getTransform } from 'ol/proj.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { transform } from 'ol/proj';

import proj4 from 'proj4';

// --
// Map helpers

export const handleOpacityChange = function (e, map) {
    const opacity = parseFloat(e.target.value) / 100;
    getLayerById(map, "map-layer").setOpacity(opacity)
}

export const gcp2pt = function ({ coll, rowb, x, y, crs, gcp_id, color }, map_crs) {
    // console.log(coll, rowb, x, y, crs, color, map_crs)

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
            coll: Math.floor(coll),
            rowb: Math.floor(rowb),
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
            coll: Math.floor(coll),
            rowb: Math.floor(rowb),
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

function _register_proj(code, wkt, bbox) {
    let extent_wgs = [bbox[1], bbox[2], bbox[3], bbox[0]];
    if (bbox[1] > bbox[3])
        extent_wgs = [bbox[1], bbox[2], bbox[3] + 360, bbox[0]];

    // console.log(code, wkt);
    proj4.defs(code, wkt);
    register(proj4);

    const new_proj = getProjection(code);
    const extent = applyTransform(extent_wgs, getTransform('EPSG:4326', new_proj), undefined, 8);
    new_proj.setExtent(extent);
    return new_proj
}

export const register_proj = function (query) {
    return (
        fetch('https://epsg.io/?format=json&q=' + query)
            .then(function (response) {
                return response.json();
            })
            .then(function (json) {
                const results = json['results'];
                if (results && results.length > 0) {
                    for (let i = 0, ii = results.length; i < ii; i++) {
                        const result = results[i];
                        if (result) {
                            const auth = result['authority'];
                            const code = result['code'];
                            const wkt = result['wkt'];
                            const bbox = result['bbox'];
                            if (
                                code && code.length > 0 &&
                                wkt && wkt.length > 0 &&
                                bbox && bbox.length == 4
                            ) {
                                // console.log(`register_proj: ${auth}:${code}`)
                                return _register_proj(`${auth}:${code}`, wkt, bbox);

                            }
                        }
                    }
                }
            })
    );
}

export const valuetext = function (value) {
    return `${Math.round(value)}%`;
}
