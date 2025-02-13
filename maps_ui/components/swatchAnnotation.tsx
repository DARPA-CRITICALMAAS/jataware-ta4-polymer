import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

import Map from "ol/Map";
import TileLayer from "ol/layer/WebGLTile";
import { Vector as VectorLayer } from "ol/layer";
import GeoTIFF from "ol/source/GeoTIFF";
import { Vector as VectorSource } from "ol/source";
import GeoJSON from "ol/format/GeoJSON";
import Polygon from 'ol/geom/Polygon';
import Feature from "ol/Feature";
import Draw, { createBox } from "ol/interaction/Draw";
import { Fill, Stroke, Style } from "ol/style";
import Snackbar from "@mui/material/Snackbar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";

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
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';

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
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useConfig } from '../ConfigContext';

const SYSTEM = import.meta.env.VITE_POLYMER_SYSTEM;
const SYSTEM_VERSION = import.meta.env.VITE_POLYMER_SYSTEM_VERSION;


const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function SwatchAnnotationPage() {
  const config = useConfig();

  const { cog_id } = useParams();

  const mapTargetElement = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | undefined>();
  const navigate = useNavigate();
  const drawRef = useRef();
  const drawTypeRef = useRef("box");
  const [drawType, setDrawType] = useState("box");
  const mapRef = useRef();
  const [isMagicStreaming, setIsMagicStreaming] = useState(false);
  const [magicProgress, setMagicProgress] = useState<number | null>(null);

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

  const [provenanceVisible, setProvenanceVisible] = React.useState(true);

  const [abortController, setAbortController] = useState<AbortController | null>(null);

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
    const sortedLegendItems = filteredSwatches.sort((a, b) => {
      const heightA = calculateHeight(a);
      const heightB = calculateHeight(b);
      return heightB - heightA;
    });
    setFilteredLegendItems(sortedLegendItems);
    add_features_to_map(sortedLegendItems);
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
    send_to_cdr.mutate(cog_id);

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

    swatch_finished_source.getFeatures().forEach((feature) => {
      const status = feature.get('status');
      if (status === 'succeeded' || status === 'validated') {
        swatch_finished_source.removeFeature(feature);
      }
    });
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
  function calculateHeight(polygon) {
    const yValues = polygon?.coordinates_from_bottom?.coordinates?.[0]?.map(point => point[1]) || [];
    if (yValues.length === 0) return 0;

    return Math.max(...yValues);
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
        const sortedLegendItems = createdItems.sort((a, b) => {
          const heightA = calculateHeight(a);
          const heightB = calculateHeight(b);
          return heightB - heightA;
        });

        setLegendItems(sortedLegendItems);
        add_succeeded_features_to_map(successItems);
      }
      // get map ages and sort them based on already used ages
      axios({
        method: "GET",
        url: "/api/map/sgmc/ages",
        headers: _APP_JSON_HEADER,
      }).then((response) => {
        const sortedData = Object.entries(response.data).sort(([, a], [, b]) => {
          const maxA = a.min_ma ?? -Infinity;
          const maxB = b.min_ma ?? -Infinity;
          return maxB - maxA;
        })
          .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
          }, {});
        setGeologicAges(Object.keys(sortedData));
      });

    });
  }

  function setData() {
    setLoadingProvenanceData(true);

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

    Promise.all([provenancePromise, legendSwatchPromise]).finally(() => {
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
    let clickCount = 0;
    let clickTimer = null;

    const handleRightClick = (event) => {
      event.preventDefault();
      clickCount += 1;

      if (clickCount === 1) {
        clickTimer = setTimeout(() => {
          clickCount = 0;
        }, 500);
      } else if (clickCount === 2) {
        clearTimeout(clickTimer);
        clickCount = 0;

        processLegendSwatches();
      }
    };

    window.addEventListener("contextmenu", handleRightClick);

    return () => {
      window.removeEventListener("contextmenu", handleRightClick);
      clearTimeout(clickTimer);
    };
  }, [filteredLegendItems]);


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
    let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource();
    let swatch_source = getLayerById(mapRef.current, "swatch-layer").getSource();
    let features = swatch_source.getFeatures();
    if (features.length < 1) {
      alert("Please select at least one polygons for processing.");
      return;
    }

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
          age_texts: [],
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
        setLegendItems([newLegendSwatch, ...legendItems]);

        const filteredSwatches = [newLegendSwatch, ...filteredLegendItems];
        setFilteredLegendItems(filteredSwatches);
      })
      .catch((error) => {
        console.error("Error fetching data:", error);
      });
  }

  function cancelMagicStream() {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsMagicStreaming(false);
    }
  }

  function processLegendSwatchesMagic() {
    // Create new AbortController and store it
    const controller = new AbortController();
    setAbortController(controller);

    setIsMagicStreaming(true);

    // --
    // Clear the bounding box layer

    getLayerById(mapRef.current, "bounding-box").getSource().clear();

    // --
    // Get the swatch layer and features

    let finished_swatch_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource();
    let swatch_source = getLayerById(mapRef.current, "swatch-layer").getSource();
    let features = swatch_source.getFeatures();
    if (features.length !== 1) {
      alert("Please select exactly one polygon for processing.");
      setIsMagicStreaming(false);
      return;
    }

    let swatch_feature = features[0];
    let swatch_geom = swatch_feature.getGeometry();
    let swatch_xmin = swatch_geom.extent_[0];
    let swatch_ymax = swatch_geom.extent_[3];
    let swatch_prefix = cog_id + asString(swatch_geom.extent_);

    // --
    // Get the bboxes

    let bboxes = [swatch_geom.extent_];

    // --
    // Clear the swatch layer

    swatch_source.clear();

    // --
    // Create fetch request with streaming response

    fetch("/auto_legend_api/legend/auto_legend/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cog_id: cog_id, bboxes: bboxes, no_description: false }),
      signal: controller.signal  // Use the controller's signal
    })
      .then(response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        function processText(text) {
          buffer += text;

          // Process complete JSON objects
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const jsonStr = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            try {
              const item = JSON.parse(jsonStr);
              // Handle progress messages
              if (item.__progress !== undefined) {
                if (item.__status === "ERROR") {
                  alert(`Algorithm failed with error message:\n"""\n${item.__error}.\n""" \n\nPlease retry.`);
                  cancelMagicStream();
                  return;
                } else {
                  setMagicProgress(item.__progress);
                  return; // Skip further processing for progress messages
                }
              }

              let item_geom: Polygon | null = null;
              if (item.bbox) {
                const [xmin, ymin, xmax, ymax] = item.bbox;
                item_geom = new Polygon([[
                  [swatch_xmin + xmin, swatch_ymax - ymin],
                  [swatch_xmin + xmax, swatch_ymax - ymin],
                  [swatch_xmin + xmax, swatch_ymax - ymax],
                  [swatch_xmin + xmin, swatch_ymax - ymax],
                  [swatch_xmin + xmin, swatch_ymax - ymin],
                ]]);
              }

              const legend_id = swatch_prefix + item.id;
              const newLegendSwatch = {
                cog_id: cog_id,
                legend_id: legend_id,

                image_url: returnImageUrl(cog_id, item_geom ? item_geom.getExtent() : swatch_geom.getExtent()),
                extent_from_bottom: item_geom ? item_geom.getExtent() : swatch_geom.getExtent(),
                coordinates_from_bottom: {
                  type: "Polygon",
                  coordinates: item_geom ? item_geom.getCoordinates() : swatch_geom.getCoordinates(),
                },
                label_coordinates_from_bottom: {
                  type: "Polygon",
                  coordinates: null,
                },

                _symbol_id: item.symbol_id,
                abbreviation: item.symbol ?? item.name,
                label: item.name,
                age_text: item.age ?? "",
                age_texts: item.age ? [item.age] : [],
                descriptions: item.description ? [{
                  text: item.description,
                  coordinates_from_bottom: null,
                  legend_id: legend_id + "_0",
                  parent_id: legend_id,
                  status: "created",
                }] : [],
                category: item.category,
                color: "",
                pattern: "",

                model: null,
                model_version: null,
                system: SYSTEM,
                system_version: SYSTEM_VERSION,
                provenance: SYSTEM + "_" + SYSTEM_VERSION,
                confidence: null,
                status: "created",
                notes: "",
                minimized: true,
              };

              if (item_geom) {
                const _feature = new Feature({
                  geometry: item_geom
                });
                _feature.set("legend_id", newLegendSwatch.legend_id);
                finished_swatch_source.addFeature(_feature);
              }

              // Update state for each item
              setLegendItems(prev => [...prev, newLegendSwatch]);
              setFilteredLegendItems(prev => [...prev, newLegendSwatch]);
              setProvenanceOption(prev => [...prev, SYSTEM + "_" + SYSTEM_VERSION]);

            } catch (e) {
              console.error("Error parsing JSON:", e);
            }
          }
        }

        // Read the stream
        function readStream() {
          return reader.read().then(({ done, value }) => {
            if (done) {
              if (buffer.length > 0) {
                processText(buffer);
              }
              return;
            }

            processText(decoder.decode(value, { stream: true }));
            return readStream();
          });
        }

        // Update provenance if needed
        if (!legendProvenances.includes(SYSTEM + "_" + SYSTEM_VERSION)) {
          setlegendProvenances(prev => [...prev, SYSTEM + "_" + SYSTEM_VERSION]);
        }

        return readStream();
      })
      .catch(error => {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted');
        } else {
          console.error("Error fetching data:", error);
        }
      })
      .finally(() => {
        setIsMagicStreaming(false);
        setAbortController(null);
        setMagicProgress(null);
      });

    // Return the cancel function
    return cancelMagicStream;
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
        if (item.in_cdr == true) {
          item.in_cdr = false
        }
        if (item.status == "succeeded") {
          console.log("clean");
        } else {
          items_.push(feature);
        }
        if (validateExtent(item.extent_from_bottom)) {
          let swatch_finished_source = getLayerById(mapRef.current, "swatch-finished-layer").getSource()
          let swatch_finished_features = swatch_finished_source.getFeatures()
          for (let feature of swatch_finished_features) {
            if (feature.get("legend_id") == item.legend_id) {
              swatch_finished_source.removeFeature(feature)
              let swatch_feature = new GeoJSON().readFeature({
                type: "Feature",
                geometry: item["coordinates_from_bottom"],
                properties: {
                  legend_id: item["legend_id"],
                },
              });
              swatch_finished_source.addFeature(swatch_feature);
            }
          }
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
      setlegendProvenances([
        ...legendProvenances,
        SYSTEM + "_" + SYSTEM_VERSION,
      ]);
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

  // Add ref for the scroll container
  const legendItemsContainerRef = useRef<HTMLDivElement>(null);

  // Add useEffect to scroll when filteredLegendItems changes
  useEffect(() => {
    if (legendItemsContainerRef.current) {
      legendItemsContainerRef.current.scrollTop = legendItemsContainerRef.current.scrollHeight;
    }
  }, [filteredLegendItems]);

  function validateAll() {
    for (let item of selectedLegendItem) {
      setValidated(item, 'validated')
    }
  }

  function clearSelectedLayer() {
    getLayerById(mapRef.current, "bounding-box").getSource().clear();
    getLayerById(mapRef.current, "swatch-layer").getSource().clear();

  }
  const SECOND = 1000;
  const MINUTE = SECOND * 60;
  function formatReprojectError(e) {
    const { status } = e.response;

    if (status === 422) {
      const { detail } = e.response.data;
      console.log(e.response.data)
      let template = "Validation Error: ";
      for (let info of detail) {
        template += info.msg;
        template += `: ${JSON.stringify(info.loc)}`;
      }
      return template;
    } else if (status === 500) {
      console.log(e.response.data)
      return "Internal Server Error. Contact us for details or retry operation.";
    } else if (status === 400) {
      console.log(e.response.data)
      return "Bad Request withno further validation details. Retry operation or contact us.";
    }

    return "Unknown or unhandled error ocurred. Retry or contact us.";
  }

  const send_to_cdr = useMutation({
    mutationFn: async (cog_id) => {
      return axios({
        method: "post",
        url: "/api/map/send_to_cdr?cog_id=" + cog_id,
        timeout: 5 * MINUTE,
        headers: _APP_JSON_HEADER,
      });
    },
    onSuccess: async (response) => {
      if (response.status === 204) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        console.log("Request was successful!");
        navigate(0);
      }
      setWaitingForCDRSubmit(false);

    },
    onError: (e) => {
      setWaitingForCDRSubmit(false);
      throw new Error(formatReprojectError(e));
    },
  });
  const areMutationErrors = send_to_cdr.isError;
  const closeNotifier = () => {
    send_to_cdr.reset();
    setWaitingForCDRSubmit(false);
  };

  return (
    <div className="swatch-annotation-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Header navigate={navigate} cog_id={cog_id} />

      <PanelGroup style={{ flex: 1 }} autoSaveId="polymer-swatch-pane" direction="horizontal">
        <Panel defaultSize={35} minSize={20} className="map-wrapper">
          {/* Map */}
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

          {/* Control Panel */}
          <div className="control-panel">
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div>
                {/* Box Button */}
                <PolymerTooltip title="Create boxes to extract legend swatch, label and descriptions">
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
                </PolymerTooltip>

                {/* Shape Button */}
                <PolymerTooltip title="Create shapes to extract legend swatch, label and descriptions">
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
                </PolymerTooltip>

                {/* Undo Button */}
                <PolymerTooltip title="Remove last shape">
                  <IconButton
                    color="secondary"
                    onClick={() => {
                      clearLastPolygon(mapRef.current);
                    }}
                  >
                    <UndoIcon />
                  </IconButton>
                </PolymerTooltip>

                {/* Clear Button */}
                <PolymerTooltip title="Remove all in progress shapes">
                  <IconButton
                    color="secondary"
                    onClick={() => {
                      clearClippedPolygons();
                    }}
                  >
                    <ClearIcon />
                  </IconButton>
                </PolymerTooltip>

                {/* Systems Button */}
                <PolymerTooltip
                  title={provenanceVisible ? "Hide Systems" : "Show Systems"}
                >
                  <span>
                    <IconButton
                      color="secondary"
                      disabled={Boolean(loadingProvenanceData)}
                      onClick={() => {
                        setProvenanceVisible(!provenanceVisible);
                      }}
                    >

                      <FormatAlignJustifyIcon />
                    </IconButton>
                  </span>
                </PolymerTooltip>
              </div>



              {/* Provenance Data Selector */}
              {(loadingProvenanceData || forceCogCache.isPending) ? (
                <LoadingButton
                  loading
                  loadingPosition="start"
                  startIcon={<SaveIcon />}
                  sx={{ marginTop: "0.5rem" }}
                >
                  Loading System Data
                </LoadingButton>
              ) : (
                provenanceVisible && (
                  <>
                    {/* Extract Legend Item Button */}
                    <PolymerTooltip title="*Or Press Enter or Double Right Click">
                      <Button
                        color="info"
                        size="small"
                        variant="contained"
                        style={{ marginTop: "0.5rem" }}
                        onClick={processLegendSwatches}
                      >
                        Extract Legend Item
                      </Button>
                    </PolymerTooltip>

                    {/* Experimental Features Section */}
                    <Accordion
                      defaultExpanded
                      sx={{
                        marginTop: "0.5rem",
                        backgroundColor: "transparent",
                        boxShadow: "none",
                        "&:before": {
                          display: "none" // Removes the default divider
                        }
                      }}
                    >
                      <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{
                          padding: "0 0.5rem",
                          minHeight: "32px",
                          "& .MuiAccordionSummary-content": {
                            margin: "4px 0"
                          }
                        }}
                      >
                        Experimental Features
                      </AccordionSummary>
                      <AccordionDetails sx={{ padding: "0 0.5rem" }}>
                        <Button
                          color={isMagicStreaming ? "error" : "info"}
                          size="small"
                          variant="contained"
                          fullWidth
                          onClick={isMagicStreaming ? cancelMagicStream : processLegendSwatchesMagic}
                        >
                          {isMagicStreaming ? "Cancel Auto Extract" : "Auto Legend Extract"}
                        </Button>
                      </AccordionDetails>
                    </Accordion>
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
                                  color: "var(--mui-palette-text-primary)",
                                }}
                              >
                                <span>{option}</span>
                              </Text>
                            }
                          />
                        ))}
                      </FormGroup>
                    </Box>
                  </>

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
              Legend Annotation
            </Text>
            {/* <hr style={{ border: "1px solid #ccc", margin: "0.5rem 1rem" }} /> */}


            {/* Save to CDR Button */}
            <PolymerTooltip
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
            </PolymerTooltip>
          </div>
          <div
            style={{
              height: "1px",
              backgroundColor: "#ccc",
              margin: "0.25rem 0",
            }}
          ></div>

          <div key={"scroll" + cog_id} className="flex-child scrollableContent">
            <div className="right-panel">
              {forceCogCache.isPending ? (
                <div className="loading-tiles">
                  <MapSpinner />
                </div>
              ) : (
                <div className="right-panel-swatch-list">
                  <div className="right-container">

                    {/* left column */}
                    <div className="left_column">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text variant="h6"> Pending Review </Text>
                        {isMagicStreaming && (
                          magicProgress !== null ? (
                            <div style={{ width: '100px' }}>
                              <LinearProgress
                                variant="determinate"
                                value={magicProgress}
                                sx={{
                                  height: 8,
                                  borderRadius: 4,
                                  '& .MuiLinearProgress-bar': {
                                    borderRadius: 4,
                                  },
                                }}
                              />
                            </div>
                          ) : (
                            <CircularProgress size={20} />
                          )
                        )}
                      </div>
                      <div className="legend-items">
                        <div ref={legendItemsContainerRef}>
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
                              clearSelectedLayer={clearSelectedLayer}
                            ></LegendCard>
                          ))}
                        </div>
                      </div>
                    </div> {/* left column */}

                    {/* reviewed column */}
                    <div className="legend-items" style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <Text variant="h6"> Reviewed </Text>
                        <Button variant="text"
                          onClick={() => validateAll()}
                        >Validate all</Button>

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
                    </div> {/* reviewed column */}

                  </div>
                </div>
              )}
            </div>
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
          {send_to_cdr.isError
            ? `Saving to cdr failed. ${send_to_cdr?.error?.message},`
            : ""}
        </Alert>
      </Snackbar>
    </div>
  );
}

export default SwatchAnnotationPage;