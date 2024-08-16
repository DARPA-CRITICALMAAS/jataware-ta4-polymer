import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import { Vector as VectorLayer } from "ol/layer";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import GeoJSON from "ol/format/GeoJSON";
import Draw, { createBox } from "ol/interaction/Draw";
import { Fill, Stroke, Style } from "ol/style";

import Button from "@mui/material/Button";
import ChangeHistoryIcon from "@mui/icons-material/ChangeHistory";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Text from "@mui/material/Typography";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useQuery } from "@tanstack/react-query";
import Tooltip, { TooltipProps, tooltipClasses } from "@mui/material/Tooltip";
import LoadingButton from "@mui/lab/LoadingButton";
import SaveIcon from "@mui/icons-material/Save";

import "../css/legend_annotation.scss";
import { MapSpinner } from "../Spinner";
import {
  getLayerById,
  expand_resolutions,
  returnImageUrl,
  getColorForProvenance,
  validateExtent,
} from "./helpers";
import { useParams } from "react-router-dom";
import { asString } from "ol/color";
import UndoIcon from "@mui/icons-material/Undo";
import ClearIcon from "@mui/icons-material/Clear";
import FormatShapesIcon from "@mui/icons-material/FormatShapes"; // Params
import LegendCard from "./swatchCards";
import LegendCardSuccess from "./legendCardSuccess";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";

import Header from "./Header";
import PolymerTooltip from "./Tooltip";

const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX;
const SYSTEM = import.meta.env.VITE_POLYMER_SYSTEM;
const SYSTEM_VERSION = import.meta.env.VITE_POLYMER_SYSTEM_VERSION;

