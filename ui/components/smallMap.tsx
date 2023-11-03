// smallMap.tsx

import React, { useEffect, useState, useRef } from 'react';

import Map from 'ol/Map.js';
import TileLayer from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import { Vector as VectorSource } from 'ol/source.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Circle as CircleStyle, Stroke, Style } from 'ol/style.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import { Button } from '@mui/material';

import { expand_resolutions } from "./helpers"

const TIFF_URL = import.meta.env.VITE_TIFF_URL;
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const BUFFER = 250;

function SmallMap({ map_name, gcp, updateGCP }) {
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [showMap, setShowMap] = useState(true)
    const [imageUrl, setImageUrl] = useState("")
    const [clicked, setClicked] = useState(false)
    // --
    // MAP layer

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/tiles/${map_name}/${map_name}.cog.tif`,
                nodata: 0,
            }
        ],
        convertToRGB: true,
        interpolate: false,
    });

    const map_layer = new TileLayer({
        source: map_source,
    })

    // --
    // VECTOR layer

    const vector_styles = {
        'Point': new Style({
            image: new CircleStyle({
                radius: 1,
                stroke: new Stroke({ color: 'red', width: 5 }),
            })
        }),
    };
    const vector_source = new VectorSource({
        features: new GeoJSON().readFeatures({
            "type": "FeatureCollection",
            "features": [
                {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Point',
                        'coordinates': [gcp.coll, gcp.rowb],
                        "properties": {
                            "color_": "red"
                        }
                    }
                }

            ]
        })
    });

    const vector_layer = new VectorLayer({
        source: vector_source,
        style: function (feature) {
            return vector_styles[feature.getGeometry().getType()];
        },
    });


    useEffect(() => {
        const map = new Map({
            layers: [map_layer, vector_layer],
            controls: [],
            view: map_source.getView().then((v) => {
                v.resolutions = expand_resolutions(v, 0, 7);
                v.extent = [gcp.coll - BUFFER, gcp.rowb - BUFFER, gcp.coll + BUFFER, gcp.rowb + BUFFER];
                return v;
            })
        })
        map.setTarget(mapTargetElement.current || "")
        map.on('click', (e) => {
            let new_gcp = { ...gcp };
            new_gcp["coll"] = e.coordinate[0];
            new_gcp["rowb"] = e.coordinate[1];
            updateGCP(new_gcp);
        })
        map.once('rendercomplete', () => {
            if (clicked) {

            } else {
                const mapCanvas = map.getViewport().getElementsByTagName('canvas')[0];
                // console.log('made it wowowo', map.getRenderer())
                if (mapCanvas) {
                    const image = mapCanvas.toDataURL();
                    setImageUrl(image);

                }
                if (showMap) {
                    setShowMap(false)
                }
            }


        });
        return () => map.setTarget("")
    }, [gcp])




    function returnColor(arr) {
        return `rgb(${arr[0]},${arr[1]},${arr[2]} )`
    }
    function show_rerender() {
        let new_gcp = { ...gcp };
        setClicked(true)
        updateGCP(new_gcp)
        setShowMap(true)

    }
    function finishEdit() {
        setShowMap(false)
        setClicked(false)

    }
    function returnHeight() {
        if (showMap) return "250px"
        return "220px"
    }
    function returnHeightMap() {
        if (showMap) return "180px"
        return "200px"
    }
    return (
        <>
            <div className='borderBox' style={{ display: "grid", justifyContent: "center", alignContent: "center", width: returnHeight(), height: "220px", background: returnColor(gcp.color) }}>
                {showMap ?
                    <>
                        <div
                            ref={mapTargetElement}
                            className="map"
                            style={{
                                border: "1px solid",
                                borderColor: "red",
                                width: "200px",
                                height: returnHeightMap(),
                                position: "relative"
                            }} >
                        </div >
                        <Button variant="contained" color="success" onClick={() => finishEdit()}>Finish Edits</Button>
                    </>

                    :

                    <img
                        src={imageUrl}
                        alt="Static Map"
                        style={{

                            width: '200px',
                            height: '200px',
                            cursor: 'pointer'
                        }}
                        onClick={() => show_rerender()}
                    />
                }


            </div>
        </>
    )
}
export default SmallMap;
