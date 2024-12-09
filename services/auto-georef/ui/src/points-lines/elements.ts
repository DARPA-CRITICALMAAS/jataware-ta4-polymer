/**
 * Retrieves an element from the DOM using the specified selector.
 * Clearly throwing an error if no element is found with the specified selector.
 *
 * @template T - The type of the element to retrieve. Defaults to HTMLElement.
 * @param parent - The optional parent element to query from.
 * @param selector - The selector to use to retrieve the element.
 * @returns The element matching the selector.
 * @throws If no element is found with the specified selector.
 * @example
 *
 * ```ts
 * const sessionModal = query<HTMLDialogElement>("#session-start");
 * const sessionForm = query<HTMLFormElement>(sessionModal, "form.modal-form");
 * ```
 */
export function query<T extends Element = HTMLElement>(selector: string): T;
export function query<T extends Element = HTMLElement>(
  parent: Element,
  selector: string,
): T;
export function query<T extends Element = HTMLElement>(
  parentOrSelector: Element | string,
  selectorOrUndefined?: string,
): T {
  const parent =
    parentOrSelector instanceof Element ? parentOrSelector : document;
  const selector =
    parentOrSelector instanceof Element
      ? selectorOrUndefined
      : parentOrSelector;

  if (selector == null) {
    throw new Error("Selector cannot be null");
  }

  const element = parent.querySelector<T>(selector);
  if (element == null) {
    throw new Error("Element with selector " + selector + " not found");
  }
  return element;
}

/**
 * Retrieves all elements from the DOM that match the specified selector.
 *
 * @template T - The type of the elements to retrieve. Defaults to HTMLElement.
 * @param parent - The optional parent element to query from.
 * @param selector - The selector to use to retrieve the elements.
 * @returns An array of elements matching the selector.
 * @example
 *
 * ```ts
 * const sessionButtons = queryAll<HTMLButtonElement>(".session-button");
 * const validationInputs = queryAll<HTMLInputElement>(
 *   validationForm,
 *   "input[type='text']",
 * );
 * ```
 */
export function queryAll<T extends Element = HTMLElement>(
  selector: string,
): T[];
export function queryAll<T extends Element = HTMLElement>(
  parent: Element,
  selector: string,
): T[];
export function queryAll<T extends Element = HTMLElement>(
  parentOrSelector: Element | string,
  selectorOrUndefined?: string,
): T[] {
  const parent =
    parentOrSelector instanceof Element ? parentOrSelector : document;
  const selector =
    parentOrSelector instanceof Element
      ? selectorOrUndefined
      : parentOrSelector;

  if (selector == null) {
    throw new Error("Selector cannot be null");
  }

  const elements = Array.from(parent.querySelectorAll<T>(selector));
  return elements;
}

export const sessionModal = query<HTMLDialogElement>("#session-start");
export const validateModal = query<HTMLDialogElement>("#validate-start");
export const createModal = query<HTMLDialogElement>("#create-start");
export const sessionForm = query<HTMLFormElement>(
  sessionModal,
  "form.modal-form",
);
export const validateForm = query<HTMLFormElement>(
  validateModal,
  "form.modal-form",
);
export const createForm = query<HTMLFormElement>(
  createModal,
  "form.modal-form",
);
export const hideMapButton = query("#hide-map");
export const hideFeaturesButton = query("#hide-features");
export const newSessionButton = query("#new-session");
export const validateControls = query("#validate-controls");
export const createControls = query("#create-controls");
export const validateGoodButton = query<HTMLButtonElement>(
  validateControls,
  "#validate-good",
);
export const validateMiscButton = query<HTMLButtonElement>(
  validateControls,
  "#validate-misc",
);
export const validateBadButton = query<HTMLButtonElement>(
  validateControls,
  "#validate-bad",
);
export const progress = query<HTMLProgressElement>(
  validateControls,
  "#progress",
);
export const createGoodButton = query<HTMLButtonElement>(
  createControls,
  "#create-good",
);
export const createMiscButton = query<HTMLButtonElement>(
  createControls,
  "#create-misc",
);
export const newValidateButton = query("#new-validate");
export const newCreateButton = query("#new-create");
export const linePattern = query("#line-pattern");
export const linePatternSelect = query<HTMLSelectElement>(
  linePattern,
  "select",
);
