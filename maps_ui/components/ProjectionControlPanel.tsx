import React, { useEffect, useRef, useState } from "react";

import InfoIcon from "@mui/icons-material/Info";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip, { TooltipProps, tooltipClasses } from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { styled } from "@mui/material/styles";

import { valuetext } from "./helpers";

import "../css/projection_control_panel.scss";

const HTMLTooltip = styled(({ className, ...props }: TooltipProps) => (
  <Tooltip {...props} classes={{ popper: className }} />
))(({ theme }) => ({
  [`& .${tooltipClasses.tooltip}`]: {
    backgroundColor: "#f5f5f9",
    color: "rgba(0, 0, 0, 0.87)",
    maxWidth: 220,
    fontSize: theme.typography.pxToRem(12),
    border: "1px solid #dadde9",
  },
}));

export default function ControlPanel({
  handleOpacityChange,
  baseSelected,
  handleBaseChange,
  baseMapSwitch,
}) {
  return (
    <div className="projection-control-panel" id="control-panel">
      <Box sx={{ paddingRight: "1.25rem" }}>
        <Typography variant="h5" gutterBottom>
          Map Opacity
        </Typography>
        <Slider
          aria-label="Continuous slider"
          defaultValue={100}
          step={10}
          valueLabelDisplay="auto"
          onChange={handleOpacityChange}
          valueLabelFormat={valuetext}
        />

        {baseMapSwitch && (
          <div style={{ display: "flex", alignItems: "center" }}>
            <Select
              sx={{ color: "white", borderColor: "white" }}
              value={baseSelected}
              onChange={handleBaseChange}
              displayEmpty
              style={{ margin: "0.25rem" }}
            >
              <MenuItem value="" disabled>
                Select an Option
              </MenuItem>
              {Object.keys(baseMapSwitch).map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </Select>
            <HTMLTooltip
              title={
                <React.Fragment>
                  <Typography color="inherit">
                    Changing to some Layers may require zooming out for them to
                    load.
                  </Typography>
                </React.Fragment>
              }
            >
              <InfoIcon color="warning" fontSize="large" />
            </HTMLTooltip>
          </div>
        )}
      </Box>
    </div>
  );
}
