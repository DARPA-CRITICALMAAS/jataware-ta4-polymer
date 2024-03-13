// mapExtraction.tsx

import React, { useEffect, useRef, useState } from 'react';

import Map from 'ol/Map.js';
import CircularProgress from '@mui/material/CircularProgress';

import TileLayer from 'ol/layer/WebGLTile.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import XYZ from 'ol/source/XYZ.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import { Vector as VectorSource } from 'ol/source.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Draw, { createBox } from 'ol/interaction/Draw'

import { Fill, Stroke, Style } from 'ol/style.js';
import { useNavigate } from "react-router-dom";

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { Button, Modal } from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import { Card, CardContent, TextField, Grid, Typography, Slider, Box } from '@mui/material';

import "../css/mapExtraction.css";
import epsg_data from '../assets/EPSG_CODES_verbose.json'
import SmallMap from './smallMap'
import { sortByGcpId, checkIfEdited, getColorForProvenance, provenance_mapper, dec2dms, dms2dec, register_proj, getLayerById, expand_resolutions, valuetext, gcp2box, handleOpacityChange, oneMap, createPath } from "./helpers"
import { FormGroup, Checkbox, FormControlLabel } from '@mui/material';
// Params
const TIFF_URL = import.meta.env.VITE_TIFF_URL;
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const BUFFER = 150;

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    'Content-Type': 'application/json',
}


