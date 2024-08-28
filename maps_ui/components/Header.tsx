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
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import GitHubIcon from "@mui/icons-material/GitHub";

import polymerLogo from "../assets/polymer_logo.svg?react";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import LoadingButton from "@mui/lab/LoadingButton";
import Text from "@mui/material/Typography";
import SvgIcon from "@mui/material/SvgIcon";

import Menu from "@mui/material/Menu";
import MenuIcon from "@mui/icons-material/Menu";
import MenuItem from "@mui/material/MenuItem";
import AdbIcon from "@mui/icons-material/Adb";
import Snackbar from "@mui/material/Snackbar";
import CloseIcon from "@mui/icons-material/Close";
import CopyIcon from "@mui/icons-material/ContentCopy";

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

const pages = [
  {
    label: "Map GCPs",
    urlPath: "points",
  },
  { label: "Projections", urlPath: "projections" },
  {
    label: "Legend Swatches",
    urlPath: "swatchannotation",
  },
  {
    label: "Polygons",
    urlPath: "segment",
    external: true,
  },
  {
    label: "Points/Lines",
    urlPath: "lines",
    external: true,
  },
];

export default function Header({ navigate, forceLoading, cog_id }) {
  const { mode, setMode } = useColorScheme();
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();

  function onNavClick(page) {
    const url = `/${page}/${cog_id}`;
    navigate(url);
  }

  function toV2Url(page) {
    return `/${page}/${cog_id}`;
  }

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
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  function queueMapProcess() {}

  const [anchorElNav, setAnchorElNav] = React.useState<null | HTMLElement>(
    null,
  );
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(
    null,
  );

  const handleOpenNavMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElNav(event.currentTarget);
  };

  const handleCloseNavMenu = () => {
    setAnchorElNav(null);
  };

  return (
    <header className="polymer-header-root">
      <div className="left-header">
        <a href="/" className="polymer-title">
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
                  component={external ? "a" : undefined}
                >
                  <Text textAlign="center">{page.label}</Text>
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
          </nav>
        ) : (
          <nav>
            <ul>
              <li>
                <NavButton onClick={() => onNavClick("points")}>
                  {!isLargeScreen ? <span>GCPs</span> : <span>Map GCPs</span>}
                </NavButton>
              </li>
              {Boolean(cogProjectionsQuery?.data?.data?.length) && (
                <li>
                  <NavButton onClick={() => onNavClick("projections")}>
                    Projections
                  </NavButton>
                </li>
              )}
              <li>
                <NavButton onClick={() => onNavClick("swatchannotation")}>
                  {!isLargeScreen ? (
                    <span>Swatches</span>
                  ) : (
                    <span>Legend Swatches</span>
                  )}
                </NavButton>
              </li>
              <li>
                <NavButton href={toV2Url("segment")}>Polygons</NavButton>
              </li>

              <li>
                <NavButton href={toV2Url("lines")}>Points/Lines</NavButton>
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

              {cog_id && (
                <li>
                  <COGDownloads cog_id={cog_id}/>
                </li>
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
    </header>
  );
}
