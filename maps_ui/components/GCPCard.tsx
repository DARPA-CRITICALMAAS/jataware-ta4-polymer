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

import {
  checkIfEdited,
  getColorForProvenance,
  dec2dms,
  dms2dec,
} from "./helpers";

import LocationInput from "./LocationInput";
import epsg_data from "../assets/EPSG_CODES_verbose.json";
import "../css/GCP_card.scss";

enum DegreeType {
  DD = "DD", // decimal degrees
  DMS = "DMS", // degreees, minutes, seconds
  UTM = "UTM"
}

export default function GCPCard({
  gcp,
  updateGCP,
  deleteGCP,
  height,
  children,
  degreesType,
  readonly,
}) {
  const [isFirstRender, setIsFirstRender] = useState(true);

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
            <TextField {...params} placeholder="EPSG Code" />
          )}
          onInputChange={(_, val_) => _onChange("crs", val_)}
        />
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
                  label="X"
                  type="number"
                  value={gcp.longitude}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="Y"
                  value={gcp.latitude}
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
            {degreesType === DegreeType.UTM && (
              <div className="decimal-degrees">
                <TextField
                  style={{ marginBottom: "1rem" }}
                  size="small"
                  disabled={readonly}
                  label="E"
                  type="number"
                  value={gcp.longitude}
                  onChange={(e) => _onChange("longitude", e.target.value)}
                />
                <TextField
                  size="small"
                  disabled={readonly}
                  label="N"
                  value={gcp.latitude}
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
