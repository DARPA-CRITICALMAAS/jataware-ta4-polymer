// mapExtraction.tsx

import React, { useEffect, useRef, useState } from 'react';

import Map from 'ol/Map';
import CircularProgress from '@mui/material/CircularProgress';

import TileLayer from 'ol/layer/WebGLTile';
import { Vector as VectorLayer } from 'ol/layer';
import GeoTIFF from 'ol/source/GeoTIFF';
import { Vector as VectorSource } from 'ol/source';
import GeoJSON from 'ol/format/GeoJSON';
import Draw, { createBox } from 'ol/interaction/Draw'
import CropSquareIcon from '@mui/icons-material/CropSquare';
import { Fill, Stroke, Style } from 'ol/style';
import { useNavigate } from "react-router-dom";
import FormControlLabel from '@mui/material/FormControlLabel';
import { FormGroup } from '@mui/material';

import axios from 'axios';

import { Button, Checkbox } from '@mui/material';
import { Card, CardContent, TextField, Typography, Box } from '@mui/material';

import "../css/legendAnnotations.css";
import { getLayerById, expand_resolutions, returnImageUrl, oneMap, provenance_mapper, createPath, getColorForProvenance } from "./helpers"
import { useParams } from "react-router-dom";
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import { asString } from 'ol/color';
import UndoIcon from '@mui/icons-material/Undo';
import ClearIcon from '@mui/icons-material/Clear';
import FormatShapesIcon from '@mui/icons-material/FormatShapes';// Params
import CloseIcon from '@mui/icons-material/Close';
import LegendCard from "./swatchCards"
import LegendCardSuccess from './legendCardSuccess'
import ColorLensIcon from '@mui/icons-material/ColorLens';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import FormatAlignJustifyIcon from '@mui/icons-material/FormatAlignJustify';

import InterestsIcon from '@mui/icons-material/Interests';

const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX
const SYSTEM = import.meta.env.VITE_POLYMER_SYSTEM
const SYSTEM_VERSION = import.meta.env.VITE_POLYMER_SYSTEM_VERSION

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    'Content-Type': 'application/json',
}


