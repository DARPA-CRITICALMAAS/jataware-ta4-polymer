import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TablePagination,
  TableHead,
} from "@mui/material";

import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import T from "@mui/material/Typography";

import { createPath, oneMap } from "./components/helpers";
import { useNavigate } from "react-router-dom";
import FileUploadForm from "./components/uploadFile";
import CircularProgress from "@mui/material/CircularProgress";
import Slider from "@mui/material/Slider";
import FormControlLabel from "@mui/material/FormControlLabel";
import GeoJSON from "ol/format/GeoJSON";
import Autocomplete from "@mui/material/Autocomplete";
import InfoIcon from "@mui/icons-material/Info";

import XYZ from "ol/source/XYZ";
import TileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import View from "ol/View";
import Draw, { createBox } from "ol/interaction/Draw";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import { Fill, Stroke, Style, Text } from "ol/style";
import { getLayerById } from "./components/helpers";
import { transform } from "ol/proj";
import state_data from "./assets/simplified_states_geojson_file.json";
import WrongLocationIcon from "@mui/icons-material/WrongLocation";
import Header from "./components/Header";
import "./css/landing.scss";

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
function Landing() {
  const navigate = useNavigate();
  const [mapsList, setMapsList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [showPagination, setShowPagination] = useState(false);
  const [statCounts, setStatCounts] = useState({});
  const [loading, setLoading] = useState(false);

  const [viewMapFinder, setViewMapFinder] = useState(true);
  const [searchParams, setSearchParams] = useState({
    georeferenced: true,
    not_georeferenced: true,
    validated: true,
  });
  const [scaleRangeValue, setScaleRangeValue] = useState([0, 150]);
  const [scaleMarks, setScaleMarks] = useState([
    { value: 150, label: "1:1,000,000" },
    { value: 125, label: "1:250,000" },
    { value: 100, label: "1:100,000" },
    { value: 75, label: "1:75,000" },
    { value: 50, label: "1:50,000" },
    { value: 25, label: "1:25,000" },
    { value: 10, label: "1:10,000" },
    { value: 0, label: "1:0" },
  ]);

  const [scaleMapper, setScaleMapper] = useState({});
  const [stateNames, setStateNames] = useState({});
  const [statesBorders, setStatesBorders] = useState(null);
  const [selectedState, setSelectedState] = useState(null);

  const mapRef = useRef(null);
  const mapTargetElement = useRef<HTMLDivElement>(null);
  let draw;
  const drawRef = useRef();
  const [clickedMap, setClickedMap] = useState({});
  const [totalMapsFound, setTotalMapsFound] = useState(0);

  const updateSearchParams = (event) => {
    setPage(0);
    const { name, checked } = event.target;

    setSearchParams((prevSearchParams) => ({
      ...prevSearchParams,
      [name]: checked,
    }));
  };
  const scaleRangeChange = (event, newValue) => {
    setPage(0);
    setScaleRangeValue(newValue);
  };

  const base_source = new XYZ({
    url: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
    crossOrigin: "",
  });

  const base_layer = new TileLayer({
    id: "Satellite",
    source: base_source,
    visible: true,
  });

  function getFeatureStyle(feature) {
    var georeferenced = feature.get("georeferenced");
    var validated = feature.get("validated");
    var highlight = feature.get("highlight");

    if (highlight == true) {
      return new Style({
        fill: new Fill({
          color: "rgb(58, 150, 121,.1)",
        }),
        stroke: new Stroke({
          color: "red",
          width: 3,
        }),
      });
    } else if (validated === true) {
      return new Style({
        fill: new Fill({
          color: "rgb(58, 150, 121,.1)",
        }),
        stroke: new Stroke({
          color: "white",
          width: 3,
        }),
      });
    } else if (georeferenced === true) {
      // Use a yellowish style for other conditions
      return new Style({
        fill: new Fill({
          color: "rgba(255, 255, 0, 0.1)", // Yellowish color
        }),
        stroke: new Stroke({
          color: "white",
          width: 3,
        }),
      });
    } else {
      return new Style({
        fill: new Fill({
          color: "rgba(255, 0, 0, 0.1)",
        }),
        stroke: new Stroke({
          color: "white",
          width: 3,
        }),
      });
    }
  }

  const found_maps_source = new VectorSource({ wrapX: false });
  const found_maps_layer = new VectorLayer({
    id: "found-maps",
    source: found_maps_source,
    style: getFeatureStyle,
  });
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const closerRef = useRef(null);

  const clip_source = new VectorSource({ wrapX: false });
  const clip_layer = new VectorLayer({
    id: "bounding-box",
    source: clip_source,
  });

  function remove_old_clip() {
    let feature_source = getLayerById(
      mapRef.current,
      "bounding-box",
    ).getSource();
    let features = feature_source.getFeatures();
    if (features.length == 1) {
      feature_source.removeFeature(features[0]);
    }
    features = feature_source.getFeatures();
  }

  const handleMapFeatureClick = (event) => {
    const feature = mapRef.current.forEachFeatureAtPixel(
      event.pixel,
      (feature) => feature,
    );

    if (feature && feature.getProperties()["map_name"]) {
      setClickedMap(feature.getProperties());
    } else {
      setClickedMap({});
    }
  };
  const loadStats = async () => {
    try {
      let { data } = await axios({
        method: "get",
        url: "/api/map/maps_stats",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });

      setStatCounts(data);
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const paginateMaps = async () => {
    try {
      const geojsonFormat = new GeoJSON();
      if (mapRef.current == null) return;
      let features_source = getLayerById(
        mapRef.current,
        "bounding-box",
      ).getSource();
      let features = features_source.getFeatures();
      let bbox = features[0];
      let convertedGeojsonFeature;
      if (bbox !== undefined) {
        let sourceCoordinates;
        let destCoordinates;
        if (bbox.getGeometry().getType() == "Polygon") {
          convertedGeojsonFeature = geojsonFormat.writeFeatureObject(bbox);
          sourceCoordinates = convertedGeojsonFeature.geometry.coordinates;
          let new_coords = [];
          destCoordinates = transformPolygonCoordinates(
            sourceCoordinates,
            "EPSG:3857",
            "EPSG:4326",
          );
          new_coords.push(destCoordinates);
          convertedGeojsonFeature.geometry.coordinates = new_coords;
        } else if (bbox.getGeometry().getType() == "MultiPolygon") {
          convertedGeojsonFeature = geojsonFormat.writeFeatureObject(bbox);
          sourceCoordinates = convertedGeojsonFeature.geometry.coordinates;
          let new_coords = [];
          for (let poly of sourceCoordinates) {
            new_coords.push(
              transformPolygonCoordinates(poly, "EPSG:3857", "EPSG:4326"),
            );
          }
          convertedGeojsonFeature.geometry.coordinates = new_coords;
        }
      } else {
        convertedGeojsonFeature = null;
      }

      if (checkObjectForFalseValues(searchParams)) {
        return;
      }
      if (scaleMapper[scaleRangeValue[0]] == scaleMapper[scaleRangeValue[1]]) {
        return;
      }
      var data = {
        ...searchParams,
        multi_polygons_intersect: {
          coordinates: convertedGeojsonFeature.geometry.coordinates,
          type: "MultiPolygon",
        },
        scale_min: scaleMapper[scaleRangeValue[0]],
        scale_max: scaleMapper[scaleRangeValue[1]],
        search_text: searchTerm,
        page_size: rowsPerPage,
        page_number: page,
      };
      axios({
        method: "post",
        url: "/api/map/maps_in_bbox",
        data: data,
        headers: _APP_JSON_HEADER,
      }).then((response) => {
        let map_layer_source = getLayerById(
          mapRef.current,
          "found-maps",
        ).getSource();
        map_layer_source.clear();
        if (response["data"]["maps"].length > 0) {
          setMapsList(response["data"]["maps"]);
          setTotalMapsFound(response["data"]["total_hits"]);
          response["data"]["maps"].forEach(function (map) {
            let bounds = [];
            for (let b of map.best_bounds_geojson.coordinates[0]) {
              let transformed_bound = transform(b, "EPSG:4326", "EPSG:3857");
              bounds.push(transformed_bound);
            }
            map.best_bounds_geojson.coordinates[0] = bounds;
            let geoJSONFeature = new GeoJSON().readFeature({
              type: "Feature",
              geometry: map.best_bounds_geojson,
              properties: {
                map_name: map.map_name,
                map_id: map.map_id,
                georeferenced: map.georeferenced,
                validated: map.validated,
                highlight: false,
              },
            });
            map_layer_source.addFeature(geoJSONFeature);
          });

          setShowPagination(true);
        } else {
          setMapsList([]);
          setTotalMapsFound(0);
        }
      });
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };
  useEffect(() => {
    const dict_ = scaleMarks.reduce((acc, item) => {
      acc[item.value] = parseInt(
        item.label.split(":")[1].replace(/,/g, ""),
        10,
      );
      return acc;
    }, {});

    setScaleMapper(dict_);
  }, []);

  useEffect(() => {
    paginateMaps();
  }, [page, rowsPerPage]);

  useEffect(() => {
    let states = [];
    for (let d of state_data.features) {
      let sourceCoordinates;
      let destCoordinates;
      states.push(d.properties["NAME"]);
      if (d.geometry.type == "Polygon") {
        sourceCoordinates = d.geometry.coordinates;
        destCoordinates = transformPolygonCoordinates(
          sourceCoordinates,
          "EPSG:4326",
          "EPSG:3857",
        );
        d.geometry.coordinates = destCoordinates;
      } else if (d.geometry.type == "MultiPolygon") {
        sourceCoordinates = d.geometry.coordinates;
        let new_coords = [];
        for (let poly of sourceCoordinates) {
          new_coords.push(
            transformPolygonCoordinates(poly, "EPSG:4326", "EPSG:3857"),
          );
        }
        d.geometry.coordinates = new_coords;
      }
    }
    setStateNames(states);
    setStatesBorders(state_data);
  }, []);

  useEffect(() => {
    document.title = "Map Explorer";
    document.title = "Polymer Maps";
    loadStats();

    const map = new Map({
      layers: [base_layer, clip_layer, found_maps_layer],
      view: new View({
        center: [-11688546.533293726, 5311971.846945472],
        zoom: 3,
      }),
      controls: [],
    });

    map.setTarget(mapTargetElement.current || "");
    draw = new Draw({
      source: clip_source,
      type: "Circle",
      geometryFunction: createBox(),
    });
    draw.on("drawend", function () {
      remove_old_clip();
      setSelectedState(null);
    });

    draw.setActive(true);
    drawRef.current = draw;
    map.addInteraction(draw);

    map.on("click", function (e) {
      handleMapFeatureClick(e);
    });

    mapRef.current = map;
  }, []);

  function returnRowColor(map) {
    if (map["not_a_map"]) return "lightgray";
    if (map["validated"]) return "#3a9679";
    if (map["georeferenced"]) return "#fabc60";
    return "#e16262";
  }

  function submitSearch() {
    setPage(0);
    setRowsPerPage(10);
    paginateMaps();
    setShowPagination(true);
  }

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };

  function navigateToMap(mapStatus) {
    oneMap(mapStatus, navigate, createPath(mapStatus, "."));
  }

  function checkObjectForFalseValues(inputObject) {
    const allFalse = Object.values(inputObject).every(
      (value) => value === false,
    );
    if (allFalse) {
      alert(
        "Alert: Please select at least one Map type (Georeferenced, Validated, or Not Georeferenced) ",
      );
      return true;
    }
    return false;
  }

  function transformExtent(coordinates, source, dest) {
    let coordinates1 = transform(
      [coordinates[0], coordinates[1]],
      source,
      dest,
    );
    let coordinates2 = transform(
      [coordinates[2], coordinates[3]],
      source,
      dest,
    );

    const extentArray = [
      coordinates1[0],
      coordinates1[1],
      coordinates2[0],
      coordinates2[1],
    ];
    return extentArray;
  }

  function search_for_maps() {
    setPage(0);
    setRowsPerPage(10);
    paginateMaps();
  }

  const transformPolygonCoordinates = (coordinates, source, dest) => {
    let new_coords = [];
    for (let arr of coordinates) {
      let new_arr = [];
      for (let x of arr) {
        new_arr.push(transform(x, source, dest));
      }
      new_coords.push(new_arr);
    }
    return new_coords;
  };

  function handleStateSelection(e) {
    let features_source = getLayerById(
      mapRef.current,
      "bounding-box",
    ).getSource();
    if (e == "" || statesBorders == null) {
      features_source.clear();
      setSelectedState(null);
    } else {
      setSelectedState(e);

      let features_source = getLayerById(
        mapRef.current,
        "bounding-box",
      ).getSource();

      let features = features_source.getFeatures();
      if (features.length == 1) {
        features_source.removeFeature(features[0]);
      }

      for (let state of statesBorders.features) {
        if (state.properties["NAME"] == e) {
          let geoJSONFeature = new GeoJSON().readFeature(state);
          features_source.addFeature(geoJSONFeature);
        }
      }
    }
  }

  function updateMapHighlight(map_id, value) {
    let maps = [];
    for (let map of mapsList) {
      if (map["map_id"] == map_id) {
        map["highlight"] = value;
      }
      maps.push(map);
    }
    setMapsList([...maps]);
    let map_layer_source = getLayerById(
      mapRef.current,
      "found-maps",
    ).getSource();

    map_layer_source.clear();
    for (let map of maps) {
      let geoJSONFeature = new GeoJSON().readFeature({
        type: "Feature",
        geometry: map.best_bounds_geojson,
        properties: {
          map_name: map.map_name,
          map_id: map.map_id,
          georeferenced: map.georeferenced,
          validated: map.validated,
          highlight: map.highlight,
        },
      });
      map_layer_source.addFeature(geoJSONFeature);
    }
  }

  return (
    <>
      {loading && (
        <div className="loading">
          <CircularProgress />
        </div>
      )}
      {mapsList && (
        <>
          <div className="landing-root">
            <Header navigate={navigate} />
            <div className="header">
              <T variant="h3" className="title">
                Find Maps
              </T>
              <div className="file-upload">
                <FileUploadForm setLoading={setLoading} />
              </div>
            </div>
            <div className="stats-container">
              <div className="stats_container">
                <div className="stat_nav">
                  <b>
                    Total Maps:&nbsp;
                    {statCounts["validated"] +
                      statCounts["georeferenced"] +
                      statCounts["not_georeferenced"]}
                  </b>
                  <div className="card-grid">
                    <div className="card2">
                      <div className="card-title">
                        <span
                          style={{
                            backgroundColor: returnRowColor({
                              validated: false,
                              georeferenced: true,
                            }),
                            borderRadius: "5px",
                            padding: "3px",
                          }}
                        >
                          Georeferenced
                        </span>
                      </div>
                      <div className="card-count">
                        Count: {statCounts["georeferenced"]}
                      </div>
                      <button onClick={() => navigateToMap("georeferenced")}>
                        View
                      </button>
                    </div>

                    <div className="card2">
                      <div className="card-title">
                        <span
                          style={{
                            backgroundColor: returnRowColor({
                              validated: false,
                              georeferenced: false,
                            }),
                            borderRadius: "5px",
                            padding: "3px",
                          }}
                        >
                          Not Georeferenced
                        </span>
                      </div>
                      <div className="card-count">
                        Count: {statCounts["not_georeferenced"]}
                      </div>
                      <button
                        onClick={() => navigateToMap("not_georeferenced")}
                      >
                        View
                      </button>
                    </div>

                    <div className="card2">
                      <div className="card-title">
                        <span
                          style={{
                            backgroundColor: returnRowColor({
                              validated: true,
                              georeferenced: false,
                            }),
                            borderRadius: "5px",
                            padding: "3px",
                          }}
                        >
                          Complete
                        </span>
                      </div>
                      <div className="card-count">
                        Count: {statCounts["validated"]}
                      </div>
                      <button onClick={() => navigateToMap("validated")}>
                        View
                      </button>
                    </div>
                    <div className="card2">
                      <div className="card-title">
                        <span
                          style={{
                            backgroundColor: returnRowColor({
                              not_a_map: true,
                            }),
                            borderRadius: "5px",
                            padding: "3px",
                          }}
                        >
                          Not Maps
                        </span>
                      </div>
                      <div className="card-count">
                        Count: {statCounts["not_a_map"]}
                      </div>
                      <button onClick={() => navigateToMap("not_a_map")}>
                        View
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/*stats container*/}
            <div className="mapSearch">
              <div className="search_group">
                <div className="checkbox-grid">
                  <FormControlLabel
                    className="filter_item"
                    control={
                      <Checkbox
                        checked={searchParams.validated}
                        onChange={updateSearchParams}
                        name="validated"
                      />
                    }
                    label="Validated"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={searchParams.georeferenced}
                        onChange={updateSearchParams}
                        name="georeferenced"
                      />
                    }
                    label="Georeferenced"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={searchParams.not_georeferenced}
                        onChange={updateSearchParams}
                        name="not_georeferenced"
                      />
                    }
                    label="Not Georeferenced"
                  />
                  <div>
                    Scale (1:n):
                    <Slider
                      value={scaleRangeValue}
                      onChange={scaleRangeChange}
                      aria-labelledby="range-slider"
                      marks={scaleMarks}
                      min={0}
                      max={150}
                      step={null}
                      sx={{
                        "& .MuiSlider-markLabel": {
                          transform: "rotate(-35deg) translateX(-50%)", // Adjusts position after rotation
                          padding: "2px",
                          fontSize: "10px",
                          left: "calc(-50% + 4px)", // Adjust this value as needed for alignment
                          top: "20px",
                        },
                        "& .MuiSlider-mark": {
                          height: "8px",
                          width: "3px",
                          backgroundColor: "rgba(0, 0, 0, 0.54)",
                        },
                      }}
                    />
                  </div>
                </div>
                <div className="search-grid">
                  <div className="search-state">
                    <Autocomplete
                      value={selectedState}
                      className="autoComplete"
                      disablePortal
                      options={stateNames}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          label="Select a State"
                        />
                      )}
                      onInputChange={(event, value) => {
                        handleStateSelection(value);
                      }}
                    />
                    <IconButton
                      className="nav-to-state"
                      onClick={() => {
                        handleStateSelection("");
                      }}
                      style={{ color: "red" }}
                    >
                      <WrongLocationIcon />
                    </IconButton>
                  </div>

                  <TextField
                    size="small"
                    label="Search for text on map"
                    variant="outlined"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitSearch();
                      }
                    }}
                  />

                  <Button
                    style={{ justifySelf: "end", width: "30%", height: "35px" }}
                    onClick={() => search_for_maps()}
                    variant="contained"
                    size="small"
                  >
                    Search
                  </Button>
                </div>
              </div>
              <div style={{ display: "grid", width: "100%", display: "flex" }}>
                <div
                  className="centered-content"
                  style={{ minWidth: "65%", maxWidth: "800px" }}
                >
                  <div
                    ref={mapTargetElement}
                    id="map"
                    className="map"
                    style={{
                      width: "100%",
                      height: "100%",
                      position: "relative",
                    }}
                  />
                </div>
                <div style={{ minWidth: "30%" }}>
                  <div style={{ overflowY: "auto", height: "545px" }}>
                    <TablePagination
                      component="div"
                      count={totalMapsFound}
                      page={page}
                      onPageChange={handleChangePage}
                      rowsPerPage={rowsPerPage}
                      onRowsPerPageChange={handleChangeRowsPerPage}
                    />

                    {mapsList.map((item, index) => (
                      <MapScrollCard
                        key={index}
                        returnRowColor={returnRowColor}
                        item={item}
                        updateMap={updateMapHighlight}
                      ></MapScrollCard>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default Landing;

function MapScrollCard({ returnRowColor, item, updateMap }) {
  const [info, setInfo] = React.useState(false);

  function handleInfoClick() {
    setInfo(!info);
    updateMap(item["map_id"], !item.highlight);
  }
  function handleMapClick(map_info, path) {
    window.open("./" + path + "/" + map_info["cog_id"]);
  }

  return (
    <div
      key={item.map_id}
      style={{
        color: "black",
        backgroundColor: returnRowColor(item),
        border: "1px solid black",
        padding: "4px",
        borderRadius: "5px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h5 style={{ margin: "4px" }}>
        <span style={{ color: "black", fontSize: "15px" }}>
          {" "}
          {item["title"]}
        </span>
      </h5>
      <p style={{ margin: "4px" }}>
        <strong>Year:</strong>{" "}
        <span style={{ color: "black" }}>{item["year"]}</span>
      </p>
      <p style={{ margin: "4px" }}>
        <strong>Author:</strong>{" "}
        <span style={{ margin: "4px", color: "black" }}>{item["authors"]}</span>
      </p>
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          justifyContent: "space-evenly",
        }}
      >
        {item.validated ? (
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              handleMapClick(item, "points");
            }}
          >
            Georeference
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              handleMapClick(item, "points");
            }}
          >
            Georeference
          </Button>
        )}
        {item.georeferenced ? (
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              handleMapClick(item, "projections");
            }}
          >
            Projections
          </Button>
        ) : (
          <Button
            size="small"
            disabled
            variant="contained"
            onClick={() => {
              handleMapClick(item, "projections");
            }}
          >
            Projections
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          onClick={() => {
            handleMapClick(item, "swatchannotation");
          }}
        >
          Legend Annotations
        </Button>

        <InfoIcon
          aria-label="expand row"
          size="small"
          onClick={() => handleInfoClick()}
        ></InfoIcon>
        <br></br>
      </div>

      {info && (
        <div
          style={{
            color: "black",
            backgroundColor: returnRowColor(item),
            padding: "4px",
            borderRadius: "5px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <p style={{ margin: "4px" }}>
            <strong>Map ID:</strong>{" "}
            <span style={{ color: "black" }}>{item["map_id"]}</span>
          </p>
          <p style={{ margin: "4px" }}>
            <strong>Map Name:</strong>{" "}
            <span style={{ margin: "4px", color: "black" }}>
              {item["map_name"]}
            </span>
          </p>
          <p style={{ margin: "4px" }}>
            <strong>Category:</strong>{" "}
            <span style={{ margin: "4px", color: "black" }}>
              {item["category"]}
            </span>
          </p>
          <p style={{ margin: "4px" }}>
            <strong>Series Name:</strong>{" "}
            <span style={{ margin: "4px", color: "black" }}>
              {item["series_name"]}
            </span>
          </p>
          <p style={{ margin: "4px" }}>
            <strong>Publisher:</strong>{" "}
            <span style={{ margin: "4px", color: "black" }}>
              {item["publisher"]}
            </span>
          </p>
          <p style={{ margin: "4px" }}>
            <strong>Publication Link:</strong>{" "}
            <span style={{ margin: "4px", color: "black" }}>
              {item["pub_link"]}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
