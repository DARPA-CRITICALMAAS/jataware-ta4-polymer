// mapExtraction.tsx

import React, { useEffect, useRef, useState } from 'react';

import Map from 'ol/Map.js';
import CircularProgress from '@mui/material/CircularProgress';

import TileLayer from 'ol/layer/WebGLTile.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import { Vector as VectorSource } from 'ol/source.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Draw, { createBox } from 'ol/interaction/Draw'
import CropSquareIcon from '@mui/icons-material/CropSquare';
import { Fill, Stroke, Style } from 'ol/style.js';
import { useNavigate } from "react-router-dom";
import FormControlLabel from '@mui/material/FormControlLabel';

import axios from 'axios';

import { Button, Checkbox } from '@mui/material';
import { Card, CardContent, TextField, Typography, Box } from '@mui/material';

import "../css/legendAnnotations.css";
import { getLayerById, expand_resolutions, returnImageUrl, oneMap, createPath } from "./helpers"
import { useParams } from "react-router-dom";
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import { asString } from 'ol/color';
import UndoIcon from '@mui/icons-material/Undo';
import ClearIcon from '@mui/icons-material/Clear';
import FormatShapesIcon from '@mui/icons-material/FormatShapes';// Params
import InterestsIcon from '@mui/icons-material/Interests';

const TIFF_URL = import.meta.env.VITE_TIFF_URL;

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    'Content-Type': 'application/json',
}


