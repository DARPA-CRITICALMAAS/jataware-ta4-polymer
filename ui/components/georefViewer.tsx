// mapExtraction.tsx

import React, { useEffect, useRef, useState } from 'react';

import Map from 'ol/Map.js';

import TileLayer from 'ol/layer/WebGLTile.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import XYZ from 'ol/source/XYZ.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import { Vector as VectorSource } from 'ol/source.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import View from 'ol/View.js';

import { Fill, Stroke, RegularShape, Style } from 'ol/style.js';
import { useNavigate } from "react-router-dom";

import axios from 'axios';

import { Button, Modal } from '@mui/material';
import { Card, CardContent, TextField, Grid, Typography, Slider, Box, Link } from '@mui/material';

import "../css/georefViewer.css";
import SmallMapImage from './smallMapImage'
import { register_proj, getLayerById, expand_resolutions, valuetext, gcp2pt, handleOpacityChange } from "./helpers"
import proj4 from 'proj4';
import { applyTransform } from 'ol/extent.js';
import { get as getProjection, getTransform, transformExtent } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';

// Params
const TIFF_URL = import.meta.env.VITE_TIFF_URL;
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    'Content-Type': 'application/json',
}

function returnColor(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]} )`
}

function MapPage({ mapData }) {
    const navigate = useNavigate();
    const map_name = mapData['map_info']['map_name']
    document.title = "Nylon Georeferencer Projections -" + map_name;

    const [map, setMap] = useState()
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const proj_index = useRef(0)
    const [gcps, setGCPS] = useState(mapData['proj_info'][0]['gcps'])
    const mapRef = useRef()
    const currZoomRef = useRef()
    const currCenterRef = useRef()
    const [open, setOpen] = useState(false);

    const handleClose = () => {
        setOpen(false);
    };

    let used_gcps = {
        'type': 'FeatureCollection',
        'features': []
    }

    for (let gcp of mapData['proj_info'][0]['gcps']) {
        used_gcps['features'].push(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [gcp["x"], gcp['y']]
                },
                "properties": {
                    "color": returnColor(gcp['color'])
                }
            }
        )
    }

    const vector_source = new VectorSource({
        features: new GeoJSON().readFeatures(used_gcps)
    });

    const vector_layer = new VectorLayer({
        id: "vector-layer",
        source: vector_source,
        style: (feature) => {
            let style = new Style({
                image: new RegularShape({
                    fill: new Fill({ color: feature.values_.color }),
                    stroke: new Stroke({ color: 'black', width: 2 }),
                    points: 5,
                    radius: 10,
                    radius2: 4,
                    angle: 0,
                }),
            })
            return style;
        },
    });

    // MAP layer
    const proj_ = register_proj(mapData['proj_info'][0]['epsg_code'])
    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/tiles/${map_name}/${map_name}_${mapData['proj_info'][proj_index.current]['proj_id']}.pro.cog.tif`,
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


    // BASE layer
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



    // Render map
    useEffect(() => {
        const _map = new Map({
            controls: [],
            layers: [base_layer, map_layer, vector_layer],
            view: map_source.getView().then((v) => {
                v.resolutions = expand_resolutions(v, 1, 7);
                v.extent = undefined;
                return v;
            })
        });
        search(mapData['proj_info'][proj_index.current]['epsg_code'], _map)

        currZoomRef.current = _map.getView().getZoom();

        _map.on('moveend', function (e) {
            var newZoom = _map.getView().getZoom();
            var newCenter = _map.getView().getCenter();
            if (currZoomRef.current != newZoom) {
                currZoomRef.current = newZoom;
            }
            if (currCenterRef.current != newCenter) {
                currCenterRef.current = newCenter
            }
        });

        _map.setTarget(mapTargetElement.current || "");
        setMap(_map);
        mapRef.current = _map
        return () => _map.setTarget("")
    }, [])

    useEffect(() => {
        if (map === undefined) return;
        register_proj(mapData['proj_info'][proj_index.current]['epsg_code']).then(() => {
            getLayerById(map, "vector-layer").getSource().clear();
            getLayerById(map, "vector-layer").getSource().addFeatures(gcps.map((gcp) => {
                return gcp2pt(gcp, mapData['proj_info'][proj_index.current]['epsg_code'])
            }));
        })

    }, [gcps])


    function nextProjection(map) {
        // hac will need to be fixed.
        if (currZoomRef.current < 8) {
            currZoomRef.current = 12
        }

        if (proj_index.current >= mapData['proj_info'].length - 1) {
            proj_index.current = 0
        } else {
            proj_index.current = proj_index.current + 1
        }
        const new_map_source = new GeoTIFF({
            sources: [
                {
                    url: `${TIFF_URL}/tiles/${map_name}/${map_name}_${mapData['proj_info'][proj_index.current]['proj_id']}.pro.cog.tif`,
                    nodata: 0,
                }
            ],
            convertToRGB: true,
            interpolate: false,
        })
        getLayerById(map, "map-layer").setSource(new_map_source);

        // register_proj(mapData['proj_info'][proj_index.current]['epsg_code'])

        search(mapData['proj_info'][proj_index.current]['epsg_code'], map)

        setGCPS([...mapData['proj_info'][proj_index.current]['gcps']])

    }

    function saveProjStatus(map_id, proj_id, status) {
        axios({
            method: 'post',
            url: "/api/map/maps/proj_info",
            data: {
                "map_id": map_id,
                "proj_id": proj_id,
                "status": status
            },
            headers: _APP_JSON_HEADER
        }).then((response) => {
            handleClose();
            if (status == "success") {
                next()
            } else {
                nextProjection(mapRef.current)
            }
        }).catch((e) => {
            alert(e)
        })
    }


    function setProjection(code, name, proj4def, bbox, map) {

        if (code === null || name === null || proj4def === null || bbox === null) {
            map.setView(
                new View({
                    projection: 'EPSG:3857',
                    center: [0, 0],
                    zoom: 1,
                })
            );
            return;
        }

        const newProjCode = 'EPSG:' + code;
        proj4.defs(newProjCode, proj4def);
        register(proj4);
        const newProj = getProjection(newProjCode);
        const fromLonLat = getTransform('EPSG:4326', newProj);
        let worldExtent = [bbox[1], bbox[2], bbox[3], bbox[0]];
        newProj.setWorldExtent(worldExtent);

        if (bbox[1] > bbox[3]) {
            worldExtent = [bbox[1], bbox[2], bbox[3] + 360, bbox[0]];
        }
        const extent = applyTransform(worldExtent, fromLonLat, undefined, 8);

        newProj.setExtent(extent);

        const newView = new View({
            projection: newProj
        })

        mapRef.current.setView(newView)
        newView.fit(extent);
        newView.setCenter(currCenterRef.current)
        newView.setZoom(currZoomRef.current)
    }


    function search(query, map) {
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
                            const code = result['code'];
                            const name = result['name'];
                            const proj4def = result['wkt'];
                            const bbox = result['bbox'];
                            if (
                                code &&
                                code.length > 0 &&
                                proj4def &&
                                proj4def.length > 0 &&
                                bbox &&
                                bbox.length == 4
                            ) {
                                setProjection(code, name, proj4def, bbox, map);
                                return;
                            }
                        }
                    }
                }
                setProjection(null, null, null, null, map);

            });
    }
    function next() {
        axios({
            method: "get",
            url: "/api/map/random",
            params: { "georeferenced": true },
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
        })
            .then((response) => {
                let data = response.data;
                navigate("../projections/" + data["map"]);
                navigate(0);
            })
            .catch((error) => {
                console.error("Error fetching data:", error);
            });
    }


    return (
        <>
            <Modal
                open={open}
                onClose={handleClose}
                aria-labelledby="modal-title"
                aria-describedby="modal-description"
            >
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: 400,
                        bgcolor: 'background.paper',
                        border: '2px solid #000',
                        boxShadow: 24,
                        p: 4,
                    }}
                >
                    <Typography id="modal-description" variant="body1" mb={2}>
                        "Success" means this is the correct projection.
                        "Failed" means it was not correct and should be discarded.
                    </Typography>
                    <Button
                        color="success"
                        onClick={(e) => saveProjStatus(
                            mapData['map_info']['map_id'],
                            mapData['proj_info'][proj_index.current]["proj_id"],
                            "success")}>
                        Projection Succeeded
                    </Button>
                    <Button
                        color="error"
                        onClick={(e) => saveProjStatus(
                            mapData['map_info']['map_id'],
                            mapData['proj_info'][proj_index.current]["proj_id"],
                            "failed")}>
                        Projection Failed
                    </Button>
                </Box>
            </Modal>

            <div className="flex-container" >
                <div className="flexChild">
                    <div className="control_panel" id="control-panel">
                        <Box sx={{ width: 200 }}>
                            <Typography id="continuous-slider" gutterBottom>
                                Map Opacity
                            </Typography>
                            <Slider
                                aria-label="Continuous slider"
                                defaultValue={100}
                                step={10}
                                valueLabelDisplay="auto"
                                onChange={(e) => handleOpacityChange(e, map)}
                                valueLabelFormat={valuetext}
                            />
                        </Box>
                    </div>
                    <div
                        ref={mapTargetElement}
                        className="map"
                        style={{
                            width: "100%",
                            height: "100%",
                            position: "relative",
                        }} />
                </div>
                <div className="flexChild scrollableContent">
                    <div className="left-panel">

                        <Button onClick={(e) => navigate("/")}>Home</Button>
                        <Button onClick={(e) => nextProjection(map)}>Next Projection ({String(proj_index.current + 1)}/{mapData['proj_info'].length})</Button>
                        <Button
                            color="warning"
                            onClick={(e) => navigate("/points/" + mapData['map_info']['map_id'])}>
                            Redo From Scratch
                        </Button>
                        <Button
                            className="nextButton"
                            color="success"
                            onClick={() => setOpen(true)}
                        >
                            Review Map
                        </Button>

                        <Button
                            className="nextButton"
                            color="primary"
                            onClick={() => next()}
                        >
                            Next Map
                        </Button>
                        <br />
                        <Link href={`${TIFF_URL}/tiles/${map_name}/${map_name}_${mapData['proj_info'][proj_index.current]['proj_id']}.pro.cog.tif`}>DOWNLOAD PROJECTION</Link>

                        <Typography variant="body2" style={{ fontSize: "1.2rem", marginBottom: "5px" }}>
                            Projection code: {mapData['proj_info'][proj_index.current]['epsg_code']}
                        </Typography>

                        <div>
                            {gcps &&
                                gcps.map((gcp, i) => {
                                    return <div key={gcp.gcp_id}>
                                        <div className="container_card">
                                            <GCPCardSummary gcp={gcp} />
                                            <SmallMapImage map_name={map_name} gcp={gcp} />
                                        </div>
                                    </div>
                                })
                            }
                        </div>
                    </div >
                </div>
            </div >
        </>
    )
}

