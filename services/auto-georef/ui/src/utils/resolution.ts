import type { Extent } from "ol/extent";

/**
 * Calculates the default resolution based on the extent of the map.
 * @param extent - The extent of the map.
 * @returns The default resolution.
 */
export function defaultResolution(extent: Extent) {
  const [x1, y1, x2, y2] = extent;
  const width = x2 - x1;
  const height = y2 - y1;
  const maxResWidth = width / window.innerWidth;
  const maxResHeight = height / window.innerHeight;
  const maxResolution = Math.max(maxResWidth, maxResHeight);

  return maxResolution * 1.25;
}

/**
 * Expands the resolutions array by adding more resolutions in around the existing ones.
 * @param resolutions - The resolutions array to expand.
 * @param maxSteps - The number of steps to expand the maximum resolution.
 * @param minSteps - The number of steps to expand the minimum resolution.
 * @returns The expanded resolutions array.
 */
export function expandResolutions(
  resolutions: number[],
  maxSteps: number,
  minSteps: number,
) {
  let out = [...resolutions];

  const maxRes = resolutions[0];
  for (let i = 1; i < maxSteps; i++) {
    out.unshift(maxRes * Math.pow(2, i));
  }

  const minRes = resolutions[resolutions.length - 1];
  for (let i = 1; i < minSteps; i++) {
    out.push(minRes / Math.pow(2, i));
  }

  return out;
}
