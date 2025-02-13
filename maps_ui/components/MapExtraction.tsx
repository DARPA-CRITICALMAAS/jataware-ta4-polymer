import React, { useEffect, useRef, useState } from "react";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import { Vector as VectorLayer } from "ol/layer";
import XYZ from "ol/source/XYZ";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import GeoJSON from "ol/format/GeoJSON";
import Draw, { createBox } from "ol/interaction/Draw";

import { Fill, Stroke, Style } from "ol/style";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";

import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Checkbox from "@mui/material/Checkbox";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import CloseIcon from "@mui/icons-material/Close";
import ScanIcon from "@mui/icons-material/DocumentScanner";
import MapIcon from "@mui/icons-material/Map";
import LoadingButton from "@mui/lab/LoadingButton";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";

import { MapSpinner } from "../Spinner";
import "../css/map_extraction.scss";
import epsg_data from "../assets/PROJ_CODES_WORLD.json";
import SmallMap from "./smallMap";
import {
  checkIfEdited,
  getColorForProvenance,
  dec2dms,
  dms2dec,
  register_proj,
  getLayerById,
  expand_resolutions,
  valuetext,
  gcp2box,
  handleOpacityChange,
  oneMap,
  createPath,
} from "./helpers";
import GCPList from "./GCPList";
import { Tooltip } from "@mui/material";
import PolymerTooltip from "./Tooltip";
import { useConfig } from '../ConfigContext';

// Params
// const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
// const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
// const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX;
const SYSTEM_VERSION = import.meta.env.VITE_POLYMER_SYSTEM_VERSION;
const SYSTEM = import.meta.env.VITE_POLYMER_SYSTEM;

// const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const BUFFER = 150;

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function nullToString(value) {
  if (value == undefined) return "";
  return value;
}

function formatReprojectError(e) {
  const { status } = e.response;

  if (status === 422) {
    const { detail } = e.response.data;
    let template = "Validation Error: ";
    for (let info of detail) {
      template += info.msg;
      template += `: ${JSON.stringify(info.loc)}`;
    }
    return template;
  } else if (status === 500) {
    return "Server Error. Contact us for details or retry operation.";
  } else if (status === 400) {
    return "Bad Request withno further validation details. Retry operation or contact us.";
  }

  return "Unknown or unhandled error ocurred. Retry or contact us.";
}

const SECOND = 1000;
const MINUTE = SECOND * 60;

