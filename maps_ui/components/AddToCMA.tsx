import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
/* import Text from '@mui/material/Typography'; */

import OutlinedInput from "@mui/material/OutlinedInput";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import ListItemText from "@mui/material/ListItemText";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import {
  red,
  blue,
  pink,
  purple,
  indigo,
  cyan,
  teal,
  lightGreen,
  amber,
  orange,
  brown,
  grey,
  blueGrey,
} from "@mui/material/colors";

import Tooltip from "./Tooltip";

// Copied over from MUI's select+checkbox example
const ITEM_HEIGHT = 48;
const MenuProps = {
  PaperProps: {
    style: {
      maxHeight: ITEM_HEIGHT * 4.5, // force scroll to display a couple items
    },
  },
};

function nameToColor(name) {
  var colors = [
    red,
    blue,
    pink,
    purple,
    indigo,
    cyan,
    teal,
    lightGreen,
    amber,
    orange,
    brown,
    grey,
    blueGrey,
  ];
  var hash = hashStr(name);
  var index = hash % colors.length;
  return colors[index][300];
}

const TooltipFallback = ({ enabled, children }) => {
  return enabled ? (
    <Tooltip title="Failed to fetch associated CMAs. CMA linking for this Map has been disabled. Contact us to report.">
      {children}
    </Tooltip>
  ) : (
    children
  );
};

function hashStr(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var charCode = str.charCodeAt(i);
    hash += charCode;
  }
  return hash;
}

function AddCogMultipleSelectCMA(props = {}) {
  const [linkedCMAs, setLinkedCMAs] = React.useState<string[]>([]);
  const [CMAs, setCMAs] = useState([]);
  const { cog_id } = props;

  const [cogSelectorDisabled, setCogSelectorDisabled] = useState(false);

  useEffect(() => {
    // To show all CMAs in the selector:
    axios("/api/manage-cma/").then((CMAs) => {
      setCMAs(
        CMAs.data.map((cma) => ({
          label: cma.mineral,
          id: cma.cma_id,
        })),
      );

      // To autoselect cmas the cog already belongs to when loading the page
      let cogLinkedCMAs = [];

      return axios(`/api/manage-cma/cog/${cog_id}`)
        .then((response) => {
          const { data } = response;
          cogLinkedCMAs = data.map((cma) => cma.mineral);
          setLinkedCMAs(cogLinkedCMAs);
          return true;
        })
        .catch((e) => {
          console.log(
            `Error retrieving pre-existing CMAs for cog=${cog_id},`,
            e,
          );
          setCogSelectorDisabled(true);
        });
    });
  }, []);

  const handleChange = (event) => {
    const {
      target: { value },
    } = event;

    const newLinkedCMAs = value;

    setLinkedCMAs(newLinkedCMAs);

    if (linkedCMAs.length < newLinkedCMAs.length) {
      // link
      const newCMA = newLinkedCMAs.find(
        (newLabelName) => !linkedCMAs.includes(newLabelName),
      );
      const cma_id = CMAs.find((oneCMA) => oneCMA.label === newCMA).id;
      axios.post(`/api/manage-cma/${cma_id}/link`, {
        cog_ids: [cog_id],
      });
    } else {
      // unlink
      const removedCMA = linkedCMAs.find(
        (prevCMALabel) => !newLinkedCMAs.includes(prevCMALabel),
      );
      const cma_id = CMAs.find((oneCMA) => oneCMA.label === removedCMA).id;
      axios.post(`/api/manage-cma/${cma_id}/unlink`, {
        cog_ids: [cog_id],
      });
    }
  };

  return (
    <Box {...props}>
      <FormControl sx={{ m: 1, minWidth: "10rem", width: "100%" }} size="small">
        <InputLabel id="demo-multiple-chip-label">CMA</InputLabel>
        <TooltipFallback enabled={cogSelectorDisabled}>
          <Select
            sx={{ overflow: "hidden" }}
            multiple
            disabled={cogSelectorDisabled}
            value={linkedCMAs}
            onChange={handleChange}
            input={<OutlinedInput id="select-multiple-chip" label="Chip" />}
            renderValue={(selected) => (
              <Box
                sx={{
                  display: "flex",
                  gap: 0.5,
                  maxWidth: "100%",
                  overflow: "hidden",
                }}
              >
                {selected.map((value) => (
                  <Chip
                    sx={{ backgroundColor: nameToColor(value) }}
                    size="small"
                    key={value}
                    label={value}
                  />
                ))}
              </Box>
            )}
            MenuProps={MenuProps}
          >
            {CMAs.map((cmaPair) => (
              <MenuItem key={cmaPair.id} value={cmaPair.label}>
                <Checkbox checked={linkedCMAs.indexOf(cmaPair.label) > -1} />
                <ListItemText primary={cmaPair.label} />
              </MenuItem>
            ))}
          </Select>
        </TooltipFallback>
      </FormControl>
    </Box>
  );
}

export default AddCogMultipleSelectCMA;
