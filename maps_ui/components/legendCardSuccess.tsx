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

import ColorLensIcon from '@mui/icons-material/ColorLens';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';

import InterestsIcon from '@mui/icons-material/Interests';

const CDR_COG_URL = import.meta.env.VITE_CDR_COG_URL;
const CDR_PUBLIC_BUCKET = import.meta.env.VITE_CDR_PUBLIC_BUCKET;
const CDR_S3_COG_PREFEX = import.meta.env.VITE_CDR_S3_COG_PREFEX
const SYSTEM = import.meta.env.VITE_POLYMER_SYSTEM
const SYSTEM_VERSION = import.meta.env.VITE_POLYMER_SYSTEM_VERSION


function LegendCardSuccess({ cog_id, item, zoomTo, setValidated }) {
    console.log(item)
    const [minimized, setMinimized] = useState(false)

    function handleMinimizeItem_() {
        setMinimized(!minimized)
    }
    function returnValidatedString(status) {
        return status ? "validated" : "succeeded";
    }
    function wrapValidateChanges(value) {
        setValidated(item, value)
    }

    return (
        <>
            <div>
                <div style={{ "marginLeft": "10px", 'padding': "10px", 'border': "1px solid gray", 'backgroundColor': '#E8E8E8', 'borderRadius': "16px" }}>
                    {(minimized || item.status == "validated") ?

                        <div>
                            <div style={{ "display": "grid", "gridTemplateColumns": "1fr 1fr" }}>
                                <div>
                                    <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>
                                    <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                    <div><b>Abbreviation:</b> {item.abbreviation}</div>
                                </div>
                                <img src={returnImageUrl(cog_id, item.extent_from_bottom)} alt="Legend Item" style={{ maxWidth: '20%', height: 'auto', marginBottom: '10px' }} />

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

                            </div>
                        </div>
                        :
                        <>
                            <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>

                            <div><b>Status: </b>{item.status.toUpperCase()}</div>

                            <CardContent>
                                <img src={returnImageUrl(cog_id, item.extent_from_bottom)} alt="Legend Item" style={{ maxWidth: '40%', height: 'auto', marginBottom: '10px' }} />
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    <div style={{ marginRight: "10px", fontWeight: "bold", color: "#333" }}>Abbreviation:</div>
                                    <div style={{ color: "#666" }}>{item.abbreviation}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    <div style={{ marginRight: "10px", fontWeight: "bold", color: "#333" }}>Label:</div>
                                    <div style={{ color: "#666" }}>{item.label}</div>
                                </div>
                                {(item.descriptions != undefined) &&
                                    <>
                                        <div style={{ display: "flex", alignItems: "center" }}>
                                            <div style={{ marginRight: "10px", fontWeight: "bold", color: "#333" }}>Descriptions:</div>
                                        </div>
                                        {item.descriptions.map((child, i) => {
                                            return (
                                                <div style={{ color: "#666", display: "flex", alignItems: "center" }} key={i}>

                                                    {child.text}
                                                </div>
                                            )
                                        })
                                        }
                                    </>
                                }
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    <div style={{ marginRight: "10px", fontWeight: "bold", color: "#333" }}>Color:</div>
                                    <div style={{ color: "#666" }}>{item.color}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                    <div style={{ marginRight: "10px", fontWeight: "bold", color: "#333" }}>Pattern:</div>
                                    <div style={{ color: "#666" }}>{item.pattern}</div>
                                </div>
                            </CardContent>
                        </>
                    }
                    <>
                        <Button onClick={() => handleMinimizeItem_()} size="small" color="primary">
                            {minimized ? "Expand" : "Minimize"}
                        </Button>
                    </>
                    <Button onClick={() => zoomTo(item)}>Zoom To</Button>
                    <FormControlLabel control={
                        <Checkbox
                            checked={item["status"] == "validated"}
                            onChange={(e) => wrapValidateChanges(returnValidatedString(e.target.checked))}
                            inputProps={{ 'aria-label': 'controlled' }}
                        />
                    } label={item['status'] != "validated" ? "Validate" : "Validated"} />


                </div>
            </div >

        </>
    );
}
export default LegendCardSuccess