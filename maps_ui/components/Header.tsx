import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  useIsFetching,
  useIsMutating,
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import { useColorScheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import Alert from "@mui/material/Alert";
import Badge, { BadgeProps } from '@mui/material/Badge';
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import { styled } from '@mui/material/styles';

import polymerLogo from "../assets/polymer_logo.svg?react";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import LoadingButton from "@mui/lab/LoadingButton";
import Text from "@mui/material/Typography";
import SvgIcon from "@mui/material/SvgIcon";

import Menu from "@mui/material/Menu";
import MenuIcon from "@mui/icons-material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import CloseIcon from "@mui/icons-material/Close";
import CopyIcon from "@mui/icons-material/ContentCopy";
import SubmitShapefileButtonModal from "./SubmitShapefileModel"
import { useLocation } from 'react-router-dom';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

import CMASelection from "./AddToCMA";
import { ErrorBoundary } from "react-error-boundary";

import { Spinner } from "../Spinner";
import COGDownloads from "./COGDownloads";
import Tooltip from "./Tooltip";

import "../css/header.scss";

const _APP_JSON_HEADER = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function isNumber(n) {
  return typeof n === "number";
}

export function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const NavBadge = styled(Badge)<BadgeProps>(({ theme }) => ({
  '& .MuiBadge-badge': {
    right: 2,
    top: -1,
    // border: `1px solid ${theme.palette.background.paper}`,
    height: "1rem",
    fontWeight: "bold",
    opacity: 0.78,
    filter: "hue-rotate(12deg)",
    fontSize: "0.6rem",
    color: theme.palette.common.black,
  },
}));

const SLOW_JOB_WAIT_TIME = 15000;
async function pollCallSuccess(url) {
  let wait = 5000; //ms
  let totalSecondsWaited = 0;

  while (true) {
    await sleep(wait);
    totalSecondsWaited += wait / 1000;
    const res = await axios.get(url);
    const { data } = res;
    // const data = await res.json();

    if (!["running", "pending"].includes(data.status)) {
      return data.status;
    }
    if (totalSecondsWaited >= 90 && wait < SLOW_JOB_WAIT_TIME) {
      wait = SLOW_JOB_WAIT_TIME;
    }
  }
}

const fallbackCopyTextToClipboard = (text: string) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
};

const copyTextToClipboard = (text: string) => {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    function () {
      console.log("Copying to clipboard was successful!");
    },
    function (err) {
      console.error("Could not copy text: ", err);
    },
  );
};

enum ThemeModes {
  Light = "light",
  Dark = "dark",
}

const SECOND = 1000;
const MINUTE = SECOND * 60;

const NavButton = (props) => {
  return (
    <Button
      color="inherit"
      sx={{
        fontWeight: "bold",
        textTransform: "capitalize",
        color: "theme.palette.grey",
      }}
      {...props}
    />
  );
};

// TODO use this for both the mobile-version menu and desktop version
const pages = [
  {
    label: "Map GCPs",
    urlPath: "points",
  },
  { label: "Projections",
    urlPath: "projections",
    statusKey: "projections"
  },
  {
    label: "Areas",
    urlPath: "areas"
  },
  {
    label: "Legend Swatches",
    urlPath: "swatchannotation",
    statusKey: "legend_items",
  },
  {
    label: "Polygons",
    urlPath: "segment",
    statusKey: "polygons" ,
    external: true,
  },
  {
    label: "Points/Lines",
    urlPath: "lines",
    statusKey: "lines",
    external: true,
  },
];

const V2_BASE_URL = import.meta.env.VITE_V2_UI_BASE_URL;

const validGreen = "success";
const pendingYellow = "pending"; // rgb(108, 171, 245) blue previously
const emptyRed = "error";

enum StatState {
    VALIDATED = "validated",
    PENDING = "pending",
    EMPTY = "empty",
};

const stateToColorMapper = {
  [StatState.VALIDATED]: validGreen,
  [StatState.PENDING]: pendingYellow,
  [StatState.EMPTY]: emptyRed,
};

// Previous tooltips
// const statusToTooltip = {
//   [validGreen]: "Validated items available.",
//   [pendingYellow]: "Pending items available for review.",
//   [emptyRed]: "No items available.",
// }

