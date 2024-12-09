/**
 * Represents the Cursor module.
 * @module Cursor
 */

import * as E from "./Elements";

export default class Cursor {
  /**
   * The default cursor value.
   */
  static DEFAULT: string = "default";

  /**
   * The crosshair cursor value.
   */
  static CROSSHAIR: string = "crosshair";

  /**
   * The progress cursor value.
   */
  static PROGRESS: string = "progress";

  /**
   * The none cursor value.
   */
  static NONE: string = "none";

  /**
   * Sets the cursor value for the specified element.
   * @param {string} cursor - The cursor value to set.
   */
  static set(cursor: string): void {
    E.map.style.cursor = cursor;
  }

  /**
   * Resets the cursor value to the default value.
   */
  static reset(): void {
    Cursor.set(Cursor.DEFAULT);
  }
}
