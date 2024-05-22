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


function LegendAnnotationPage() {
    const { cog_id } = useParams();

    const [loading, setLoading] = useState(false)
    const mapTargetElement = useRef<HTMLDivElement>(null)
    const [map, setMap] = useState<Map | undefined>()
    const navigate = useNavigate();
    const drawRef = useRef()
    const drawTypeRef = useRef("box")
    const mapRef = useRef()
    const [areaProvenances, setAreaProvenances] = useState([])
    const [legendProvenances, setlegendProvenances] = useState([])
    const [provenanceOption, setProvenanceOption] = useState([])

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

    const handleProvenanceChange = (event) => {
        const option = event.target.name;
        console.log(provenanceOption)
        let newOptions = [...provenanceOption];

        if (event.target.checked) {
            // Add the checked option
            newOptions.push(option);
        } else {
            // Remove the unchecked option
            newOptions = newOptions.filter(item => item !== option);
        }
        // const filteredGCPS = mapData['all_gcps'].filter((gcp) => newOptions.includes(gcp.system + "_" + gcp.system_version));
        // setGCPs(sortByGcpId(filteredGCPS))
        console.log(newOptions)
        setProvenanceOption(newOptions);
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
                sendAreaUpdates({ 'cog_id': cog_id, "cog_area_extractions": [area] })
            }
            setLegendAreas(areas)

        } else if (activeStep === 1) {
            let items_ = []
            for (let item of legendItems) {
                item['minimized'] = false
                items_.push(item)
                if (item['status'] == 'created') item['status'] = "succeeded"
                for (let desc of item['children']) {
                    if (desc['status'] == 'created') desc['status'] = "succeeded"
                }
                sendSwatchUpdates({ 'cog_id': cog_id, "legend_swatch": item })
            }
            setLegendItems(items_)
        } else if (activeStep === 2) {
            let all_validated = true
            let items_ = []
            for (let item of legendItems) {
                item['minimized'] = false

                if (item['status'] !== 'validated') {
                    all_validated = false
                    for (let desc of item['children']) {
                        desc['status'] = "succeeded"
                    }
                } else {
                    for (let desc of item['children']) {
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

                    sendSwatchUpdates({ 'cog_id': cog_id, "legend_swatch": item })
                }
                for (let area of legendAreas) {
                    sendAreaUpdates({ 'cog_id': cog_id, "cog_area_extractions": [area] })
                }
                sendUSGSValidatedResults({ "cog_id": cog_id })
            } else {
                alert("Please validate every item before finishing")
                setLegendItems(items_)
                return
            }
            setLegendItems(items_)
        }
        const newCompleted = completed;
        newCompleted[activeStep] = true;
        setCompleted(newCompleted);
        handleNext();
    };

    async function sendAreaUpdates(data_) {
        try {
            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'POST',
                url: "/api/map/save_area_extractions",
                data: data_,
                headers: _APP_JSON_HEADER
            })
        } catch (error) {
            console.error('Error making the request:', error);
        }
    }

    async function sendUSGSValidatedResults(data) {
        try {

            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'post',
                url: "/api/map/validated_legend_items",
                data: data,
                headers: _APP_JSON_HEADER
            });

        } catch (error) {
            console.error('Error making the request:', error);
        }
        try {

            // Perform the Axios post request using async/await
            const response = await axios({
                method: 'post',
                url: "/api/map/validated_area_extraction",
                data: data,
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


    async function processLegendArea(mapRef, legendAreasRef) {
        if (activeStep === 0) {
            let vector_layer_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
            let features = getLayerById(mapRef.current, "bounding-box").getSource().getFeatures()
            let bboxes = []
            for (let feat of features) {
                bboxes.push(feat.getGeometry().extent_)
                feat.set('area_id', cog_id + asString(feat.getGeometry().extent_))
                vector_layer_source.addFeature(feat)
            }
            let legend_areas = [...legendAreasRef.current]

            for (let [index, feat] of features.entries()) {

                let area_geom = feat.getGeometry()
                let newLegendArea = {
                    "cog_id": cog_id,
                    "area_id": cog_id + asString(area_geom.extent_),
                    "image_url": returnImageUrl(cog_id, area_geom.extent_),
                    "extent_from_bottom": area_geom.extent_,
                    "coordinates_from_bottom": { "type": "Polygon", "coordinates": area_geom.getCoordinates() },
                    "text": "",
                    "model": "",
                    "model_version": "",
                    "system": SYSTEM,
                    "system_version": SYSTEM_VERSION,
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
            url: "/api/map/" + cog_id + "/cog_legend_extractions",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            let areaProvenances_ = []
            if (response.data["area_extractions"].length != 0) {

                let area_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
                for (let area of response.data['area_extractions']) {
                    console.log(area)
                    if (!areaProvenances_.includes(area.system + "_" + area.system_version)) {
                        console.log('here')
                        areaProvenances_.push(area.system + "_" + area.system_version)
                    }
                    console.log(area)
                    area["image_url"] = returnImageUrl(cog_id, area.extent_from_bottom)
                    let area_feature = new GeoJSON().readFeature({
                        type: 'Feature',
                        geometry: area['coordinates_from_bottom'],
                        properties: {
                            area_id: area['area_id']
                        }
                    });
                    area_source.addFeature(area_feature)
                }
                console.log(areaProvenances_)
                setLegendAreas(response.data["area_extractions"])
                setAreaProvenances(areaProvenances_)
                legendAreasRef.current = response.data["area_extractions"]
            }
            if (response.data['legend_swatches'].length > 0) {
                let legendProvenance_ = []
                // imageMetaRef.current = response.data['map_info']
                let swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
                for (let swatch of response.data['legend_swatches']) {
                    // console.log(swatch)
                    if (!legendProvenance_.includes(swatch.system + "_" + swatch.system_version)) {
                        legendProvenance_.push(swatch.system + "_" + swatch.system_version)
                    }

                    let swatch_feature = new GeoJSON().readFeature({
                        type: 'Feature',
                        geometry: swatch['coordinates_from_bottom'],
                        properties: {
                            legend_id: swatch['legend_id']
                        }
                    });
                    swatch_source.addFeature(swatch_feature)
                    for (let description of swatch['children']) {
                        // swatch_feature.set('children_ids', description['parent_id'])
                        let desc_feature = new GeoJSON().readFeature({
                            type: 'Feature',
                            geometry: description['coordinates_from_bottom']
                        });

                        desc_feature.set('legend_id', desc_feature['legend_id'])
                        desc_feature.set('parent_id', swatch['legend_id'])
                        swatch_source.addFeature(desc_feature)
                    }
                }
                setlegendProvenances(legendProvenance_)
                setLegendItems(response.data['legend_swatches'])
            }
        })
    }

    // Render map
    useEffect(() => {


        document.title = "Polymer Georeferencer Extractions - " + cog_id;

        axios({
            method: 'GET',
            url: "/api/map/" + cog_id + "/meta",
            headers: _APP_JSON_HEADER
        }).then((response) => {
            imageMetaRef.current = response.data
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
    }, [cog_id])


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
                        processLegendSwatches()
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
            let bboxes = []
            for (let feat of features) {
                // feat.set('parent_id', cog_id + asString(swatch_geom.extent_))
                // feat.set('feature_id', cog_id + asString(feat.getGeometry().extent_))
                // finished_swatch_source.addFeature(feat)
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
                    "children": [],
                    "image_url": returnImageUrl(cog_id, swatch_geom.extent_),
                    "extent_from_bottom": swatch_geom.extent_,
                    // "bbox": [
                    //     [swatch_geom.extent_[0], imageMetaRef.current['height'] - swatch_geom.extent_[1]],
                    //     [swatch_geom.extent_[2], imageMetaRef.current['height'] - swatch_geom.extent_[3]]],
                    "coordinates_from_bottom": { "type": "Polygon", "coordinates": swatch_geom.getCoordinates() },
                    "text": response.data['extracted_text'][0],
                    "model": null,
                    "model_version": null,
                    "system": SYSTEM,
                    "system_version": SYSTEM_VERSION,
                    "category": 'legend_swatch',
                    "confidence": null,
                    "status": "created",
                    "notes": "",
                    "minimized": false,
                }
                swatch_feature.set('legend_id', swatch_feature_id)
                finished_swatch_source.addFeature(swatch_feature)

                for (let [index, item] of features.slice(1).entries()) {
                    let item_geom = item.getGeometry()

                    let item_feature_id = cog_id + asString(item_geom.extent_) + response.data['extracted_text'][index + 1]
                    let newLegendItem = {
                        "cog_id": cog_id,
                        "legend_id": item_feature_id,
                        "image_url": returnImageUrl(cog_id, item_geom.extent_),
                        "extent_from_bottom": item_geom.extent_,
                        // "bbox": [
                        //     [item_geom.extent_[0], imageMetaRef.current['height'] - item_geom.extent_[1]],
                        //     [item_geom.extent_[2], imageMetaRef.current['height'] - item_geom.extent_[3]]],
                        "coordinates_from_bottom": { "type": "Polygon", "coordinates": item_geom.getCoordinates() },
                        "text": response.data['extracted_text'][index + 1],
                        "model": null,
                        "model_version": null,
                        "system": SYSTEM,
                        "system_version": SYSTEM_VERSION,
                        "category": index == 0 ? "legend_label" : "legend_description",
                        "confidence": 1,
                        "notes": "",
                        "status": "created"
                    }
                    item.set('legend_id', item_feature_id)
                    item.set('parent_id', swatch_feature_id)
                    finished_swatch_source.addFeature(item)

                    newLegendSwatch['children'].push(newLegendItem)
                }
                sendSwatchUpdates({ "cog_id": cog_id, "legend_swatch": newLegendSwatch })
                // sendUpdates({ "cog_id": cog_id, "features": [newLegendItem] })

                setLegendItems(prevItems => [...prevItems, newLegendSwatch]);



            }).catch((error) => {
                console.error('Error fetching data:', error);
            });
        }
    }



    function deleteLegendItem(id) {
        let items = []
        let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
        for (let feat_ of finished_swatch_source.getFeatures()) {

            if (feat_.get('legend_id') == id | feat_.get('parent_id') == id) {
                finished_swatch_source.removeFeature(feat_)
            }
        }

        for (let item of legendItems) {
            if (item.legend_id != id) {
                items.push(item)
            } else {
                axios({
                    method: 'delete',
                    url: "/api/map/delete_legend_extractions",
                    data: { "category": "legend_swatch", "id": id },
                    headers: _APP_JSON_HEADER
                }).then((response) => {
                    console.log(response)
                })
            }
        }

        setLegendItems(items)
    }

    function changeDraw_(type) {
        if (type == "box") {
            drawTypeRef.current = "box"
        } else if (type == 'poly') {
            drawTypeRef.current = "poly"
        }
        changeDraw()
    }


    function updateItem(item) {

        if (mapRef.current === undefined) return;

        let items_ = []
        for (let feature of legendItems) {

            if (item.legend_id === feature['legend_id']) {
                for (const [key, value] of Object.entries(item)) {
                    feature[key] = value;
                }
            }
            items_.push(feature)
        }
        setLegendItems([...items_])
    }


    function updateArea(area) {

        if (mapRef.current === undefined) return;

        let areas_ = []
        let sending_areas = []
        for (let feature of legendAreas) {

            if (area.area_id === feature['area_id']) {
                for (const [key, value] of Object.entries(area)) {
                    feature[key] = value;
                }
                sending_areas.push(feature)

            }
            areas_.push(feature)
        }
        setLegendAreas([...areas_])

    }

    function sendDeleteAreaExtraction(area_id) {
        axios({
            method: 'delete',
            url: "/api/map/delete_area_extractions",
            data: { "id": area_id },
            headers: _APP_JSON_HEADER
        }).then((response) => {
            console.log(response)
        })

    }

    function sendDeleteAreaExtraction(area_id) {
        axios({
            method: 'delete',
            url: "/api/map/delete_area_extractions",
            data: { "id": area_id },
            headers: _APP_JSON_HEADER
        }).then((response) => {
            console.log(response)
        })

    }

    function deleteArea(areaId) {
        let areas = []
        let finished_area_source = getLayerById(mapRef.current, "legend-area-layer").getSource()
        for (let feat_ of finished_area_source.getFeatures()) {
            if (feat_.get('area_id') == areaId) {
                finished_area_source.removeFeature(feat_)
            }
        }

        for (let item of legendAreas) {
            if (item.area_id != areaId) {
                areas.push(item)
            } else {
                sendDeleteAreaExtraction(item.area_id)

            }
        }
        setLegendAreas([...areas])
        legendAreasRef.current = areas

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
                                    onClick={() => processLegendSwatches()}>
                                    Process Legend Item
                                </Button>
                            </>
                        }

                    </Box >
                    <Box sx={{ width: 200 }}>
                        <br />
                        <h4 style={{ "padding": "0px", "margin": "4px" }}>Select System</h4>
                        <FormGroup style={{ width: '200px' }}>

                            {activeStep === 0 ?
                                <>
                                    {areaProvenances.map((option, index) => (
                                        < FormControlLabel
                                            key={index}
                                            control={
                                                < Checkbox
                                                    checked={provenanceOption.includes(option)}
                                                    onChange={handleProvenanceChange}
                                                    name={option}
                                                />
                                            }
                                            label={
                                                <Typography style={{
                                                    color: getColorForProvenance(option),
                                                }}>
                                                    <>
                                                        {provenance_mapper[option]}
                                                    </>
                                                </Typography>}
                                        />
                                    ))}
                                </>
                                :
                                <>
                                    {legendProvenances.map((option, index) => (
                                        <FormControlLabel
                                            key={index}
                                            control={
                                                <Checkbox
                                                    checked={legendProvenances.includes(option)}
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
                                </>
                            }

                        </FormGroup>

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
                <div key={"scroll" + cog_id} className="flexChild scrollableContent">
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
                                                    deleteArea={() => { deleteArea(area.area_id) }}
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
                    <div><b>Provenance: </b>{area.system.toUpperCase() + "_" + area.system_version}</div>
                    <div><b>Validated: </b>{area.status.toUpperCase()}</div>

                    {area['status'] != "validated" &&
                        <>
                            <div style={{ 'justifySelf': "end" }}>
                                <img src={area.image_url} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />
                            </div>
                            {activeStep == 2 &&
                                <Button onClick={() => zoomTo(area)}>Zoom To</Button>
                            }
                            <Button onClick={() => deleteArea(area.area_id)}>Delete</Button>
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

const LegendDescriptionCard = ({ child, i, id, wrapDescriptionChangeText }) => {

    const [descriptionText, setDescriptionText] = useState(child.text)

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
            for (let desc of item['children']) {
                desc['status'] = "validated"
            }
            new_item['minimized'] = false
        } else if (key_ === "status" & value === "succeeded") {
            for (let desc of item['children']) {
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
        for (let desc of item.children) {
            if (desc.legend_id == id) {
                desc[key_] = value
            }
            new_descriptions.push(desc)
        }
        wrapChanges('children', new_descriptions)
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
                                        <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>
                                        <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                        <div><b>Label:</b> {item.text}</div>
                                    </div>
                                    <div style={{ 'justifySelf': "end" }}>
                                        <img src={item.image_url} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />

                                    </div>
                                    {activeStep != 2 ?
                                        <div
                                            title={item.children.map(desc => desc.text).join(' ')}
                                            style={{
                                                "whiteSpace": "nowrap",
                                                "overflow": "hidden",
                                                "textOverflow": "ellipsis",
                                                "maxWidth": "250px",
                                                "maxHeight": "250px"
                                            }}>
                                            <b>Description:</b> {item.children.map(desc => desc.text).join(' ')}
                                        </div>
                                        :
                                        <div
                                            title={item.children.map(desc => desc.text).join(' ')}
                                            style={{
                                            }}>
                                            <b>Description:</b> {item.children.map(desc => desc.text).join(' ')}
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
                                        id={item.legend_id}
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
                                    {item.children != undefined &&
                                        <>
                                            {item.children.map((child, i) => {
                                                return (
                                                    <div key={i}>
                                                        <LegendDescriptionCard
                                                            child={child}
                                                            i={i}
                                                            id={child.legend_id}
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
                            <Button color="warning" onClick={() => deleteLegendItem(item.legend_id)}>Delete</Button>
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
