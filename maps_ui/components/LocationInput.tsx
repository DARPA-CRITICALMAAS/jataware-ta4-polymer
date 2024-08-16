import React, { useEffect, useRef, useState } from "react";

import { TextField, Grid, Typography, Box } from "@mui/material";

import "../css/location_input.scss";

/**
 *
 */
export default function LocationInput({
  input_label,
  gcp,
  updateDMS,
  disabled,
}) {
  const [degree, setDegree] = useState("");
  const [minute, setMinute] = useState("");
  const [second, setSecond] = useState("");

  useEffect(() => {
    let dms = null;
    if (input_label == "y_dms") {
      dms = gcp["y_dms"];
    } else {
      dms = gcp["x_dms"];
    }
    if (dms != null) {
      setDegree(dms.split("°")[0].trim());
      setMinute(dms.split("°")[1].split("'")[0].trim());
      setSecond(dms.split("'")[1].split('"')[0].trim());
    }
  }, [gcp]);

  function updateValue(value, type) {
    if (type == "degree")
      updateDMS(input_label, value + "° " + minute + "' " + second + '"');
    if (type == "minute")
      updateDMS(input_label, degree + "° " + value + "' " + second + '"');
    if (type == "second")
      updateDMS(input_label, degree + "° " + minute + "' " + value + '"');
  }

  return (
    <Box className="location-input-root">
      <div>
        <label style={{ fontSize: "12px", paddingLeft: 15 }}>
          {input_label.split("_")[0].toUpperCase()} DMS{" "}
        </label>
      </div>
      <Grid
        container
        direction="row"
        justifyContent="center"
        alignItems="center"
      >
        <Grid
          item
          style={{
            width: "33px",
            padding: "0px",
            margin: "0px",
          }}
        >
          <TextField
            value={degree}
            onChange={(e) => {
              setDegree(e.target.value);
            }}
            onBlur={() => {
              updateValue(degree, "degree");
            }}
            variant="standard"
            InputLabelProps={{
              notched: false,
            }}
            maxLength={2}
            size="small"
            style={{
              padding: "0px",
              margin: "0px",
            }}
            disabled={disabled}
          />
        </Grid>
        <Grid item>
          <Typography
            variant="h6"
            style={{ marginBottom: 6, paddingRight: "12px" }}
          >
            °
          </Typography>
        </Grid>
        <Grid
          item
          style={{
            width: 25,
            padding: 0,
            margin: 0,
          }}
        >
          <TextField
            size="small"
            value={minute}
            onChange={(e) => {
              setMinute(e.target.value);
            }}
            disabled={disabled}
            onBlur={() => {
              updateValue(minute, "minute");
            }}
            variant="standard"
            InputLabelProps={{
              notched: false,
            }}
            maxLength={2}
            style={{
              padding: "0px",
              margin: "0px",
            }}
          />
        </Grid>
        <Grid item>
          <Typography
            variant="h6"
            style={{ marginBottom: 6, paddingRight: "12px" }}
          >
            ′
          </Typography>
        </Grid>
        <Grid
          item
          style={{
            width: 23,
            padding: 0,
            margin: 0,
          }}
        >
          <TextField
            value={second}
            size="small"
            disabled={disabled}
            onChange={(e) => {
              setSecond(e.target.value);
            }}
            onBlur={() => {
              updateValue(second, "second");
            }}
            variant="standard"
            InputLabelProps={{
              notched: false,
            }}
            maxLength={4}
            style={{
              width: "30px",
              padding: "0px",
              margin: "0px",
            }}
          />
        </Grid>
        <Grid item>
          <Typography variant="h6" style={{ marginBottom: 6 }}>
            ″
          </Typography>
        </Grid>
      </Grid>
    </Box>
  );
}
