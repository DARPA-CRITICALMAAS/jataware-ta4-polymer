import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import { Vector as VectorLayer } from "ol/layer";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import { Card, CardContent } from "@mui/material";
import { Button } from "@mui/material";

import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Text from "@mui/material/Typography";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useQuery } from "@tanstack/react-query";
import LoadingButton from "@mui/lab/LoadingButton";
import SaveIcon from "@mui/icons-material/Save";
import { useConfig } from '../ConfigContext';

import "../css/area_extraction.scss";
import { MapSpinner } from "../Spinner";
import {
    getLayerById,
    expand_resolutions,
} from "./helpers";
import { useParams } from "react-router-dom";

import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";

import Header from "./Header";
import PolymerTooltip from "./Tooltip";

// const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
// const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
// const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX;

const _APP_JSON_HEADER = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
};

const areaTypeColorMap = {
    "map_area": 'blue',            // Orange for Map_Area
    "legend_area": '#33FF57',         // Green for Legend_Area
    "cross_section": '#5733FF',        // Blue for CrossSection
    "ocr": '#FF33A1',                 // Pink for OCR
    "polygon_legend_area": '#FFC300', // Yellow for Polygon_Legend_Area
    "line_point_legend_area": '#C70039', // Red for Line_Point_Legend_Area
    "line_legend_area": '#900C3F',    // Dark Red for Line_Legend_Area
    "point_legend_area": '#581845',   // Purple for Point_Legend_Area
    "correlation_diagram": '#1ABC9C'  // Teal for Correlation_Diagram
};

