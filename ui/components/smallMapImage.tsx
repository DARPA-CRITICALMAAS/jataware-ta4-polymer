
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
const BUFFER = 200;

function SmallMapImage({ map_name, gcp }) {
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [imageUrl, setImageUrl] = useState("")
    const [showMap, setShowMap] = useState(true)

    // --
    // MAP layer
    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/cogs/${map_name}/${map_name}.cog.tif`,
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

        map.once('rendercomplete', () => {

            const mapCanvas = map.getViewport().getElementsByTagName('canvas')[0];
            if (mapCanvas) {
                const image = mapCanvas.toDataURL();
                setImageUrl(image);

            }
            if (showMap) {
                setShowMap(false)
            }
        });

        return () => map.setTarget("")
    }, [gcp])




    function returnColor(arr) {
        return `rgb(${arr[0]},${arr[1]},${arr[2]} )`
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
                    />
                }


            </div>
        </>
    )
}
export default SmallMapImage;