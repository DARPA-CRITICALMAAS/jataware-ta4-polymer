/**
 * @module Radius
 * @description Represents a class for managing radius values.
 */

type State = string;

/**
 * Represents a class for managing radius values.
 */
export default class Radius {
  /**
   * The erase radius value.
   */
  static erase: number = 250;

  /**
   * The add radius value.
   */
  static add: number = 150;

  /**
   * The minimum radius value.
   */
  static MIN: number = 3;

  /**
   * The maximum radius value.
   */
  static MAX: number = 1000;

  /**
   * The step value for the radius input.
   */
  static STEP: number = (Radius.MAX - Radius.MIN) / 100;

  /**
   * The increment value for increasing or decreasing the radius.
   */
  static INC: number = 25;

  /**
   * The radius element.
   */
  static radiusElement: HTMLElement;

  /**
   * The radius input element.
   */
  static radiusInput: HTMLInputElement;

  /**
   * A function to get the current mode.
   */
  static getMode: () => State;

  /**
   * Initializes the Radius class.
   * @param {HTMLElement} radiusElement - The radius element.
   * @param {Function} getMode - A function to get the current mode.
   */
  static init(radiusElement: HTMLElement, getMode: () => State) {
    Radius.radiusElement = radiusElement;
    Radius.radiusInput = radiusElement.querySelector("input[type=range]") as HTMLInputElement;

    Radius.getMode = getMode;

    Radius.radiusInput.min = Radius.MIN.toString();
    Radius.radiusInput.max = Radius.MAX.toString();
    Radius.radiusInput.step = Radius.STEP.toString();

    Radius.radiusInput.addEventListener("input", (event: Event) => {
      const target = event.target as HTMLInputElement;
      const val = parseFloat(target.value);
      Radius.set(val);
    });
  }

  /**
   * Gets the current radius value.
   * @param {State} [mode] - The mode to get the radius for. If not provided, the current mode will be used.
   * @returns {number} The current radius value.
   */
  static get(mode?: State): number {
    mode = mode ?? Radius.getMode();
    if (mode === "erase") return Radius.erase;
    if (mode === "add") return Radius.add;

    return parseFloat(Radius.radiusInput.value);
  }

  /**
   * Sets the radius value.
   * @param {number} radius - The radius value to set.
   * @param {State} [mode] - The mode to set the radius for. If not provided, the current mode will be used.
   */
  static set(radius: number, mode?: State) {
    mode = mode ?? Radius.getMode();
    radius = Math.max(Radius.MIN, Math.min(Radius.MAX, radius));

    if (Radius.getMode() === mode) Radius.radiusInput.value = radius.toString();

    if (mode === "add") Radius.add = radius;
    if (mode === "erase") Radius.erase = radius;
  }

  /**
   * Hides the radius element.
   */
  static hide() {
    Radius.radiusElement.classList.add("hidden");
  }

  /**
   * Shows the radius element.
   */
  static show() {
    if (Radius.getMode() === "erase") Radius.set(Radius.erase);
    if (Radius.getMode() === "add") Radius.set(Radius.add);

    Radius.radiusElement.classList.remove("hidden");
  }

  /**
   * Increases the radius value.
   * @param {State} [mode] - The mode to increase the radius for. If not provided, the current mode will be used.
   */
  static increase(mode?: State) {
    const val = Radius.get(mode);
    Radius.set(val + Radius.INC);
  }

  /**
   * Decreases the radius value.
   * @param {State} [mode] - The mode to decrease the radius for. If not provided, the current mode will be used.
   */
  static decrease(mode?: State) {
    const val = Radius.get(mode);
    Radius.set(val - Radius.INC);
  }
}
