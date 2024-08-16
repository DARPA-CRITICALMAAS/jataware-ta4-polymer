# User-in-the-loop Segmentation

Polygon annotation tool for user-in-the-loop segmentation.

## Installation

```bash
npm install
```

## Commands

Be sure to run the following commands in the `segment_ui` directory, while the backend server (`services/auto-georef`) is be running.

```bash
npm run start         # Start development server
npm run build         # Build production version
npm run preview       # Preview production version
npm run lint[:fix]    # Lint project [and fix]
npm run format[:fix]  # Check format of project [and fix]
```

> Note: The frontend server must be accessed from a `/<COG_ID>` path, where `<COG_ID>` is the ID of the COG to segment.
