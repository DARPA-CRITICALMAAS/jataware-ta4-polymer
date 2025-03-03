import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import { Vector as VectorLayer } from "ol/layer";
import XYZ from "ol/source/XYZ";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import View from "ol/View";
import { transform, get as getProjection } from "ol/proj";
import proj4 from "proj4";
import Draw, { createBox } from "ol/interaction/Draw";
import { getCenter } from "ol/extent";
import { Projection } from "ol/proj";

import { Modal, Switch } from "@mui/material";
import { Card, CardContent, Link } from "@mui/material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Divider from "@mui/material/Divider";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { MapSpinner } from "../Spinner";
import SmallMapImage from "./smallMapImage";
import SmallProjectionClipped from "./smallProjectionClipped";
import GCPList from "./GCPList";

import {
  determineMapSourceURL,
  oneMap,
  createPath,
  checkIfEdited,
  getColorForProvenance,
  register_proj,
  getLayerById,
  basemapURLS,
  handleOpacityChange,
  loadWMTSLayer,
  getShapeCenterPoint,
  returnInCDR,
  returnInCDRStyle,
} from "./helpers";
import { fromUrl, fromArrayBuffer, fromBlob } from "geotiff";
import SubmitProjectionModal from "./SubmitProjectionModal";
import ControlPanel from "./ProjectionControlPanel";
import { useConfig } from '../ConfigContext';

import "../css/projection_viewer.scss";

// Params

// const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function order_projections(proj_info) {
  let validated_projections = []
  let non_validated = []
  for (let x of proj_info) {
    if (x['status'] == "validated") {
      validated_projections.push(x)
    } else {
      non_validated.push(x)
    }
  }
  validated_projections.sort((a, b) => new Date(b.created) - new Date(a.created));
  non_validated.sort((a, b) => new Date(b.created) - new Date(a.created));

  let all = [...validated_projections, ...non_validated]
  return all
}

