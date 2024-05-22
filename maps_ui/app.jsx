import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom';

import ProjectionViewer from './projectionViewer.jsx'
import GeoreferencePage from './georeferencePage.jsx'
import Landing from './landing.tsx'
import SwatchAnnotationPage from './components/swatchAnnotation.tsx';
function App() {


  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/projections/:cog_id"
          element={<ProjectionViewer />}
        />
        <Route path="/points/:cog_id"
          element={<GeoreferencePage />}
        />
        <Route path="/swatchannotation/:cog_id"
          element={<SwatchAnnotationPage />}
        />

      </Routes>
    </BrowserRouter>
  )

}

export function renderToDOM(container) {
  createRoot(container).render(
    <App />
  );
}
