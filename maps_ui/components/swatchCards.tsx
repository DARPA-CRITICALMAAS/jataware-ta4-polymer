// mapExtraction.tsx

import React, { useState } from 'react';


import { Button, Checkbox } from '@mui/material';
import { Card, CardContent, TextField, Typography, Box } from '@mui/material';

import "../css/legendAnnotations.css";
import { returnImageUrl, valuetext } from "./helpers"

import CloseIcon from '@mui/icons-material/Close';

import ColorLensIcon from '@mui/icons-material/ColorLens';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import Autocomplete from '@mui/material/Autocomplete';



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
                // rows={}
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



function LegendCard({ cog_id, item, updateItem, saveItem, removeItem, zoomTo, ocrLastClipArea, geologicAges }) {

    const [abbrText, setAbbrText] = useState(item['abbreviation'])
    const [colorText, setColorText] = useState(item['color'])
    const [patternText, setPatternText] = useState(item['pattern'])
    const [labelText, setLabelText] = useState(returnLabel(item))

    function returnLabel(item) {
        return item.label || "";
    }

    function handleMinimizeItem_() {
        wrapChanges('minimized', !item.minimized)
    }
    function wrapChanges(key_, value) {
        let new_item = { ...item }
        new_item[key_] = value
        if (key_ === "status" && value === "validated") {
            for (let desc of item['descriptions']) {
                desc['status'] = "validated"
            }
            new_item['minimized'] = false
        } else if (key_ === "status" && value === "succeeded") {
            for (let desc of item['descriptions']) {
                desc['status'] = "succeeded"
            }
        }
        if (key_ != "minimized" && key_ != "status") {
            new_item['status'] = "created"
        }
        updateItem(new_item)
    }

    function wrapDescriptionChange(item, id, key_, value) {
        let new_descriptions = []
        for (let desc of item.descriptions) {
            if (desc.legend_id == id) {
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

    function handleRemoveItem() {
        wrapChanges('status', 'removed')
    }

    function handleSaveItem_() {
        item['status'] = "succeeded"
        // wrapChanges('status', 'succeeded')
        saveItem(item)
        // handleMinimizeItem_()
    }

    function wrapLabelChange(item, value) {
        let new_label
        if (item.label == null) {
            new_label = ""
        } else {
            new_label = value
        }
        wrapChanges('label', new_label)
    }

    async function setValueFromClip(type, index, item) {
        const resp = await ocrLastClipArea()
        let text = resp[0]
        let coordinates_from_bottom = resp[1]
        if (type == "label") {
            setLabelText(text)
            wrapChanges('label', text)
            if (coordinates_from_bottom != null) {
                wrapChanges('label_coordinates_from_bottom', coordinates_from_bottom)
            }
        }

        if (type == "color") setColorText(text)
        if (type == "abbreviation") setAbbrText(text)
        if (type == "description") {
            if (index == null) {
                item.descriptions = [...item.descriptions, {
                    "text": text,
                    "coordinates_from_bottom": coordinates_from_bottom,
                    "legend_id": item.legend_id + "_" + item.descriptions.length.toString(),
                    "parent_id": item.legend_id,
                    "status": "created"
                }]
                wrapDescriptionChange(item, item.legend_id, "status", "created")
            } else {

                item.descriptions[index]['text'] = text
                item.descriptions[index]["coordinates_from_bottom"] = coordinates_from_bottom

                wrapDescriptionChange(item, item.legend_id, "status", "created")
            }
        }
        if (type == "age_text") {
            wrapChanges('age_text', text)
        }
    }
    function removeDescription(index, item) {
        item.descriptions.splice(index, 1)
        wrapDescriptionChange(item, item.legend_id, "status", "created")

    }


    return (
        <>
            <div>

                <div style={{ "marginTop": "10px", 'padding': "5px", 'border': "1px solid gray", 'backgroundColor': '#E8E8E8', 'borderRadius': "16px" }}>
                    <Card style={{ width: "100%", borderRadius: "10px" }}>
                        <h3>Legend Item</h3>
                        {(item.minimized || item.status == "validated") ?

                            <div>
                                <div style={{ "display": "grid", "gridTemplateColumns": "1fr 1fr" }}>
                                    <div>
                                        <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>
                                        <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                        <div><b>Abbreviation:</b> {item.abbreviation}</div>
                                    </div>
                                    <div style={{ 'justifySelf': "end" }}>
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
                            </div>
                            :
                            <>
                                <div><b>Provenance: </b>{item.system.toUpperCase() + "_" + item.system_version}</div>

                                <div><b>Status: </b>{item.status.toUpperCase()}</div>

                                <CardContent>
                                    <img src={returnImageUrl(cog_id, item.extent_from_bottom)} alt="Legend Item" style={{ maxWidth: '40%', height: 'auto', marginBottom: '10px' }} />
                                    <div style={{ display: "flex", alignItems: "center" }}>
                                        <HighlightAltIcon onClick={() => { setValueFromClip("abbreviation", null, item) }} style={{ marginRight: "8px" }} />

                                        <TextField
                                            id={item.legend_id}
                                            label="Abbreviation"
                                            variant="outlined"
                                            fullWidth
                                            margin="normal"
                                            value={abbrText}
                                            onBlur={(e) => {
                                                wrapChanges('abbreviation', abbrText)
                                            }}
                                            onChange={(e) => setAbbrText(e.target.value)} // Update the state on input change
                                        />
                                    </div>
                                    <br></br>
                                    <div style={{ display: "flex", alignItems: "center" }}>
                                        <HighlightAltIcon onClick={() => { setValueFromClip("label", null, item) }} style={{ marginRight: "8px" }} />

                                        <TextField
                                            id={item.legend_id}
                                            label="Label"
                                            variant="outlined"
                                            fullWidth
                                            margin="normal"
                                            value={labelText}
                                            onBlur={(e) => {
                                                wrapLabelChange(item, labelText)
                                            }}
                                            onChange={(e) => setLabelText(e.target.value)} // Update the state on input change
                                        />
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center" }}>
                                        <HighlightAltIcon onClick={() => { setValueFromClip("age_text", null, item) }} style={{ marginRight: "8px" }} />

                                        <Autocomplete
                                            style={{ "display": "grid" }}
                                            value={item.age_text}
                                            className="autoComplete"
                                            disablePortal
                                            options={geologicAges}
                                            renderInput={(params) => (<TextField {...params} label="Geologic Age" />)}
                                            onInputChange={(event, value) => {
                                                wrapChanges("age_text", value)
                                            }}
                                        />
                                    </div>

                                    Add new description <HighlightAltIcon onClick={() => { setValueFromClip("description", null, item) }} style={{ marginRight: "8px" }} />

                                    {(item.descriptions != undefined) &&
                                        <>

                                            {item.descriptions.map((child, i) => {
                                                return (
                                                    <div style={{ display: "grid", alignItems: "center" }} key={i}>

                                                        <div style={{ display: "flex", alignItems: "center" }} key={i}>
                                                            <div style={{ display: "grid", alignItems: "center" }} key={i}>

                                                                <HighlightAltIcon onClick={() => { setValueFromClip("description", i, item) }} style={{ marginRight: "8px" }} />
                                                                <CloseIcon onClick={() => { removeDescription(i, item) }} style={{ marginRight: "8px" }} />
                                                            </div>
                                                            <LegendDescriptionCard
                                                                child={child}
                                                                i={i}
                                                                id={child.legend_id}
                                                                wrapDescriptionChangeText={wrapDescriptionChangeText}
                                                            >
                                                            </LegendDescriptionCard>
                                                        </div>
                                                    </div>

                                                )
                                            })
                                            }
                                        </>
                                    }

                                    {/* <div style={{ display: "flex", alignItems: "center" }}>
                                        <ColorLensIcon onClick={() => { setValueFromClip("color", null, item) }} style={{ marginRight: "8px" }} />

                                        <TextField
                                            id={item.legend_id}
                                            label="Color"
                                            variant="outlined"
                                            fullWidth
                                            margin="normal"
                                            value={colorText}
                                            onBlur={(e) => {
                                                wrapChanges('color', colorText)
                                            }}
                                            onChange={(e) => setColorText(e.target.value)} // Update the state on input change
                                        />
                                    </div> */}
                                    <TextField
                                        id={item.legend_id}
                                        label="Pattern"
                                        variant="outlined"
                                        fullWidth
                                        margin="normal"
                                        value={patternText}
                                        onBlur={(e) => {
                                            wrapChanges('pattern', patternText)
                                        }}
                                        onChange={(e) => setPatternText(e.target.value)} // Update the state on input change
                                    />


                                </CardContent>


                            </>
                        }


                        {(item.status != "succeeded" && item.status != "validated") &&
                            <Button color="success" onClick={() => handleSaveItem_()} size="small" >
                                Save
                            </Button>
                        }
                        {item.status !== "validated" &&
                            <>
                                <Button onClick={() => handleMinimizeItem_()} size="small" color="warning">
                                    {item['minimized'] ? "Edit" : "Minimize"}
                                </Button>
                            </>
                        }

                        <Button onClick={() => zoomTo(item)}>Zoom To</Button>
                        <Button color="success" onClick={() => removeItem(item)} size="small" >
                            Remove
                        </Button>
                        {/* {item.status !== "validated" &&

                            <Button color="warning" onClick={() => handleRemoveItem()}>Delete</Button>
                        } */}

                    </Card>

                </div>
            </div >

        </>
    );
}

export default LegendCard
