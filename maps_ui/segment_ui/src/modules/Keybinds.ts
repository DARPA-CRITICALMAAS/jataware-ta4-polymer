import * as E from "./Elements";

export const view = ["KeyQ"];
export const label = ["KeyW"];
export const lasso = ["KeyE"];
export const add = ["KeyR"];
export const erase = ["KeyT"];

export const decreaseRadius = ["BracketLeft"];
export const increaseRadius = ["BracketRight"];

export const hidePolygons = ["Comma"];
export const hideMap = ["Period"];

const keyMap = new Map<string, string>();
keyMap.set("KeyQ", "Q");
keyMap.set("KeyW", "W");
keyMap.set("KeyE", "E");
keyMap.set("KeyR", "R");
keyMap.set("KeyT", "T");
keyMap.set("BracketLeft", "[");
keyMap.set("BracketRight", "]");
keyMap.set("Comma", ",");
keyMap.set("Period", ".");

E.mode
  .querySelector(".tooltip:has(> input[value=view])")
  ?.setAttribute("data-tip", `View (${keyMap.get(view[0])!})`);

E.mode
  .querySelector(".tooltip:has(> input[value=label])")
  ?.setAttribute("data-tip", `Label (${keyMap.get(label[0])!})`);

E.mode
  .querySelector(".tooltip:has(> input[value=lasso])")
  ?.setAttribute("data-tip", `Lasso (${keyMap.get(lasso[0])!})`);

E.mode
  .querySelector(".tooltip:has(> input[value=add])")
  ?.setAttribute("data-tip", `Add (${keyMap.get(add[0])!})`);

E.mode
  .querySelector(".tooltip:has(> input[value=erase])")
  ?.setAttribute("data-tip", `Erase (${keyMap.get(erase[0])!})`);
