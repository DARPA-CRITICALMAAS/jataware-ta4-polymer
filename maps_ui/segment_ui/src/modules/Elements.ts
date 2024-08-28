/**
 * All the elements are defined here
 * @module Elements
 */

/**
 * Retrieves an element from the DOM using the specified selector.
 *
 * @template T - The type of the element to retrieve. Defaults to HTMLElement.
 * @param {string} selector - The CSS selector used to identify the element.
 * @returns {T} - The element matching the selector.
 * @throws {Error} - If no element is found with the specified selector.
 */
const getElement = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (element == null) {
    throw new Error(`Element with selector ${selector} not found`);
  }
  return element;
};

export const selectedMode = getElement("#selected-mode");
export const modeLoading = getElement("#mode-loading");
export const modeName = getElement("#mode-name");
export const mode = getElement("#mode");
export const radius = getElement("#radius");
export const hidePolygons = getElement("#hide-polygons");
export const hideMap = getElement("#hide-map");
export const undo = getElement("#undo");
export const redo = getElement("#redo");
export const clear = getElement("#clear");
export const sendLabels = getElement("#send-labels");
export const drawMode = getElement("#draw-mode");
export const lassoMode = getElement("#lasso-mode");
export const lassoDrawMode = getElement("#lasso-draw-mode");
export const labelMode = getElement("#label-mode");
export const selectDelete = getElement("#select-delete");
export const drawDelete = getElement("#draw-delete");
export const helpDialog = getElement<HTMLDialogElement>("#help");
export const layerSidebar = getElement("#layer-sidebar");
export const root = getElement(":root");
export const map = getElement("#map");
export const cursor = getElement<SVGElement>("#cursor");
export const alertContainer = getElement("#alert-container");
export const pointsLink = getElement<HTMLLinkElement>("#points-link");
export const projLink = getElement<HTMLLinkElement>("#proj-link");
export const legendLink = getElement<HTMLLinkElement>("#legend-link");
export const linesLink = getElement<HTMLLinkElement>("#lines-link");
export const polyLink = getElement<HTMLLinkElement>("#poly-link");
export const cogIDBadge = getElement("#cog-id");
export const options = getElement<HTMLDialogElement>("#options");
