import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Experimental_CssVarsProvider as CssVarsProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import { createBrowserRouter, RouterProvider } from "react-router-dom";

import ProjectionViewer from "./projectionViewer.jsx";
import MapExtractionWrapper from "./MapExtractionWrapper";
import Landing from "./landing.tsx";
import SwatchAnnotationPage from "./components/swatchAnnotation.tsx";
import AreaExtractionsComponent from "./components/areaExtractions.tsx";
import NotFound from "./NotFoundPage";

import { theme } from "./theme";

import { ConfigProvider } from "./ConfigContext";

import "./app.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Landing />,
    errorElement: <NotFound />,
  },
  {
    path: "/projections/:cog_id",
    element: <ProjectionViewer />,
    errorElement: <NotFound />,
  },
  {
    path: "/points/:cog_id",
    element: <MapExtractionWrapper />,
    errorElement: <NotFound />,
  },
  {
    path: "/swatchannotation/:cog_id",
    element: <SwatchAnnotationPage />,
    errorElement: <NotFound />,
  },
  {
    path: "/areas/:cog_id",
    element: <AreaExtractionsComponent />,
    errorElement: <NotFound />,
  },
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // default: true
    },
  },
});

const App = () => {
  return (
    <CssVarsProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </CssVarsProvider>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <ConfigProvider>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </ConfigProvider>,
);
