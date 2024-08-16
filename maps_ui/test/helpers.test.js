import { describe, expect, test } from "vitest";

import { getColorForProvenance, getShapeCenterPoint, numberToFixed } from "../components/helpers.js";

describe("getColorForProvenance", () => {
  test("returns black if no provenance param", () => {
    expect(getColorForProvenance()).toBe("#000000");
  });
});

describe("getShapeCenterPoint", () => {

    /*
    Sample Square; (lon, lat)

 (0,0)o---o(1,0)
      |   |
      |   |
(0,-1)o---o(1,-1)
     */

  test("center point simple square example", () => {

    const input = [
      [0,0],
      [1,0],
      [1,-1],
      [0,-1],
    ];

    expect(getShapeCenterPoint(input)).toEqual([0.5, -0.5]);
  });

});

describe("numberToFixed", () => {
  test("pass integer in", () => {
    // expect(numberToFixed(4)).toBe(4); // Implement me if required
    expect(numberToFixed(4)).toBe("4.0000");
  });
  test("pass null in", () => {
    expect(numberToFixed(null)).toBe("");
  });
  test("pass '' empty string in", () => {
    expect(numberToFixed("")).toBe("");
  });
  test("pass float in", () => {
    expect(numberToFixed(4.743874)).toBe("4.7439");
  });
});
