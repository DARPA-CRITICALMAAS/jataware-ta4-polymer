import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom';

import ProjectionViewer from './ProjectionViewer.jsx'
import PointViewer from './pointViewer.jsx'
import Landing from './landing.tsx'
import ExploreTable from './explore_table.jsx';

function App() {


  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/projections/:map_id"
          element={<ProjectionViewer />}
        />
        <Route path="/points/:map_id"
          element={<PointViewer />}
        />
        <Route path="/explore"
          element={<ExploreTable />}
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
