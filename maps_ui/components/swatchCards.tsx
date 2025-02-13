// mapExtraction.tsx
import React, { useState } from "react";

import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import CardHeader from "@mui/material/CardHeader";
import CardActions from "@mui/material/CardActions";

import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Text from "@mui/material/Typography";
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import Autocomplete from "@mui/material/Autocomplete";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Select, { SelectChangeEvent } from "@mui/material/Select";

import AddTaskIcon from "@mui/icons-material/AddTask";
import DeleteIcon from "@mui/icons-material/Delete";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import FormatShapesIcon from "@mui/icons-material/FormatShapes"; // Params
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";

import PolymerTooltip from "./Tooltip";

const icon = <CheckBoxOutlineBlankIcon fontSize="small" />;
const checkedIcon = <CheckBoxIcon fontSize="small" />;

import {
  returnImageUrl,
  getColorForProvenance,
  validateExtent,
} from "./helpers";

import "../css/legend_annotation.scss";


const OCRButton = React.forwardRef(({ onClick, ...props }, ref) => {
  const [isFetchingOCR, setIsFetchingOCR] = useState(false);
  const Icon = isFetchingOCR ? MoreHorizIcon : HighlightAltIcon;

  return (
    <Button
      {...props}
      ref={ref}
      variant="contained"
      onClick={() => {
        setIsFetchingOCR(true);
        Promise.resolve(onClick()).finally(() => setIsFetchingOCR(false));
      }}
      disabled={isFetchingOCR}
      sx={{ px: 0, minWidth: "2.25rem" }}
    >
      <Icon />
    </Button>
  );
});

const OcrField = ({
  clipName,
  clipTitle,
  item,
  onBlur,
  onChange,
  value,
  setValueFromClip,
  tooltip = "OCR text from selected shape on map into field.",
}) => {
  const [isFetchingOCR, setIsFetchingOCR] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", columnGap: "0.5rem" }}>
      <PolymerTooltip title={tooltip} placement="left">
        <OCRButton onClick={() => setValueFromClip(clipName, null, item)} />
      </PolymerTooltip>

      <TextField
        id={item.legend_id}
        label={clipTitle}
        variant="outlined"
        size="small"
        fullWidth
        sx={{ my: "0.5rem" }}
        margin="normal"
        value={value}
        onBlur={onBlur}
        onChange={onChange}
      />
    </div>
  );
};

const LegendDescriptionCard = ({ child, i, id, wrapDescriptionChangeText }) => {
  const [descriptionText, setDescriptionText] = useState(child.text);
  function wrapDescriptionChange_() {
    wrapDescriptionChangeText(id, "text", descriptionText);
  }
  return (
    <TextField
      id={id}
      label={`Description box - ${i}`}
      variant="outlined"
      fullWidth
      multiline
      minRows={2}
      size="small"
      sx={{ my: "0.5rem" }}
      value={descriptionText}
      onBlur={(e) => {
        wrapDescriptionChange_();
      }}
      onChange={(e) => setDescriptionText(e.target.value)}
    />
  );
};

