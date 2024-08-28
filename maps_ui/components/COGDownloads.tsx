import * as React from "react";
import axios from "axios";
import Button from "@mui/material/Button";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import Grow from "@mui/material/Grow";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Tooltip from "./Tooltip";
import { useQuery } from "@tanstack/react-query";

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

const options = [
  "Get Projected Features",
  "Get Projected COG",
  "Get Pixel-Space COG",
];

const optionIndexToKey = {
  "0": "products",
  "1": "projected",
  "2": "cog",
}

export default function DownloadButton({cog_id}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const { isLoading, isError, data, error } = useQuery({
    queryKey: ["mapCog", cog_id, "downloads"],
    queryFn: () => {
      const p = axios({
        method: "GET",
        url: "/api/map/downloads/" + cog_id,
        headers: _APP_JSON_HEADER,
      });
      return p;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  if (isLoading) {
    return null;
  }

  return (
    <div
      onMouseEnter={() => setOpen(!isError)}
      onMouseLeave={() => setOpen(false)}
    >

      <Tooltip
        title={isError && "Downloads available for maps with validated projections only."}
        arrow
      >
        <span>
          <Button
            ref={anchorRef}
            variant="outlined"
            endIcon={<ArrowDropDownIcon />}
            sx={{cursor: "default"}}
            disabled={isError}
          >
            Download
          </Button>
        </span>
      </Tooltip>

      <Popper
        sx={{
          zIndex: 1,
        }}
        open={open}
        anchorEl={anchorRef.current}
        transition
      >
        {({ TransitionProps, placement }) => (
          <Grow {...TransitionProps}>
            <Paper>
              <MenuList sx={{ flexDirection: "column" }}>
                {options.map((option, index) => (
                  <MenuItem
                    component="a"
                    key={option}
                    download
                    href={!isError && data.data[optionIndexToKey[index]]}
                  >
                    {option}
                  </MenuItem>
                ))}
              </MenuList>
            </Paper>
          </Grow>
        )}
      </Popper>
    </div>
  );
}