export default MapPage;

function GCPCardSummary({ gcp }) {
    return (
        <Card variant="outlined" className="card" style={{ padding: '8px' }}>
            <CardContent>
                <Typography variant="body2" style={{ fontSize: "1.2rem", marginBottom: "5px" }}>
                    <b>CRS:</b> {gcp.crs}
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <Typography variant="caption" display="block" gutterBottom style={{ fontWeight: 'bold', fontSize: "1.2rem" }}>
                            X, Y Coordinates:
                        </Typography>
                        <Typography variant="body2" style={{ fontSize: '1.2rem', backgroundColor: "#E0E0E0", borderRadius: "10px", padding: "10px" }}>
                            {gcp.x},  {gcp.y}
                        </Typography>
                    </Grid>
                    <Grid item xs={6}>
                        <Typography variant="caption" display="block" gutterBottom style={{ fontWeight: 'bold', fontSize: "1.2rem" }}>
                            Coords DMS:
                        </Typography>
                        <Typography variant="body2" style={{ fontSize: '1.2rem', backgroundColor: "#E0E0E0", borderRadius: "10px", padding: "10px" }}>
                            {LocationInput("x_dms", gcp)}, {LocationInput("y_dms", gcp)}
                        </Typography>
                    </Grid>
                </Grid>
            </CardContent>
        </Card >
    );
}

function LocationInput(input_label, gcp) {
    const [degree, setDegree] = useState('');
    const [minute, setMinute] = useState('');
    const [second, setSecond] = useState('');

    useEffect(() => {
        let dms = null
        if (input_label == "y_dms") {
            dms = gcp['y_dms']
        } else {
            dms = gcp['x_dms']
        }
        if (dms != null) {
            setDegree(dms.split("°")[0].trim())
            setMinute(dms.split("°")[1].split("'")[0].trim())
            setSecond(dms.split("'")[1].split('"')[0].trim())
        }
    }, [gcp])

    return <>{degree + "°" + minute + "'" + second + '"'}</>

}

