import React, { useEffect, useState } from "react";

import { styled } from "@mui/material/styles";
import Avatar from "@mui/material/Avatar";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardHeader from "@mui/material/CardHeader";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";

import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import Text from "@mui/material/Typography";

import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import IconButton, { IconButtonProps } from "@mui/material/IconButton";

import AddTaskIcon from "@mui/icons-material/AddTask";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CircleIcon from "@mui/icons-material/FiberManualRecord";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";
import ZoomInIcon from "@mui/icons-material/ZoomIn";

import {
  returnImageUrl,
  getColorForProvenance,
  validateExtent,
} from "./helpers";
import ButtonInput from "./ButtonInput";
import Popover from "@mui/material/Popover";

import "../css/legend_card.scss";

enum FeaturePattern {
  Solid = "solid",
  Dashed = "dashed",
}

const ExpandMore = styled((props: ExpandMoreProps) => {
  const { expand, ...other } = props;
  return <IconButton {...other} />;
})(({ theme, expand }) => ({
  transform: !expand ? "rotate(0deg)" : "rotate(180deg)",
  marginLeft: "auto",
  transition: theme.transitions.create("transform", {
    duration: theme.transitions.duration.shortest,
  }),
}));

/**
 *
 */
export default function LegendCard({
  item, // Legend Item
  updateItem,
  saveItem,
  removeItem,
  zoomTo,
  ocrLastClipArea,
  geologicAges,
  mockBaseUrl = "",
}) {
  const [abbrText, setAbbrText] = useState(item["abbreviation"]);
  const [labelText, setLabelText] = useState(item?.label || "");
  const [colorText, setColorText] = useState(item["color"]);
  const [patternText, setPatternText] = useState(
    item["pattern"] || FeaturePattern.Solid,
  );
  // Also known as Feature Type
  const [category, setCategory] = useState(item["category"]);
  const [geologicAge, setGeologicAge] = useState(item["age_text"]);
  const [expanded, setExpanded] = useState(true);

  const provenance = item.system.toUpperCase() + "_" + item.system_version;
  const swatchImageUrl = `${mockBaseUrl}${returnImageUrl(item.cog_id, item.extent_from_bottom).replace("/api", "")}`;

  const [popoverAnchorEl, setPopoverAnchorEl] =
    React.useState<HTMLButtonElement | null>(null);

  const popoverId = "whjd";

  const handlePopoverTriggerClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    setPopoverAnchorEl(event.currentTarget);
  };

  const handlePopoverClose = () => {
    setPopoverAnchorEl(null);
  };

  const isPopoverOpen = Boolean(popoverAnchorEl);

  const handleExpandClick = () => {
    // For minimize
    setExpanded(!expanded);
  };

  return (
    <>
      <Card variant="outlined" className="available-legend-card">
        <CardHeader
          sx={{ padding: "0.75rem 1rem 0.75rem 1rem" }}
          avatar={
            <img
              aria-label=""
              className="legend-card-avatar-img"
              src={swatchImageUrl}
            />
          }
          action={
            <IconButton aria-label="delete" onClick={removeItem} color="error">
              <CloseIcon />
            </IconButton>
          }
          title={provenance}
          subheader="Provenance"
        />

        <CardContent className="legend-main-card-content">
          <div className="main-card-grid">
            <ButtonInput label="Abbreviation" />
            <ButtonInput label="Label" />
          </div>

          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <div className="main-card-grid" style={{ marginTop: "0.75rem" }}>
              <ButtonInput label="Feature Type" select />
            </div>

            <div className="main-card-grid" style={{ marginTop: "0.75rem" }}>
              <TextField size="small" label="Pattern" select />
              <TextField size="small" label="Geologic Age" select />
            </div>

            <Button link sx={{ marginTop: "0.75rem" }}>
              Add Description
            </Button>

            <div
              style={{
                display: "flex",
                columnGap: "0.5rem",
                alignItems: "center",
              }}
            >
              <ButtonInput
                label="Description"
                multiline
                minRows={2}
                style={{ marginTop: "0.5rem", width: "100%" }}
              />
              <IconButton>
                <DeleteIcon />
              </IconButton>
            </div>
          </Collapse>
        </CardContent>

        <CardActions disableSpacing className="legend-card-actions">
          <Button
            variant="outlined"
            color="success"
            startIcon={<AddTaskIcon />}
            onClick={saveItem}
          >
            Save
          </Button>

          <IconButton sx={{ marginLeft: "0.25rem" }} onClick={zoomTo}>
            <ZoomInIcon />
          </IconButton>

          {/* <IconButton> */}
          {/*   <HelpCenterIcon onMouseEnter={handlePopoverTriggerClick} /> */}
          {/* </IconButton> */}

          <ExpandMore
            expand={expanded}
            onClick={handleExpandClick}
            aria-expanded={expanded}
            aria-label="View More Fields"
          >
            <ExpandMoreIcon />
          </ExpandMore>
        </CardActions>
      </Card>
      <Popover
        id={popoverId}
        open={isPopoverOpen}
        anchorEl={popoverAnchorEl}
        onClose={handlePopoverClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
      >
        <Alert icon={<HighlightAltIcon fontSize="inherit" />} severity="info">
          When using the OCR tool, ensure one shape is drawn over map, then
          press the extract text button.
        </Alert>
        <Alert icon={<AddTaskIcon fontSize="inherit" />} severity="success">
          Save ensures we track the Legend Item within Polymer only. Validate
          the saved Legend items in order to send to CDR.
        </Alert>
      </Popover>
    </>
  );
}
