import type * as jsts from "jsts";
// @ts-expect-error types are missing
import { OverlayOp } from "jsts/org/locationtech/jts/operation/overlay";
// @ts-expect-error types are missing
import { UnaryUnionOp } from "jsts/org/locationtech/jts/operation/union";
// @ts-expect-error types are missing
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory";

import * as Convert from "./Convert";
import type { Map } from "ol";
import type { Coordinate } from "ol/coordinate";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { useEffect, useRef } from "react";

/// Utility functions for working with JSTS geometries

// Split a JSTS line string into an array of segments
export const splitLineString = (lineString: jsts.geom.LineString): jsts.geom.LineString[] => {
  const coordinates = lineString
    .getCoordinates()
    .map(({ x, y }: { x: number; y: number }) => [x, y]);
  const segments: jsts.geom.LineString[] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const segment = Convert.jsonToJSTS({
      type: "LineString",
      coordinates: [coordinates[i], coordinates[i + 1]],
    }) as jsts.geom.LineString;
    segments.push(segment);
  }
  return segments;
};

// Union of JSTS geometries
// TODO!: fix occasional performance issues (maybe with binaryUnion)?
export const union = (geometries: jsts.geom.Geometry[]): jsts.geom.Geometry => {
  const geomFactory: jsts.geom.GeometryFactory = new GeometryFactory();
  const geomCollection = geomFactory.createGeometryCollection(geometries);
  const unaryUnionOp = new UnaryUnionOp(geomCollection);
  return unaryUnionOp.union();
};

export const difference = (
  geom1: jsts.geom.Geometry,
  geom2: jsts.geom.Geometry,
): jsts.geom.Geometry => {
  if (geom1.isEmpty()) {
    return geom1;
  } else {
    return OverlayOp.difference(geom1, geom2);
  }
};

export const exteriorPolygon = (polygon: jsts.geom.Polygon): jsts.geom.Geometry => {
  const factory: jsts.geom.GeometryFactory = new GeometryFactory();
  const exterior = factory.createPolygon(polygon.getExteriorRing(), []);
  return exterior;
};

export const multiPolygonToFeatures = (multiPolygon: MultiPolygon): Feature<Polygon>[] => {
  return multiPolygon.coordinates.map((coordinates) => ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates,
    },
    properties: {},
  }));
};

export const coordinatePixelDistance = (
  coord1: Coordinate,
  coord2: Coordinate,
  map: Map,
): number => {
  if (map == null) throw new Error("map is required");

  const pixel1 = map.getPixelFromCoordinate(coord1);
  const pixel2 = map.getPixelFromCoordinate(coord2);
  const distance = Math.sqrt(
    Math.pow(pixel2[0] - pixel1[0], 2) + Math.pow(pixel2[1] - pixel1[1], 2),
  );
  return distance;
};

export const emptyMultiPolygon = (): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [],
  // coordinates: [[[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]]],
});

export const useTimeout = (callback: () => void, delay?: number) => {
  const savedCallback = useRef(callback);

  // Remember the latest callback if it changes.
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the timeout.
  useEffect(() => {
    // Don't schedule if no delay is specified.
    if (delay == null) return;

    const id = setTimeout(() => savedCallback.current(), delay);
    return () => clearTimeout(id);
  }, [delay]);
};

export const getRandomInt = (min: number, max: number) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const fallbackCopyTextToClipboard = (text: string) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
};

export const copyTextToClipboard = (text: string) => {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    function () {
      console.log("Async: Copying to clipboard was successful!");
    },
    function (err) {
      console.error("Async: Could not copy text: ", err);
    },
  );
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-constraint
export const fetchAPI = <T extends unknown>(
  api_path: string,
  options?: Omit<RequestInit, "body"> & {
    method: "GET" | "POST" | "PUT" | "DELETE";
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    timeout?: number;
  },
): Promise<Omit<Response, "json"> & { json(): Promise<T> }> => {
  const { origin } = window.location;
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const init: RequestInit = {
    ...options,
    headers,
    signal: options?.timeout ? AbortSignal.timeout(options.timeout) : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  };

  let fetchPath = `${origin}/api/segment/${api_path}`;
  if (options?.query) {
    const searchParams = new URLSearchParams(options.query);
    fetchPath += `?${searchParams.toString()}`;
  }

  return fetch(fetchPath, init);
};
