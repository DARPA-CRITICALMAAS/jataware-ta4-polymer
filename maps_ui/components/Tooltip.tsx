import React from "react";
import { styled } from "@mui/material/styles";
import Tooltip, { TooltipProps, tooltipClasses } from "@mui/material/Tooltip";
import { blueGrey } from "@mui/material/colors";

/**
 *
 */
const PolymerTooltip = styled(
  ({ className, placement = "bottom", ...props }: TooltipProps) => (
    <Tooltip {...props} placement={placement} classes={{ popper: className }} />
  ),
)(({ theme }) => {
  return {
    [`& .${tooltipClasses.tooltip}`]: {
      backgroundColor: blueGrey[900],
      boxShadow: theme.shadows[1],
      fontSize: 14,
      maxWidth: "unset",
    },
    [`& .${tooltipClasses.arrow}`]: {
      color: blueGrey[900],
    },
  };
});

export default PolymerTooltip;
