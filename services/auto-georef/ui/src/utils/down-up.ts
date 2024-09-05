/**
 * Handles the mouse down and up events for a target element, where the mouse
 * up event will trigger even when the mouse is released outside the button.
 * @param target - The target element to handle the events for.
 * @param downFn - The function to call on mouse down.
 * @param upFn - The function to call on mouse up.
 * @param cls - The optional class to add to the target element on mouse down.
 */
export function handleMouseDownUp<T extends EventTarget>(
  target: T,
  downFn: () => void,
  upFn: () => void,
  cls: string = "swap-active",
) {
  // Mousedown logic
  downFn.call(target);
  if (cls && target instanceof Element) target.classList.add(cls);

  // Ensures that the event will trigger even when the mouse is released outside the target
  const handleMouseUp = () => {
    upFn.call(target);
    if (cls && target instanceof Element) target.classList.remove(cls);

    document.removeEventListener("mouseup", handleMouseUp);
  };

  target.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mouseup", handleMouseUp);
}

/**
 * Handles the key down and up events for a target element.
 * @param originalEvent - The keyboard event to handle.
 * @param downFn - The function to call on key down.
 * @param upFn - The function to call on key up.
 */
export function handleKeyDownUp(
  originalEvent: KeyboardEvent,
  downFn: (event: KeyboardEvent) => void,
  upFn: (event: KeyboardEvent) => void,
) {
  // Mousedown logic
  downFn(originalEvent);

  // Ensures that the event will trigger even when the key is released outside the target
  const handleKeyUp = (newEvent: KeyboardEvent) => {
    upFn(newEvent);
    document.removeEventListener("keyup", handleKeyUp);
  };

  document.addEventListener("keyup", handleKeyUp);
}
