
import React, { useEffect, useState, useRef } from 'react';

import Map from 'ol/Map.js';
import TileLayer from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import XYZ from 'ol/source/XYZ.js';
import { Typography, Slider } from '@mui/material';
import { valuetext, handleOpacityChange, getLayerById } from "./helpers"
import View from 'ol/View.js';
import { transformExtent, get as getProjection } from 'ol/proj';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';

const TIFF_URL = import.meta.env.VITE_TIFF_URL;
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

function SmallMapImageClipped({ map_id, proj_info, clippedState, baseMapSources, parentBaseMap }) {
    let bbox = clippedState['clipExentRef']
    let center = clippedState['clippedCenter']
    let sourceProjection = clippedState["clippedProjection"]
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const mapRef = useRef()
    const mapExtent = useRef()
    var targetProjection = getProjection(proj_info['epsg_code']);
    const [baseMapSelected, setBaseMapSelected] = useState(true)

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/cogs/${map_id}/${map_id}_${proj_info['proj_id']}.pro.cog.tif`,
                nodata: 0,
            }
        ],
        convertToRGB: true,
        interpolate: false,
    });

    const map_layer = new TileLayer({
        id: "map-layer",
        source: map_source,
    })

    // --
    const base_source = new XYZ({
        // projection: mapData['proj_info'][proj_index.current]['epsg_code'],
        url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
        crossOrigin: '',
    });

    const base_layer = new TileLayer({
        id: "base-layer",
        source: base_source,
        visible: true
    });

    // historic base layer
    const wmts_layer = new TileLayer({
        id: "historic-layer"
    })
    if (parentBaseMap != "Satellite") {
        wmts_layer.setSource(baseMapSources[parentBaseMap])
        wmts_layer.setVisible(true)
        base_layer.setVisible(false)
    } else {
        wmts_layer.setSource(baseMapSources["USGSTopo"])
        wmts_layer.setVisible(false)
    }

    useEffect(() => {
        map_layer.setOpacity(.4)
        const map = new Map({
            layers: [base_layer, wmts_layer, map_layer],
            controls: [],
            view: new View({
                center: center,
                zoom: 10,
                projection: proj_info['epsg_code']
            })
        })
        map.setTarget(mapTargetElement.current || "")
        mapRef.current = map
        mapExtent.current = transformExtent(bbox, sourceProjection, targetProjection)
        map.getView().fit(mapExtent.current)

        return () => map.setTarget("")
    }, [])


    useEffect(() => {
        mapExtent.current = transformExtent(bbox, sourceProjection, targetProjection)
        mapRef.current.getView().fit(mapExtent.current)
    }, [clippedState]);

    function switchBaseMap() {
        if (baseMapSelected) {
            getLayerById(mapRef.current, "base-layer").setVisible(true);
            getLayerById(mapRef.current, "historic-layer").setVisible(false);;
        } else {
            getLayerById(mapRef.current, "base-layer").setVisible(false);
            getLayerById(mapRef.current, "historic-layer").setVisible(true);;
        }

        setBaseMapSelected(!baseMapSelected)

    }

    return (
        <>
            <div className='borderBox'
                style={{
                    display: "grid",
                    justifyContent: "center",
                    alignContent: "center",
                    width: "400px", height: "420px"
                }}>
                <Typography id="continuous-slider" gutterBottom>
                    Map Projection: {proj_info['epsg_code']}
                </Typography>
                <Typography id="continuous-slider" gutterBottom>
                    GCPs: {proj_info['gcps'].length}
                </Typography>

                <Slider
                    aria-label="Continuous slider"
                    defaultValue={40}
                    step={10}
                    valueLabelDisplay="auto"
                    onChange={(e) => handleOpacityChange(e, mapRef.current)}
                    valueLabelFormat={valuetext}
                />
                <FormControlLabel control={<Switch checked={baseMapSelected} onChange={() => { switchBaseMap() }} />} label="Change baselayer" />

                <div
                    ref={mapTargetElement}
                    className="map"
                    style={{
                        border: "1px solid",
                        borderColor: "red",
                        width: "300px",
                        height: "300px",
                        position: "relative"
                    }} >
                </div >
            </div>
        </>
    )
}
export default SmallMapImageClipped;