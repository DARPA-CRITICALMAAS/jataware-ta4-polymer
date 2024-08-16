// https://color-contrast-ratio.netlify.app/
export const hslToRGB = (hslColor) => {
  const dataForCalculation = hslColor.map((hslValue, index) => {
    return index === 0 ? hslValue : hslValue / 100;
  });
  //C = (1 - |2L - 1|) * S
  const Chroma =
    (1 - Math.abs(2 * dataForCalculation[2] - 1)) * dataForCalculation[1];
  const HuePrime = dataForCalculation[0] / 60;
  //X = C * (1 |H' mod 2 - 1|)
  const X = Chroma * (1 - Math.abs((HuePrime % 2) - 1));
  let RGBresult = [];
  if (HuePrime <= 1) {
    RGBresult = [Chroma, X, 0];
  } else if (HuePrime > 1 && HuePrime <= 2) {
    RGBresult = [X, Chroma, 0];
  } else if (HuePrime > 2 && HuePrime <= 3) {
    RGBresult = [0, Chroma, X];
  } else if (HuePrime > 3 && HuePrime <= 4) {
    RGBresult = [0, X, Chroma];
  } else if (HuePrime > 4 && HuePrime <= 5) {
    RGBresult = [X, 0, Chroma];
  } else {
    RGBresult = [Chroma, 0, X];
  }
  //m = L - (C / 2)
  const adjustLightness = dataForCalculation[2] - Chroma / 2;
  return RGBresult.map((RGBvalue) =>
    Math.round((RGBvalue + adjustLightness) * 255),
  );
};

const getLuminance = (RGBarray) => {
  //convert 8bit colors to
  //RsRGB, GsRGB BsRGB
  const XsRGBarray = RGBarray.map((elem) => elem / 255);

  const getRGBCoefficient = (XsRGB) => {
    if (XsRGB <= 0.03928) {
      return XsRGB / 12.92;
    } else {
      return Math.pow((XsRGB + 0.055) / 1.055, 2.4);
    }
  };

  //array of multipliers, for r, g, b respectively
  //L = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const multipliers = [0.2126, 0.7152, 0.0722];

  let luminance = 0;

  for (let i = 0; i < multipliers.length; i++) {
    luminance += getRGBCoefficient(XsRGBarray[i]) * multipliers[i];
  }

  return luminance;
};

/**
 * This function takes two RGB[int, int, int] values
 * and calculates their contrast ratio
 *
 * @param {RGB} color1 The color representation in RGB.
 * @param {RGB} color2 The color representation in RGB.
 *
 * @return {float} Contrast ratio of the two given colors.
 */
export const calculateRatioRGB = (color1, color2) => {
  const color1Luminance = getLuminance(color1);
  const color2Luminance = getLuminance(color2);
  /* (L1 + 0.05) / (L2 + 0.05), whereby:
    L1 is the relative luminance of the lighter of the colors, and
    L2 is the relative luminance of the darker of the colors. */
  let lighterLum = Math.max(color1Luminance, color2Luminance);
  let darkerLum = Math.min(color1Luminance, color2Luminance);
  return (lighterLum + 0.05) / (darkerLum + 0.05);
};

/**
 * This function takes two HSL[int, int, int] values
 * and calculates their contrast ratio
 *
 * @param {HSL} color1 The color representation in HSL.
 * @param {HSL} color2 The color representation in HSL.
 *
 * @return {float} Contrast ratio of the two given colors.
 */
export const calculateRatioHSL = (color1, color2) => {
  const color1Luminance = getLuminance(hslToRGB(color1));
  const color2Luminance = getLuminance(hslToRGB(color2));
  /* (L1 + 0.05) / (L2 + 0.05), whereby:
    L1 is the relative luminance of the lighter of the colors, and
    L2 is the relative luminance of the darker of the colors. */
  let lighterLum = Math.max(color1Luminance, color2Luminance);
  let darkerLum = Math.min(color1Luminance, color2Luminance);
  return (lighterLum + 0.05) / (darkerLum + 0.05);
};
