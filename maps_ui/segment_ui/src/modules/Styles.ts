/**
 * @module Styles
 * @description Collection of OpenLayers styles that can be used to style features.
 */

import { Circle, Fill, Stroke, Style } from "ol/style";

/**
 * Creates a custom style with the specified color.
 * @param r - The red component of the color (0-255).
 * @param g - The green component of the color (0-255).
 * @param b - The blue component of the color (0-255).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The custom style object.
 */
export const custom = (r: number, g: number, b: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `rgba(${r}, ${g}, ${b}, ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `rgba(${r}, ${g}, ${b}, ${alpha ?? 0.7})`,
      width,
    }),
  });

/**
 * Creates a style with contrast inverted fill and stroke colors.
 * @param r - The red component of the color (0-255).
 * @param g - The green component of the color (0-255).
 * @param b - The blue component of the color (0-255).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The style object with contrast inverted fill and stroke colors.
 */
export const contrast = (r: number, g: number, b: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `rgba(${r}, ${g}, ${b}, ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `rgba(${255 - r}, ${255 - g}, ${255 - b}, ${alpha ?? 0.7})`,
      width,
    }),
  });

/**
 * Creates a style with contrast inverted fill and stroke colors.
 * @param r - The red component of the color (0-255).
 * @param g - The green component of the color (0-255).
 * @param b - The blue component of the color (0-255).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The style object with contrast inverted fill and stroke colors.
 */
export const contrastInv = (r: number, g: number, b: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `rgba(${255 - r}, ${255 - g}, ${255 - b}, ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `rgba(${r}, ${g}, ${b}, ${alpha ?? 0.7})`,
      width,
    }),
  });

/**
 * Creates a custom style with the specified color.
 * @param h - The hue component of the color (0-360).
 * @param s - The saturation component of the color (0-100).
 * @param l - The lightness component of the color (0-100).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The custom style object.
 */
export const customHSL = (h: number, s: number, l: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `hsl(${h}deg ${s}% ${l}% / ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `hsl(${h}deg ${s}% ${l}% / ${alpha ?? 0.7})`,
      width,
    }),
  });

/**
 * Creates a style with contrast inverted fill and stroke colors.
 * @param h - The hue component of the color (0-360).
 * @param s - The saturation component of the color (0-100).
 * @param l - The lightness component of the color (0-100).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The style object with contrast inverted fill and stroke colors.
 */
export const contrastHSL = (h: number, s: number, l: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `hsl(${h}deg ${s}% ${l}% / ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `hsl(${(h + 180) % 360}deg ${100}% ${75}% / ${alpha ?? 0.7})`,
      width,
    }),
  });

/**
 * Creates a style with contrast inverted fill and stroke colors.
 * @param h - The hue component of the color (0-360).
 * @param s - The saturation component of the color (0-100).
 * @param l - The lightness component of the color (0-100).
 * @param width - The width of the stroke (default: 3).
 * @param alpha - The alpha value of the color (default: 0.3 for fill, 0.7 for stroke).
 * @returns The style object with contrast inverted fill and stroke colors.
 */
export const contrastInvHSL = (h: number, s: number, l: number, width = 3, alpha?: number): Style =>
  new Style({
    fill: new Fill({
      color: `hsl(${(h + 180) % 360}deg ${100}% ${75}% / ${alpha ?? 0.3})`,
    }),
    stroke: new Stroke({
      color: `hsl(${h}deg ${s}% ${l}% / ${alpha ?? 0.7})`,
      width,
    }),
  });
/**
 * Creates a style with light visible custom fill color.
 * @param r - The red component of the color (0-255).
 * @param g - The green component of the color (0-255).
 * @param b - The blue component of the color (0-255).
 * @param alpha - The alpha value of the color (default: 0.25).
 * @returns The style object with light visible custom fill color.
 */
export const lightVisibleCustom = (r: number, g: number, b: number, alpha = 0.25): Style =>
  new Style({
    fill: new Fill({
      color: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    }),
  });

/**
 * A style with a dark fill and stroke color.
 */
export const darken: Style = new Style({
  fill: new Fill({
    color: "rgba(0, 0, 0, 0.3)",
  }),
  stroke: new Stroke({
    color: "rgba(0, 0, 0, 0.7)",
    width: 5,
  }),
  zIndex: -1,
});

/**
 * A style with a white fill and stroke color.
 */
export const white: Style = custom(255, 255, 255);

/**
 * A style with a black fill and stroke color.
 */
export const black: Style = custom(0, 0, 0);

/**
 * A style with a red fill and stroke color.
 */
export const red: Style = custom(255, 0, 0);

/**
 * A style with a green fill and stroke color.
 */
export const green: Style = custom(0, 255, 0);

/**
 * A style with a blue fill and stroke color.
 */
export const blue: Style = custom(0, 0, 255);

/**
 * A style with a clear fill and stroke color.
 */
export const clear: Style = new Style({
  fill: new Fill({
    color: "rgba(0, 0, 0, 0)",
  }),
  stroke: new Stroke({
    color: "rgba(0, 0, 0, 0)",
    width: 3,
  }),
});

/**
 * A style with a point marker.
 */
export const point: Style = new Style({
  image: new Circle({
    radius: 5,
    fill: new Fill({
      color: "yellow",
    }),
    stroke: new Stroke({
      color: "black",
      width: 2,
    }),
  }),
});

/**
 * Creates a label style with the specified color.
 * @param isPos - Whether the label represents a positive value.
 * @returns The label style object.
 */
export const label = (isPos: boolean): Style =>
  new Style({
    image: new Circle({
      radius: 5,
      fill: new Fill({
        color: isPos ? "blue" : "red",
      }),
      stroke: new Stroke({
        color: isPos ? "white" : "black",
        width: 2,
      }),
    }),
    zIndex: 1,
  });
