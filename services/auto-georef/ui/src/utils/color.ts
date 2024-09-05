/**
 * A color represented as an array of three numbers.
 */
export type ColorComponents = readonly [number, number, number];

/**
 * The model of a color.
 */
export type ColorModel = "RGB" | "HSL";

/**
 * A color represented as an array of three numbers.
 */
export type Color<T extends ColorModel = ColorModel> = {
  components: ColorComponents;
  model: T;
};

/**
 * Creates a color in the HSL color model where the raw color is an array of
 * three numbers: hue, saturation, and lightness. The hue is in degrees [0, 360],
 * and the saturation and lightness are percentages [0, 100].
 * @param components - The color to create.
 * @returns The color in the HSL color model.
 * @see {@link https://en.wikipedia.org/wiki/HSL_and_HSV}
 */
export function HSL(...components: ColorComponents): Color<"HSL">;
export function HSL(rgb: Color<"RGB">): Color<"HSL">;
export function HSL(...raw: ColorComponents | [Color<"RGB">]): Color<"HSL"> {
  // https://stackoverflow.com/questions/2353211/hsl-to-rgb-color-conversion
  const fromRGB = ([r, g, b]: ColorComponents): ColorComponents => {
    r /= 255;
    g /= 255;
    b /= 255;

    const vmax = Math.max(r, g, b);
    const vmin = Math.min(r, g, b);

    let l = (vmax + vmin) / 2;

    if (vmax === vmin) {
      return [0, 0, Math.round(l * 100)]; // achromatic
    }

    const d = vmax - vmin;
    const s = l > 0.5 ? d / (2 - vmax - vmin) : d / (vmax + vmin);

    let h = 0;
    if (vmax === r) h = (g - b) / d + (g < b ? 6 : 0);
    if (vmax === g) h = (b - r) / d + 2;
    if (vmax === b) h = (r - g) / d + 4;
    h /= 6;

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  };

  if (raw.length === 1) {
    const [color] = raw;
    if (color.model === "RGB") {
      return { components: fromRGB(color.components), model: "HSL" };
    } else {
      throw new Error("Invalid color model.");
    }
  } else if (raw.length === 3) {
    return { components: raw, model: "HSL" };
  } else {
    throw new Error("Invalid color.");
  }
}

/**
 * Creates a color in the RGB color model where the raw color is an array of
 * three numbers: red, green, and blue. Each component is an integer [0, 255].
 * @param color - The color to create.
 * @returns The color in the RGB color model.
 * @see {@link https://en.wikipedia.org/wiki/RGB_color_model}
 */
export function RGB(...components: ColorComponents): Color<"RGB">;
export function RGB(hsl: Color<"HSL">): Color<"RGB">;
export function RGB(...raw: ColorComponents | [Color<"HSL">]): Color<"RGB"> {
  // https://stackoverflow.com/questions/2353211/hsl-to-rgb-color-conversion
  const fromHSL = ([h, s, l]: ColorComponents): ColorComponents => {
    const hueToRgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };

  if (raw.length === 1) {
    const [color] = raw;
    if (color.model === "HSL") {
      return { components: fromHSL(color.components), model: "RGB" };
    } else {
      throw new Error("Invalid color model.");
    }
  } else if (raw.length === 3) {
    return { components: raw, model: "RGB" };
  } else {
    throw new Error("Invalid color.");
  }
}

/**
 * Returns the luminance of a color.
 * @param color - The color to get the luminance of.
 * @returns The luminance of the color.
 * @see {@link https://www.w3.org/TR/WCAG20/#relativeluminancedef}
 */
export function getLuminance({ components, model }: Color) {
  if (model === "RGB") {
    const fromSRGB = (c: number) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

    const [r_8bit, g_8bit, b_8bit] = components;
    const [r_sRGB, g_sRGB, b_sRGB] = [r_8bit, g_8bit, b_8bit].map(
      (c) => c / 255,
    );
    const [r, g, b] = [r_sRGB, g_sRGB, b_sRGB].map(fromSRGB);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } else if (model === "HSL") {
    return getLuminance(RGB({ components, model }));
  } else {
    throw new Error("Invalid color model.");
  }
}

/**
 * Returns the contrast ratio between two colors.
 * @param color1 - The first color.
 * @param color2 - The second color.
 * @returns The contrast ratio between the two colors.
 * @see {@link https://www.w3.org/TR/WCAG20/#contrast-ratiodef}
 * @see {@link https://www.accessibility-developer-guide.com/knowledge/colours-and-contrast/how-to-calculate/}
 */
export function colorContrast(color1: Color, color2: Color) {
  const lum1 = getLuminance(color1);
  const lum2 = getLuminance(color2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns a string representation of a color.
 * @param color - The color to get the string representation of.
 * @param alpha - The alpha value of the color.
 * @returns The string representation of the color.
 */
export function colorString({ components, model }: Color, alpha?: number) {
  const alphaOrEmpty = alpha !== undefined ? ` / ${alpha}` : "";
  if (model === "RGB") {
    const [r, g, b] = components;
    return `rgb(${r} ${g} ${b}${alphaOrEmpty})`;
  } else if (model === "HSL") {
    const [h, s, l] = components;
    return `hsl(${h} ${s}% ${l}%${alphaOrEmpty})`;
  } else {
    throw new Error("Invalid color model.");
  }
}