const LightTooltip = PolymerTooltip;

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function SwatchAnnotationPage() {
  const { cog_id } = useParams();

  const mapTargetElement = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | undefined>();
  const navigate = useNavigate();
  const drawRef = useRef();
  const drawTypeRef = useRef("box");
  const [drawType, setDrawType] = useState("box");
  const mapRef = useRef();

  const [legendProvenances, setlegendProvenances] = useState([]);
  const [provenanceOption, setProvenanceOption] = useState([]);

  const [legendItems, setLegendItems] = useState([]);
  const [filteredLegendItems, setFilteredLegendItems] = useState([]);

  const [selectedLegendItem, setSelectedLegendItems] = useState([]);
  const [geologicAges, setGeologicAges] = useState([]);
  const [loadingMap, setLoadingMap] = useState(true);
  const [waitingForCDRSubmit, setWaitingForCDRSubmit] = useState(false);

  const [loadingProvenanceData, setLoadingProvenanceData] = useState(true);

  let legendAreaColor = "#AAFF00";
  let draw;

  const [provenanceVisable, setProvenanceVisable] = React.useState(true);

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

  const handleProvenanceChange = (option, checked) => {
    let newOptions = [...provenanceOption];

    if (checked) {
      newOptions.push(option);
    } else {
      newOptions = newOptions.filter((item) => item !== option);
    }

    const filteredSwatches = legendItems.filter((item) =>
      newOptions.includes(item.system + "_" + item.system_version),
    );
    setFilteredLegendItems(filteredSwatches);
    add_features_to_map(filteredSwatches);
    setProvenanceOption(newOptions);
  };

  async function updateSwatches(cog_id) {
    const swatchUpdatePromises = selectedLegendItem.map((item) => {
      return sendSwatchUpdates({ cog_id: cog_id, legend_swatch: item });
    });

    const updatedSwatches = await Promise.all(swatchUpdatePromises);
    return updatedSwatches;
  }

  async function sendUSGSValidatedResults() {
    let all_validated = true;
    for (let item of selectedLegendItem) {
      if (item["status"] !== "validated") {
        all_validated = false;
      }
    }

    setWaitingForCDRSubmit(true);

    if (all_validated) {
      await updateSwatches(cog_id);
    } else {
      alert("Please validate every item before finishing");
      setWaitingForCDRSubmit(false);
      return;
    }

    try {
      const response = await axios({
        method: "post",
        url: "/api/map/send_to_cdr?cog_id=" + cog_id,
        headers: _APP_JSON_HEADER,
      });
      if (response.status === 204) {
        alert("Request was successful!");
        navigate(0);
      } else {
        alert("Request was made but did not return a 204 status code.");
      }
    } catch (error) {
      console.error("Error making the request:", error);
    } finally {
      setWaitingForCDRSubmit(false);
    }
  }

  async function sendSwatchUpdates(data_) {
    if (data_["legend_swatch"]["label"]) {
      if (data_["legend_swatch"]["label"].length > 150) {
        alert(
          "Label is too long. Please limit the number of characters to 150.",
        );
        return;
      }
    }
    try {
      const response = await axios({
        method: "post",
        url: "/api/map/save_legend_swatch",
        data: data_,
        headers: _APP_JSON_HEADER,
      });
      if (response.status == 200) {
        return response.data;
      }
    } catch (error) {
      console.error("Error making the request:", error);
    }
  }

  let placeholder = {
    type: "FeatureCollection",
    features: [],
  };

  const swatch_source = new VectorSource({
    features: new GeoJSON().readFeatures(placeholder),
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
        color: "rgba(0, 0, 0, 0)",
      }),
    }),
  });

  const swatch_finished_source = new VectorSource({
    features: new GeoJSON().readFeatures(placeholder),
  });

  const swatch_finished_layer = new VectorLayer({
    id: "swatch-finished-layer",
    source: swatch_finished_source,
    style: (feature) => {
      let color = "red";
      const status = feature.get("status");
      if (status === "succeeded" || status === "validated") {
        color = "green";
      }
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
        url: `${CDR_COG_URL}/${CDR_PUBLIC_BUCKET}/${CDR_S3_COG_PREFEX}/${cog_id}.cog.tif`,
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

  // ocr vector layer
  const ocr_source = new VectorSource({ wrapX: false });
  const ocr_vector = new VectorLayer({
    id: "bounding-box",
    source: ocr_source,
  });

  function addLegendItemToMap(feature) {
    let swatch_layer_source = getLayerById(
      mapRef.current,
      "swatch-layer",
    ).getSource();

    swatch_layer_source.addFeature(feature);
    getLayerById(mapRef.current, "bounding-box").getSource().clear();
  }

  function changeDraw() {
    mapRef.current.removeInteraction(drawRef.current);
    let draw_;
    let ocr_source = getLayerById(mapRef.current, "bounding-box").getSource();
    if (drawTypeRef.current == "box") {
      draw_ = new Draw({
        source: ocr_source,
        type: "Circle",
        geometryFunction: createBox(),
      });
    } else if (drawTypeRef.current == "poly") {
      draw_ = new Draw({
        source: ocr_source,
        type: "Polygon",
      });
    }

    draw_.on("drawend", function (event) {
      addLegendItemToMap(event.feature);
    });
    draw_.setActive(true);
    mapRef.current.addInteraction(draw_);

    drawRef.current = draw_;
  }

  function add_succeeded_features_to_map(selectedLegendItems) {
    // clear swatches on the page
    let swatch_finished_source = getLayerById(
      mapRef.current,
      "swatch-finished-layer",
    ).getSource();
    swatch_finished_source.clear();
    for (let swatch of selectedLegendItems) {
      // add swatch box
      if (swatch["coordinates_from_bottom"]["coordinates"].length != 0) {
        let swatch_feature = new GeoJSON().readFeature({
          type: "Feature",
          geometry: swatch["coordinates_from_bottom"],
          properties: {
            legend_id: swatch["legend_id"],
            status: swatch["status"],
          },
        });
        swatch_finished_source.addFeature(swatch_feature);
      }

      // add label text box
      if (swatch.label_coordinates_from_bottom != null) {
        if (swatch.label_coordinates_from_bottom["coordinates"] != null) {
          if (swatch.label_coordinates_from_bottom["coordinates"] != null) {
            let swatch_label_feature = new GeoJSON().readFeature({
              type: "Feature",
              geometry: swatch["label_coordinates_from_bottom"],
              properties: {
                legend_id: swatch["legend_id"],
                status: swatch["status"],
              },
            });
            swatch_label_feature.set(
              "legend_id",
              swatch_label_feature["legend_id"],
            );
            swatch_label_feature.set("parent_id", swatch["legend_id"]);
            swatch_finished_source.addFeature(swatch_label_feature);
          }
        }
      }
      // add description boxes
      for (let description of swatch["descriptions"]) {
        let desc_feature = new GeoJSON().readFeature({
          type: "Feature",
          geometry: description["coordinates_from_bottom"],
          properties: {
            legend_id: swatch["legend_id"],
            status: swatch["status"],
          },
        });

        desc_feature.set("legend_id", desc_feature["legend_id"]);
        desc_feature.set("parent_id", swatch["legend_id"]);
        swatch_finished_source.addFeature(desc_feature);
      }
    }
  }

  function add_features_to_map(filteredSwatches) {
    // clear swatches on the page
    let swatch_finished_source = getLayerById(
      mapRef.current,
      "swatch-finished-layer",
    ).getSource();

    for (let x of swatch_finished_source.getFeatures()) {
      if (x.get("status") != "succeeded" && x.get("status") != "validated") {
        swatch_finished_source.removeFeature(x);
      }
    }

    for (let swatch of filteredSwatches) {
      if (swatch["coordinates_from_bottom"]["coordinates"].length != 0) {
        let swatch_feature = new GeoJSON().readFeature({
          type: "Feature",
          geometry: swatch["coordinates_from_bottom"],
          properties: {
            legend_id: swatch["legend_id"],
          },
        });
        swatch_finished_source.addFeature(swatch_feature);
      }
      if (swatch.label_coordinates_from_bottom != null) {
        if (swatch.label_coordinates_from_bottom["coordinates"] != null) {
          if (swatch.label_coordinates_from_bottom["coordinates"] != null) {
            let swatch_label_feature = new GeoJSON().readFeature({
              type: "Feature",
              geometry: swatch["label_coordinates_from_bottom"],
              properties: {
                legend_id: swatch["legend_id"],
                status: swatch["status"],
              },
            });
            swatch_label_feature.set(
              "legend_id",
              swatch_label_feature["legend_id"],
            );
            swatch_label_feature.set("parent_id", swatch["legend_id"]);
            swatch_finished_source.addFeature(swatch_label_feature);
          }
        }
      }

      for (let description of swatch["descriptions"]) {
        let desc_feature = new GeoJSON().readFeature({
          type: "Feature",
          geometry: description["coordinates_from_bottom"],
        });

        desc_feature.set("legend_id", desc_feature["legend_id"]);
        desc_feature.set("parent_id", swatch["legend_id"]);
        swatch_finished_source.addFeature(desc_feature);
      }
    }
  }

  function setLegendSwatchData() {
    return axios({
      method: "GET",
      url: "/api/map/" + cog_id + "/px_extractions",
      headers: _APP_JSON_HEADER,
    }).then((response) => {
      if (response.data["legend_swatches"].length > 0) {
        let successItems = [];
        let createdItems = [];
        for (let swatch of response.data["legend_swatches"]) {
          if (swatch.status == "validated" || swatch.status == "succeeded") {
            successItems.push(swatch);
          }
          if (swatch.status == "created") {
            swatch["minimized"] = true;

            createdItems.push(swatch);
          }
        }
        setSelectedLegendItems(successItems);
        setLegendItems(createdItems);
        add_succeeded_features_to_map(successItems);
      }
    });
  }

  function setData() {
    setLoadingProvenanceData(true);

    axios({
      method: "GET",
      url: "/api/map/sgmc/ages",
      headers: _APP_JSON_HEADER,
    }).then((response) => {
      setGeologicAges(response.data);
    });

    //  get provenances
    const provenancePromise = axios({
      method: "GET",
      url: "/api/map/" + cog_id + "/px_extraction_systems",
      headers: _APP_JSON_HEADER,
    }).then((response) => {
      if (response.data) {
        setlegendProvenances(response.data);
        return true;
      }
    });

    const legendSwatchPromise = setLegendSwatchData();

    Promise.all([provenancePromise, provenancePromise]).finally(() => {
      setLoadingProvenanceData(false);
    });
  }

  // Render map
  useEffect(() => {
    document.title =
      "Polymer Georeferencer Legend Swatch Extractions - " + cog_id;

    setData();

    const _map = new Map({
      controls: [],
      layers: [map_layer, swatch_layer, swatch_finished_layer, ocr_vector],
      view: map_source.getView().then((v) => {
        v.resolutions = expand_resolutions(v, 1, 7);
        v.extent = undefined;
        return v;
      }),
    });
    _map.setTarget(mapTargetElement.current || "");

    _map.getViewport().addEventListener("contextmenu", function (evt) {
      evt.preventDefault();
      mapRef.current.removeInteraction(drawRef.current);
      changeDraw();
    });
    mapRef.current = _map;

    _map.on("loadend", function () {
      setLoadingMap(false);
    });

    draw = new Draw({
      source: ocr_source,
      type: "Circle",
      geometryFunction: createBox(),
    });
    draw.setActive(true);
    draw.on("drawend", function (event) {
      addLegendItemToMap(event.feature);
    });

    drawRef.current = draw;
    _map.addInteraction(draw);
    setMap(_map);

    return () => _map.setTarget("");
  }, [cog_id]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        const focusedElement = document.activeElement;
        if (focusedElement.tagName === "BODY") {
          processLegendSwatches();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredLegendItems]);

  function clearClippedPolygons() {
    getLayerById(mapRef.current, "bounding-box").getSource().clear();
    getLayerById(mapRef.current, "swatch-layer").getSource().clear();
  }

  function clearLastPolygon(map) {
    let layer = getLayerById(map, "bounding-box");
    let source = layer.getSource();
    let features = source.getFeatures();
    if (features.length > 0) {
      var lastFeature = features[features.length - 1];
      source.removeFeature(lastFeature);
    }
    let layer_ = getLayerById(map, "swatch-layer");
    let source_ = layer_.getSource();
    let features_ = source_.getFeatures();
    if (features_.length > 0) {
      var lastFeature_ = features_[features_.length - 1];
      source_.removeFeature(lastFeature_);
    }
  }

  async function wrapRequest(swatch_feature) {
    try {
      if (swatch_feature != null) {
        const response = await axios({
          method: "post",
          url: "/api/map/tif_ocr",
          data: {
            cog_id: cog_id,
            bboxes: [swatch_feature.getGeometry().extent_],
          },
          headers: _APP_JSON_HEADER,
        });
        return [
          response.data["extracted_text"][0],
          {
            type: "Polygon",
            coordinates: swatch_feature.getGeometry().getCoordinates(),
          },
          swatch_feature.getGeometry().extent_,
        ];
      }
      return ["", null, null];
    } catch (error) {
      console.error("Error in wrapRequest:", error);
      throw error; // Rethrow the error so it can be caught by the caller
    }
  }

  async function ocrLastClipArea() {
    getLayerById(mapRef.current, "bounding-box").getSource().clear();
    const swatch_source = getLayerById(
      mapRef.current,
      "swatch-layer",
    ).getSource();
    const features = swatch_source.getFeatures();
    if (features.length > 1) {
      alert("Please select only one polygon for processing.");
      return ["", null];
    } else {
      const swatch_feature = features[0];

      swatch_source.clear();

      return await wrapRequest(swatch_feature);
    }
  }

  function processLegendSwatches() {
    getLayerById(mapRef.current, "bounding-box").getSource().clear();
    let finished_swatch_source = getLayerById(
      mapRef.current,
      "swatch-finished-layer",
    ).getSource();
    let swatch_source = getLayerById(
      mapRef.current,
      "swatch-layer",
    ).getSource();
    let features = swatch_source.getFeatures();
    if (features.length < 1) {
      alert("Please select at least one polygons for processing.");
      return;
    } else {
      let swatch_feature = features[0];

      let label_feature = features[1];
      let label_feature_coords = null;
      if (label_feature != null) {
        label_feature_coords = label_feature.getGeometry().getCoordinates();
      }
      let bboxes = [];

      for (let feat of features) {
        bboxes.push(feat.getGeometry().extent_);
      }
      swatch_source.clear();
      axios({
        method: "post",
        url: "/api/map/tif_ocr",
        data: { cog_id: cog_id, bboxes: bboxes },
        headers: _APP_JSON_HEADER,
      })
        .then((response) => {
          let swatch_geom = swatch_feature.getGeometry();
          let swatch_feature_id =
            cog_id +
            asString(swatch_geom.extent_) +
            response.data["extracted_text"][0];

          // save swatch
          let newLegendSwatch = {
            cog_id: cog_id,
            legend_id: swatch_feature_id,
            descriptions: [],
            image_url: returnImageUrl(cog_id, swatch_geom.extent_),
            extent_from_bottom: swatch_geom.extent_,
            coordinates_from_bottom: {
              type: "Polygon",
              coordinates: swatch_geom.getCoordinates(),
            },
            label_coordinates_from_bottom: {
              type: "Polygon",
              coordinates: label_feature_coords,
            },
            abbreviation: response.data["extracted_text"][0] ?? "",
            label: response.data["extracted_text"][1] ?? "",
            model: null,
            model_version: null,
            system: SYSTEM,
            system_version: SYSTEM_VERSION,
            provenance: SYSTEM + "_" + SYSTEM_VERSION,
            category: "polygon",
            confidence: null,
            status: "created",
            notes: "",
            color: "",
            pattern: "",
            minimized: false,
            age_text: "",
          };
          swatch_feature.set("legend_id", swatch_feature_id);
          finished_swatch_source.addFeature(swatch_feature);
          if (label_feature != null) {
            label_feature.set("legend_id", swatch_feature_id);
            finished_swatch_source.addFeature(label_feature);
          }

          for (let [index, item] of features.slice(2).entries()) {
            let item_geom = item.getGeometry();

            let item_feature_id =
              cog_id +
              asString(item_geom.extent_) +
              response.data["extracted_text"][index + 1];
            let newLegendItem = {
              cog_id: cog_id,
              legend_id: item_feature_id,
              image_url: returnImageUrl(cog_id, item_geom.extent_),
              extent_from_bottom: item_geom.extent_,
              coordinates_from_bottom: {
                type: "Polygon",
                coordinates: item_geom.getCoordinates(),
              },
              text: response.data["extracted_text"][index + 2],
              model: null,
              model_version: null,
              system: SYSTEM,
              system_version: SYSTEM_VERSION,
              confidence: 1,
              notes: "",
              status: "created",
            };
            item.set("legend_id", item_feature_id);
            item.set("parent_id", swatch_feature_id);
            finished_swatch_source.addFeature(item);
            newLegendSwatch["descriptions"].push(newLegendItem);
          }

          let newOptions = [...provenanceOption, SYSTEM + "_" + SYSTEM_VERSION];
          setProvenanceOption(newOptions);

          if (!legendProvenances.includes(SYSTEM + "_" + SYSTEM_VERSION)) {
            setlegendProvenances([
              ...legendProvenances,
              SYSTEM + "_" + SYSTEM_VERSION,
            ]);
          }
          setLegendItems([...legendItems, newLegendSwatch]);

          const filteredSwatches = [...filteredLegendItems, newLegendSwatch];
          setFilteredLegendItems(filteredSwatches);
        })
        .catch((error) => {
          console.error("Error fetching data:", error);
        });
    }
  }

  function changeDraw_(type) {
    if (type == "box") {
      setDrawType("box");
      drawTypeRef.current = "box";
    } else if (type == "poly") {
      setDrawType("poly");
      drawTypeRef.current = "poly";
    }
    changeDraw();
  }

  function setValidated(item, value) {
    let items_ = [];
    for (let feature of selectedLegendItem) {
      if (item.legend_id === feature["legend_id"]) {
        feature["status"] = value;
      }
      items_.push(feature);
    }
    setSelectedLegendItems([...items_]);
  }

  async function saveItem(item) {
    let new_item = await sendSwatchUpdates({
      cog_id: cog_id,
      legend_swatch: item,
    });
    if (new_item) {
      let all_items = [];
      for (let item_ of legendItems) {
        if (item_.legend_id == item.legend_id) {
          item_["status"] = "created";
          item_["minimized"] = true;
        }
        all_items.push(item_);
      }
      setLegendItems([...all_items]);

      const filteredSwatches = filteredLegendItems.filter(
        (item_) => item_.legend_id != item.legend_id,
      );
      setFilteredLegendItems(filteredSwatches);

      let selectedItems = [...selectedLegendItem, new_item];
      setSelectedLegendItems(selectedItems);

      add_succeeded_features_to_map(selectedItems);
    }
  }

  function updateItem(item) {
    if (mapRef.current === undefined) return;

    let items_ = [];
    for (let feature of legendItems) {
      if (item.legend_id === feature["legend_id"]) {
        for (const [key, value] of Object.entries(item)) {
          feature[key] = value;
        }
        if (item.status == "succeeded") {
          console.log("clean");
        } else {
          items_.push(feature);
        }
      } else {
        items_.push(feature);
      }
    }

    setLegendItems([...items_]);
  }

  function zoomTo(item) {
    let extent = [
      item["extent_from_bottom"][0] - 50,
      item["extent_from_bottom"][1] - 100,
      item["extent_from_bottom"][2] + 200,
      item["extent_from_bottom"][3] + 100,
    ];
    item["minimized"] = false;
    let items = [];
    for (let i of filteredLegendItems) {
      if (i["legend_id"] == item.legend_id) {
        i["minimized"] = false;
      }
      items.push(i);
    }
    setFilteredLegendItems(items);

    // update view to not zoom in so much
    let view = mapRef.current.getView();
    view.fit(extent, mapRef.current.getSize());
    let zoom = view.getZoom();
    view.setZoom(zoom - 0.6);
  }

  function removeSucceededItem(item) {
    item["status"] = "created";
    item["minimized"] = true;
    sendSwatchUpdates({ cog_id: cog_id, legend_swatch: item });
    let successItems = selectedLegendItem.filter(
      (item_) => item_.legend_id != item.legend_id,
    );
    setSelectedLegendItems(successItems);
    if (!legendProvenances.includes(SYSTEM + "_" + SYSTEM_VERSION)) {
      setlegendProvenances([...legendProvenances, SYSTEM + "_" + SYSTEM_VERSION])
    }
    if (!provenanceOption.includes(SYSTEM + "_" + SYSTEM_VERSION)) {
      let newOptions = [...provenanceOption, SYSTEM + "_" + SYSTEM_VERSION];
      setProvenanceOption(newOptions);
    }

    let filteredSwatches = [item, ...filteredLegendItems];
    setFilteredLegendItems(filteredSwatches);

    add_succeeded_features_to_map(successItems);

    let legendItemSwatches = legendItems.filter(
      (item_) => item_.legend_id != item.legend_id,
    );
    const legendItemsSwatches_plus = [...legendItemSwatches, item];
    setLegendItems(legendItemsSwatches_plus);
  }

  function removeItem(item) {
    let filteredItems = filteredLegendItems.filter(
      (item_) => item_.legend_id != item.legend_id,
    );
    setFilteredLegendItems(filteredItems);
    let legendItems_ = legendItems.filter(
      (item_) => item_.legend_id != item.legend_id,
    );
    setLegendItems(legendItems_);
    add_features_to_map(filteredItems);
  }

  return (
    <div
      className="swatch-annotation-root"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
    >
      <Header navigate={navigate} cog_id={cog_id} />
      <PanelGroup
        style={{ flex: 1 }}
        autoSaveId="polymer-swatch-pane"
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
          <div className="control-panel">
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div>
                <LightTooltip title="Create boxes to extract legend swatch, label and descriptions">
                  <IconButton
                    style={{
                      backgroundColor: drawType === "box" ? "#bdddfc" : "",
                    }}
                    color="secondary"
                    onClick={() => {
                      changeDraw_("box");
                    }}
                  >
                    <FormatShapesIcon />
                  </IconButton>
                </LightTooltip>
                <LightTooltip title="Create shapes to extract legend swatch, label and descriptions">
                  <IconButton
                    style={{
                      backgroundColor: drawType === "poly" ? "#bdddfc" : "",
                    }}
                    color="secondary"
                    onClick={() => {
                      changeDraw_("poly");
                    }}
                  >
                    <ChangeHistoryIcon />
                  </IconButton>
                </LightTooltip>

                <LightTooltip title="Remove last shape">
                  <IconButton
                    color="secondary"
                    onClick={() => {
                      clearLastPolygon(mapRef.current);
                    }}
                  >
                    <UndoIcon />
                  </IconButton>
                </LightTooltip>
                <LightTooltip title="Remove all in progress shapes">
                  <IconButton
                    color="secondary"
                    onClick={() => {
                      clearClippedPolygons();
                    }}
                  >
                    <ClearIcon />
                  </IconButton>
                </LightTooltip>

                <LightTooltip
                  title={provenanceVisable ? "Hide Systems" : "Show Systems"}
                >
                  <IconButton
                    color="secondary"
                    disabled={Boolean(loadingProvenanceData)}
                    onClick={() => {
                      setProvenanceVisable(!provenanceVisable);
                    }}
                  >
                    <FormatAlignJustifyIcon />
                  </IconButton>
                </LightTooltip>
              </div>
              <LightTooltip title="*Or Press Enter">
                <Button
                  color="info"
                  size="small"
                  variant="contained"
                  style={{ marginTop: "0.5rem" }}
                  onClick={processLegendSwatches}
                >
                  Extract Legend Item
                </Button>
              </LightTooltip>
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
                provenanceVisable && (
                  <Box>
                    <Text variant="body2" style={{ marginTop: "0.75rem" }}>
                      Select System
                    </Text>

                    <FormGroup>
                      {legendProvenances.map((option) => (
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
                                color: getColorForProvenance(option),
                              }}
                            >
                              <span>{option}</span>
                            </Text>
                          }
                        />
                      ))}
                    </FormGroup>
                  </Box>
                )
              )}
            </Box>
          </div>
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
              Legend Items
            </Text>
            <LightTooltip
              title="Submit Validated items in the Reviewed queue to CDR."
              placement="left"
            >
              <LoadingButton
                variant="contained"
                loading={waitingForCDRSubmit}
                onClick={sendUSGSValidatedResults}
              >
                Save To CDR
              </LoadingButton>
            </LightTooltip>
          </div>
          <div key={"scroll" + cog_id} className="flex-child scrollableContent">
            <div className="right-panel">
              {forceCogCache.isPending ? (
                <div className="loading-tiles">
                  <MapSpinner />
                </div>
              ) : (
                <div className="right-panel-swatch-list">
                  <div className="right-container">
                    <div className="left_column">
                      <Text variant="h5">Pending Review</Text>
                      <div className="legend-items">
                        <div>
                          {filteredLegendItems.map((item, i) => (
                            <LegendCard
                              key={item.legend_id}
                              cog_id={cog_id}
                              item={item}
                              updateItem={updateItem}
                              saveItem={saveItem}
                              removeItem={removeItem}
                              zoomTo={zoomTo}
                              ocrLastClipArea={ocrLastClipArea}
                              geologicAges={geologicAges}
                            ></LegendCard>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div
                      className="legend-items"
                      style={{ display: "flex", flexDirection: "column" }}
                    >
                      <div
                        style={{
                          margin: "0 0.25rem 0.25rem 0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text variant="h5" gutterBottom>
                          Reviewed
                        </Text>
                      </div>
                      <div className="right-column-legends">
                        <div>
                          {selectedLegendItem.map((item, i) => (
                            <LegendCardSuccess
                              cog_id={cog_id}
                              key={i}
                              item={item}
                              setValidated={setValidated}
                              removeSucceededItem={removeSucceededItem}
                              zoomTo={zoomTo}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export default SwatchAnnotationPage;
