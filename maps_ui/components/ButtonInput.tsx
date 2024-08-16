import * as React from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ButtonGroup from "@mui/material/ButtonGroup";

import Grow from "@mui/material/Grow";
import Paper from "@mui/material/Paper";

import HighlightAltIcon from "@mui/icons-material/HighlightAlt";

import { styled } from "@mui/material/styles";
import Box from "@mui/material/Box";
/* import ButtonBase from '@mui/material/ButtonBase'; */
import Text from "@mui/material/Typography";

import TextField from "@mui/material/TextField";

import "../css/button_input.scss";

/*
 Unused file while we finish updating pre-existing card.
*/

export default function ButtonInput({
  icon = <HighlightAltIcon />,
  onClick,
  color = "primary",
  style,
  ...props
}) {
  return (
    <div className="polymer-button-input" style={style}>
      <Button
        size="small"
        startIcon={icon}
        variant="contained"
        onClick={onClick}
        color={color}
        sx={{ pr: 0, zIndex: 15, pl: 1.75, maxHeight: "4rem" }}
      />
      <TextField
        fullWidth
        color={color}
        size="small"
        {...props}
        InputProps={{
          className: "grouped-Input-field",
        }}
      />
    </div>
  );
}

// <ButtonGroup
//       size="small"
//       variant="contained"
//       className="polymer-button-input"
//       color={color}
//       sx={sx}
//     >
//       <Button
//         size="small"
//         startIcon={icon}
//         onClick={onClick}
//         color={color}
//         sx={{ pr: 0, zIndex: 15, pl: 1.75 }}
//       />
//       <TextField
//         sx={{
//           ml: "-0.25rem",
//         }}
//         fullWidth
//         color={color}
//         size="small"
//         {...props}
//         InputProps={{
//           className: "grouped-Input-field",
//         }}
//       />
//     </ButtonGroup>
//   );
