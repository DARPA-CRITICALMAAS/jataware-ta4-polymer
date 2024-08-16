import * as React from "react";

import CircularProgress, {
  CircularProgressProps,
} from "@mui/material/CircularProgress";

export function Spinner(props: CircularProgressProps) {
  return (
    <React.Fragment>
      <svg width={0} height={0}>
        <defs>
          <linearGradient id="my_gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e01cd5" />
            <stop offset="100%" stopColor="#1CB5E0" />
          </linearGradient>
        </defs>
      </svg>
      <CircularProgress
        sx={{ "svg circle": { stroke: "url(#my_gradient)" } }}
        thickness={props.thinkness || 4}
        size={props.size || 40}
        disableShrink
      />
    </React.Fragment>
  );
}

export function MapSpinner(props: CircularProgressProps) {
  return (
    <CircularProgress
      thickness={props.thinkness || 4}
      size={props.size || 20}
      disableShrink
      color="primary"
    />
  );
}