function AreaExtractionsComponent() {
    const config = useConfig();
    const { cog_id } = useParams();

    const mapTargetElement = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<Map | undefined>();
    const navigate = useNavigate();

    const mapRef = useRef();

    const [legendProvenances, setlegendProvenances] = useState([]);
    const [provenanceOption, setProvenanceOption] = useState([]);

    const [areas, setAreas] = useState([]);
    const [filteredAreas, setFilteredAreas] = useState([]);

    const [loadingMap, setLoadingMap] = useState(true);

    const [loadingProvenanceData, setLoadingProvenanceData] = useState(true);


    const [provenanceVisible, setProvenanceVisible] = React.useState(true);

    const forceCogCache = useQuery({
        queryKey: ["mapCog", cog_id, "cache", "swatches"],
        queryFn: () => {
            return axios({
                method: "GET",
                url: "/api/map/load_tiff_into_cache?cog_id=" + cog_id,
                headers: _APP_JSON_HEADER,
            });
        },
        refetchOnWindowFocus: true,
        retry: 1,
    });

    function zoomTo(item) {
        let extent = [
            item["extent_from_bottom"][0] - 50,
            item["extent_from_bottom"][1] - 100,
            item["extent_from_bottom"][2] + 200,
            item["extent_from_bottom"][3] + 100,
        ];


        // update view to not zoom in so much
        let view = mapRef.current.getView();
        view.fit(extent, mapRef.current.getSize());
        let zoom = view.getZoom();
        view.setZoom(zoom - 0.6);
    }


    const handleProvenanceChange = (option, checked) => {
        let newOptions = [...provenanceOption];
        if (checked) {
            newOptions.push(option);
        } else {
            newOptions = newOptions.filter((item) => item !== option);
        }

        const filteredAreas = areas.filter((item) =>
            newOptions.includes(item.system + "_" + item.system_version)
        );
        setFilteredAreas(filteredAreas)

        add_features_to_map(filteredAreas);
        setProvenanceOption(newOptions);
    };




    let placeholder = {
        type: "FeatureCollection",
        features: [],
    };

    const area_source = new VectorSource({
        features: new GeoJSON().readFeatures(placeholder),
    });

    const area_layer = new VectorLayer({
        id: "area-layer",
        source: area_source,
        style: (feature) => {
            let color = "red";
            const category = feature.get("category");
            color = areaTypeColorMap[category]

            return new Style({
                stroke: new Stroke({
                    width: 1,
                    color: color,
                }),
                fill: new Fill({
                    color: "rgba(0, 0, 0, 0)",
                }),
            });
        },
    });

    const map_source = new GeoTIFF({
        sources: [
            {
                url: `${config.CDR_COG_URL}/${config.CDR_PUBLIC_BUCKET}/${config.CDR_S3_COG_PREFEX}/${cog_id}.cog.tif`,
                nodata: -1,
            },
        ],
        convertToRGB: true,
        interpolate: false,
    });

    const map_layer = new TileLayer({
        id: "map-layer",
        source: map_source,
    });





    function add_features_to_map(filteredAreas) {
        // clear swatches on the page
        let area_source = getLayerById(
            mapRef.current,
            "area-layer",
        ).getSource();
        area_source.clear()

        for (let area of filteredAreas) {
            if (area["coordinates_from_bottom"]["coordinates"].length != 0) {
                let area_feature = new GeoJSON().readFeature({
                    type: "Feature",
                    geometry: area["coordinates_from_bottom"],
                    properties: {
                        area_extraction_id: area["area_extraction_id"],
                        category: area["category"],
                    },
                });
                area_source.addFeature(area_feature);
            }

        }
    }

    function setAreasData() {
        return axios({
            method: "GET",
            url: "/api/map/" + cog_id + "/area_extractions",
            headers: _APP_JSON_HEADER,
        }).then((response) => {
            if (response.data["areas"].length > 0) {

                let areas = response.data["areas"]
                let systems = []
                for (let area of areas) {
                    if (!systems.includes(area.system + "_" + area.system_version)) {
                        systems.push(area.system + "_" + area.system_version)
                    }
                }
                setlegendProvenances(systems)
                setAreas(areas);

            }
            setLoadingProvenanceData(false);
        });
    }

    function setData() {
        setLoadingProvenanceData(true);
        setAreasData();
    }

    useEffect(() => {
        document.title =
            "Polymer Georeferencer Area Extractions - " + cog_id;

        setData();

        const _map = new Map({
            controls: [],
            layers: [map_layer, area_layer],
            view: map_source.getView().then((v) => {
                v.resolutions = expand_resolutions(v, 1, 7);
                v.extent = undefined;
                return v;
            }),
        });
        _map.setTarget(mapTargetElement.current || "");


        mapRef.current = _map;

        _map.on("loadend", function () {
            setLoadingMap(false);
        });

        setMap(_map);

        return () => _map.setTarget("");
    }, [cog_id]);



    return (
        <div
            className="area-extraction-root"
            style={{ height: "100vh", display: "flex", flexDirection: "column" }}
        >
            <Header navigate={navigate} cog_id={cog_id} />
            <PanelGroup
                style={{ flex: 1 }}
                autoSaveId="polymer-area-pane"
                direction="horizontal"
            >
                <Panel defaultSize={35} minSize={20} className="map-wrapper">
                    {loadingMap && (
                        <div className="loading-tiles">
                            <MapSpinner />
                        </div>
                    )}
                    <div
                        ref={mapTargetElement}
                        className="map"
                        style={{
                            width: "100%",
                            height: "100%",
                            position: "relative",
                        }}
                    />
                    {
                        legendProvenances.length > 0 && (
                            <div className="control-panel">
                                <Box
                                    sx={{
                                        display: "flex",
                                        flexDirection: "column",
                                    }}
                                >


                                    {loadingProvenanceData ? (
                                        <LoadingButton
                                            loading
                                            loadingPosition="start"
                                            startIcon={<SaveIcon />}
                                            sx={{ marginTop: "0.5rem" }}
                                        >
                                            Loading System Data
                                        </LoadingButton>
                                    ) : (
                                        <>


                                            <Box>

                                                <FormGroup>
                                                    <div style={{ display: "flex" }}>

                                                        <Text variant="body2" style={{ marginTop: "0.75rem" }}>
                                                            Select System
                                                        </Text>
                                                        <PolymerTooltip
                                                            title={provenanceVisible ? "Hide Systems" : "Show Systems"}
                                                        >
                                                            <IconButton
                                                                color="secondary"
                                                                disabled={Boolean(loadingProvenanceData)}
                                                                onClick={() => {
                                                                    setProvenanceVisible(!provenanceVisible);
                                                                }}
                                                            >
                                                                <FormatAlignJustifyIcon />
                                                            </IconButton>
                                                        </PolymerTooltip>
                                                    </div>
                                                    {legendProvenances.map((option) => (
                                                        <>


                                                            {provenanceVisible && (
                                                                <FormControlLabel
                                                                    className="provenance-control-label"
                                                                    key={option}
                                                                    control={
                                                                        <Checkbox
                                                                            size="small"
                                                                            checked={provenanceOption.includes(option)}
                                                                            onChange={(e) => {
                                                                                handleProvenanceChange(
                                                                                    e.target.name,
                                                                                    e.target.checked,
                                                                                );
                                                                            }}
                                                                            name={option}
                                                                        />
                                                                    }
                                                                    label={
                                                                        <Text
                                                                            style={{
                                                                                color: "var(--mui-palette-text-primary)",
                                                                            }}
                                                                        >
                                                                            <span>{option}</span>
                                                                        </Text>
                                                                    }

                                                                />
                                                            )}

                                                        </>
                                                    ))}
                                                </FormGroup>


                                            </Box>

                                        </>
                                    )
                                    }
                                </Box>

                            </div>
                        )

                    }

                </Panel>

                <PanelResizeHandle className="panel-resize-handle" />

                <Panel defaultSize={65} minSize={40}>
                    <div
                        style={{
                            margin: "0.25rem 1rem 0 1rem",
                            display: "flex",
                            justifyContent: "space-between",
                        }}
                    >
                        <Text variant="h4" sx={{ fontSize: "1.75rem" }}>
                            Area Extractions
                        </Text>

                    </div>
                    <div key={"scroll" + cog_id} className="flex-child scrollableContent">
                        <div className="right-panel">
                            {forceCogCache.isPending ? (
                                <div className="loading-tiles">
                                    <MapSpinner />
                                </div>
                            ) : (
                                <div className="right-panel-swatch-list">
                                    <div >
                                        <div >
                                            <div className="legend-items">
                                                {filteredAreas.map((item, i) => (
                                                    <Card style={{ width: "100%", borderRadius: "10px", padding: "1rem" }}>
                                                        <div>
                                                            <div
                                                                style={{
                                                                    marginLeft: "8px",
                                                                    padding: "1rem",
                                                                    border: "1px solid gray",
                                                                    backgroundColor: "var(--mui-palette-background-paper)",
                                                                    color: "var(--mui-palette-text-secondary)",
                                                                    borderRadius: "14px",
                                                                }}
                                                            >

                                                                <div style={{ display: "grid", gridTemplateColumns: "1fr" }}>
                                                                    <div>
                                                                        <div>
                                                                            <b>Provenance: </b>
                                                                            <span
                                                                                style={{
                                                                                    color: "var(--mui-palette-text-secondary)",

                                                                                }}
                                                                            >
                                                                                {item.system.toUpperCase() + "_" + item.system_version}
                                                                            </span>
                                                                        </div>
                                                                        <div>
                                                                            <b>Type:</b> <span style={{ color: areaTypeColorMap[item.category] }}>{item.category}</span>

                                                                        </div>

                                                                        <Button
                                                                            onClick={() => { zoomTo(item) }}>
                                                                            ZoomTo
                                                                        </Button>

                                                                    </div>

                                                                </div>
                                                            </div>
                                                        </div>
                                                    </Card>
                                                ))}
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </Panel>
            </PanelGroup>
        </div >
    )
}

export default AreaExtractionsComponent;
