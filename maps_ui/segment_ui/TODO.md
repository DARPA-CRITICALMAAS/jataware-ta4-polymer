# Todo

Asterisks are in progress

## Questions

- Should edit history only apply to edits that directly affect the user-facing polygon? For example, should changing the radius or changing the mode be included in the edit history? Should undo and redo change the mode to reflect the state of the edit history?
- Think about tooling for black and white maps in particular?

## High-Priority

- [ ] B&W map with 1 channel breaks, assumes 3 channels
- [ ] Inline the two cards showing mode into one

## Medium-Priority

- [ ] Lock editing for view only mode
- [ ] Rework cursors
- [ ] Bug: Selection resets when `userFacingLayer` is updating (e.g., from getting mean color)

## Low-Priority

- [ ] Refactor/reorganization with `addEventListeners` for state managers/edit history
- [ ] Adding or setting a PLM with an OpenLayers geometry should allow for option to separate a MultiPolygon to a FeatureCollection of Polygons
- [ ] Adjust `maxResolution` on window resize
- [ ] Add edit history to layers, adding/removing etc
- [ ] Make alerts fade out when closed programmatically
- [ ] `Alert.show` and `Alert.create` shortcut for when `Alert.show` takes an instance of `Alert`
- [ ] Bug: Adding a new layer then hitting space to get label region from server creates a new layer
- [ ] Bug: Change radius midway through drawing fix
- [ ] Bug: Lasso tool issues when zoomed in
- [ ] Bug: Polygon clipping while zooming
- [ ] Bug: Fix layer color after undo/redo

## Conceptual

- [ ] *\*Customizable hotkey bindings*
- [ ] Use Web Workers for heavy operations
- [ ] Migrate JSTS to Turf.js
- [ ] Add individual undo/redo for the points in the lasso tool
- [ ] Adjust opacity and color of polygons
- [ ] Rate limit and debounce for lasso tool
- [ ] When drawing and erasing, actually draw and erase rather than generating a polygon and applying on mouse up
- [ ] Visibility for erase layer
- [ ] Move from hidden sub-layers to list of features

## Complete

- [x] Bug: Switching layer with hotkey while lasso is waiting for server response switches without warning
- [x] Update help menu for legend item association/publishing
- [x] Importing after associating a legend items could allow that legend item to associate with multiple layers
- [x] Add warning if there are no validated legend items.
- [x] Bug: Radius inc/dec hotkeys switched
- [x] Bug: Add a layer scrolls entire page when cursor SVG is visible during a draw mode.
- [x] Update model `sam_model_best.pth`
- [x] Overhaul help screen
- [x] Bug: Deleting layer before importing with no layers breaks the import layers
- [x] Don't block lasso usage while in manual mode
- [x] Use HSL for colors
- [x] Drawing interaction refactor
- [x] Drag with middle click
- [x] Scroll to new layer when added
- [x] Bug: Layer sidebar going invisible instead of animating out (to prevent weird tabbable focus behavior)
- [x] Bug: repeated alerts occasionally used the same react `key`
- [x] Add error alerts for `console.error` and other network errors
- [x] Maintain right-click functionality by making right-click do the opposite of the current mode
- [x] Warn when about to lose progress from switching mode/layer
- [x] Add warning when attempting to edit hidden layer or no layer selected to edit
- [x] A general purpose alert system
- [x] Add layer UI tooltips
- [x] Bug: Focus is occasionally stuck after editing label
- [x] Bug: Instability with DOM queries in react
- [x] Waiting timeout for label and lasso tools from server
- [x] Draw tools have radius preview instead of mouse pointer
- [x] Explicit importing
- [x] Fixed server concurrency issues [(used `def` instead of `async def`)](https://fastapi.tiangolo.com/async/?h=threadpool#path-operation-functions)
- [x] Refactor OL vector layer styling for performance issues
- [x] Importing maps and polygons from S3
- [x] Better zooming and panning without as many constraints
- [x] Bug: Click and drag "hide polygon" button and it stays hidden
- [x] Color averaging for polygon color, and view is color, edit is opposite color
- [x] Change hide polygon shortcut from slash (some browsers globally capture this input)
- [x] Add hide map UI + shortcut
- [x] Delete layer
- [x] View multiple layers at once
- [x] Edit only one layer at a time
- [x] Make layers scrollable
- [x] Automatically generate layer colors
- [x] Map slides over when sidebar is open
- [x] Multiple layers support
- [x] Bug: Changing layer midway through action (drawing, label, lasso, etc.) fixes
- [x] Infinite zooming
- [x] Lasso manual and magnetic modes
- [x] Bug: Tab indexing and focus styling and behavior
- [x] Bug: When reloading with with ctrl + R, switches to the add tool rather than defaulting to view
- [x] Bug: Change mode midway through action (drawing, label, lasso, etc.) fixes
- [x] Bug: Polygon clipping while panning
- [x] Bug: Undoing a radius change for a different tool will update the current tool radius (in UI only)
- [x] See shortcut on tooltip
- [x] Bug: Fix clear button
- [x] Typescript migration
- [x] Bug: First undo issue
- [x] Bug: unable to interact with map near control areas
- [x] Select delete UI
- [x] Update help screen to reflect drawing mode changes
- [x] Label tool mode (positive, negative)
- [x] Lasso tool mode (add, erase)
- [x] Get better label model working
- [x] Better selection for erase polygons
- [x] Drawing modes (fill, no fill, select)
- [x] Light/dark mode
- [x] Tooltips
- [x] Help menu
- [x] Migrate to tailwindcss and daisyUI
- [x] Click to remove points from labels, and last point from lasso
- [x] Better loading indicator
- [x] Better UI for mode switching
- [x] Ability to subtract polygons with lasso tool
- [x] UI for sending labels to server
- [x] Select and delete polygons
- [x] Show progress cursor, especially for lasso tool and label tool
- [x] Better realtime radius adjustment
- [x] Add lasso closing to edit history
- [x] Clicking too fast breaks lasso tool
- [x] Fix coordinate matching logic for closing lasso
- [x] Temporarily hide polygon
- [x] Update README.md "How to use" and "How it works"
- [x] Lasso tool
- [x] Better radius scaling in UI
- [x] Change radius through UI/better tooling
- [x] Right click = fill (getExteriorRing) for Add and Erase tools
- [x] Redo
- [x] UI for undo/redo
