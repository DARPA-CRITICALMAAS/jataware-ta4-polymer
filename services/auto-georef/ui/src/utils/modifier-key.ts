/**
 * @module ModifierKey
 * @description Represents a module that handles modifier key states.
 */

type Key = "Control" | "Meta" | "Alt" | "Shift";
type State = { [key in Key]: boolean };

export default class ModifierKey {
  /**
   * Represents the states of the modifier keys.
   */
  static state: State = {
    Control: false,
    Meta: false,
    Alt: false,
    Shift: false,
  };

  /**
   * Checks if a modifier key is pressed.
   * @param key - The key to check.
   * @returns A boolean indicating if the key is pressed.
   */
  static is(key: Key): boolean {
    return ModifierKey.state[key];
  }

  static isKey(key: string): key is Key {
    return Object.keys(this.state).includes(key);
  }

  /**
   * Handles the keydown event for modifier keys.
   * @param event - The keyboard event.
   */
  static keydown({ key }: KeyboardEvent): void {
    if (this.isKey(key)) this.state[key] = true;
  }

  /**
   * Handles the keyup event for modifier keys.
   * @param event - The keyboard event.
   */
  static keyup({ key }: KeyboardEvent): void {
    if (this.isKey(key)) this.state[key] = false;
  }
}

addEventListener("keydown", (event) => ModifierKey.keydown(event));
addEventListener("keyup", (event) => ModifierKey.keyup(event));