function ProjectionsPage({ cog_id, mapData }) {
  const config = useConfig();

  const navigate = useNavigate();
  const cog_name = mapData["cog_info"]["cog_name"];
  const all_proj_info = order_projections(mapData["proj_info"]);
  const proj_index = useRef(0);
  const curr_proj_info = all_proj_info[proj_index.current];

  const [loadingMap, setLoadingMap] = useState(true);

  const mapTargetElement = useRef<HTMLDivElement>(null);
  const [gcps, setGCPS] = useState();
  const mapRef = useRef();
  const currZoomRef = useRef();

  let draw;
  const drawRef = useRef();
  const clippedExtentIndex = useRef(0);
  const [clippedState, setClippedState] = useState({
    clipExentRef: null,
    clippedCenter: null,
    clippedProjection: null,
  });

  const [openReview, setOpenReview] = useState(false);
  const [showGCPs, setShowGCPs] = useState(true);
  const [showClippedMaps, setShowClippedMaps] = useState(false);
  const [showButtonForClip, setShowButtonForClip] = useState(false);

  const [baseMapSwitch, setBaseMapSwitch] = useState();
  const [baseMapSources, setBaseMapSources] = useState();
  const [baseSelected, setBaseSelected] = useState("USGSTopo");
  const [currentProj, setCurrentProj] = useState();

  const currCenterRef = useRef();
  const Proj_Ref = useRef();
  const baseMapSwitchRef = useRef({});

  const handleClose = () => {
    setOpenReview(false);
  };


  const base_source = new XYZ({
    url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${config.MAPTILER_KEY}`,
    crossOrigin: "",
    projection: 'EPSG:3857'
  });

  const base_layer = new TileLayer({
    id: "Satellite",
    source: base_source,
    visible: false,
  });
  const XYZ_base_layers = { Satellite: base_layer };
  let first_proj = all_proj_info[proj_index.current]["crs"];

  const clip_source = new VectorSource({ wrapX: false });
  const clip_layer = new VectorLayer({
    id: "bounding-box",
    source: clip_source,
  });

  async function register_projs(codes) {
    for (let code of codes) {
      await register_proj(code, config.MAPTILER_KEY);
    }
  }

  async function buildWMTSBaseLayers(center) {
    let allWMTSBaseLayers = {};
    let allWMTSSourceLayers = {};
    for (let url of basemapURLS) {
      let [resp, sources] = await loadWMTSLayer(url);
      if (url.includes("USGSTopo")) {
        resp["USGSTopo"].setVisible(true);
      }

      allWMTSBaseLayers = { ...allWMTSBaseLayers, ...resp };
      allWMTSSourceLayers = { ...allWMTSSourceLayers, ...sources };
    }
    return [allWMTSBaseLayers, allWMTSSourceLayers, center];
  }

  async function waitForProjections(codes) {
    try {
      await register_projs(codes);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  }

  // Render map
  useEffect(() => {
    document.title = "Polymer Georeferencer Projections -" + cog_id;
    proj_index.current = 0;

    // need to update values here when cog_id changes
    setGCPS(curr_proj_info["gcps"]);
    mapRef.current = null;
    proj_index.current = 0;
    setCurrentProj(curr_proj_info["crs"]);
    Proj_Ref.current = curr_proj_info["crs"];

    let codes = ["EPSG:4267"];
    for (let proj_ of all_proj_info) {
      codes.push(proj_["crs"]);
    }
    waitForProjections(codes)
      .then(() => {
        return setCenterExtent();
      })
      .then((center) => {
        return buildWMTSBaseLayers(center);
      })
      .then(([WMTS_base_layers, WMTS_source_layers, center]) => {
        const map_source = new GeoTIFF({
          sources: [
            {
              url: determineMapSourceURL(curr_proj_info, cog_id, config),
              nodata: -1,
            },
          ],
          projection: first_proj,
          convertToRGB: true,
          interpolate: false,
        });

        const map_layer = new TileLayer({
          id: "map-layer",
          source: map_source,
        });

        let all_layers = [
          ...Object.values(XYZ_base_layers),
          ...Object.values(WMTS_base_layers),
          map_layer,
          clip_layer,
        ];

        baseMapSwitchRef.current = { ...XYZ_base_layers, ...WMTS_base_layers };
        setBaseMapSwitch({ ...XYZ_base_layers, ...WMTS_base_layers });
        setBaseMapSources({ ...WMTS_source_layers });
        const map = new Map({
          controls: [],
          layers: all_layers,
          view: new View({
            center: center,
            zoom: 8,
            projection: curr_proj_info["crs"],
          }),
        });
        currZoomRef.current = map.getView().getZoom();

        map.on("loadend", function () {
          setLoadingMap(false);
        });

        map.on("moveend", function (e) {
          var newZoom = map.getView().getZoom();
          var newCenter = map.getView().getCenter();

          if (currZoomRef.current != newZoom) {
            currZoomRef.current = newZoom;
          }
          if (currCenterRef.current != newCenter) {
            currCenterRef.current = newCenter;
          }
        });

        // set Target
        map.setTarget(mapTargetElement.current || "");

        draw = new Draw({
          source: clip_source,
          type: "Circle",
          geometryFunction: createBox(),
        });
        draw.on("drawend", function () {
          updateClippedState(-1);
          setShowButtonForClip(true);
        });
        draw.setActive(false);
        drawRef.current = draw;
        map.addInteraction(draw);

        // set map ref to map
        mapRef.current = map;
      });

    return;
  }, [cog_id]);

  async function setCenterExtent() {
    let extent = await getGeoTIFFExtent(
      determineMapSourceURL(all_proj_info[0], cog_id, config),
    );
    let center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
    currCenterRef.current = center;
    return center;
  }

  async function getGeoTIFFExtent(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    return bbox;
  }

  async function zoomToCurrentCogCenter() {
    const curr_proj_crs = all_proj_info[proj_index.current]["crs"];

    if (!gcps.length) {
      // helps with division by zero
      throw new Error(
        "Should not be in projections page. No GCPs, cannot calulate center.",
      );
    }

    const convertedGCPs = gcps.map((point) => {
      const basePoint = [point.longitude, point.latitude];
      if (curr_proj_crs !== point.crs) {
        return proj4(point.crs, curr_proj_crs, basePoint);
      }
      return basePoint;
    });

    const center = getShapeCenterPoint(convertedGCPs);

    const view = mapRef.current.getView();
    view.setCenter(center);
  }

  function nextProjection(projIndex = null) {
    // update projection index
    let old_proj = currentProj;

    if (projIndex == null) {
      proj_index.current = 0;
    } else if (proj_index.current == all_proj_info.length - 1) {
      proj_index.current = 0;
    } else {
      proj_index.current = proj_index.current + 1;
    }
    // new map source
    let proj_ = all_proj_info[proj_index.current]["crs"];

    const new_map_source = new GeoTIFF({
      sources: [
        {
          url: determineMapSourceURL(all_proj_info[proj_index.current], cog_id, config),
          nodata: -1,
        },
      ],
      projection: proj_,
      convertToRGB: true,
    });

    setCurrentProj(proj_);

    const newView = new View({
      center: currCenterRef.current,
      zoom: 10,
      projection: proj_,
    });

    mapRef.current.setView(newView);
    Proj_Ref.current = proj_;

    getLayerById(mapRef.current, "map-layer").setSource(new_map_source);

    setGCPS([...all_proj_info[proj_index.current]["gcps"]]);

    var sourceProjection = getProjection(old_proj);
    var targetProjection = getProjection(proj_);

    newView.setCenter(
      transform(currCenterRef.current, sourceProjection, targetProjection),
    );

    // limit to zoom to 16.4 to work with base layers
    if (currZoomRef.current > 16.4) {
      newView.setZoom(16.4);
    } else {
      newView.setZoom(currZoomRef.current);
    }
  }

  function saveProjStatus(cog_id, proj_id, status) {
    axios({
      method: "post",
      url: "/api/map/proj_update",
      data: {
        cog_id: cog_id,
        projection_id: proj_id,
        status: status,
      },
      headers: _APP_JSON_HEADER,
    })
      .then((response) => {
        handleClose();
        if (status == "validated") {
          alert("Validated");

          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
        if (status == "failed") {
          alert("Marked as failed");

          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }


      })
      .catch((e) => {
        alert(e);
      });
  }

  const switchRightPanel = () => {
    setShowGCPs(!showGCPs);
    drawRef.current.setActive(showGCPs);
    if (!showGCPs) {
      let layer_source = getLayerById(
        mapRef.current,
        "bounding-box",
      ).getSource();
      layer_source.clear();
      setShowClippedMaps(false);
      setClippedState((clippedState) => ({
        ...clippedState,
        clipExentRef: null,
        clippedCenter: null,
        clippedProjection: null,
      }));
      setShowButtonForClip(false);
    }
  };

  function updateClippedState(clippedIndex) {
    let features = getLayerById(mapRef.current, "bounding-box")
      .getSource()
      .getFeatures();

    var sourceProjection = mapRef.current.getView().getProjection();

    if (features.length > 0) {
      let feature = features.slice(clippedIndex)[0];
      let extent = feature.getGeometry().extent_;
      setClippedState((clippedState) => ({
        ...clippedState,
        clipExentRef: extent,
        clippedCenter: getCenter(extent),
        clippedProjection: sourceProjection,
      }));
    }
  }

  function viewClippedArea() {
    updateClippedState(0);
    setShowClippedMaps(true);
  }

  function clearClippedArea() {
    //clear polygons
    getLayerById(mapRef.current, "bounding-box").getSource().clear();

    //update state
    setClippedState((clippedState) => ({
      ...clippedState,
      clipExentRef: null,
      clippedCenter: null,
      clippedProjection: null,
    }));
    setShowButtonForClip(false);
    setShowClippedMaps(false);
  }

  function nextClippedPolygon(i = null) {
    let length = getLayerById(mapRef.current, "bounding-box")
      .getSource()
      .getFeatures().length;
    if (i != null) {
      clippedExtentIndex.current = i;
    } else if (clippedExtentIndex.current >= length - 1) {
      clippedExtentIndex.current = 0;
    } else {
      clippedExtentIndex.current = clippedExtentIndex.current + 1;
    }
    updateClippedState(clippedExtentIndex.current);
  }

  function changedBaseMap(key) {
    for (let key_ of Object.keys(baseMapSwitch)) {
      if (key == key_) {
        getLayerById(mapRef.current, key_).setVisible(true);
        if (key === "Satellite") {
          const view = mapRef.current.getView();
          const currZoom = view.getZoom();
          view.setZoom(currZoom - 1);
        }
      } else {
        getLayerById(mapRef.current, key_).setVisible(false);
      }
    }
  }

  const handleBaseChange = (event) => {
    setBaseSelected(event.target.value);
    changedBaseMap(event.target.value);
  };

  function saveProjection() {
    saveProjStatus(
      mapData["cog_info"]["cog_id"],
      all_proj_info[proj_index.current]["projection_id"],
      "validated",
    );
  }

  function failProjection() {
    saveProjStatus(
      mapData["cog_info"]["cog_id"],
      all_proj_info[proj_index.current]["projection_id"],
      "failed",
    );
  }


  function checkValidatedProj(status) {
    if (status == "validated") {
      return "TRUE";
    }

    return "FALSE";
  }
  function returnValidatedStyle(status) {
    if (status == "validated") {
      return {
        marginRight: "5px",
        background: "var(--mui-palette-success-light)",
      };
    }
    return { marginRight: "5px" };
  }

  return (
    <>
      <div key={"flex" + cog_id} className="projection-main">
        <PanelGroup autoSaveId="polymer-pane" direction="horizontal">
          <Panel defaultSize={65} minSize={30}>
            <div className="map-and-panel">
              {loadingMap && (
                <div className="loading-tiles">
                  <MapSpinner />
                </div>
              )}
              <div
                key={"map" + cog_id}
                ref={mapTargetElement}
                className="map"
                id="map"
              />
              <ControlPanel
                handleOpacityChange={(e) =>
                  handleOpacityChange(e, mapRef.current)
                }
                baseSelected={baseSelected}
                handleBaseChange={handleBaseChange}
                baseMapSwitch={baseMapSwitch}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="panel-resize-handle" />

          <Panel defaultSize={35} minSize={15}>
            <aside className="side-panel">
              <section className="side-panel-nav">
                <Button onClick={() => nextProjection(proj_index.current + 1)}>
                  Next Projection ({String(proj_index.current + 1)}/
                  {all_proj_info.length})
                </Button>
                <Button onClick={() => zoomToCurrentCogCenter()}>
                  Center Projection
                </Button>

                <Button color="success" onClick={() => setOpenReview(true)}>
                  Send to CDR
                </Button>

                <Button
                  onClick={() =>
                    oneMap(
                      "georeferenced",
                      navigate,
                      createPath("georeferenced", ".."),
                    )
                  }
                >
                  Random Map
                </Button>
              </section>

              <Typography>
                Projection Provenance:&nbsp;
                <span
                  style={{
                    color: getColorForProvenance(
                      all_proj_info[proj_index.current]["provenance"],
                    ),
                  }}
                >
                  {" " + all_proj_info[proj_index.current]["provenance"]}
                </span>
              </Typography>

              <Typography component="span">
                <span style={{ display: "flex" }}>
                  In CDR:&nbsp;
                  <Chip
                    style={returnInCDRStyle(
                      all_proj_info[proj_index.current]["in_cdr"],
                    )}
                    size="small"
                    label={returnInCDR(
                      all_proj_info[proj_index.current]["in_cdr"],
                    )}
                  />

                </span>
              </Typography>
              <Typography component="span">
                <span style={{ display: "flex" }}>
                  <span>
                    Validated:&nbsp;
                    <Chip
                      style={returnValidatedStyle(
                        all_proj_info[proj_index.current]["status"],
                      )}
                      size="small"
                      label={checkValidatedProj(
                        all_proj_info[proj_index.current]["status"],
                      )}
                    />
                  </span>
                </span>
              </Typography>

              <Typography
                component="div"
                style={{ display: "flex", alignItems: "center" }}
              >
                Projection:
                <span style={{ marginLeft: "5px" }}>
                  {
                    mapData["crs_names"][
                    all_proj_info[proj_index.current]["crs"]
                    ]
                  }
                </span>
                <span style={{ marginLeft: "5px" }}>
                  <Button
                    variant="outlined"
                    href={`https://epsg.io/${all_proj_info[proj_index.current]["crs"].split(":")[1]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ({all_proj_info[proj_index.current]["crs"]})
                  </Button>
                </span>
              </Typography>
              <Typography>
                <span style={{ display: "flex", float: "right" }}>
                  {(all_proj_info[proj_index.current]["in_cdr"] === false) && (
                    <Button variant="text"
                      color="error"
                      onClick={() => {
                        failProjection();
                      }}>
                      Mark as failed
                    </Button>
                  )
                  }
                </span>
              </Typography>

              <FormControlLabel
                className="clipped-areas-toggle"
                control={
                  <Switch
                    checked={!showGCPs}
                    onChange={() => {
                      switchRightPanel();
                    }}
                  />
                }
                label={
                  showGCPs ? "Compare Clipped Areas" : "Comparing Clipped Areas"
                }
              />
              {showGCPs ? (
                Array.isArray(gcps) &&
                gcps.length && (
                  <GCPList
                    gcps={gcps}
                    cog_id={cog_id}
                    ClipComponent={SmallMapImage}
                    height={mapData["cog_info"]["height"]}
                    readonly
                  />
                )
              ) : (
                <>
                  {showButtonForClip == true ? (
                    <div>
                      <Button
                        onClick={() => {
                          viewClippedArea();
                        }}
                      >
                        Process Clipped Area
                      </Button>
                      <Button
                        onClick={() => {
                          clearClippedArea();
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        onClick={() => {
                          nextClippedPolygon();
                        }}
                      >
                        Next Clipped Polygon
                      </Button>
                    </div>
                  ) : (
                    <p>Select an area to view for all projections</p>
                  )}

                  <div className="clipped-maps">
                    <div>
                      {showClippedMaps &&
                        all_proj_info.map((all_proj_info, i) => {
                          return (
                            <div key={all_proj_info.projection_id}>
                              <div className="">
                                <SmallProjectionClipped
                                  cog_id={cog_id}
                                  proj_info={all_proj_info}
                                  clippedState={clippedState}
                                  baseMapSources={baseMapSources}
                                  parentBaseMap={baseSelected}
                                  crs_names={mapData["crs_names"]}
                                />
                                <Button onClick={() => nextProjection(i + 1)}>
                                  View in Main Window
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </>
              )}
            </aside>
          </Panel>
        </PanelGroup>
      </div >
      {/*projection-main*/}

      < SubmitProjectionModal
        open={openReview}
        handleClose={handleClose}
        save={saveProjection}
      />

    </>
  );
}

export default ProjectionsPage;
