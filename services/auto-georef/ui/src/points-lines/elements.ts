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
export const validationModal = query<HTMLDialogElement>("#validation-start");
export const sessionForm = query<HTMLFormElement>(
  sessionModal,
  "form.modal-form",
);
export const validationForm = query<HTMLFormElement>(
  validationModal,
  "form.modal-form",
);
export const hideMapButton = query("#hide-map");
export const hideFeaturesButton = query("#hide-features");
export const newSessionButton = query("#new-session");
export const goodButton = query<HTMLButtonElement>("#good");
export const skipButton = query<HTMLButtonElement>("#skip");
export const badButton = query<HTMLButtonElement>("#bad");
export const progress = query<HTMLProgressElement>("#progress");
export const validateControls = query("#validate-controls");
export const switchGroup = query("#switch-group");

// export const sessionModal = document.querySelector<HTMLDialogElement>("#session-start");
// export const validationModal = document.querySelector<HTMLDialogElement>("#validation-start");
// export const sessionForm = sessionModal.querySelector<HTMLFormElement>("form.modal-form");
// export const validationForm = validationModal.querySelector<HTMLFormElement>("form.modal-form");
// export const hideMapButton = document.querySelector("#hide-map");
// export const hideFeaturesButton = document.querySelector("#hide-features");
// export const newSessionButton = document.querySelector("#new-session");
// export const goodButton = document.querySelector("#good");
// export const skipButton = document.querySelector("#skip");
// export const badButton = document.querySelector("#bad");
// export const progress = document.querySelector<HTMLProgressElement>("#progress");
// export const validateControls = document.querySelector("#validate-controls");
// export const switchGroup = document.querySelector("#switch-group");
