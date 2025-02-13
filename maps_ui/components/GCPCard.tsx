import React, { useEffect, useRef, useState } from "react";

import Grid from "@mui/material/Grid";
import Autocomplete from "@mui/material/Autocomplete";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import CircleIcon from "@mui/icons-material/FiberManualRecord";
import DeleteIcon from "@mui/icons-material/Delete";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
// import Text from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import PolymerTooltip from "./Tooltip";

import {
  checkIfEdited,
  getColorForProvenance,
  dec2dms,
  dms2dec,
} from "./helpers";

import LocationInput from "./LocationInput";
import epsg_data from "../assets/PROJ_CODES_WORLD.json";
import "../css/GCP_card.scss";

enum DegreeType {
  DD = "DD", // decimal degrees
  DMS = "DMS", // degreees, minutes, seconds
  EN = "EN", // East North
  WS = "WS", // West South
  WN = "WN" // West North
}
function determineCrsFormat(gcp) {
  return gcp?.crs_format || "DMS";
}


export default function GCPCard({
  gcp,
  updateGCP,
  deleteGCP,
  height,
  children,
  readonly,
}) {
  const [isFirstRender, setIsFirstRender] = useState(true);
  const [degreesType, setDegreesType] = useState(determineCrsFormat(gcp));
  function _onChange(key_, val_) {
    if (isFirstRender) {
      return;
    }
    let new_gcp = { ...gcp };
    if (
      ["longitude", "latitude", "rows_from_top", "columns_from_left"].includes(
        key_,
      )
    )
      val_ = parseFloat(val_);

    new_gcp[key_] = val_;

    if (key_ == "longitude") new_gcp["x_dms"] = dec2dms(val_);
    if (key_ == "latitude") new_gcp["y_dms"] = dec2dms(val_);
    if (key_ == "x_dms") new_gcp["longitude"] = dms2dec(val_);
    if (key_ == "y_dms") new_gcp["latitude"] = dms2dec(val_);

    new_gcp["just_edited"] = true; // TODO why is this needed?

    updateGCP(new_gcp, height);
  }

  function updateDMS(key, value) {
    _onChange(key, value);
  }

  // TODO document why this is needed
  useEffect(() => {
    setIsFirstRender(false);
  }, []);

  return (
    <Card variant="outlined" className="gcp-card-root">
      <div className="card-header">
        <div className="heading-edited">
          <div className="spacer">
            <Tooltip title={`Provenance: ${gcp["provenance"]}`} arrow>
              <h4 style={{ color: getColorForProvenance(gcp["provenance"]) }}>
                {gcp["provenance"]}
              </h4>
            </Tooltip>

            {checkIfEdited(gcp) && (
              <Tooltip title="edited" arrow>
                <CircleIcon sx={{ fontSize: "1rem" }} color="success" />
              </Tooltip>
            )}
          </div>
        </div>

        <Autocomplete
          required
          className="autocomplete"
          size="small"
          disabled={readonly}
          options={epsg_data.codes}
          value={gcp.crs}
          renderInput={(params) => (
            <TextField {...params} placeholder="CRS Code" />
          )}
          onInputChange={(_, val_) => _onChange("crs", val_)}
        />
        <FormControl className="degrees-selection">
          <FormLabel>Format</FormLabel>
          &nbsp; &nbsp;
          <RadioGroup
            row
            className="gcp-list-degrees"
            aria-labelledby="degrees-type-selection"
            value={degreesType}
            onChange={(e) => setDegreesType(e.target.value)}
          >
            <PolymerTooltip
              title="Degree Minute Seconds"
              placement="right"
            >
              <FormControlLabel
                value={DegreeType.DMS}
                control={<Radio size="small" />}
                label="DMS"
              />
            </PolymerTooltip>
            <PolymerTooltip
              title="Decimal Degree"
              placement="right"
            >
              <FormControlLabel
                value={DegreeType.DD}
                control={<Radio size="small" />}
                label="DD"
              />
            </PolymerTooltip>
            <PolymerTooltip
              title="East/North"
              placement="right"
            >
              <FormControlLabel
                value={DegreeType.EN}
                control={<Radio size="small" />}
                label="E/N"
              />
            </PolymerTooltip>
            <PolymerTooltip
              title="West/North"
              placement="right"
            >
              <FormControlLabel
                value={DegreeType.WN}
                control={<Radio size="small" />}
                label="W/N"
              />
            </PolymerTooltip>
            <PolymerTooltip
              title="West/South"
              placement="right"
            >
              <FormControlLabel
                value={DegreeType.WS}
                control={<Radio size="small" />}
                label="W/S"
              />
            </PolymerTooltip>
          </RadioGroup>
        </FormControl>
      </div>
      <div className="extraction-card">
        <CardContent>
          <div className="gcp-card-grid">
            {degreesType === DegreeType.DD && (
              <div className="decimal-degrees">
                <TextField
                  style={{ marginBottom: "1rem" }}
                  size="small"
                  disabled={readonly}
                  label="lng"
                  type="number"
                  value={gcp.longitude ?? ""}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="lat"
                  value={gcp.latitude ?? ""}
                  type="number"
                  onChange={(e) => _onChange("latitude", e.target.value)}
                />
              </div>
            )}
            {degreesType === DegreeType.DMS && (
              <div>
                <LocationInput
                  disabled={readonly}
                  input_label="x_dms"
                  gcp={gcp}
                  updateDMS={updateDMS}
                />
                <LocationInput
                  disabled={readonly}
                  input_label="y_dms"
                  gcp={gcp}
                  updateDMS={updateDMS}
                />
              </div>
            )}
            {degreesType === DegreeType.EN && (
              <div className="decimal-degrees">
                <TextField
                  style={{ marginBottom: "1rem" }}
                  size="small"
                  disabled={readonly}
                  label="E"
                  type="number"
                  value={gcp.longitude ?? ""}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="N"
                  value={gcp.latitude ?? ""}
                  type="number"
                  onChange={(e) => _onChange("latitude", e.target.value)}
                />
              </div>
            )}
            {degreesType === DegreeType.WS && (
              <div className="decimal-degrees">
                <TextField
                  style={{ marginBottom: "1rem" }}
                  size="small"
                  disabled={readonly}
                  label="W"
                  type="number"
                  value={gcp.longitude ?? ""}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="S"
                  value={gcp.latitude ?? ""}
                  type="number"
                  onChange={(e) => _onChange("latitude", e.target.value)}
                />
              </div>
            )}
            {degreesType === DegreeType.WN && (
              <div className="decimal-degrees">
                <TextField
                  style={{ marginBottom: "1rem" }}
                  size="small"
                  disabled={readonly}
                  label="W"
                  type="number"
                  value={gcp.longitude ?? ""}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="N"
                  value={gcp.latitude ?? ""}
                  type="number"
                  onChange={(e) => _onChange("latitude", e.target.value)}
                />
              </div>
            )}
            {!readonly && (
              <div>
                <Button
                  className="trash-button"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => deleteGCP(gcp)}
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        </CardContent>
        <CardActions>
          {gcp.rows_from_top && gcp.columns_from_left && !readonly && (
            <div className="rows-x-cols">
              <Tooltip title="pixels from top" arrow>
                <span>[&nbsp;{gcp.rows_from_top.toFixed(0)}</span>
              </Tooltip>
              ,&nbsp;
              <Tooltip title="pixels from left" arrow>
                <span>{gcp.columns_from_left.toFixed(0)}&nbsp;]&nbsp;</span>
              </Tooltip>
            </div>
          )}
          {children}
        </CardActions>
      </div>
    </Card>
  );
}
