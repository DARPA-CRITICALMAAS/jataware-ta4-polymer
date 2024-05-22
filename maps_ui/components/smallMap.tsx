// smallMap.tsx

import React, { useEffect, useState, useRef } from 'react';

import Map from 'ol/Map';
import TileLayer from 'ol/layer/WebGLTile';
import GeoTIFF from 'ol/source/GeoTIFF';
import { Vector as VectorSource } from 'ol/source';
import GeoJSON from 'ol/format/GeoJSON';
import { Circle as CircleStyle, Stroke, Style } from 'ol/style';
import { Vector as VectorLayer } from 'ol/layer';
import { Button } from '@mui/material';

import { returnImageBufferUrl, expand_resolutions } from "./helpers"

const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const BUFFER = 250;

function SmallMap({ cog_id, gcp, updateGCP, height }) {
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [showMap, setShowMap] = useState(false)
    const [clicked, setClicked] = useState(false)
    const [clipUrl, setClipUrl] = useState(returnImageBufferUrl(cog_id, gcp, height))
    // --
    // MAP layer

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${CDR_COG_URL}/${CDR_PUBLIC_BUCKET}/${CDR_S3_COG_PREFEX}/${cog_id}.cog.tif`,
                nodata: -1,
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
                        'coordinates': [gcp.columns_from_left, height - gcp.rows_from_top],
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
                v.extent = [gcp.columns_from_left - BUFFER, height - gcp.rows_from_top - BUFFER,
                gcp.columns_from_left + BUFFER, height - gcp.rows_from_top + BUFFER];
                return v;
            })
        })
        map.setTarget(mapTargetElement.current || "")
        map.on('click', (e) => {
            let new_gcp = { ...gcp };
            new_gcp["columns_from_left"] = e.coordinate[0];
            new_gcp["rows_from_top"] = height - e.coordinate[1];
            new_gcp['just_edited'] = true
            updateGCP(new_gcp, height);
        })

        return () => map.setTarget("")
    }, [gcp])


    function returnColor(arr) {
        return `rgb(${arr[0]},${arr[1]},${arr[2]} )`
    }
    function show_rerender() {
        let new_gcp = { ...gcp };
        setClicked(true)
        updateGCP(new_gcp, height)
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

            {clipUrl &&

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
                        <>

                            <img
                                src={clipUrl}
                                alt="Loading Clipped Map..."
                                style={{

                                    width: '200px',
                                    height: '200px',
                                    cursor: 'pointer'
                                }}
                                onClick={() => show_rerender()}
                            />

                        </>


                    }


                </div>

            }

        </>
    )
}
export default SmallMap;