function LegendAnnotationPage() {
    const { map_id } = useParams();

    const [loading, setLoading] = useState(false)
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [map, setMap] = useState<Map | undefined>()
    const navigate = useNavigate();
    const drawRef = useRef()
    const drawTypeRef = useRef("box")
    const mapRef = useRef()
    const [legendItems, setLegendItems] = useState([])
    const legendItemsRef = useRef([])
    const [legendAreas, setLegendAreas] = useState([])
    const legendAreasRef = useRef([])
    const imageMetaRef = useRef()
    let legendAreaColor = "#AAFF00"
    let draw;
    const steps = [
        'Select Legend Area',
        'Select Legend Items',
        'USGS Review'
    ];
    const activeStepRef = useRef(0);
    const [activeStep, setActiveStep] = React.useState(0);
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

    const handleComplete = () => {
        if (activeStep === 0) {
            let features = getLayerById(mapRef.current, "legend-area-layer").getSource().getFeatures()
            if (features.length < 1) {
                alert("Warning, Continuing Without Legend Area Processed.")
            }
            let areas = []
            for (let area of legendAreas) {
                if (area["status"] == "created") area['status'] = "succeeded"
                areas.push(area)
                sendUpdates({ 'map_id': map_id, "features": [area] })
            }
            setLegendAreas(areas)

        } else if (activeStep === 1) {
            let items_ = []
            for (let item of legendItems) {
                item['minimized'] = false
                items_.push(item)
                if (item['status'] == 'created') item['status'] = "succeeded"
                for (let desc of item['descriptions']) {
                    if (desc['status'] == 'created') desc['status'] = "succeeded"
                    sendUpdates({ 'map_id': map_id, "features": [desc] })
                }
                sendUpdates({ 'map_id': map_id, "features": [item] })
            }
            setLegendItems(items_)
        } else if (activeStep === 2) {
            let all_validated = true
            let items_ = []
            for (let item of legendItems) {
                item['minimized'] = false

                if (item['status'] !== 'validated') {
                    all_validated = false
                    for (let desc of item['descriptions']) {
                        desc['status'] = "succeeded"
                    }
                } else {
                    for (let desc of item['descriptions']) {
                        if (desc['status'] !== 'validated') desc['status'] = "validated"
                    }
                }
                items_.push(item)
            }
            for (let area of legendAreas) {
                if (area['status'] !== 'validated') {
                    all_validated = false
                }
            }
            if (all_validated) {
                for (let item of legendItems) {
                    for (let desc of item['descriptions']) {
                        sendUpdates({ 'map_id': map_id, "features": [desc] })
                    }
                    sendUpdates({ 'map_id': map_id, "features": [item] })
                }
                for (let area of legendAreas) {
                    sendUpdates({ 'map_id': map_id, "features": [area] })
                }
            } else {
                alert("Please validate every item before finishing")
                setLegendItems(items_)
                legendItemsRef.current = items_
                return
            }
            setLegendItems(items_)
            legendItemsRef.current = items_
        }
        const newCompleted = completed;
        newCompleted[activeStep] = true;
        setCompleted(newCompleted);
        handleNext();
    };

    // // For in case we want to get ocr on legend area
    // async function wraprequest(bboxes) {
    //     let result = await sendOCRRequest(bboxes)
    //     return result
    // }

    // async function sendOCRRequest(bboxes) {
    //     try {
    //         // Perform the Axios post request using async/await
    //         const response = await axios({
    //             method: 'post',
    //             url: "/api/map/tif_ocr",
    //             data: { "map_id": map_id, "bboxes": bboxes },
    //             headers: _APP_JSON_HEADER
    //         });

    //         return response.data['extracted_text']

    //     } catch (error) {
    //         console.error('Error making the request:', error);
    //     }
    // }

    async function sendUpdates(data_) {
        try {
            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'post',
                url: "/api/map/save_features",
                data: data_,
                headers: _APP_JSON_HEADER
            });

        } catch (error) {
            console.error('Error making the request:', error);
        }
    }


    async function processLegendArea(mapRef, legendAreasRef) {

        if (activeStep === 0) {
            let vector_layer_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
            let features = getLayerById(mapRef.current, "bounding-box").getSource().getFeatures()
            let bboxes = []
            for (let feat of features) {
                bboxes.push(feat.getGeometry().extent_)
                feat.set('feature_id', map_id + asString(feat.getGeometry().extent_))
                vector_layer_source.addFeature(feat)
            }
            // // If we want ocr on legend area
            // let extracted_text = await wraprequest(bboxes)

            let legend_areas = [...legendAreasRef.current]

            for (let [index, feat] of features.entries()) {

                let area_geom = feat.getGeometry()
                let newLegendArea = {
                    "map_id": map_id,
                    "parent_id": null,
                    "feature_id": map_id + asString(area_geom.extent_),
                    "reference_id": null,
                    "image_url": returnImageUrl(map_id, area_geom.extent_),
                    "extent_from_bottom": area_geom.extent_,
                    "points_from_top": [
                        [area_geom.extent_[0], imageMetaRef.current['height'] - area_geom.extent_[1]],
                        [area_geom.extent_[2], imageMetaRef.current['height'] - area_geom.extent_[3]]],
                    "geom_pixel_from_bottom": { "type": "Polygon", "coordinates": area_geom.getCoordinates() },
                    "text": "",
                    "provenance": "manual",
                    "model": null,
                    "model_version": null,
                    "category": "legend_area",
                    "confidence": null,
                    "notes": "",
                    "status": "created"
                }
                legend_areas.push(newLegendArea)
            }
            setLegendAreas(legend_areas)
            legendAreasRef.current = legend_areas
            getLayerById(mapRef.current, "bounding-box").getSource().clear()
            // 
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
    const legend_area_source = new VectorSource({
        features: new GeoJSON().readFeatures(placeholder)
    });


    const legend_area_layer = new VectorLayer({
        id: "legend-area-layer",
        source: legend_area_source,
        style: new Style({
            stroke: new Stroke({
                width: 2,
                color: legendAreaColor,
            }),
            fill: new Fill({
                color: 'rgba(0, 0, 0, 0)',
            }),
        })

    });

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
        style: new Style({
            stroke: new Stroke({
                width: 1,
                color: "red",
            }),
            fill: new Fill({
                color: 'rgba(0, 0, 0, 0)',
            }),
        })

    });
    // MAP layer

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${TIFF_URL}/cogs/${map_id}/${map_id}.cog.tif`,
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
            if (activeStepRef.current === 1) {
                addLegendItemToMap(feature)
            }
        });
        draw_.setActive(true)
        mapRef.current.addInteraction(draw_);

        drawRef.current = draw_;
    }

    function setData() {
        axios({
            method: 'GET',
            url: "/api/map/" + map_id + "/legend_features",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            if (response.data['legend_areas'].length > 0) {
                let area_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
                for (let area of response.data['legend_areas']) {
                    let area_feature = new GeoJSON().readFeature({
                        type: 'Feature',
                        geometry: area['geom_pixel_from_bottom'],
                        properties: {
                            feature_id: area['feature_id']
                        }
                    });
                    area_source.addFeature(area_feature)
                }
                setLegendAreas(response.data['legend_areas'])
                legendAreasRef.current = response.data['legend_areas']
            }
            if (response.data['legend_swatches'].length > 0) {
                // imageMetaRef.current = response.data['map_info']
                let swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
                for (let swatch of response.data['legend_swatches']) {
                    let swatch_feature = new GeoJSON().readFeature({
                        type: 'Feature',
                        geometry: swatch['geom_pixel_from_bottom'],
                        properties: {
                            feature_id: swatch['feature_id']
                        }
                    });
                    swatch_source.addFeature(swatch_feature)
                    for (let description of swatch['descriptions']) {
                        let desc_feature = new GeoJSON().readFeature({
                            type: 'Feature',
                            geometry: description['geom_pixel_from_bottom']

                        });
                        desc_feature.set('parent_id', description['parent_id'])
                        desc_feature.set('feature_id', description['feature_id'])
                        swatch_source.addFeature(desc_feature)
                    }
                }
                setLegendItems(response.data['legend_swatches'])
                legendItemsRef.current = response.data['legend_swatches']
            }
        })
    }

    // Render map
    useEffect(() => {


        document.title = "Polymer Georeferencer Extractions - " + map_id;

        axios({
            method: 'GET',
            url: "/api/map/" + map_id + "/meta",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            imageMetaRef.current = response.data['map_info']
        })

        setData()

        const _map = new Map({
            controls: [],
            layers: [map_layer, legend_area_layer, swatch_layer, swatch_finished_layer, ocr_vector],
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
            if (activeStepRef.current === 0) {

            } else if (activeStepRef.current === 1) {
                addLegendItemToMap(feature)
            }
        });
        drawRef.current = draw
        _map.addInteraction(draw);
        setMap(_map);

        return () => _map.setTarget("")
    }, [map_id])


    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Enter') {

                const focusedElement = document.activeElement;
                if (focusedElement.tagName === 'BODY') {
                    if (activeStepRef.current === 0) {
                        try {
                            let features = getLayerById(mapRef.current, "bounding-box").getSource().getFeatures()

                            if (features.length > 0) {
                                processLegendArea(mapRef, legendAreasRef)
                                getLayerById(mapRef.current, "bounding-box").getSource().clear()
                            }
                        } catch {
                            console.log('error')
                        }

                    } else if (activeStepRef.current === 1) {
                        processLegendItems(legendItemsRef)
                    }

                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);


    function clearClippedPolygons(map) {
        getLayerById(mapRef.current, "bounding-box").getSource().clear()
        if (activeStep === 0) {
            getLayerById(mapRef.current, "legend-area-layer").getSource().clear()
        } else if (activeStep === 1) {

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
    }


    function processLegendItems(legendItemsRef) {
        getLayerById(mapRef.current, "bounding-box").getSource().clear()
        let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
        let swatch_source = getLayerById(mapRef.current, "swatch-layer").getSource()
        let features = swatch_source.getFeatures()
        if (features.length < 1) {
            alert("Please select at least one polygons for processing.")
            return
        } else {
            let swatch_feature = features[0]
            let bboxes = []
            for (let feat of features) {
                // feat.set('parent_id', map_id + asString(swatch_geom.extent_))
                // feat.set('feature_id', map_id + asString(feat.getGeometry().extent_))
                // finished_swatch_source.addFeature(feat)
                bboxes.push(feat.getGeometry().extent_)
            }
            swatch_source.clear()
            axios({
                method: 'post',
                url: "/api/map/tif_ocr",
                data: { "map_id": map_id, "bboxes": bboxes },
                headers: _APP_JSON_HEADER
            }).then((response) => {

                let swatch_geom = swatch_feature.getGeometry()
                let swatch_feature_id = map_id + asString(swatch_geom.extent_) + response.data['extracted_text'][0]
                // save swatch 
                let newLegendSwatch = {
                    "map_id": map_id,
                    "parent_id": null,
                    "feature_id": swatch_feature_id,
                    "reference_id": null,
                    "image_url": returnImageUrl(map_id, swatch_geom.extent_),
                    "extent_from_bottom": swatch_geom.extent_,
                    "points_from_top": [
                        [swatch_geom.extent_[0], imageMetaRef.current['height'] - swatch_geom.extent_[1]],
                        [swatch_geom.extent_[2], imageMetaRef.current['height'] - swatch_geom.extent_[3]]],
                    "geom_pixel_from_bottom": { "type": "Polygon", "coordinates": swatch_geom.getCoordinates() },
                    "text": response.data['extracted_text'][0],
                    "provenance": "manual",
                    "model": null,
                    "model_version": null,
                    "category": 'legend_swatch',
                    "confidence": null,
                    "status": "created",
                    "notes": "",
                    "minimized": false,
                    "descriptions": []
                }
                swatch_feature.set('feature_id', swatch_feature_id)
                finished_swatch_source.addFeature(swatch_feature)
                sendUpdates({ "map_id": map_id, "features": [newLegendSwatch] })

                for (let [index, item] of features.slice(1).entries()) {
                    let item_geom = item.getGeometry()

                    let item_feature_id = map_id + asString(item_geom.extent_) + response.data['extracted_text'][index + 1]
                    let newLegendItem = {
                        "map_id": map_id,
                        "parent_id": swatch_feature_id,
                        "feature_id": item_feature_id,
                        "reference_id": null,
                        "image_url": returnImageUrl(map_id, item_geom.extent_),
                        "extent_from_bottom": item_geom.extent_,
                        "points_from_top": [
                            [item_geom.extent_[0], imageMetaRef.current['height'] - item_geom.extent_[1]],
                            [item_geom.extent_[2], imageMetaRef.current['height'] - item_geom.extent_[3]]],
                        "geom_pixel_from_bottom": { "type": "Polygon", "coordinates": item_geom.getCoordinates() },
                        "text": response.data['extracted_text'][index + 1],
                        "provenance": "manual",
                        "model": null,
                        "model_version": null,
                        "category": "legend_description",
                        "confidence": null,
                        "notes": "",
                        "status": "created"
                    }
                    item.set('feature_id', item_feature_id)
                    item.set('parent_id', swatch_feature_id)
                    finished_swatch_source.addFeature(item)
                    sendUpdates({ "map_id": map_id, "features": [newLegendItem] })
                    newLegendSwatch['descriptions'].push(newLegendItem)
                }

                if (legendItemsRef.current == undefined) {
                    legendItemsRef.current = []
                }
                setLegendItems(prevItems => [...prevItems, newLegendSwatch]);

                legendItemsRef.current.push(newLegendSwatch);


            }).catch((error) => {
                console.error('Error fetching data:', error);
            });
        }
    }


    function deleteLegendItem(id) {
        let items = []
        let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
        for (let feat_ of finished_swatch_source.getFeatures()) {
            if (feat_.get('feature_id') == id | feat_.get('parent_id') == id) {
                finished_swatch_source.removeFeature(feat_)
            }
        }

        for (let item of legendItems) {
            if (item.feature_id != id) {
                items.push(item)
            } else {
                let failed_items = []
                item['status'] = "failed"
                for (let desc of item['descriptions']) {
                    desc['status'] = "failed"

                    failed_items.push(desc)
                }
                if (item.hasOwnProperty("descriptions")) {
                    delete item["descriptions"];
                }
                failed_items.push(item)
                sendUpdates({ "map_id": map_id, "features": failed_items })
            }
        }

        setLegendItems(items)
        legendItemsRef.current = items
    }

    function changeDraw_(type) {
        if (type == "box") {
            drawTypeRef.current = "box"
        } else if (type == 'poly') {
            drawTypeRef.current = "poly"
        }
        changeDraw()
    }

    function updateItemValue(id, key, value) {

    }

    function updateItem(item) {

        if (mapRef.current === undefined) return;

        let items_ = []
        for (let feature of legendItems) {

            if (item.feature_id === feature['feature_id']) {
                for (const [key, value] of Object.entries(item)) {
                    feature[key] = value;
                }
            }
            items_.push(feature)
        }
        setLegendItems([...items_])
        legendItemsRef.current = [...items_]
    }

    // function updateItem(item) {

    //     if (mapRef.current === undefined) return;

    //     for (let feature of legendItems) {

    //         if (item.feature_id === feature['feature_id']) {
    //             for (const [key, value] of Object.entries(item)) {
    //                 feature[key] = value;
    //             }
    //             // for (let desc of feature['descriptions']) {

    //             //     // sendUpdates({ "map_id": map_id, "features": [desc] })
    //             // }
    //             sendUpdates({ "map_id": map_id, "features": [feature] })
    //         }
    //     }
    //     setData()
    // }

    function updateArea(area) {

        if (mapRef.current === undefined) return;

        let areas_ = []
        let sending_areas = []
        for (let feature of legendAreas) {

            if (area.feature_id === feature['feature_id']) {
                for (const [key, value] of Object.entries(area)) {
                    feature[key] = value;
                }
                sending_areas.push(feature)

            }
            areas_.push(feature)
        }
        setLegendAreas([...areas_])
        // legendAsRef.current = [...items_]
        // sendUpdates({ "map_id": map_id, "features": sending_areas })
    }

    function deleteArea(areaId) {
        let areas = []
        let finished_area_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
        for (let feat_ of finished_area_source.getFeatures()) {
            if (feat_.get('feature_id') == areaId) {
                finished_area_source.removeFeature(feat_)
            }
        }
        for (let item of legendAreas) {
            if (item.feature_id != areaId) {
                areas.push(item)
            } else {
                let updated_area = { ...item, "status": "failed" }

                sendUpdates({ "map_id": map_id, "features": [updated_area] })
            }
        }
        setLegendAreas(areas)
        legendAreasRef.current = areas

    }
    function downloadFeatures() {
        axios({
            method: 'GET',
            url: "/api/map/" + map_id + "/legend_features_json",
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
        mapRef.current.getView().fit(item['extent_from_bottom'], mapRef.current.getSize());
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

                            <Button onClick={() => downloadFeatures()}>Download Swatch Feature Extractions</Button>
                            <Button
                                className="nextButton"
                                color="primary"
                                onClick={() => oneMap("georeferenced", navigate, createPath("legendAnnotation", '..'))}
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
                                {completedSteps() !== totalSteps() - 1 &&

                                    <Button onClick={handleNext} sx={{ mr: 1 }}>
                                        Next
                                    </Button>
                                }
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
                                                : 'Complete Step'}
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
                            onClick={() => { clearClippedPolygons(mapRef.current) }}

                        />
                        {activeStep === 0 ?
                            <>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    style={{ 'color': "black", "borderColor": legendAreaColor, "fontWeight": "bold" }}
                                    onClick={() => processLegendArea(mapRef, legendAreasRef)}>
                                    Process Legend Area
                                </Button>
                            </>
                            :
                            <>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    style={{ 'color': 'black', "borderColor": 'red', "fontWeight": "bold" }}
                                    onClick={() => processLegendItems(legendItemsRef)}>
                                    Process Legend Item
                                </Button>
                            </>
                        }

                    </Box >

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
                <div key={"scroll" + map_id} className="flexChild scrollableContent">
                    <div className="left-panel">

                        {activeStep === 0 &&
                            <>
                                <div style={{ background: '#E8E8E8', borderRadius: "10px", padding: "10px" }}>
                                    <div>
                                        <p>
                                            Select all areas of the map that are part of the legend then click complete step
                                        </p>
                                    </div>
                                </div >
                            </>
                        }
                        {(activeStep === 0 || activeStep === 2) &&
                            <>
                                <div style={{ "display": "flex" }}>
                                    <h3>
                                        Legend Areas
                                    </h3>
                                    <CropSquareIcon style={{ alignSelf: "center", color: legendAreaColor, marginBottom: "0px", marginLeft: "5px" }}></CropSquareIcon>
                                </div>
                                {
                                    legendAreas.map((area, i) => {
                                        return <div key={i}>
                                            <div className="container_card">
                                                <LegendAreaCard
                                                    deleteArea={deleteArea}
                                                    area={area}
                                                    activeStep={activeStep}
                                                    zoomTo={zoomTo}
                                                    updateArea={updateArea}
                                                >
                                                </LegendAreaCard>

                                            </div>
                                        </div>
                                    })
                                }
                            </>
                        }

                        {activeStep === 1 &&
                            <>
                                <div style={{ background: '#E8E8E8', borderRadius: "10px", padding: "10px" }}>

                                    <div>
                                        <p>
                                            Select the legend swatch first then the title and description for processing.
                                        </p>
                                        <p>
                                            The first box should be the legend watch area which will be clipped as an image.
                                            All boxes after will be combined into the description.
                                        </p>
                                    </div>

                                </div >
                            </>
                        }
                        {(activeStep === 1 || activeStep === 2) &&
                            <>
                                <div>
                                    <div style={{ "display": "flex" }}>
                                        <h3>
                                            Legend Items

                                        </h3>
                                        <CropSquareIcon style={{ alignSelf: "center", color: "red", marginBottom: "0px", marginLeft: "5px" }}></CropSquareIcon>
                                    </div>
                                    {
                                        legendItems.map((item, i) => {
                                            return <div key={i}>
                                                <div className="container_card">
                                                    <LegendCard
                                                        item={item}
                                                        updateItem={updateItem}
                                                        deleteLegendItem={deleteLegendItem}
                                                        activeStep={activeStep}
                                                        zoomTo={zoomTo}
                                                    >
                                                    </LegendCard>

                                                </div>
                                            </div>
                                        })
                                    }

                                </div>
                            </>


                        }

                    </div >
                </div>
            </div >
        </>
    )
}

const LegendAreaCard = ({ area, deleteArea, activeStep, zoomTo, updateArea }) => {
    function wrapUpdateArea(state) {
        let area_ = { ...area }
        if (state) {
            area_['status'] = "validated"
        } else {
            area_['status'] = "succeeded"
        }

        updateArea(area_)
    }
    return (
        <>
            <div style={{ "marginTop": "10px", 'padding': "5px", 'border': "1px solid gray", 'backgroundColor': '#E8E8E8', 'borderRadius': "16px" }}>
                <div style={{ "display": "grid", "gridTemplateColumns": "1fr " }}>
                    <h3>Legend Area</h3>
                    <div><b>Provenance: </b>{area.provenance.toUpperCase()}</div>
                    <div><b>Validated: </b>{area.status.toUpperCase()}</div>

                    {area['status'] != "validated" &&
                        <>
                            <div style={{ 'justifySelf': "end" }}>
                                <img src={area.image_url} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />
                            </div>
                            {activeStep == 2 &&
                                <Button onClick={() => zoomTo(area)}>Zoom To</Button>
                            }
                            <Button onClick={() => deleteArea(area.feature_id)}>Delete</Button>
                        </>
                    }
                    {activeStep == 2 &&
                        <FormControlLabel control={
                            <Checkbox
                                checked={area["status"] == "validated"}
                                onChange={(e) => wrapUpdateArea(e.target.checked)}
                                inputProps={{ 'aria-label': 'controlled' }}
                            />
                        } label={area['status'] != "validated" ? "Validate" : "Validated"} />
                    }

                </div>
            </div>
        </>
    )
}

const LegendDescriptionCard = ({ text, i, id, wrapDescriptionChangeText }) => {
    const [descriptionText, setDescriptionText] = useState(text)
    function wrapDescriptionChange_() {
        wrapDescriptionChangeText(id, "text", descriptionText)
    }
    return (
        <>


            <TextField
                id={id}
                label={`Description box - ${i}`}
                variant="outlined"
                fullWidth
                multiline
                rows={2}
                margin="normal"
                value={descriptionText}
                onBlur={(e) => {
                    wrapDescriptionChange_()
                }}
                onChange={(e) => setDescriptionText(e.target.value)}
            />
        </>

    );
}

const LegendCard = ({ item, updateItem, deleteLegendItem, activeStep, zoomTo }) => {
    const [labelText, setLabelText] = useState(item['text'])
    function handleMinimizeItem_() {
        wrapChanges('minimized', !item.minimized)
    }
    function wrapChanges(key_, value) {
        let new_item = { ...item }
        new_item[key_] = value
        if (key_ === "status" & value === "validated") {
            for (let desc of item['descriptions']) {
                desc['status'] = "validated"
            }
            new_item['minimized'] = false
        } else if (key_ === "status" & value === "succeeded") {
            for (let desc of item['descriptions']) {
                desc['status'] = "succeeded"
            }
        }
        if (key_ === "minimized" & value === false) {
            new_item['status'] = "created"
        }

        updateItem(new_item)
    }
    function wrapDescriptionChange(item, id, key_, value) {
        let new_descriptions = []
        for (let desc of item.descriptions) {
            if (desc.feature_id == id) {
                desc[key_] = value
            }
            new_descriptions.push(desc)
        }
        wrapChanges('descriptions', new_descriptions)
    }
    function wrapDescriptionChangeText(id, key_, text) {
        wrapDescriptionChange(item, id, key_, text)
    }
    function returnValidatedString(status) {
        if (status) {
            return "validated"
        } else {
            return "succeeded"
        }
    }
    return (
        <>
            <div>

                <div style={{ "marginTop": "10px", 'padding': "5px", 'border': "1px solid gray", 'backgroundColor': '#E8E8E8', 'borderRadius': "16px" }}>
                    <Card style={{ width: "100%", borderRadius: "10px" }}>
                        <h3>Legend Item</h3>
                        {(item.minimized | item.status == "validated") ?

                            <div>
                                <div style={{ "display": "grid", "gridTemplateColumns": "1fr 1fr" }}>
                                    <div>
                                        <div><b>Provenance: </b>{item.provenance.toUpperCase()}</div>
                                        <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                        <div><b>Label:</b> {item.text}</div>
                                    </div>
                                    <div style={{ 'justifySelf': "end" }}>
                                        <img src={item.image_url} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />

                                    </div>
                                    {activeStep != 2 ?
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
                                        :
                                        <div
                                            title={item.descriptions.map(desc => desc.text).join(' ')}
                                            style={{
                                            }}>
                                            <b>Description:</b> {item.descriptions.map(desc => desc.text).join(' ')}
                                        </div>
                                    }
                                </div>
                            </div>
                            :
                            <>
                                <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                <CardContent>
                                    <img src={item.image_url} alt="Legend Item" style={{ maxWidth: '40%', height: 'auto', marginBottom: '10px' }} />
                                    <TextField
                                        id={item.feature_id}
                                        label="Label"
                                        variant="outlined"
                                        fullWidth
                                        margin="normal"
                                        value={labelText}
                                        onBlur={(e) => {
                                            wrapChanges('text', labelText)
                                        }}
                                        onChange={(e) => setLabelText(e.target.value)} // Update the state on input change
                                    />
                                    {item.descriptions != undefined &&
                                        <>
                                            {item.descriptions.map((description, i) => {
                                                return (
                                                    <div key={i}>
                                                        <LegendDescriptionCard
                                                            text={description.text}
                                                            i={i}
                                                            id={description.feature_id}
                                                            wrapDescriptionChangeText={wrapDescriptionChangeText}
                                                        >
                                                        </LegendDescriptionCard>
                                                    </div>
                                                )
                                            })
                                            }
                                        </>
                                    }


                                </CardContent>


                            </>
                        }
                        {item.status !== "validated" &&
                            <Button onClick={() => handleMinimizeItem_()} size="small" color="primary">
                                {item['minimized'] ? "Edit" : "Minimize"}
                            </Button>
                        }

                        <Button onClick={() => zoomTo(item)}>Zoom To</Button>
                        {item.status !== "validated" &&
                            <Button color="warning" onClick={() => deleteLegendItem(item.feature_id)}>Delete</Button>
                        }
                        {activeStep == 2 &&
                            <FormControlLabel control={
                                <Checkbox
                                    checked={item["status"] == "validated"}
                                    onChange={(e) => wrapChanges('status', returnValidatedString(e.target.checked))}
                                    inputProps={{ 'aria-label': 'controlled' }}
                                />
                            } label={item['status'] != "validated" ? "Validate" : "Validated"} />
                        }
                    </Card>

                </div>
            </div>
        </>
    );
}

export default LegendAnnotationPage;