function MapPage({ mapData }) {
    console.log(mapData)
    const map_id = mapData['map_info']['map_id']
    const map_name = mapData['map_info']['map_name']
    const [loading, setLoading] = useState(false)
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [map, setMap] = useState<Map | undefined>()
    const [gcps, setGCPs] = useState([]);
    const [map_crs, setMapCRS] = useState(null);
    // const [showExtractButton, setShowExtractButton] = useState(true)
    const [georeferenced, setGeoreferenced] = useState(false)
    const [isProjected, setProjected] = useState(mapData['map_info']['georeferenced']);
    const [provenanceOption, setProvenanceOption] = useState([])
    const [loadedTiff, setLoadedTiff] = useState(false)
    const [showOCR, setShowOCR] = useState(false)
    const [EPSGs, setEPSGs] = useState([])
    const [extractedText, setExtractedText] = useState("")
    const [reasoning, setReasoning] = useState("")
    const navigate = useNavigate();
    const drawRef = useRef()
    const mapRef = useRef()

    let draw;


    // ----------------- LAYERS -----------------
    // VECTOR layer

    const vector_styles = {
        'Polygon': new Style({
            stroke: new Stroke({
                width: 3,
            }),
            fill: new Fill({
                color: 'rgba(0, 0, 0, 0.3)',
            }),
        }),
    };


    let used_gcps = {
        'type': 'FeatureCollection',
        'features': []
    }
    const vector_source = new VectorSource({
        features: new GeoJSON().readFeatures(used_gcps)
    });


    const vector_layer = new VectorLayer({
        id: "vector-layer",
        source: vector_source,
        style: (feature) => {
            let style = vector_styles[feature.getGeometry().getType()]
            let color = feature.values_.color
            style.stroke_.color_ = color
            return style;
        },
    });

    // MAP layer

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/cogs/${map_id}/${map_id}.cog.tif`,
                nodata: -1,
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
        url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
        crossOrigin: '',
    });

    const base_layer = new TileLayer({
        id: "base-layer",
        source: base_source,
        visible: false
    });

    // ocr vector layer
    const ocr_source = new VectorSource({ wrapX: false });
    const ocr_vector = new VectorLayer({
        id: "bounding-box",
        source: ocr_source,
    });

    function create_gcp_id(gcp) {
        let gcp_id
        if (gcp.gcp_id == undefined) {
            gcp_id = gcp.y.toString() + gcp.x.toString() + gcp.coll.toString() + gcp.rowb.toString() + gcp.crs.toString()
        } else {
            gcp_id = gcp.gcp_id
        }

        return gcp_id

    }

    function ensureString(value) {
        return value === null || value === undefined ? '' : value;
    }


    function project(gcps) {
        if (map_crs == null) {
            alert("Map CRS required!");
            return;
        }
        setLoading(true)

        register_proj(map_crs).then(() => {

            let gcps_ = gcps.map((gcp) => ({
                gcp_id: create_gcp_id(gcp),
                rowb: gcp.rowb,
                coll: gcp.coll,
                x: gcp.x,
                y: gcp.y,
                crs: gcp.crs.split("__")[0],
                provenance: gcp.provenance,
                gcp_reference_id: ensureString(gcp.gcp_reference_id),
                map_id: map_id
            }))

            // project
            axios({
                method: 'post',
                url: "/api/map/project",
                data: {
                    "map_name": map_name,
                    "map_id": map_id,
                    "gcps": gcps_,
                    "crs": map_crs
                },
                headers: _APP_JSON_HEADER
            }).then((response) => {
                let proj_url = response.data['pro_cog_path']
                // Change map source
                const new_map_source = new GeoTIFF({
                    sources: [
                        {
                            url: proj_url,
                            nodata: -1,
                        }
                    ],
                    convertToRGB: true,
                    interpolate: false,
                })
                getLayerById(map, "map-layer").setSource(new_map_source);

                // Change view
                map.setView(
                    new_map_source.getView().then((v) => {
                        v.resolutions = expand_resolutions(v, 5, 7);
                        v.extent = undefined;
                        return v;
                    })
                );

                getLayerById(map, "base-layer").setVisible(true);
                setGeoreferenced(true)
                setProjected(true)
                setLoading(false)

            }).catch((error) => {
                console.error('Error fetching data:', error);
            });
        });
    }


    function map_onClick(e) {
        let [coll, rowb] = e.coordinate;
        if (drawRef.current.values_.active != true) {
            setGCPs(sortByGcpId([...gcps, {
                gcp_id: "manual_" + uuidv4(),
                rowb: Math.floor(rowb),
                coll: Math.floor(coll),
                x: null,
                y: null,
                x_dms: null,
                y_dms: null,
                crs: null,
                provenance: "api_endpoint",
                gcp_reference_id: null,
                color: [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
            }]))
        }
    }

    // Render map
    useEffect(() => {
        document.title = "Polymer Georeferencer Extractions - " + map_name;
        const _map = new Map({
            controls: [],
            layers: [base_layer, map_layer, vector_layer, ocr_vector],
            view: map_source.getView().then((v) => {
                v.resolutions = expand_resolutions(v, 1, 7);
                v.extent = undefined;
                return v;
            })
        });
        _map.setTarget(mapTargetElement.current || "");
        _map.on('click', map_onClick);
        mapRef.current = _map
        draw = new Draw({
            source: ocr_source,
            type: "Circle",
            geometryFunction: createBox(),

        });
        draw.setActive(false)
        drawRef.current = draw
        _map.addInteraction(draw);
        setMap(_map);

        return () => _map.setTarget("")
    }, [map_id])

    useEffect(() => {
        // Show jataware points to start
        setGCPs([])
        const checkboxes = document.querySelectorAll('input[type="checkbox"][name="bulk_upload"]');
        checkboxes.forEach(checkbox => {
            checkbox.click();
        });
    }, [map_id]);

    // Propagate data
    useEffect(() => {
        if (mapRef.current === undefined) return;

        // On GCP change, need to update click to have new gcps
        mapRef.current.on('click', map_onClick);

        // On GCP change ... update map
        getLayerById(mapRef.current, "vector-layer").getSource().clear();
        getLayerById(mapRef.current, "vector-layer").getSource().addFeatures(gcps.map(gcp2box));

        return () => mapRef.current.on('click', undefined);
    }, [gcps])


    useEffect(() => {
        axios({
            method: 'get',
            url: `/api/map/clip-tiff?map_id=${map_id}&coll=${1}&rowb=${1}`,
            headers: _APP_JSON_HEADER
        }).then((response) => {
            setLoadedTiff(true)

        }).catch((error) => {
            console.error('Error fetching data:', error);
        });
        return
    }, [])


    // Update GCPs
    function updateGCP(new_gcp) {

        if (map === undefined) return;

        let features = getLayerById(mapRef.current, 'vector-layer').getSource().getFeatures()
        let gcps_ = []

        for (let feature of features) {
            if (feature.values_.gcp_id == new_gcp['gcp_id']) {
                for (const [key, value] of Object.entries(new_gcp)) {
                    feature.values_[key] = value;
                }

                if ("coll" in new_gcp && "rowb" in new_gcp) {
                    let BUFFER = 150
                    feature.getGeometry().setCoordinates([[
                        [new_gcp['coll'] - BUFFER, new_gcp["rowb"] - BUFFER],
                        [new_gcp['coll'] + BUFFER, new_gcp["rowb"] - BUFFER],
                        [new_gcp['coll'] + BUFFER, new_gcp["rowb"] + BUFFER],
                        [new_gcp['coll'] - BUFFER, new_gcp["rowb"] + BUFFER],
                        [new_gcp['coll'] - BUFFER, new_gcp["rowb"] - BUFFER]]]
                    );
                }
            }
            gcps_.push({
                "gcp_id": feature.values_['gcp_id'],
                "coll": feature.values_['coll'],
                "rowb": feature.values_['rowb'],
                "x": feature.values_['x'],
                "y": feature.values_['y'],
                "x_dms": dec2dms(feature.values_['x']),
                "y_dms": dec2dms(feature.values_['y']),
                "crs": feature.values_['crs'],
                "color": feature.values_['color'],
                "provenance": feature.values_['provenance'],
                "gcp_reference_id": feature.values_['gcp_reference_id'],
                "just_edited": feature.values_['just_edited']
            })
        }
        setGCPs(sortByGcpId([...gcps_]))
    }

    function deleteGCP(old_gcp) {
        setGCPs(sortByGcpId([...gcps].filter((x) => (x.gcp_id !== old_gcp.gcp_id))));
        // setShowExtractButton(true)
    }

    function turnOnDraw() {
        drawRef.current.setActive(!drawRef.current.values_.active)
    }


    function clearClippedPolygons(map) {
        setExtractedText("")
        setReasoning("")
        setEPSGs([])
        getLayerById(map, "bounding-box").getSource().clear()
    }


    function send_for_ocr() {
        let features = getLayerById(map, "bounding-box").getSource().getFeatures()
        let bboxes = []
        for (let feat of features) {
            bboxes.push(feat.getGeometry().extent_)
        }
        axios({
            method: 'post',
            url: "/api/map/tif_ocr",
            data: { "map_id": map_id, "bboxes": bboxes },
            headers: _APP_JSON_HEADER
        }).then((response) => {
            let all_text = ""
            for (let text of response.data['extracted_text']) {
                all_text = all_text + " " + text
            }
            setExtractedText(all_text)

        }).catch((error) => {
            console.error('Error fetching data:', error);
        });
    }

    function send_for_EPSGs() {

        let prompt = `Here is some ocr extracted text from a geological map. Can you help determine the EPSG code for this map? 
        Make sure to explain your reasoning for each recommendation with a max limit of 5 codes.
        Be succinct with your response with a max limit of words at 500.
        Make sure each code is returned as the code EPSG followed by a : then the number. Like EPSG:32101. 
        Do not allow for spaces between the : and numbers. 
        IMPORTANT: if a map was made before 1983, it cannot use NAD83 datum. if a map was made before 1927, it cannot use NAD27 datum.
        It should look something like EPSG:26919 This code represents the UTM Zone 19N, which corresponds to the Universal Transverse Mercator grid ticks mentioned in the text.
        Here is the text describing the map CRS: ` + extractedText

        axios({
            method: 'post',
            url: "/api/map/send_prompt",
            data: { "prompt": prompt },
            headers: _APP_JSON_HEADER
        }).then((response) => {

            setEPSGs(response.data['matches'])
            setReasoning(response.data['reasoning'])

        }).catch((error) => {
            console.error('Error fetching data:', error);
        });
    }


    function handleExtractedTextChange(e) {
        setExtractedText(e.target.value);
    }


    function returnEPSGName(code) {
        for (let epsg of epsg_data['codes']) {
            if ("label" in epsg) {
                if (epsg['label'].split("__")[0] == code) {
                    return <div>Name: {epsg["info"]["name"]}</div>
                }
            }
        }
    }

    // function extract_gcps(map_name) {

    //     setLoading(true)

    //     axios({
    //         method: 'post',
    //         url: "/api/map/extract_gcps",
    //         data: { "map_id": map_id },
    //         headers: _APP_JSON_HEADER
    //     }).then((response) => {

    //         let new_data = response.data.map((gcp, _id) => ({
    //             gcp_id: create_gcp_id(gcp),
    //             rowb: gcp.rowb,
    //             coll: gcp.coll,
    //             x: gcp.x,
    //             y: gcp.y,
    //             x_dms: dec2dms(gcp.x),
    //             y_dms: dec2dms(gcp.y),
    //             provenance: gcp.provenance,
    //             gcp_reference_id: gcp.gcp_reference_id,
    //             crs: gcp.crs,
    //             color: [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]
    //         }))

    //         setGCPs(sortByGcpId([...new_data, ...gcps]))
    //         setLoading(false)
    //         // setShowExtractButton(false)

    //     }).catch((error) => {
    //         console.error('Error fetching data:', error);
    //     });
    // }


    function viewprojects() {
        navigate('/projections/' + map_id)
    }

    const handleProvenanceChange = (event) => {
        const option = event.target.name;
        let newOptions = [...provenanceOption];

        if (event.target.checked) {
            // Add the checked option
            newOptions.push(option);
        } else {
            // Remove the unchecked option
            newOptions = newOptions.filter(item => item !== option);
        }
        const filteredGCPS = mapData['all_gcps'].filter((gcp) => newOptions.includes(gcp.provenance));
        setGCPs(sortByGcpId(filteredGCPS))

        setProvenanceOption(newOptions);
    };



    function saveMapStatus(map_id, not_a_map) {
        not_a_map = !not_a_map
        axios({
            method: 'put',
            url: "/api/map/map_info",
            data: {
                "map_id": map_id,
                "key": "not_a_map",
                "value": not_a_map
            },
            headers: _APP_JSON_HEADER
        }).then((response) => {
            oneMap("not_georeferenced", navigate, createPath("not_georeferenced", '..'))
        }).catch((e) => {
            alert(e)
        })

    }

    return (
        <>


            {loading &&
                <div className="loading">
                    <CircularProgress />
                </div>
            }
            <div className="flex-container" >

                <div className="flexChild">


                    <div className="control_panel" id="control-panel">
                        <Box sx={{ width: 200 }}>
                            <h4 style={{ "padding": "0px", "margin": "4px" }}>Select GCPs</h4>
                            <FormGroup style={{ width: '200px' }}>
                                {mapData['provenances'].map((option, index) => (
                                    <FormControlLabel
                                        key={index}
                                        control={
                                            <Checkbox
                                                checked={provenanceOption.includes(option)}
                                                onChange={handleProvenanceChange}
                                                name={option}
                                            />
                                        }
                                        label={
                                            <Typography style={{
                                                color: getColorForProvenance(option),
                                            }}>
                                                {provenance_mapper[option]}
                                            </Typography>}
                                    />
                                ))}
                            </FormGroup>
                            {
                                georeferenced &&
                                <>
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
                                </>

                            }
                        </Box >

                    </div >

                    <div
                        ref={mapTargetElement}
                        className="map"
                        style={{
                            width: "100%",
                            height: "100%",
                            position: "relative",
                        }} />
                </div >
                <div key={"scroll" + map_id} className="flexChild scrollableContent">
                    <div className="left-panel">
                        <Button onClick={(e) => navigate("/")}>Home</Button>

                        <Button
                            className="nextButton"
                            color="primary"
                            onClick={() => oneMap("not_georeferenced", navigate, createPath("not_georeferenced", '..'))}
                        >
                            Next Map
                        </Button>
                        {/* {showExtractButton &&
                            <Button onClick={() => extract_gcps(map_name)}> EXTRACT GCPs </Button>
                        } */}
                        <Button onClick={() => project(gcps)} > GEOREFERENCE </Button>
                        {isProjected && <Button onClick={() => viewprojects()} > VIEW PROJECTIONS </Button>}
                        <Button
                            color={mapData['map_info']['not_a_map'] ? "warning" : "error"}
                            onClick={(e) => saveMapStatus(
                                mapData['map_info']['map_id'], mapData['map_info']['not_a_map']
                            )}>
                            {mapData['map_info']['not_a_map'] ? "Mark as Map" : "Not A Map"}
                        </Button>
                        <Autocomplete
                            value={map_crs}
                            className="autoComplete"
                            disablePortal
                            options={epsg_data["codes"]}
                            renderInput={(params) => (<TextField {...params} label="Map CRS" />)}
                            onInputChange={(event, value) => {
                                setMapCRS(value.split("__")[0])
                            }}
                        />

                        <Button onClick={() => { setShowOCR(!showOCR); turnOnDraw() }}> {showOCR ? "Hide Map CRS" : "Find Map CRS"}</Button>
                        {showOCR &&
                            <div style={{ background: '#E8E8E8', borderRadius: "10px", padding: "10px" }}>
                                <Button onClick={() => clearClippedPolygons(map)}>Clear Polygons</Button>
                                <div>
                                    <p style={{ color: "red" }}>
                                        Warning: These are recomendations generated by AI not an expert. Please verify any selected recomendations
                                        before georeferencing.
                                    </p>
                                    <p>
                                        First select an area of the map with the most relvant information about the map CRS.
                                        You are allowed to create multiple boxes, the text from each will be combined.
                                        It helps to include the year the map was created, either by manually entering it
                                        or finding it on the map and extracting it.
                                        The extracted text sent to chat GPT to help determining the EPSG code.
                                    </p>
                                    <Button onClick={(e) => send_for_ocr()}>Extract Text from Polygons</Button>
                                    <TextField
                                        id="filled-multiline-flexible"
                                        size="small"
                                        fullWidth
                                        label="Extracted Text"
                                        multiline
                                        maxRows={4}
                                        variant="filled"
                                        value={extractedText}
                                        onChange={(e) => { handleExtractedTextChange(e) }}
                                    />
                                    <br />
                                    <Button onClick={(e) => send_for_EPSGs()}>Get EPSG Recomendations</Button>
                                    <ul>
                                        {
                                            EPSGs.map((gcp, i) => {
                                                return <li key={i}>{gcp}: {returnEPSGName(gcp)} { }</li>
                                            })
                                        }
                                    </ul>
                                    <p>
                                        {reasoning}
                                    </p>



                                </div>
                            </div >
                        }

                        <div>

                            {
                                loadedTiff ?
                                    <>
                                        {
                                            gcps.map((gcp, i) => {
                                                return <div key={gcp.gcp_id}>
                                                    <div className="container_card">
                                                        <GCPCard gcp={gcp} updateGCP={updateGCP} deleteGCP={deleteGCP} provenance={provenance_mapper} />
                                                        <SmallMap map_id={map_id} gcp={gcp} updateGCP={updateGCP} />
                                                    </div>
                                                </div>
                                            })
                                        }
                                    </>
                                    :
                                    <>
                                        <div>Looking for gcps...</div>
                                    </>

                            }
                        </div>
                    </div >
                </div>
            </div >
        </>
    )
}

function GCPCard({ gcp, updateGCP, deleteGCP, provenance }) {
    const [isFirstRender, setIsFirstRender] = useState(true);

    function _onChange(key_, val_) {
        if (isFirstRender) {
            return;
        }
        let new_gcp = { ...gcp };
        if (["x", "y", "rowb", "coll"].includes(key_))
            val_ = parseFloat(val_);

        new_gcp[key_] = val_;

        if (key_ == "x") new_gcp["x_dms"] = dec2dms(val_);
        if (key_ == "y") new_gcp["y_dms"] = dec2dms(val_);
        if (key_ == "x_dms") new_gcp["x"] = dms2dec(val_);
        if (key_ == "y_dms") new_gcp["y"] = dms2dec(val_);

        // new_gcp["provenance"] = "api_endpoint";
        new_gcp['just_edited'] = true

        updateGCP(new_gcp);
    }

    function updateDMS(key, value) {
        _onChange(key, value)
    }

    useEffect(() => {
        setIsFirstRender(false)
    }, []);



    return (
        <Card variant="outlined" className="card">
            <CardContent>
                <form>
                    <h4>Provenance: <span style={{ color: getColorForProvenance(gcp['provenance']) }}>{provenance[gcp['provenance']]}</span>
                        <span style={{ color: "#FF8C00" }}>{checkIfEdited(gcp) && " (edited)"}</span></h4>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <TextField type="number" label="Row from Bottom" value={gcp.rowb} onChange={(e) => _onChange("rowb", e.target.value)} />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField type="number" label="Col from Left" value={gcp.coll} onChange={(e) => _onChange("coll", e.target.value)} />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField type="number" label="X" value={gcp.x || ""} onChange={(e) => _onChange("x", e.target.value)} />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField type="number" label="Y" value={gcp.y || ""} onChange={(e) => _onChange("y", e.target.value)} />
                        </Grid>
                        <Grid item xs={6}>
                            {LocationInput("x_dms", gcp, updateDMS)}
                        </Grid>
                        <Grid item xs={6}>
                            {LocationInput("y_dms", gcp, updateDMS)}

                        </Grid>
                        <Grid item xs={12}>
                            <Autocomplete
                                className="autoComplete"
                                disablePortal
                                id="combo-box-demo"
                                options={epsg_data.codes}
                                value={gcp.crs}
                                renderInput={(params) => <TextField {...params} label="EPSG Code" />}
                                onInputChange={(_, val_) => _onChange("crs", val_)}
                            />
                        </Grid>
                    </Grid>
                </form>
                <Button color="error" onClick={() => deleteGCP(gcp)}> Delete </Button>
            </CardContent>
        </Card>
    );
}

export default MapPage;


function LocationInput(input_label, gcp, updateDMS) {
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

    function updateValue(value, type) {
        if (type == "degree") updateDMS(input_label, value + "° " + minute + "' " + second + '"')
        if (type == "minute") updateDMS(input_label, degree + "° " + value + "' " + second + '"')
        if (type == "second") updateDMS(input_label, degree + "° " + minute + "' " + value + '"')
    }

    return (
        // <div className="dmsContainer" >
        <Grid style={{ border: "1px" }}>
            <Box sx={{ border: 1, color: "#9e9e9e", borderRadius: "5px", padding: "4px" }}>

                <Grid item >
                    <label style={{ fontSize: "12px", paddingLeft: 15 }}>{input_label.split("_")[0].toUpperCase()} DMS </label>
                </Grid>
                <Grid container direction="row"
                    justifyContent="center"
                    alignItems="center">
                    <Grid item style={{ minWidth: "30px", maxWidth: "30px", padding: "0px", margin: "0px" }}>
                        <TextField
                            value={degree}
                            onChange={(e) => {
                                setDegree(e.target.value)
                            }}
                            onBlur={() => {
                                updateValue(degree, 'degree')
                            }}
                            variant="standard"
                            InputLabelProps={{
                                notched: false
                            }}
                            maxLength={2}
                            size="small"
                            style={{ minWidth: "30px", maxWidth: "30px", padding: "0px", margin: "0px" }}
                        />
                    </Grid>
                    <Grid item>
                        <Typography variant="h6" style={{ marginBottom: 6, paddingRight: "12px" }} >°</Typography>
                    </Grid>
                    <Grid item style={{ minWidth: "30px", maxWidth: "30px", padding: "0px", margin: "0px" }}>
                        <TextField
                            value={minute}
                            onChange={(e) => {
                                setMinute(e.target.value)
                            }}
                            onBlur={() => {
                                updateValue(minute, 'minute')
                            }}
                            variant="standard"
                            InputLabelProps={{
                                notched: false
                            }}
                            maxLength={2}
                            size="small"
                            style={{ maxWidth: "30px", minWidth: "30px", padding: "0px", margin: "0px" }}
                        />
                    </Grid>
                    <Grid item>
                        <Typography variant="h6" style={{ marginBottom: 6, paddingRight: "12px" }}>′</Typography>
                    </Grid>
                    <Grid item style={{ maxWidth: "50px", minWidth: "50px", padding: "0px", margin: "0px" }}
                    >
                        <TextField
                            value={second}
                            onChange={(e) => {
                                setSecond(e.target.value)
                            }}
                            onBlur={() => { updateValue(second, 'second') }}
                            variant="standard"
                            InputLabelProps={{
                                notched: false
                            }}
                            maxLength={4}
                            size="small"
                            style={{ maxWidth: "50px", minWidth: "50px", padding: "0px", margin: "0px" }}
                        />
                    </Grid>
                    <Grid item>
                        <Typography variant="h6" style={{ marginBottom: 6 }}>″</Typography>
                    </Grid>
                </Grid>
            </Box>
        </Grid>
    );
}