export default function Header({ navigate, forceLoading, cog_id }) {
  const { mode, setMode } = useColorScheme();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const location = useLocation();

  const isProjectionsPage = location.pathname.includes('/projections/');
  function onNavClick(page) {
    const url = `/${page}/${cog_id}`;
    navigate(url);
  }

  function toV2Url(page) {
    return `/${page}/${cog_id}`;
  }

  const availableExtractionsQuery = useQuery({
    enabled: Boolean(cog_id),
    queryKey: ["mapCog", cog_id, "extractionsAvailable"],
    queryFn: async () => {
      const response = await axios({
        method: "GET",
        url: "/api/map/" + cog_id + "/cog-stats-status",
        headers: _APP_JSON_HEADER,
      });
      const { data } = response;

      const singleFeatures = ["projections", "polygons", "legend_items"];
      const colors = singleFeatures.reduce((acc, curr) => {
        acc[curr] = {
          total: data[curr].total,
          validated: data[curr].validated,
          color: stateToColorMapper[data[curr].status],
        }
        return acc;
      }, {});

      const stateOrder = [StatState.EMPTY, StatState.PENDING, StatState.VALIDATED];

      let linePointKeyToUse = "lines";
      // if points has a higher state than lines, replace "lines" with "points" state
      if (stateOrder.indexOf(data["lines"]) < stateOrder.indexOf(data["points"])) {
        linePointKeyToUse = "points";
      }

      // use lines as the url is /lines as well
      colors["lines"] = {
        color: stateToColorMapper[data[linePointKeyToUse].status],
        total: data[linePointKeyToUse].total,
        validated: data[linePointKeyToUse].validated,
      }

      // colors is a mui `color` variant prop (eg info, success, error, warning, etc)
      return colors; // this will still be availableExtractionsQuery?.data
    },
    refetchOnWindowFocus: false,
  });

  const cogProjectionsQuery = useQuery({
    enabled: Boolean(cog_id),
    queryKey: ["mapCog", cog_id, "projections"],
    queryFn: () => {
      return axios({
        method: "GET",
        url: "/api/map/" + cog_id + "/proj_info",
        headers: _APP_JSON_HEADER,
      });
    },
    refetchOnWindowFocus: false,
  });

  const submitProcessMap = useMutation({
    mutationFn: async (cog_id) => {
      return axios({
        method: "POST",
        url: `/api/map/cdr/fire/${cog_id}`,
        timeout: 5 * MINUTE,
        headers: _APP_JSON_HEADER,
      });
    },
    onError: (e) => {
      window.localStorage.setItem(
        "polymer:cdr-last-process-map-result",
        JSON.stringify(e),
      );
    },
  });

  const mapDownloadsAvailable = useQuery({
    queryKey: ["mapCog", cog_id, "downloads"],
  });

  const georeferenceFeatures = useMutation({
    mutationFn: async () => {
      const geoFeatCall = await axios({
        method: "POST",
        url: `/api/map/${cog_id}/georeference-features`,
        timeout: 5 * MINUTE,
        headers: _APP_JSON_HEADER,
      });

      if (geoFeatCall.status === 200) {
        const { job_id } = geoFeatCall.data;

        const jobUrl = "/api/features/creation-job-status";
        const jobUrlID = `${jobUrl}?job_id=${job_id}`;
        await pollCallSuccess(jobUrlID)

        const resultJobURL = jobUrlID.replace("status", "result");
        const jobResult = await axios.get(resultJobURL);
        if (jobResult.data.state === "success") {
          return jobResult.data.state;
        }
        throw new Error(`Georeference Job Failed with status: ${jobResult.data.state}.`);
      }
      throw new Error(`An unexpected error ocurred. Status code: ${geoFeatCall.status}.`);
    },
  });

  const SnackbarActions = (
    <IconButton
      size="small"
      aria-label="close"
      color="inherit"
      onClick={submitProcessMap.reset}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );

  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("xl"));
  const isMediumScreen = useMediaQuery(theme.breakpoints.down("md"));

  const [anchorElNav, setAnchorElNav] = React.useState<null | HTMLElement>(
    null,
  );

  const handleOpenNavMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElNav(event.currentTarget);
  };

  const handleCloseNavMenu = () => {
    setAnchorElNav(null);
  };

  const { data: statusData } = availableExtractionsQuery;

  function getDataForStatus(statusKey) {
    return statusData ? statusData[statusKey] : {};
  }


  function getBadgeContents(statusKey) {
    const { total, validated } = getDataForStatus(statusKey);
    if (isNumber(total) && isNumber(validated)) {
      if (total == 0) {
        return "0";
      }
      return `${validated} / ${total}`;
    }
      return "";
  }

  function getStatusTooltip(statusKey) {
    const { total, validated } = getDataForStatus(statusKey);
    if (isNumber(total) && isNumber(validated)) {
      if (total === 0) {
        return "No extractions available."
      }
      return `${validated} validated / ${total} total`;
    }
  }

  return (
    <header className="polymer-header-root">
      <div className="left-header">
        <a href={(V2_BASE_URL || "") + "/"} className="polymer-title">
          <div className="polymer-logo">
            {Boolean(isFetching) || Boolean(isMutating) || forceLoading ? (
              <Spinner size={33} />
            ) : (
              <SvgIcon component={polymerLogo} inheritViewBox className="svg" />
            )}
          </div>
          &nbsp;
          <Text variant="h5" style={{ fontWeight: "bold" }}>
            Polymer
          </Text>
        </a>
        {cog_id && isMediumScreen ? (
          <nav>
            <IconButton
              size="large"
              aria-label="account of current user"
              aria-controls="menu-appbar"
              aria-haspopup="true"
              onClick={handleOpenNavMenu}
              color="inherit"
            >
              <MenuIcon />
            </IconButton>
            <Menu
              id="menu-appbar"
              anchorEl={anchorElNav}
              anchorOrigin={{
                vertical: "bottom",
                horizontal: "left",
              }}
              keepMounted
              transformOrigin={{
                vertical: "top",
                horizontal: "left",
              }}
              open={Boolean(anchorElNav)}
              onClose={handleCloseNavMenu}
            >
              {pages.map((page) => (

                <MenuItem
                  key={page.label}
                  onClick={
                    page.external ? undefined : () => onNavClick(page.urlPath)
                  }
                  href={page.external && toV2Url(page.urlPath)}
                  component={page.external ? "a" : undefined}
                >
                  {page.statusKey ? (
                    <Tooltip
                      title={getStatusTooltip(page.statusKey)}
                      arrow
                    >
                      <NavBadge 
                        badgeContent={getBadgeContents(page.statusKey)}
                        color={getDataForStatus(page.statusKey).color}
                      >
                        <Text textAlign="center">{page.label}</Text>
                      </NavBadge>
                    </Tooltip>
                  ) : (
                      <Text textAlign="center">{page.label}</Text>
                  )}
                </MenuItem>
              ))}
            </Menu>

            <Tooltip
              title="Queue the map for processing for georeferencing and feature extraction"
              arrow
            >
              <LoadingButton
                loading={submitProcessMap.isPending}
                loadingIndicator="Queueing…"
                onClick={() => submitProcessMap.mutate(cog_id)}
                variant="contained"
              >
                Process Map
              </LoadingButton>
            </Tooltip>
            {isProjectionsPage && (

              <SubmitShapefileButtonModal cog_id={cog_id}></SubmitShapefileButtonModal>
            )}
          </nav>
        ) : (
          <nav>
            <ul>
              <li>
                <NavButton 
                  onClick={() => onNavClick("points")} 
                >
                    {!isLargeScreen ? <span>GCPs</span> : <span>Map GCPs</span>}
                  </NavButton>
              </li>
              {Boolean(cogProjectionsQuery?.data?.data?.length) && (
                  <li>
                    <NavButton
                      onClick={() => onNavClick("projections")}
                    >
                      <Tooltip
                        title={getStatusTooltip("projections")}
                        arrow
                      >
                        <NavBadge
                          badgeContent={getBadgeContents("projections")}
                          color={getDataForStatus("projections").color}
                        >
                          Projections
                        </NavBadge>
                      </Tooltip>
                    </NavButton>
                  </li>
              )}
              <li>
                <NavButton onClick={() => onNavClick("areas")}>
                  <span>Areas</span>
                </NavButton>
              </li>
              <li>
                  <NavButton
                    onClick={() => onNavClick("swatchannotation")}
                  >
                    <Tooltip
                      title={getStatusTooltip("legend_items")}
                      arrow
                    >
                      <NavBadge
                        badgeContent={getBadgeContents("legend_items")}
                        color={getDataForStatus("legend_items").color}
                      >
                        {!isLargeScreen ? (
                          <span>Swatches</span>
                        ) : (
                          <span>Legend Swatches</span>
                        )}
                      </NavBadge>
                    </Tooltip>
                  </NavButton>
              </li>

              <li>
                <NavButton 
                    href={toV2Url("segment")}
                  >
                    <Tooltip
                      title={getStatusTooltip("polygons")}
                      arrow
                    >
                    <NavBadge
                      badgeContent={getBadgeContents("polygons")}
                      color={getDataForStatus("polygons").color}
                    >
                      Polygons
                    </NavBadge>
                    </Tooltip>
                </NavButton>
              </li>

              <li>
                  <NavButton
                    href={toV2Url("lines")}
                  >
                    <Tooltip
                      title={getStatusTooltip("lines")}
                      arrow
                    >
                      <NavBadge
                        badgeContent={getBadgeContents("lines")}
                        color={getDataForStatus("lines").color}
                      >
                        Points/Lines
                      </NavBadge>
                    </Tooltip>
                  </NavButton>
              </li>

              <li>
                <Tooltip
                  title="Queue the map for processing for georeferencing and feature extraction"
                  arrow
                >
                  <LoadingButton
                    loading={submitProcessMap.isPending}
                    loadingIndicator="Queueing…"
                    onClick={() => submitProcessMap.mutate(cog_id)}
                    variant="contained"
                  >
                    {isLargeScreen ? (
                      <span>Process Map</span>
                    ) : (
                      <span>Process</span>
                    )}
                  </LoadingButton>
                </Tooltip>
              </li>
              {isProjectionsPage && (
                <li>
                  <SubmitShapefileButtonModal cog_id={cog_id}></SubmitShapefileButtonModal>
                </li>
              )}
              {cog_id && (
                <>
                <li>
                  <COGDownloads cog_id={cog_id} />
                </li>
                {isProjectionsPage && mapDownloadsAvailable.isSuccess && (
                  <li>
                    <Tooltip
                      title={georeferenceFeatures.isSuccess ?
                              "Successfully georeferenced all features. Click to run again." :
                             georeferenceFeatures.isPending ? "Georeferencing new features (running)..." :
                             georeferenceFeatures.isError ? "Failed to georeference new features. Try again later." :
                              "Georeference manually-edited features and recreate packages."}
                      placement="bottom"
                      arrow
                    >
                      <span>
                        <IconButton
                          color={georeferenceFeatures.isSuccess ? "success" : georeferenceFeatures.isError ? "error" : "default"}
                          onClick={georeferenceFeatures.mutate}
                          disabled={georeferenceFeatures.isPending}
                        >
                          {georeferenceFeatures.isSuccess ? (
                            <TaskAltIcon />
                          ) : georeferenceFeatures.isError ? (
                              <ErrorOutlineIcon />
                          ) : (
                            <RefreshRoundedIcon className={georeferenceFeatures.isPending ? 'rotating' : ''} />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </li>
                )}
                </>
              )}
            </ul>
          </nav>
        )}
      </div>
      <ErrorBoundary fallback={<div>...</div>}>
        <div className="right-header">
          {cog_id && (
            <CMASelection cog_id={cog_id} sx={{ maxWidth: "75%", mr: 2 }} />
          )}

          <div style={{ display: "flex" }}>
            {cog_id && (
              <Tooltip
                title="Copy COG ID to Clipboard"
                placement="bottom"
                arrow
              >
                <IconButton onClick={() => copyTextToClipboard(cog_id)}>
                  <CopyIcon />
                </IconButton>
              </Tooltip>
            )}

            <Tooltip title="Toggle theme" placement="left" arrow>
              <IconButton
                onClick={() => {
                  if (mode === ThemeModes.Light) {
                    setMode(ThemeModes.Dark);
                  } else {
                    setMode(ThemeModes.Light);
                  }
                }}
              >
                {mode === ThemeModes.Dark ? (
                  <Brightness7Icon />
                ) : (
                  <Brightness4Icon />
                )}
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </ErrorBoundary>

      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        open={
          (!submitProcessMap.isPending && submitProcessMap.isSuccess) ||
          submitProcessMap.isError
        }
        autoHideDuration={5000}
        onClose={submitProcessMap.reset}
      >
        <Alert
          onClose={submitProcessMap.reset}
          severity={
            submitProcessMap.isSuccess
              ? "success"
              : submitProcessMap.isError
                ? "error"
                : ""
          }
          variant="filled"
          sx={{ width: "100%" }}
        >
          {submitProcessMap.isSuccess
            ? "The map has been queued for georeferencing and feature extraction. Please check back later to view results."
            : "Failed to queue map for processing."}
        </Alert>
      </Snackbar>

    </header >
  );
}
