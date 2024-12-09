// mapExtraction.tsx

import React, { useState } from "react";

import FormControlLabel from "@mui/material/FormControlLabel";

import { Button, Checkbox } from "@mui/material";
import { Card, CardContent } from "@mui/material";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

// import "../css/legend_annotation.scss";
import "../css/legend_card_success.scss";

import {
  returnImageUrl,
  getColorForProvenance,
  validateExtent,
  returnInCDR,
  returnInCDRStyle,
} from "./helpers";

function LegendCardSuccess({
  cog_id,
  item,
  setValidated,
  removeSucceededItem,
  zoomTo,
}) {
  const [minimized, setMinimized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);

    if (validateExtent(item.extent_from_bottom)) {
      zoomTo(item);  // Call the zoomTo function on hover
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };
  function handleMinimizeItem_() {
    setMinimized(!minimized);
  }
  function returnValidatedString(status) {
    return status ? "validated" : "succeeded";
  }
  function wrapValidateChanges(value) {
    setValidated(item, value);
  }

  return (
    <Card
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ width: "100%", borderRadius: "10px", padding: "1rem" }}>
      <div>
        <div
          style={{
            marginLeft: "8px",
            padding: "1rem",
            border: "1px solid gray",
            backgroundColor: "var(--mui-palette-background-paper)",
            color: "var(--mui-palette-text-secondary)",
            borderRadius: "14px",
          }}
        >
          {minimized || item.status == "validated" ? (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr" }}>
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
                  <Typography>
                    <span style={{ display: "flex" }}>
                      <span>
                        In cdr:&nbsp;
                        <Chip
                          style={returnInCDRStyle(item["in_cdr"])}
                          size="small"
                          label={returnInCDR(item["in_cdr"])}
                        />
                      </span>
                    </span>
                  </Typography>
                  <div>
                    <b>Feature Type:</b> {item.category}
                  </div>

                  <div>
                    <b>Abbreviation:</b> {item.abbreviation}
                  </div>
                </div>
                {validateExtent(item.extent_from_bottom) && (
                  <img
                    src={returnImageUrl(cog_id, item.extent_from_bottom)}
                    alt="Legend Item"
                    style={{
                      maxWidth: "80%",
                      height: "auto",
                      marginBottom: "10px",
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr" }}>
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
                    <b>Status: </b>
                    {item.status.toUpperCase()}
                  </div>
                  <b>Type:</b> {item.category}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <b>Abbreviation: </b>
                    {item.abbreviation}
                  </div>
                  <div>
                    <b>Label: </b>
                    {item.label}
                  </div>
                </div>
                <div>
                  <CardContent>
                    {validateExtent(item.extent_from_bottom) && (
                      <img
                        src={returnImageUrl(cog_id, item.extent_from_bottom)}
                        alt="Legend Item"
                        style={{
                          maxWidth: "80%",
                          height: "auto",
                          marginBottom: "10px",
                        }}
                      />
                    )}
                    {item.category == "polygon" && (
                      <div>
                        <b>Pattern: </b>
                        {item.pattern}
                      </div>
                    )}
                  </CardContent>
                </div>
              </div>
              {item.descriptions != undefined && (
                <>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div
                      style={{
                        marginRight: "10px",
                        fontWeight: "bold",
                      }}
                    >
                      Descriptions:
                    </div>
                  </div>
                  {item.descriptions.map((child, i) => {
                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                        }}
                        key={i}
                      >
                        {child.text}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
          <>
            <Button onClick={() => handleMinimizeItem_()} color="primary">
              {minimized ? "Expand" : "Minimize"}
            </Button>
            <Button
              onClick={() => {
                removeSucceededItem(item);
              }}
            >
              Edit
            </Button>
            {/* {validateExtent(item.extent_from_bottom) && (
              <Button startIcon={<ZoomInIcon />} onClick={() => zoomTo(item)}>
                Zoom
              </Button>
            )} */}
          </>
          <FormControlLabel
            control={
              <Checkbox
                checked={item["status"] == "validated"}
                onChange={(e) =>
                  wrapValidateChanges(returnValidatedString(e.target.checked))
                }
                inputProps={{ "aria-label": "controlled" }}
              />
            }
            label={item["status"] != "validated" ? "Validate" : "Validated"}
          />
        </div>
      </div>
    </Card>
  );
}
export default LegendCardSuccess;