function LegendCard({
  cog_id,
  item,
  updateItem,
  saveItem,
  removeItem,
  zoomTo,
  ocrLastClipArea,
  geologicAges,
  clearSelectedLayer
}) {
  const [abbrText, setAbbrText] = useState(item["abbreviation"]);
  const [patternText, setPatternText] = useState(item["pattern"]);
  const [labelText, setLabelText] = useState(returnLabel(item));
  const [category, setCategory] = useState(item["category"]);
  const [ageText, setAgeText] = useState(item["age_texts"]);
  function returnLabel(item) {
    return item.label || "";
  }

  function handleMinimizeItem_(item) {
    wrapChanges("minimized", !item.minimized);
  }

  function wrapChanges(key_, value) {
    let new_item = { ...item };
    new_item[key_] = value;
    if (key_ === "status" && value === "validated") {
      for (let desc of item["descriptions"]) {
        desc["status"] = "validated";
      }
      new_item["minimized"] = false;
    } else if (key_ === "status" && value === "succeeded") {
      for (let desc of item["descriptions"]) {
        desc["status"] = "succeeded";
      }
    }
    if (key_ != "minimized" && key_ != "status") {
      new_item['in_cdr'] = false

      new_item["status"] = "created";
    }
    updateItem(new_item);
  }

  function wrapDescriptionChange(item, id, key_, value) {
    let new_descriptions = [];
    for (let desc of item.descriptions) {
      if (desc.legend_id == id) {
        desc[key_] = value;
      }
      new_descriptions.push(desc);
    }
    wrapChanges("descriptions", new_descriptions);
  }

  function wrapDescriptionChangeText(id, key_, text) {
    wrapDescriptionChange(item, id, key_, text);
  }

  function handleSaveItem_() {
    item["status"] = "succeeded";
    saveItem(item);
  }

  function wrapLabelChange(item, value) {
    let new_label;
    if (item.label == null) {
      new_label = "";
    } else {
      new_label = value;
    }
    wrapChanges("label", new_label);
  }

  async function setSwatchCoordinates() {
    const resp = await ocrLastClipArea();
    let coordinates_from_bottom = resp[1];
    let extent_from_bottom = resp[2];
    clearSelectedLayer()
    wrapChanges("coordinates_from_bottom", coordinates_from_bottom);
    wrapChanges("extent_from_bottom", extent_from_bottom);

  }

  async function setValueFromClip(type, index, item) {
    const resp = await ocrLastClipArea();
    let text = resp[0];
    let coordinates_from_bottom = resp[1];
    if (type == "label") {
      setLabelText(text);
      wrapChanges("label", text);
      if (coordinates_from_bottom != null) {
        wrapChanges("label_coordinates_from_bottom", coordinates_from_bottom);
      }
    }

    if (type == "abbreviation") {
      setAbbrText(text);
      wrapChanges("abbreviation", text);
    }
    if (type == "description") {
      if (index == null) {
        item.descriptions = [
          ...item.descriptions,
          {
            text: text,
            coordinates_from_bottom: coordinates_from_bottom,
            legend_id:
              item.legend_id + "_" + item.descriptions.length.toString(),
            parent_id: item.legend_id,
            status: "created",
          },
        ];
        wrapDescriptionChange(item, item.legend_id, "status", "created");
      } else {
        item.descriptions[index]["text"] = text;
        item.descriptions[index]["coordinates_from_bottom"] =
          coordinates_from_bottom;

        wrapDescriptionChange(item, item.legend_id, "status", "created");
      }
    }
    if (type == "age_text") {
      wrapChanges("age_text", text);
    }
    return true;
  }
  function removeDescription(index, item) {
    item.descriptions.splice(index, 1);
    wrapDescriptionChange(item, item.legend_id, "status", "created");
  }
  const changeCategory = (event: SelectChangeEvent) => {
    setCategory(event.target.value);
    wrapChanges("category", event.target.value);
  };
  const changePattern = (event: SelectChangeEvent) => {
    setPatternText(event.target.value);
    wrapChanges("pattern", event.target.value);
  };

  const handleAgeChange = (value) => {

    setAgeText(value);
    wrapChanges("age_texts", value);
  };

  return (
    <div>
      <div
        style={{
          marginTop: "0.75rem",
          borderRadius: "15px",
        }}
      >
        <Card style={{ width: "100%", borderRadius: "10px", padding: "1rem" }}>
          {item.minimized || item.status == "validated" ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div>
                    <b>Provenance: </b>
                    <span
                      style={{
                        color: getColorForProvenance(
                          item.system.toLowerCase() + "_" + item.system_version,
                        ),
                      }}
                    >
                      {item.system.toUpperCase() + "_" + item.system_version}
                    </span>
                  </div>

                  <div>
                    <b>Abbreviation:</b> {item.abbreviation}
                  </div>
                </div>
                <div style={{ justifySelf: "end" }}>

                  {item._symbol_id !== null && validateExtent(item.extent_from_bottom) && (
                    <img
                      src={returnImageUrl(cog_id, item.extent_from_bottom)}
                      alt="Legend Item"
                      style={{
                        maxWidth: "70%",
                        height: "auto",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div>
                <>
                  <b>Provenance: </b>
                  <span
                    style={{
                      color: getColorForProvenance(
                        item.system.toLowerCase() + "_" + item.system_version,
                      ),
                    }}
                  >
                    {item.system.toUpperCase() + "_" + item.system_version}
                  </span>
                </>
              </div>

              <CardContent sx={{ paddingBottom: "0" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <PolymerTooltip
                    title="Press to assign manually selected shape on map as swatch."
                    placement="left"
                    style={{ marginRight: "6px" }}
                  >
                    <Button
                      onClick={setSwatchCoordinates}
                      variant="contained"
                      sx={{ px: 0, minWidth: "2.25rem" }}
                    >
                      <FormatShapesIcon />
                    </Button>
                  </PolymerTooltip>
                  {validateExtent(item.extent_from_bottom) && (
                    <img
                      src={returnImageUrl(cog_id, item.extent_from_bottom)}
                      alt="Legend Item"
                      style={{
                        height: "3rem",
                        maxWidth: "60%",
                      }}
                    />
                  )}


                  <FormControl fullWidth sx={{ ml: "0.5rem" }} size="small">
                    <InputLabel id="demo-simple-select-label">
                      Feature Type
                    </InputLabel>
                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={category}
                      label="Feature Type"
                      onChange={(e) => changeCategory(e)}
                    >
                      <MenuItem value={"polygon"}>Polygon</MenuItem>
                      <MenuItem value={"point"}>Point</MenuItem>
                      <MenuItem value={"line"}>Line</MenuItem>
                    </Select>
                  </FormControl>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridAutoRows: "auto",
                    margin: "0.5rem 0",
                  }}
                >
                  <OcrField
                    clipName="abbreviation"
                    clipTitle="Abbreviation"
                    item={item}
                    onBlur={() => wrapChanges("abbreviation", abbrText)}
                    onChange={(e) => setAbbrText(e.target.value)}
                    value={abbrText}
                    setValueFromClip={setValueFromClip}
                  />

                  <OcrField
                    clipName="label"
                    clipTitle="Label"
                    item={item}
                    onBlur={() => wrapLabelChange(item, labelText)}
                    onChange={(e) => setLabelText(e.target.value)}
                    value={labelText}
                    setValueFromClip={setValueFromClip}
                  />

                  <div
                    style={{
                      display: "grid",
                      gridAutoRows: "auto",
                      alignItems: "center",
                      gridGap: "0.75rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    {category == "polygon" && (

                      <div style={{ display: "flex", alignItems: "center" }}>
                        <Autocomplete
                          multiple
                          id="checkboxes-tags-demo"
                          options={geologicAges}
                          value={ageText}
                          disableCloseOnSelect
                          getOptionLabel={(option) => {
                            return option
                          }}
                          onChange={(_, value) => {

                            handleAgeChange(value);
                          }}
                          renderOption={(props, option, { selected }) => {
                            const { key, ...optionProps } = props;
                            return (
                              <li key={key} {...optionProps}>
                                <Checkbox
                                  icon={icon}
                                  checkedIcon={checkedIcon}
                                  style={{ marginRight: 8 }}
                                  checked={selected}
                                />
                                {option}
                              </li>
                            );
                          }}
                          style={{ minWidth: "100%", display: "flex", alignItems: "center" }}
                          renderInput={(params) => (
                            <TextField {...params} label="Geologic Age" placeholder="..." />
                          )}
                        />
                      </div>
                    )}

                    {category == "polygon" && (
                      <TextField
                        label="Pattern"
                        fullWidth
                        value={patternText}
                        onChange={changePattern}
                        select
                        size="small"
                      >
                        <MenuItem value={"solid"}>Solid</MenuItem>
                        <MenuItem value={"dotted"}>Dotted</MenuItem>
                        <MenuItem value={"dashed"}>Dashed</MenuItem>
                        <MenuItem value={"lined"}>Lined</MenuItem>
                        <MenuItem value={"brick"}>Brick</MenuItem>
                      </TextField>
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => {
                    setValueFromClip("description", null, item);
                  }}
                  startIcon={<AddCircleIcon />}
                >
                  Add new description
                </Button>

                {item?.descriptions?.map((child, i) => (
                  <div
                    style={{ display: "grid", alignItems: "center" }}
                    key={child.text + i.toString()}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        columnGap: "0.5rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          rowGap: "0.25rem",
                          marginTop: "0.5rem",
                        }}
                      >
                        <PolymerTooltip
                          title="OCR text from selected shape on map into field."
                          placement="left"
                        >
                          <OCRButton
                            onClick={() =>
                              setValueFromClip("description", i, item)
                            }
                          />
                        </PolymerTooltip>
                        <IconButton
                          onClick={() => {
                            removeDescription(i, item);
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </div>
                      <LegendDescriptionCard
                        child={child}
                        i={i}
                        id={child.legend_id}
                        wrapDescriptionChangeText={wrapDescriptionChangeText}
                      ></LegendDescriptionCard>
                    </div>
                  </div>
                ))}
              </CardContent>
            </>
          )}

          <CardActions
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "flex-start",
              paddingBottom: 0,
            }}
          >
            {item.status != "succeeded" && item.status != "validated" && (
              <PolymerTooltip
                title="Save to Polymer, moves to Reviewed."
                placement="bottom"
              >
                <Button
                  variant="outlined"
                  color="success"
                  onClick={handleSaveItem_}
                  size="small"
                  startIcon={<AddTaskIcon />}
                >
                  Save As Reviewed
                </Button>
              </PolymerTooltip>
            )}
            {item.status !== "validated" && (
              <Button
                onClick={() => handleMinimizeItem_(item)}
                size="small"
                color="warning"
              >
                {item["minimized"] ? "Edit" : "Minimize"}
              </Button>
            )}
            {validateExtent(item.extent_from_bottom) && (
              <Button startIcon={<ZoomInIcon />} onClick={() => zoomTo(item)}>
                Zoom
              </Button>
            )}
            <Button color="error" onClick={() => removeItem(item)} size="small">
              Hide
            </Button>
          </CardActions>
        </Card>
      </div>
    </div>
  );
}

export default LegendCard;