function GeoreferenceComponent({ mapDataInit }) {
  const config = useConfig();

  const [mapData, setMapData] = useState(mapDataInit);
  const cog_id = mapData["cog_info"]["cog_id"];
  const cog_name = mapData["cog_info"]["cog_name"];
  const mapTargetElement = useRef<HTMLDivElement>(null);
  const gcpsListRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | undefined>();
  const [gcps, setGCPs] = useState([]);
  const [map_crs, setMapCRS] = useState(null);
  const [georeferenced, setGeoreferenced] = useState(false);
  const [provenanceVisible, setProvenanceVisible] = useState(true);
  const [isProjected, setProjected] = useState(
    mapData["cog_info"]["georeferenced_count"],
  );
  const [provenanceOption, setProvenanceOption] = useState([]);
  /* const [loadedTiff, setLoadedTiff] = useState(false); */
  const [showOCR, setShowOCR] = useState(false);
  const [EPSGs, setEPSGs] = useState([]);
  const [extractedText, setExtractedText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [GCPGrouping, setGCPGrouping] = useState("system");
  const [loadingMap, setLoadingMap] = useState(true);
  const navigate = useNavigate();
  const drawRef = useRef();
  const mapRef = useRef();

  const queryClient = useQueryClient();

  const reproject = useMutation({
    mutationFn: async ({ cog_id, gcps_, map_crs }) => {
      return axios({
        method: "post",
        url: "/api/map/project",
        timeout: 5 * MINUTE,
        data: {
          cog_id: cog_id,
          gcps: gcps_,
          crs: map_crs,
        },
        headers: _APP_JSON_HEADER,
      });
    },
    onSuccess: (response) => {
      if (response.status === 200) {
        queryClient.invalidateQueries({
          queryKey: ["mapCog", cog_id, "projections"],
        });

        viewProjections();
      }
    },
    onError: (e) => {
      throw new Error(formatReprojectError(e));
    },
  });

  const ocr = useMutation({
    mutationFn: async ({ cog_id, bboxes }) => {
      return axios({
        method: "post",
        url: "/api/map/tif_ocr",
        data: { cog_id, bboxes },
        headers: _APP_JSON_HEADER,
      });
    },
    onSuccess: (response, variables, context) => {
      const { extracted_text } = response.data;
      const len = extracted_text.length;

      if (!len || (len === 1 && extracted_text[0] === "")) {
        throw new Error(
          "No text extracted. Were polygons or polygons surrounding text selected?",
        );
      }

      let all_text = "";
      for (let text of response.data.extracted_text) {
        all_text = all_text + " " + text;
      }
      setExtractedText(all_text);
    },
    // onError: (error, variables, context) => {
    //   console.log('ocr error', error);
    // }
  });

  const ocrAnalysis = useMutation({
    mutationFn: ({ prompt }) =>
      axios({
        method: "post",
        url: "/api/map/send_prompt",
        data: { prompt },
        headers: _APP_JSON_HEADER,
      }),
    onSuccess: (response) => {
      setEPSGs(response.data["matches"]);
      setReasoning(response.data["reasoning"]);
    },
  });
  const areMutationErrors =
    reproject.isError || ocr.isError || ocrAnalysis.isError;
  const closeNotifier = () => {
    reproject.reset();
    ocr.reset();
    ocrAnalysis.reset();
  };

  let draw;

  // ----------------- LAYERS -----------------
  // VECTOR layer

  const vector_styles = {
    Polygon: new Style({
      stroke: new Stroke({
        width: 3,
      }),
      fill: new Fill({
        color: "rgba(0, 0, 0, 0.3)",
      }),
    }),
  };

  let used_gcps = {
    type: "FeatureCollection",
    features: [],
  };
  const vector_source = new VectorSource({
    features: new GeoJSON().readFeatures(used_gcps),
  });

  const vector_layer = new VectorLayer({
    id: "vector-layer",
    source: vector_source,
    style: (feature) => {
      let style = vector_styles[feature.getGeometry().getType()];
      let color = feature.values_.color;
      style.stroke_.color_ = color;
      return style;
    },
  });

  // MAP layer

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

  // BASE layer

  const base_source = new XYZ({
    url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${config.MAPTILER_KEY}`,
    crossOrigin: "",
  });

  const base_layer = new TileLayer({
    id: "base-layer",
    source: base_source,
    visible: false,
  });

  // ocr vector layer
  const ocr_source = new VectorSource({ wrapX: false });
  const ocr_vector = new VectorLayer({
    id: "bounding-box",
    source: ocr_source,
  });

  // Map helpers

  function create_gcp_id(gcp) {
    let gcp_id;
    if (gcp.gcp_id == undefined || gcp.gcp_id == null) {
      gcp_id =
        gcp.latitude.toString() +
        gcp.longitude.toString() +
        gcp.columns_from_left.toString() +
        gcp.rows_from_top.toString() +
        gcp.crs.toString();
    } else {
      gcp_id = gcp.gcp_id;
    }
    return gcp_id;
  }

  function ensureString(value) {
    return value === null || value === undefined ? "" : value;
  }

  function project(gcps) {
    if (map_crs == null) {
      alert("Map CRS required!");
      return;
    }
    if (gcps.length < 3) {
      alert(
        "At least 3 GCPs are needed for projection. Add more GCPs before proceeding.",
      );
      return;
    }
    for (let gcp of gcps) {
      if (gcp.crs == "") {
        alert(
          "A gcp is missing an EPSG Code. Please fill in all gcp EPSG codes before continuing.",
        );
        return;
      }
      if (Number.isNaN(gcp.latitude) || gcp.latitude == null) {
        alert(
          "A gcp latitude value is missing. Please fill in all gcp latitude values before continuing.",
        );
        return;
      }
      if (Number.isNaN(gcp.longitude) || gcp.longitude == null) {
        alert(
          "A gcp longitude value is missing. Please fill in all gcp longitude values before continuing.",
        );
        return;
      }
    }

    // register to OL
    register_proj(map_crs).then(() => {
      let gcps_ = gcps.map((gcp) => ({
        gcp_id: create_gcp_id(gcp),
        longitude: gcp.longitude,
        latitude: gcp.latitude,
        rows_from_top: gcp.rows_from_top,
        columns_from_left: gcp.columns_from_left,
        crs: gcp.crs.split("__")[0],
        system: gcp.system ?? SYSTEM,
        system_version: gcp.system_version ?? SYSTEM_VERSION,
        reference_id: ensureString(gcp.reference_id),
        registration_id: gcp.registration_id,
        cog_id: cog_id,
        confidence: gcp.confidence,
        model_id: nullToString(gcp.model_id),
        model_version: nullToString(gcp.model_version),
        model: nullToString(gcp.model),
      }));

      // project action
      reproject.mutate({ cog_id, gcps_, map_crs });
    });
  }

  function map_onClick(e, height) {
    let [coll, rowb] = e.coordinate;

    if (drawRef.current.values_.active != true) {
      setGCPs([
        {
          gcp_id: "manual_" + uuidv4(),
          rows_from_top: Math.floor(height - rowb),
          columns_from_left: Math.floor(coll),
          longitude: null,
          latitude: null,
          x_dms: null,
          y_dms: null,
          crs: "EPSG:4267__NAD27",
          provenance: SYSTEM + "_" + SYSTEM_VERSION,
          system: SYSTEM,
          system_verison: SYSTEM_VERSION,
          model: null,
          model_version: null,
          reference_id: null,
          color: [
            Math.floor(Math.random() * 255),
            Math.floor(Math.random() * 255),
            Math.floor(Math.random() * 255),
          ],
          height: height,
        },
        ...gcps,
      ]);

      if (gcpsListRef.current) {
        gcpsListRef.current.scrollTop = 0;
      }
    }
  }

  // Render map
  useEffect(() => {
    document.title = "Polymer Map GCPs - " + cog_id;
    const _map = new Map({
      controls: [],
      layers: [base_layer, map_layer, vector_layer, ocr_vector],
      view: map_source.getView().then((v) => {
        v.resolutions = expand_resolutions(v, 1, 7);
        v.extent = undefined;
        return v;
      }),
    });
    _map.setTarget(mapTargetElement.current || "");
    _map.on("dblclick", (e) => map_onClick(e, mapData["cog_info"]["height"]));
    _map.on("loadend", function () {
      setLoadingMap(false);
    });

    mapRef.current = _map;
    draw = new Draw({
      source: ocr_source,
      type: "Circle",
      geometryFunction: createBox(),
    });
    draw.setActive(false);
    drawRef.current = draw;
    _map.addInteraction(draw);
    setMap(_map);

    return () => _map.setTarget("");
  }, [cog_id]);

  useEffect(() => {
    // Show jataware points to start
    setGCPs([]);
    const checkboxes = document.querySelectorAll(
      'input[type="checkbox"][name="bulk_upload"]',
    );
    checkboxes.forEach((checkbox) => {
      checkbox.click();
    });
  }, [cog_id]);



  // Propagate data
  useEffect(() => {
    if (mapRef.current === undefined) return;

    // On GCP change, need to update click to have new gcps
    mapRef.current.on("dblclick", (e) =>
      map_onClick(e, mapData["cog_info"]["height"]),
    );

    // On GCP change ... update map
    getLayerById(mapRef.current, "vector-layer").getSource().clear();
    getLayerById(mapRef.current, "vector-layer")
      .getSource()
      .addFeatures(
        gcps.map((gcp, i) => {
          return gcp2box(gcp, mapData["cog_info"]["height"]);
        }),
      );

    return () => mapRef.current.on("click", undefined);
  }, [gcps]);

  // Update GCPs
  function updateGCP(new_gcp, height) {
    if (map === undefined) return;

    let features = getLayerById(mapRef.current, "vector-layer")
      .getSource()
      .getFeatures();
    let gcps_ = [];

    for (let feature of features) {
      if (feature.values_.gcp_id == new_gcp["gcp_id"]) {
        for (const [key, value] of Object.entries(new_gcp)) {
          feature.set(key, value);
        }

        if ("columns_from_left" in new_gcp && "rows_from_top" in new_gcp) {
          let BUFFER = 150;
          feature.getGeometry().setCoordinates([
            [
              [
                new_gcp["columns_from_left"] - BUFFER,
                height - new_gcp["rows_from_top"] - BUFFER,
              ],
              [
                new_gcp["columns_from_left"] + BUFFER,
                height - new_gcp["rows_from_top"] - BUFFER,
              ],
              [
                new_gcp["columns_from_left"] + BUFFER,
                height - new_gcp["rows_from_top"] + BUFFER,
              ],
              [
                new_gcp["columns_from_left"] - BUFFER,
                height - new_gcp["rows_from_top"] + BUFFER,
              ],
              [
                new_gcp["columns_from_left"] - BUFFER,
                height - new_gcp["rows_from_top"] - BUFFER,
              ],
            ],
          ]);
        }
      }

      let system = feature.values_["system"] ?? SYSTEM;
      let version = feature.values_["system_version"] ?? SYSTEM_VERSION;
      let provenance = system + "_" + version;
      gcps_.push({
        gcp_id: feature.values_["gcp_id"],
        columns_from_left: feature.values_["columns_from_left"],
        rows_from_top: feature.values_["rows_from_top"],
        longitude: feature.values_["longitude"],
        latitude: feature.values_["latitude"],
        x_dms: dec2dms(feature.values_["longitude"]),
        y_dms: dec2dms(feature.values_["latitude"]),
        crs: feature.values_["crs"],
        color: feature.values_["color"],
        system,
        system_version: version,
        provenance,
        model: feature.values_["model"],
        model_version: feature.values_["model_version"],
        reference_id: feature.values_["reference_id"],
        just_edited: feature.values_["just_edited"],
      });
    }
    // keep order of original react array not order of features in openlayers
    let gcps_ordered = [];
    for (let gcp of gcps) {
      for (let feature of gcps_) {
        if (feature["gcp_id"] == gcp["gcp_id"]) {
          gcps_ordered.push(feature);
        }
      }
    }
    setGCPs([...gcps_ordered]);
  }

  function deleteGCP(old_gcp) {
    setGCPs([...gcps].filter((x) => x.gcp_id !== old_gcp.gcp_id));
  }

  function turnOnDraw() {
    drawRef.current.setActive(!drawRef.current.values_.active);
  }

  function clearClippedPolygons(map) {
    setExtractedText("");
    setReasoning("");
    setEPSGs([]);
    getLayerById(map, "bounding-box").getSource().clear();
  }

  function send_for_ocr() {
    let features = getLayerById(map, "bounding-box").getSource().getFeatures();
    let bboxes = [];
    for (let feat of features) {
      bboxes.push(feat.getGeometry().extent_);
    }
    ocr.mutate({ cog_id, bboxes });
  }

  function send_for_EPSGs() {
    let prompt =
      `Here is some ocr extracted text from a geological map. Can you help determine the EPSG code for this map? 
        Make sure to explain your reasoning for each recommendation with a max limit of 5 codes.
        Be succinct with your response with a max limit of words at 500.
        Make sure each code is returned as the code EPSG followed by a : then the number. Like EPSG:32101. 
        Do not allow for spaces between the : and numbers. 
        IMPORTANT: if a map was made before 1983, it cannot use NAD83 datum. if a map was made before 1927, it cannot use NAD27 datum.
        It should look something like EPSG:26919 This code represents the UTM Zone 19N, which corresponds to the Universal Transverse Mercator grid ticks mentioned in the text.
        Here is the text describing the map CRS: ` + extractedText;

    ocrAnalysis.mutate({ prompt });
  }

  function handleExtractedTextChange(e) {
    setExtractedText(e.target.value);
  }

  function returnCRSName(code) {
    for (let epsg of epsg_data["codes"]) {
      if ("label" in epsg) {
        if (epsg["label"].split("__")[0] == code) {
          return <div>Name: {epsg["info"]["name"]}</div>;
        }
      }
    }
  }

  function viewProjections() {
    navigate("/projections/" + cog_id);
    navigate(0);
  }

  const handleProvenanceChange = (event, type) => {
    const option = event.target.name;
    const value = event.target.checked;
    let newOptions = [...provenanceOption];

    if (event.target.checked) {
      // Add the checked option
      newOptions.push(option);
    } else {
      // Remove the unchecked option
      newOptions = newOptions.filter((item) => item !== option);
    }
    let filteredGCPSIds = [];

    if (type === "system") {
      filteredGCPSIds = mapData["all_gcps"]
        .filter((gcp) => newOptions.includes(gcp.system + "_" + gcp.system_version))
        .map((gcp) => gcp.gcp_id);
    } else if (type === "projection") {
      filteredGCPSIds = mapData["proj_info"]
        .filter((proj) => newOptions.includes(proj.projection_id))
        .flatMap((proj) => proj.gcps.map((gcp) => gcp.gcp_id));
    }


    const filteredGCPS = mapData["all_gcps"]
      .filter((gcp) => filteredGCPSIds.includes(gcp.gcp_id))

    setGCPs(filteredGCPS);
    setProvenanceOption(newOptions);
  };

  function saveMapStatus(cog_id, not_a_map) {
    not_a_map = !not_a_map;
    axios({
      method: "post",
      url: "/api/map/update_cog_meta",
      data: {
        cog_id: cog_id,
        no_map: not_a_map,
      },
      headers: _APP_JSON_HEADER,
    })
      .then((response) => {
        if (response.status == 200) {
          // TODO instead of setting map data, we can invalidate
          //      the react-query data and the parent component will
          //      auto fetch and render the new data from this call
          setMapData({
            cog_info: response.data.meta,
            all_gcps: mapDataInit.all_gcps,
            proj_info: mapDataInit.proj_info,
            provenances: mapDataInit.provenances,
          });
        }
      })
      .catch((e) => {
        alert(e);
      });
  }

  return (
    <div className="map-extraction-root">
      <PanelGroup autoSaveId="polymer-pane" direction="horizontal">
        <Panel defaultSize={65} minSize={30}>
          <div className="map-x-controls-wrap">
            {loadingMap && (
              <div className="loading-tiles">
                <MapSpinner />
              </div>
            )}
            {Boolean(mapData["provenances"]?.length) && (
              <div className="control-panel" id="control-panel">
                <Box sx={{ minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Typography style={{ marginRight: "4px" }} variant="body1">Select GCPs:</Typography>
                    <Select
                      sx={{
                        borderColor: "white",
                        padding: "5px", // Add padding to the Select component
                        '.MuiSelect-select': {
                          padding: '5px', // Add padding to the dropdown text inside the select
                        }
                      }}
                      style={{ padding: "5px" }}
                      value={GCPGrouping}
                      onChange={(e) => {
                        setGCPs([])
                        setProvenanceOption([])
                        setGCPGrouping(e.target.value)
                      }}
                      displayEmpty
                    >

                      <MenuItem key="system" value="system">
                        System
                      </MenuItem>
                      <MenuItem key="projection" value="projection">
                        Projection
                      </MenuItem>
                    </Select>
                    <PolymerTooltip
                      title={provenanceVisible ? "Hide" : "Show"}
                    >
                      <IconButton
                        color="secondary"
                        onClick={() => {
                          setProvenanceVisible(!provenanceVisible);
                        }}
                      >
                        <FormatAlignJustifyIcon />
                      </IconButton>
                    </PolymerTooltip>
                  </div>
                  {provenanceVisible &&
                    <FormGroup>
                      {GCPGrouping == "system" ?
                        <>
                          {mapData["provenances"].map((option, index) => (
                            <FormControlLabel
                              key={index}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={provenanceOption.includes(option)}
                                  onChange={(e) => {
                                    handleProvenanceChange(e, "system")
                                  }}
                                  name={option}
                                />
                              }
                              label={
                                <Typography
                                  style={{
                                    color: "var(--mui-palette-text-primary)",
                                    maxWidth: "22rem",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {option}
                                </Typography>
                              }
                            />
                          ))}
                        </>
                        :
                        <>
                          {mapData["proj_info"].map((option, index) => (
                            <FormControlLabel
                              key={index}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={provenanceOption.includes(option.projection_id)}
                                  onChange={(e) => {
                                    handleProvenanceChange(e, "projection")
                                  }}
                                  name={option.projection_id}
                                />
                              }
                              label={
                                <Tooltip title={
                                  "Created: " + option.created.split("T")[0] + " " + option.created.split("T")[1].split(".")[0]
                                }>
                                  <Typography
                                    style={{
                                      color: getColorForProvenance(option),
                                      maxWidth: "22rem",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {option.system +
                                      " M"
                                      +
                                      option.created.split('T')[1].split(":")[1]
                                      +
                                      ":"
                                      +
                                      option.created.split('T')[1].split(":")[2].split(".")[0]
                                      +
                                      " "
                                      +
                                      option.crs
                                    }
                                  </Typography>
                                </Tooltip>
                              }
                            />
                          ))}
                        </>
                      }

                    </FormGroup>
                  }

                  {georeferenced && (
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
                  )}
                </Box>
              </div>
            )}
            <div
              ref={mapTargetElement}
              className="map border-radius-right"
              style={{
                width: "100%",
                height: "100%",
                position: "relative",
              }}
            />
          </div>
        </Panel>
        <PanelResizeHandle className="panel-resize-handle" />
        {/* add `collapsible` prop to Panel to allow closing */}
        <Panel defaultSize={35} minSize={15}>
          <div key={"scroll" + cog_id} className="side-panel">
            <section className="panel-menu">
              <LoadingButton
                startIcon={<MapIcon />}
                loadingPosition="start"
                loading={reproject.isPending}
                onClick={() => project(gcps)}
              >
                Project Map
              </LoadingButton>
              {/* {isProjected && (
              <Button onClick={() => viewProjections()}>
                VIEW PROJECTIONS
              </Button>
            )} */}
              <Button
                color={mapData["cog_info"]["no_map"] ? "warning" : "error"}
                onClick={(e) =>
                  saveMapStatus(
                    mapData["cog_info"]["cog_id"],
                    mapData["cog_info"]["no_map"],
                  )
                }
              >
                {mapData["cog_info"]["no_map"] ? "Mark as Map" : "Not A Map"}
              </Button>
              <Button
                color="primary"
                onClick={() =>
                  oneMap(
                    "not_georeferenced",
                    navigate,
                    createPath("not_georeferenced", ".."),
                  )
                }
              >
                Random Map
              </Button>
            </section>

            <Paper className="crs-ocr-root">
              <div className="crs-form">
                <Autocomplete
                  value={map_crs}
                  disablePortal
                  options={epsg_data["codes"]}
                  renderInput={(params) => (
                    <TextField {...params} label="Map CRS" />
                  )}
                  onInputChange={(event, value) => {
                    setMapCRS(value.split("__")[0]);
                  }}
                />
                {showOCR && (
                  <div className="ocr-expanded">
                    <Typography color="warning.main" paragraph>
                      Warning: These are recomendations generated by AI, not an
                      expert. Please verify before georeferencing.
                    </Typography>
                    <Typography paragraph className="crs-help-description">
                      Select an area of the map with the most relevant
                      information about the map CRS. It is possible to create
                      multiple boxes, as the text from each will be combined. It
                      helps to include the year the map was created, either by
                      manually entering it or finding it on the map and
                      extracting it. The extracted text is sent to chat GPT to
                      help determine the EPSG code.
                    </Typography>

                    <LoadingButton
                      loading={ocr.isPending}
                      startIcon={<ScanIcon />}
                      loadingPosition="start"
                      onClick={(e) => send_for_ocr()}
                    >
                      Extract Text from Polygons
                    </LoadingButton>
                    <Button
                      color="error"
                      onClick={() => clearClippedPolygons(map)}
                    >
                      Clear Polygons
                    </Button>
                    <TextField
                      id="filled-multiline-flexible"
                      size="small"
                      fullWidth
                      label="Extracted Text"
                      multiline
                      maxRows={4}
                      variant="filled"
                      value={extractedText}
                      onChange={(e) => {
                        handleExtractedTextChange(e);
                      }}
                    />
                    <br />
                    <Button
                      disabled={!extractedText || ocrAnalysis.isPending}
                      onClick={(e) => send_for_EPSGs()}
                    >
                      Get CRS Recomendations
                    </Button>
                    <ul>
                      {EPSGs.map((gcp, i) => {
                        return (
                          <li key={i}>
                            {gcp}: {returnCRSName(gcp)} { }
                          </li>
                        );
                      })}
                    </ul>
                    <p>{reasoning}</p>
                  </div>
                )}
                <Button
                  color="secondary"
                  className="crs-button"
                  variant="text"
                  onClick={() => {
                    setShowOCR(!showOCR);
                    turnOnDraw();
                  }}
                >
                  {showOCR ? "Hide Map CRS" : "Use Map CRS Tool"}
                </Button>
              </div>
            </Paper>

            {Boolean(gcps.length) && (
              <GCPList
                gcps={gcps}
                cog_id={cog_id}
                scrollerRef={gcpsListRef}
                GCPOps={{ updateGCP, deleteGCP }}
                height={mapData["cog_info"]["height"]}
                readonly={false}
                ClipComponent={SmallMap}
              />
            )}
          </div>
        </Panel>
      </PanelGroup>
      <Snackbar
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        open={areMutationErrors}
        autoHideDuration={6000}
        onClose={closeNotifier}
      >
        <Alert
          onClose={closeNotifier}
          severity="error"
          variant="filled"
          sx={{ width: "100%" }}
        >
          {reproject.isError
            ? `Projection failed. ${reproject?.error?.message},`
            : ocr.isError
              ? `OCR failed. ${ocr?.error?.message}`
              : ocrAnalysis.isError &&
              `OCR Analysis failed. ${ocrAnalysis?.error?.message}`}
        </Alert>
      </Snackbar>
    </div >
  );
}

export default GeoreferenceComponent;
