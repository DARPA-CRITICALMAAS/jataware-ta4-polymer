/**
 * @module ModifierKey
 * @description Represents a module that handles modifier key states.
 */

export default class ModifierKey {
  /**
   * Represents the Control key.
   */
  static CTRL: string = "Control";

  /**
   * Represents the Meta key.
   */
  static META: string = "Meta";

  /**
   * Represents the Alt key.
   */
  static ALT: string = "Alt";

  /**
   * Represents the Shift key.
   */
  static SHIFT: string = "Shift";

  /**
   * Represents the states of the modifier keys.
   */
  static states: { [key: string]: boolean } = {
    [ModifierKey.CTRL]: false,
    [ModifierKey.META]: false,
    [ModifierKey.ALT]: false,
    [ModifierKey.SHIFT]: false,
  };

  /**
   * Checks if a modifier key is pressed.
   * @param key - The key to check.
   * @returns A boolean indicating if the key is pressed.
   */
  static is(key: string): boolean {
    return ModifierKey.states[key];
  }

  /**
   * Handles the keydown event for modifier keys.
   * @param event - The keyboard event.
   */
  static keydown({ key }: KeyboardEvent): void {
    if (key === ModifierKey.CTRL) ModifierKey.states[ModifierKey.CTRL] = true;
    if (key === ModifierKey.META) ModifierKey.states[ModifierKey.META] = true;
    if (key === ModifierKey.ALT) ModifierKey.states[ModifierKey.ALT] = true;
    if (key === ModifierKey.SHIFT) ModifierKey.states[ModifierKey.SHIFT] = true;
  }

  /**
   * Handles the keyup event for modifier keys.
   * @param event - The keyboard event.
   */
  static keyup({ key }: KeyboardEvent): void {
    if (key === ModifierKey.CTRL) ModifierKey.states[ModifierKey.CTRL] = false;
    if (key === ModifierKey.META) ModifierKey.states[ModifierKey.META] = false;
    if (key === ModifierKey.ALT) ModifierKey.states[ModifierKey.ALT] = false;
    if (key === ModifierKey.SHIFT) ModifierKey.states[ModifierKey.SHIFT] = false;
  }
}

window.addEventListener("keydown", ModifierKey.keydown);
window.addEventListener("keyup", ModifierKey.keyup);