function SwatchAnnotationPage() {
    const { cog_id } = useParams();

    const [loading, setLoading] = useState(false)
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [map, setMap] = useState<Map | undefined>()
    const navigate = useNavigate();
    const drawRef = useRef()
    const drawTypeRef = useRef("box")
    const mapRef = useRef()

    const [legendProvenances, setlegendProvenances] = useState([])
    const [provenanceOption, setProvenanceOption] = useState([])

    const [legendItems, setLegendItems] = useState([])
    const [filteredLegendItems, setFilteredLegendItems] = useState([])

    const [succeededLegendItem, setSucceededLegendItems] = useState([])
    const [geologicAges, setGeologicAges] = useState([])


    let legendAreaColor = "#AAFF00"
    let draw;
    const steps = [
        'Edit or Create Legend Swatchs',
        'USGS Review'
    ];
    const activeStepRef = useRef(0);
    const [activeStep, setActiveStep] = React.useState(0);
    const [provenanceVisable, setProvenanceVisable] = React.useState(true)
    const [completed, setCompleted] = React.useState<{
        [k: number]: boolean;
    }>({});

    const totalSteps = () => {
        return steps.length;
    };

    const completedSteps = () => {
        return Object.keys(completed).length;
    };

    const isLastStep = () => {
        return activeStep === totalSteps() - 1;
    };

    const allStepsCompleted = () => {
        return completedSteps() === totalSteps()
    };

    const handleNext = () => {
        const newActiveStep =
            isLastStep() && !allStepsCompleted()
                ? // It's the last step, but not all steps have been completed,
                // find the first step that has been completed
                steps.findIndex((step, i) => !(i in completed))
                : activeStep + 1;
        activeStepRef.current = newActiveStep
        setActiveStep(newActiveStep);
    };

    const handleBack = () => {
        activeStepRef.current = activeStepRef.current - 1
        setActiveStep((prevActiveStep) => prevActiveStep - 1);
        handleResetStep()
    };

    const handleProvenanceChange = (option, checked) => {
        // const option = event.target.name;
        let newOptions = [...provenanceOption];

        if (checked) {
            // Add the checked option
            newOptions.push(option);
        } else {
            // Remove the unchecked option
            newOptions = newOptions.filter(item => item !== option);
        }

        const filteredSwatches = legendItems.filter((item) => newOptions.includes(item.system + "_" + item.system_version));
        setFilteredLegendItems(filteredSwatches)
        add_features_to_map(filteredSwatches)
        setProvenanceOption(newOptions);
    };


    const handleComplete = () => {
        if (activeStep === 0) {

            add_succeeded_features_to_map(succeededLegendItem)

        } else if (activeStep === 1) {
            let all_validated = true
            let items_ = []
            for (let item of succeededLegendItem) {
                item['minimized'] = false

                if (item['status'] !== 'validated') {
                    all_validated = false

                }
                items_.push(item)
            }

            if (all_validated) {
                for (let item of succeededLegendItem) {
                    sendSwatchUpdates({ 'cog_id': cog_id, "legend_swatch": item })
                }

            } else {
                alert("Please validate every item before finishing")
            }
            setSucceededLegendItems(items_)

        }
        const newCompleted = completed;
        newCompleted[activeStep] = true;
        setCompleted(newCompleted);
        sendUSGSValidatedResults()
        handleNext();
    };



    async function sendUSGSValidatedResults() {
        try {

            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'post',
                url: "/api/map/send_to_cdr?cog_id=" + cog_id,
                headers: _APP_JSON_HEADER
            });

        } catch (error) {
            console.error('Error making the request:', error);
        }

    }
    async function sendSwatchUpdates(data_) {
        try {
            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'post',
                url: "/api/map/save_legend_swatch",
                data: data_,
                headers: _APP_JSON_HEADER
            });

        } catch (error) {
            console.error('Error making the request:', error);
        }
    }



    const handleReset = () => {
        setActiveStep(0);
        activeStepRef.current = 0
        setCompleted({});
    };

    // ----------------- LAYERS -----------------
    // VECTOR layer

    let placeholder = {
        'type': 'FeatureCollection',
        'features': []
    }

    const swatch_source = new VectorSource({
        features: new GeoJSON().readFeatures(placeholder)
    });


    const swatch_layer = new VectorLayer({
        id: "swatch-layer",
        source: swatch_source,
        style: new Style({
            stroke: new Stroke({
                width: 1,
                color: "blue",
            }),
            fill: new Fill({
                color: 'rgba(0, 0, 0, 0)',
            }),
        })

    });

    const swatch_finished_source = new VectorSource({
        features: new GeoJSON().readFeatures(placeholder)
    });


    const swatch_finished_layer = new VectorLayer({
        id: "swatch-finished-layer",
        source: swatch_finished_source,
        style: (feature) => {
            let color = 'red';
            const status = feature.get('status');
            if (status === 'succeeded' || status === 'validated') {
                color = 'green';
            }
            return new Style({
                stroke: new Stroke({
                    width: 1,
                    color: color,
                }),
                fill: new Fill({
                    color: 'rgba(0, 0, 0, 0)',
                }),
            });
        }
    });

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
        id: "map-layer",
        source: map_source,
    })

    // ocr vector layer
    const ocr_source = new VectorSource({ wrapX: false });
    const ocr_vector = new VectorLayer({
        id: "bounding-box",
        source: ocr_source,
    });

    function addLegendItemToMap(feature) {
        let swatch_layer_source = getLayerById(mapRef.current, "swatch-layer").getSource()

        swatch_layer_source.addFeature(feature)
        getLayerById(mapRef.current, "bounding-box").getSource().clear()
    }

    function changeDraw() {
        mapRef.current.removeInteraction(drawRef.current);
        let draw_
        let ocr_source = getLayerById(mapRef.current, "bounding-box").getSource()
        if (drawTypeRef.current == "box") {
            draw_ = new Draw({
                source: ocr_source,
                type: "Circle",
                geometryFunction: createBox(),

            });

        } else if (drawTypeRef.current == "poly") {

            draw_ = new Draw({
                source: ocr_source,
                type: 'Polygon',
            });
        }

        draw_.on('drawend', function (event) {
            var feature = event.feature;
            let extent = feature.getGeometry().extent_
            let coords = feature.getGeometry().getCoordinates()
            console.log("extent from bottom")
            console.log(extent)
            console.log("coords from bottom")
            console.log(coords)
            if (activeStepRef.current === 0) {

                addLegendItemToMap(feature)
            }
        });
        draw_.setActive(true)
        mapRef.current.addInteraction(draw_);

        drawRef.current = draw_;
    }

    function add_succeeded_features_to_map(succeededLegendItems) {
        // clear swatches on the page
        let swatch_finished_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
        swatch_finished_source.clear()
        for (let swatch of succeededLegendItems) {

            let swatch_feature = new GeoJSON().readFeature({
                type: 'Feature',
                geometry: swatch['coordinates_from_bottom'],
                properties: {
                    legend_id: swatch['legend_id'],
                    status: swatch['status']
                }
            });
            swatch_finished_source.addFeature(swatch_feature)
            if (swatch.label_coordinates_from_bottom != null) {
                if (swatch.label_coordinates_from_bottom['coordinates'] != null) {

                    if (swatch.label_coordinates_from_bottom['coordinates'] != null) {
                        let swatch_label_feature = new GeoJSON().readFeature({
                            type: 'Feature',
                            geometry: swatch['label_coordinates_from_bottom'],
                            properties: {
                                legend_id: swatch['legend_id'],
                                status: swatch['status']
                            }
                        });
                        swatch_label_feature.set('legend_id', swatch_label_feature['legend_id'])
                        swatch_label_feature.set('parent_id', swatch['legend_id'])
                        swatch_finished_source.addFeature(swatch_label_feature)
                    }

                }
            }

            for (let description of swatch['descriptions']) {

                let desc_feature = new GeoJSON().readFeature({
                    type: 'Feature',
                    geometry: description['coordinates_from_bottom'],
                    properties: {
                        legend_id: swatch['legend_id'],
                        status: swatch['status']
                    }
                });

                desc_feature.set('legend_id', desc_feature['legend_id'])
                desc_feature.set('parent_id', swatch['legend_id'])
                swatch_finished_source.addFeature(desc_feature)
            }
        }

    }



    function add_features_to_map(filteredSwatches) {
        // clear swatches on the page
        let swatch_finished_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()

        for (let x of swatch_finished_source.getFeatures()) {
            if (x.get('status') != "succeeded" && x.get("status") != "validated") {
                swatch_finished_source.removeFeature(x)
            }
        }

        for (let swatch of filteredSwatches) {
            if (swatch.status != "removed") {
                let swatch_feature = new GeoJSON().readFeature({
                    type: 'Feature',
                    geometry: swatch['coordinates_from_bottom'],
                    properties: {
                        legend_id: swatch['legend_id']
                    }
                });
                swatch_finished_source.addFeature(swatch_feature)
                if (swatch.label_coordinates_from_bottom != null) {
                    if (swatch.label_coordinates_from_bottom['coordinates'] != null) {

                        if (swatch.label_coordinates_from_bottom['coordinates'] != null) {
                            let swatch_label_feature = new GeoJSON().readFeature({
                                type: 'Feature',
                                geometry: swatch['label_coordinates_from_bottom'],
                                properties: {
                                    legend_id: swatch['legend_id'],
                                    status: swatch['status']
                                }
                            });
                            swatch_label_feature.set('legend_id', swatch_label_feature['legend_id'])
                            swatch_label_feature.set('parent_id', swatch['legend_id'])
                            swatch_finished_source.addFeature(swatch_label_feature)
                        }

                    }
                }

                for (let description of swatch['descriptions']) {

                    let desc_feature = new GeoJSON().readFeature({
                        type: 'Feature',
                        geometry: description['coordinates_from_bottom']
                    });

                    desc_feature.set('legend_id', desc_feature['legend_id'])
                    desc_feature.set('parent_id', swatch['legend_id'])
                    swatch_finished_source.addFeature(desc_feature)
                }
            }

        }

    }

    function setData() {
        axios({
            method: 'GET',
            url: "/api/map/macrostrat/map_units",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            console.log(response.data)
            setGeologicAges(response.data['map_units'])

        })

        //  get provenance
        axios({
            method: 'GET',
            url: "/api/map/" + cog_id + "/load_cdr_legend_px_extractions",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            axios({
                method: 'GET',
                url: "/api/map/" + cog_id + "/px_extraction_systems",
                headers: _APP_JSON_HEADER
            }).then((response) => {
                if (response.data) {
                    response.data.push(SYSTEM + "_" + SYSTEM_VERSION)
                    setlegendProvenances(response.data)
                }
            })


            axios({
                method: 'GET',
                url: "/api/map/" + cog_id + "/px_extractions",
                headers: _APP_JSON_HEADER
            }).then((response) => {

                if (response.data['legend_swatches'].length > 0) {
                    let successItems = []
                    let createdItems = []
                    for (let swatch of response.data['legend_swatches']) {
                        if (swatch.status == "validated" || swatch.status == "succeeded") {
                            successItems.push(swatch)
                        }
                        if (swatch.status == "created") {
                            swatch['minimized'] = true
                            createdItems.push(swatch)
                        }
                        setSucceededLegendItems(successItems)
                        setLegendItems(createdItems)
                        add_succeeded_features_to_map(successItems)

                    }
                }
            })
        })


    }

    // Render map
    useEffect(() => {


        document.title = "Polymer Georeferencer Legend Swatch Extractions - " + cog_id;

        setData()

        const _map = new Map({
            controls: [],
            layers: [map_layer, swatch_layer, swatch_finished_layer, ocr_vector],
            view: map_source.getView().then((v) => {
                v.resolutions = expand_resolutions(v, 1, 7);
                v.extent = undefined;
                return v;
            })
        });
        _map.setTarget(mapTargetElement.current || "");

        _map.getViewport().addEventListener('contextmenu', function (evt) {
            evt.preventDefault();
            mapRef.current.removeInteraction(drawRef.current);
            changeDraw()
        })
        mapRef.current = _map
        draw = new Draw({
            source: ocr_source,
            type: "Circle",
            geometryFunction: createBox(),

        });
        draw.setActive(true)
        draw.on('drawend', function (event) {
            // The drawn feature is available as event.feature
            var feature = event.feature;
            let extent = feature.getGeometry().extent_
            let coords = feature.getGeometry().getCoordinates()
            console.log("extent from bottom")
            console.log(extent)
            console.log("coords from bottom")
            console.log(coords)
            if (activeStepRef.current === 0) {
                addLegendItemToMap(feature)
            } else if (activeStepRef.current === 1) {
                console.log('active step 1')
            }
        });
        drawRef.current = draw
        _map.addInteraction(draw);
        setMap(_map);

        return () => _map.setTarget("")
    }, [cog_id])


    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Enter') {
                const focusedElement = document.activeElement;
                if (focusedElement.tagName === 'BODY') {
                    if (activeStepRef.current === 0) {
                        processLegendSwatches()
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [filteredLegendItems]);


    function clearClippedPolygons() {
        getLayerById(mapRef.current, "bounding-box").getSource().clear()
        if (activeStep === 0) {
            getLayerById(mapRef.current, "swatch-layer").getSource().clear()
        }
    }

    function clearLastPolygon(map) {
        let layer = getLayerById(map, "bounding-box")
        let source = layer.getSource()
        let features = source.getFeatures()
        if (features.length > 0) {
            var lastFeature = features[features.length - 1];
            source.removeFeature(lastFeature);
        }
    }


    function handleResetStep() {
        const newCompleted = {
            ...completed
        };
        delete newCompleted[activeStepRef.current]
        setCompleted(newCompleted);
        setProvenanceOption([])
        setFilteredLegendItems([])
    }
    async function wrapRequest(swatch_feature) {
        try {
            if (swatch_feature != null) {
                const response = await axios({
                    method: 'post',
                    url: "/api/map/tif_ocr",
                    data: { "cog_id": cog_id, "bboxes": [swatch_feature.getGeometry().extent_] },
                    headers: _APP_JSON_HEADER
                });
                return [response.data['extracted_text'][0], { "type": "Polygon", "coordinates": swatch_feature.getGeometry().getCoordinates() }]
            }
            return ["", null]

        } catch (error) {
            console.error("Error in wrapRequest:", error);
            throw error; // Rethrow the error so it can be caught by the caller
        }
    }

    async function ocrLastClipArea() {
        getLayerById(mapRef.current, "bounding-box").getSource().clear();
        const swatch_source = getLayerById(mapRef.current, "swatch-layer").getSource();
        const features = swatch_source.getFeatures();
        if (features.length > 1) {
            alert("Please select only one polygon for processing.");
            return ["", null];
        } else {
            const swatch_feature = features[0];

            swatch_source.clear()

            return await wrapRequest(swatch_feature);
        }
    }


    function processLegendSwatches() {
        getLayerById(mapRef.current, "bounding-box").getSource().clear()
        let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
        let swatch_source = getLayerById(mapRef.current, "swatch-layer").getSource()
        let features = swatch_source.getFeatures()
        if (features.length < 1) {
            alert("Please select at least one polygons for processing.")
            return
        } else {
            let swatch_feature = features[0]

            let label_feature = features[1]
            let label_feature_coords = null
            if (label_feature != null) {
                label_feature_coords = label_feature.getGeometry().getCoordinates()
            }
            let bboxes = []

            for (let feat of features) {

                bboxes.push(feat.getGeometry().extent_)
            }
            swatch_source.clear()
            axios({
                method: 'post',
                url: "/api/map/tif_ocr",
                data: { "cog_id": cog_id, "bboxes": bboxes },
                headers: _APP_JSON_HEADER
            }).then((response) => {

                let swatch_geom = swatch_feature.getGeometry()
                let swatch_feature_id = cog_id + asString(swatch_geom.extent_) + response.data['extracted_text'][0]
                // save swatch 
                let newLegendSwatch = {
                    "cog_id": cog_id,
                    "legend_id": swatch_feature_id,
                    "descriptions": [],
                    "image_url": returnImageUrl(cog_id, swatch_geom.extent_),
                    "extent_from_bottom": swatch_geom.extent_,
                    "coordinates_from_bottom": { "type": "Polygon", "coordinates": swatch_geom.getCoordinates() },
                    "abbreviation": response.data['extracted_text'][0] ?? "",
                    "label": response.data['extracted_text'][1] ?? "",
                    "label_coordinates_from_bottom": { "type": "Polygon", "coordinates": label_feature_coords },
                    "model": null,
                    "model_version": null,
                    "system": SYSTEM,
                    "system_version": SYSTEM_VERSION,
                    "provenance": SYSTEM + "_" + SYSTEM_VERSION,
                    "category": 'polygon',
                    "confidence": null,
                    "status": "created",
                    "notes": "",
                    "color": "",
                    "pattern": "",
                    "minimized": false,
                    "age_text": ""
                }
                swatch_feature.set('legend_id', swatch_feature_id)
                finished_swatch_source.addFeature(swatch_feature)
                if (label_feature != null) {
                    label_feature.set('legend_id', swatch_feature_id)
                    finished_swatch_source.addFeature(label_feature)
                }

                for (let [index, item] of features.slice(2).entries()) {
                    let item_geom = item.getGeometry()

                    let item_feature_id = cog_id + asString(item_geom.extent_) + response.data['extracted_text'][index + 1]
                    let newLegendItem = {
                        "cog_id": cog_id,
                        "legend_id": item_feature_id,
                        "image_url": returnImageUrl(cog_id, item_geom.extent_),
                        "extent_from_bottom": item_geom.extent_,
                        "coordinates_from_bottom": { "type": "Polygon", "coordinates": item_geom.getCoordinates() },
                        "text": response.data['extracted_text'][index + 2],
                        "model": null,
                        "model_version": null,
                        "system": SYSTEM,
                        "system_version": SYSTEM_VERSION,
                        "confidence": 1,
                        "notes": "",
                        "status": "created"
                    }
                    item.set('legend_id', item_feature_id)
                    item.set('parent_id', swatch_feature_id)
                    finished_swatch_source.addFeature(item)
                    newLegendSwatch['descriptions'].push(newLegendItem)
                }
                setLegendItems([...legendItems, newLegendSwatch])
                let newOptions = [...provenanceOption, SYSTEM + "_" + SYSTEM_VERSION];

                const filteredSwatches = [...filteredLegendItems, newLegendSwatch]
                setFilteredLegendItems(filteredSwatches);
                setProvenanceOption(newOptions)
            }).catch((error) => {
                console.error('Error fetching data:', error);
            });
        }
    }




    // function deleteLegendItem(id) {
    //     let items = []
    //     let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
    //     for (let feat_ of finished_swatch_source.getFeatures()) {

    //         if (feat_.get('legend_id') == id | feat_.get('parent_id') == id) {
    //             finished_swatch_source.removeFeature(feat_)
    //         }
    //     }

    //     for (let item of legendItems) {
    //         if (item.legend_id != id) {
    //             items.push(item)
    //         } else {
    //             axios({
    //                 method: 'delete',
    //                 url: "/api/map/delete_legend_extractions",
    //                 data: { "category": "legend_swatch", "id": id },
    //                 headers: _APP_JSON_HEADER
    //             }).then((response) => {
    //                 console.log(response)
    //             })
    //         }
    //     }

    //     setLegendItems(items)
    // }

    function changeDraw_(type) {
        if (type == "box") {
            drawTypeRef.current = "box"
        } else if (type == 'poly') {
            drawTypeRef.current = "poly"
        }
        changeDraw()
    }

    function setValidated(item, value) {
        let items_ = []
        for (let feature of succeededLegendItem) {
            if (item.legend_id === feature['legend_id']) {
                feature["status"] = value;
            }
            items_.push(feature)
        }
        setSucceededLegendItems([...items_])
    }

    function saveItem(item) {
        sendSwatchUpdates({ 'cog_id': cog_id, "legend_swatch": item })
        let successItems = [...succeededLegendItem, item]

        setSucceededLegendItems(successItems)
        const filteredSwatches = filteredLegendItems.filter((item_) => item_.legend_id != item.legend_id);
        console.log('filteredSwatches')
        console.log(filteredSwatches)
        setFilteredLegendItems(filteredSwatches)
        const legendItemsSwatches = legendItems.filter((item_) => item_.legend_id != item.legend_id);
        setLegendItems(legendItemsSwatches)
        add_succeeded_features_to_map(successItems)

    }
    function updateItem(item) {

        if (mapRef.current === undefined) return;

        let items_ = []
        for (let feature of legendItems) {
            if (item.legend_id === feature['legend_id']) {
                for (const [key, value] of Object.entries(item)) {
                    feature[key] = value;
                }
                if (item.status == "succeeded") {
                    console.log('clean')
                } else {
                    items_.push(feature)
                }

            } else {
                items_.push(feature)
            }


        }
        setLegendItems([...items_])

        if (item.status == "removed") {
            let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
            for (let feat_ of finished_swatch_source.getFeatures()) {
                if (feat_.get('legend_id') == item.legend_id || feat_.get('parent_id') == item.legend_id) {
                    finished_swatch_source.removeFeature(feat_)
                }
            }
        }
    }


    function downloadFeatures() {
        axios({
            method: 'GET',
            url: "/api/map/" + cog_id + "/legend_features_json",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            downloadBlob(response)
        })
    }

    function downloadBlob(response) {
        const data = response['data'];
        const jsonString = JSON.stringify(data);
        const blob = new Blob([jsonString], { type: 'application/json' }); // Adjust the type based on your data
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response['data']['download_file_name'];
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function zoomTo(item) {
        let extent = [item['extent_from_bottom'][0] - 50, item['extent_from_bottom'][1] - 100, item['extent_from_bottom'][2] + 200, item['extent_from_bottom'][3] + 100]
        item['minimized'] = false
        let items = []
        for (let i of filteredLegendItems) {
            if (i['legend_id'] == item.legend_id) {
                i['minimized'] = false

            }
            items.push(i)
        }
        setFilteredLegendItems(items)

        mapRef.current.getView().fit(extent, mapRef.current.getSize());
    }

    function removeSucceededItem(item) {
        item['status'] = "created"
        sendSwatchUpdates({ 'cog_id': cog_id, "legend_swatch": item })
        let successItems = succeededLegendItem.filter((item_) => item_.legend_id != item.legend_id);
        setSucceededLegendItems(successItems)
        let filteredSwatches
        if (provenanceOption.includes(item.system + "_" + item.system_version)) {
            item['minimized'] = true
            filteredSwatches = [...filteredLegendItems, item]
            setFilteredLegendItems(filteredSwatches)
        } else {
            item['minimized'] = true
            filteredSwatches = filteredLegendItems.filter((item_) => item_.legend_id != item.legend_id);
            setFilteredLegendItems(filteredSwatches)
        }
        add_succeeded_features_to_map(successItems)
        const legendItemsSwatches = [...legendItems, item]
        setLegendItems(legendItemsSwatches)

    }
    function removeItem(item) {
        let filteredItems = filteredLegendItems.filter((item_) => item_.legend_id != item.legend_id);
        setFilteredLegendItems(filteredItems)
        let legendItems_ = legendItems.filter((item_) => item_.legend_id != item.legend_id);
        setLegendItems(legendItems_)
        add_features_to_map(filteredItems)
    }

    return (
        <>
            {loading &&

                <div className="loading">
                    <CircularProgress />
                </div>
            }
            <Button onClick={(e) => navigate("/")}>Home</Button>
            <Box sx={{ width: '80%', margin: '10px', marginLeft: "70px" }}>
                <Stepper nonLinear activeStep={activeStep}>
                    {steps.map((label, index) => (

                        <Step key={label} completed={completed[index]}>
                            <StepLabel >
                                {label}
                                {index == 0 &&
                                    <CropSquareIcon style={{ color: legendAreaColor, marginBottom: "0px", marginLeft: "5px" }}></CropSquareIcon>
                                }
                                {index == 1 &&
                                    <CropSquareIcon style={{ color: "red", marginBottom: "0px", marginLeft: "5px" }}></CropSquareIcon>
                                }
                            </StepLabel>
                        </Step>
                    ))}
                </Stepper>
                <div>
                    {allStepsCompleted() ? (
                        <React.Fragment>
                            <Typography sx={{ mt: 2, mb: 1 }}>
                                All steps completed - you&apos;re finished
                            </Typography>
                            {/* <Button onClick={() => sendUSGSValidatedResults({ "cog_id": cog_id })}>Send validated extractions to CDR</Button> */}
                            <Button onClick={() => downloadFeatures()}>Download Swatch Feature Extractions</Button>
                            <Button
                                className="nextButton"
                                color="primary"
                                onClick={() => oneMap("georeferenced", navigate, createPath("swatchAnnotation", '..'))}
                            >
                                Next Map
                            </Button>

                        </React.Fragment>
                    ) : (
                        <React.Fragment>

                            <Box sx={{ display: 'flex', flexDirection: 'row', pt: 2 }}>

                                <Button
                                    color="inherit"
                                    disabled={activeStep === 0}
                                    onClick={handleBack}
                                    sx={{ mr: 1 }}
                                >
                                    Back
                                </Button>
                                <Box sx={{ flex: '1 1 auto' }} />
                                {/* {completedSteps() !== totalSteps() - 1 &&

                                    <Button onClick={handleNext} sx={{ mr: 1 }}>
                                        Next
                                    </Button>
                                } */}
                                {activeStep !== steps.length &&
                                    (completed[activeStep] ? (
                                        <Typography variant="caption" sx={{ display: 'inline-block' }}>
                                            Step {activeStep + 1} already completed
                                            <Button onClick={handleResetStep}>Reset Step</Button>

                                        </Typography>
                                    ) : (
                                        <Button onClick={handleComplete}>
                                            {completedSteps() === totalSteps() - 1
                                                ? 'Finish'
                                                : 'Review'}
                                        </Button>
                                    ))}
                            </Box>
                        </React.Fragment>
                    )}
                </div>
            </Box>
            <div className="flex-container" style={{ height: "92%" }}>

                <div className="control_panel" id="control-panel">
                    <Box sx={{ width: 200 }}>
                        <FormatShapesIcon
                            style={{ marginRight: "8px" }}
                            onClick={() => { changeDraw_("box") }}
                        />
                        <InterestsIcon
                            style={{ marginRight: "8px" }}
                            onClick={() => { changeDraw_("poly") }}
                        />
                        <UndoIcon
                            style={{ marginRight: "8px" }}
                            onClick={() => { clearLastPolygon(mapRef.current) }}
                        />
                        <ClearIcon
                            onClick={() => { clearClippedPolygons() }}
                        />
                        <FormatAlignJustifyIcon
                            onClick={() => { setProvenanceVisable(!provenanceVisable) }}
                        />
                        {(provenanceVisable) &&
                            <>
                                {(activeStep === 0) ?
                                    <>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            style={{ 'color': 'black', "borderColor": 'red', "fontWeight": "bold" }}
                                            onClick={() => processLegendSwatches()}>
                                            Extract Legend Item
                                        </Button>
                                    </>
                                    :
                                    <>

                                    </>
                                }
                                <Box sx={{ width: 200 }}>
                                    <br />
                                    {activeStep === 0 ?
                                        <>
                                            <h4 style={{ "padding": "0px", "margin": "4px" }}>Select System</h4>
                                            <FormGroup style={{ width: '200px' }}>

                                                {legendProvenances.map((option, index) => (
                                                    <FormControlLabel
                                                        key={option}
                                                        control={
                                                            <Checkbox
                                                                checked={provenanceOption.includes(option)}
                                                                onChange={(e) => { handleProvenanceChange(e.target.name, e.target.checked) }}
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
                                        </>
                                        :
                                        <>
                                        </>
                                    }
                                </Box >
                            </>
                        }

                    </Box>
                </div >

                <div className="flexChild">
                    <div
                        ref={mapTargetElement}
                        className="map"
                        style={{
                            width: "100%",
                            height: "100%",
                            position: "relative",
                        }} />
                </div >
                <div key={"scroll" + cog_id} className="flexChild scrollableContent">
                    <div className="left-panel">


                        {activeStep === 0 &&
                            <>
                                <div style={{ background: '#E8E8E8', borderRadius: "10px", padding: "10px" }}>

                                    <div>
                                        <p>
                                            Select the legend swatch first containing the abbreviation
                                            then select the bounding box for the label/title. All additional
                                            boxes will be used for description for processing.
                                        </p>

                                    </div>

                                </div >
                            </>
                        }

                        <>
                            <div>

                                {activeStep == 0 &&
                                    <>
                                        <div className='right-container' style={{ "display": "grid", "gridTemplateColumns": "1fr 1fr" }}>
                                            <div className='left_column' >
                                                <h3>
                                                    Raw Legend Items
                                                </h3>
                                                {
                                                    filteredLegendItems.map((item, i) => {
                                                        return <div style={{ "margin": "10px" }} key={item.legend_id}>
                                                            <LegendCard
                                                                cog_id={cog_id}
                                                                item={item}
                                                                updateItem={updateItem}
                                                                saveItem={saveItem}
                                                                removeItem={removeItem}
                                                                zoomTo={zoomTo}
                                                                ocrLastClipArea={ocrLastClipArea}
                                                                geologicAges={geologicAges}
                                                            >
                                                            </LegendCard>

                                                        </div>
                                                    })
                                                }

                                            </div>
                                            <div>
                                                <h3>
                                                    Saved Legend Items
                                                </h3>
                                                {
                                                    succeededLegendItem.map((item, i) => {
                                                        return <div style={{ "margin": "10px" }} key={i}>
                                                            <Card style={{ width: "100%", borderRadius: "10px" }}>

                                                                <div style={{ "display": "grid", "gridTemplateColumns": "1fr 1fr" }}>
                                                                    <div>
                                                                        <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>
                                                                        <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                                                        <div><b>Abbreviation:</b> {item.abbreviation}</div>
                                                                    </div>
                                                                    <div style={{ 'justifySelf': "end" }}>
                                                                        <img src={returnImageUrl(cog_id, item.extent_from_bottom)} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />

                                                                    </div>
                                                                    <div
                                                                        title={item.descriptions.map(desc => desc.text).join(' ')}
                                                                        style={{
                                                                            "whiteSpace": "nowrap",
                                                                            "overflow": "hidden",
                                                                            "textOverflow": "ellipsis",
                                                                            "maxWidth": "250px",
                                                                            "maxHeight": "250px"
                                                                        }}>
                                                                        <b>Description:</b> {item.descriptions.map(desc => desc.text).join(' ')}
                                                                    </div>
                                                                    <div style={{ "display": "flex" }}>
                                                                        <Button onClick={() => { removeSucceededItem(item) }}>Remove</Button>
                                                                        <Button onClick={() => { zoomTo(item) }}>Zoom To</Button>
                                                                    </div>

                                                                </div>
                                                            </Card>
                                                        </div>
                                                    })
                                                }
                                            </div>

                                        </div>



                                    </>
                                }
                                {activeStep == 1 &&
                                    <>
                                        <h3>Validate Items</h3>

                                        {
                                            succeededLegendItem.map((item, i) => {
                                                return <div key={i}>
                                                    <div className="container_card">
                                                        <LegendCardSuccess
                                                            cog_id={cog_id}
                                                            item={item}
                                                            zoomTo={zoomTo}
                                                            setValidated={setValidated}
                                                        >
                                                        </LegendCardSuccess>

                                                    </div>
                                                </div>
                                            })
                                        }


                                    </>
                                }



                            </div>
                        </>




                    </div >
                </div>
            </div >
        </>
    )
}



export default SwatchAnnotationPage;
