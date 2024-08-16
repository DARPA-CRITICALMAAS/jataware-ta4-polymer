/**
 * @module Mouse
 * @description Represents a mouse module.
 */

export default class Mouse {
  /**
   * Represents an unknown mouse button.
   */
  static UNKNOWN: number = -1;

  /**
   * Represents the left mouse button.
   */
  static LEFT: number = 0;

  /**
   * Represents the middle mouse button.
   */
  static MIDDLE: number = 1;

  /**
   * Represents the right mouse button.
   */
  static RIGHT: number = 2;

  /**
   * Represents the current mouse button.
   */
  static button: number = Mouse.UNKNOWN;

  /**
   * Returns the current mouse button.
   * @returns {number} The current mouse button.
   */
  static get(): number {
    return Mouse.button;
  }

  /**
   * Checks if the current mouse button is equal to the given value.
   * @param {number} val - The value to compare with the current mouse button.
   * @returns {boolean} True if the current mouse button is equal to the given value, false otherwise.
   */
  static is(val: number): boolean {
    return Mouse.get() === val;
  }

  /**
   * Represents the current mouse position.
   */
  static position: [number, number] = [NaN, NaN];
}

document.addEventListener("contextmenu", (e: MouseEvent) => e?.cancelable && e.preventDefault());
window.addEventListener("mousedown", ({ button }: MouseEvent) => {
  if (button === Mouse.LEFT) Mouse.button = Mouse.LEFT;
  else if (button === Mouse.RIGHT) Mouse.button = Mouse.RIGHT;
  else if (button === Mouse.MIDDLE) Mouse.button = Mouse.MIDDLE;
  else Mouse.button = Mouse.UNKNOWN;
});
window.addEventListener("mouseup", () => {
  Mouse.button = Mouse.UNKNOWN;
});
window.addEventListener("mousemove", ({ clientX, clientY }: MouseEvent) => {
  Mouse.position = [clientX, clientY];
});
