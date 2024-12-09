import type { Map as OpenLayersMap } from "ol";

import type { LineString, Point } from "geojson";

import * as turf from "@turf/turf";

import { Success, Failure } from "@/utils/result";

import * as U from "@/points-lines/utils";
import * as E from "@/points-lines/elements";

export default class FeatureCreator {
  static get features() {
    if (polymer.markedFeatures === undefined) polymer.markedFeatures = [];
    return polymer.markedFeatures;
  }

  static set features(features) {
    if (polymer.markedFeatures === undefined) polymer.markedFeatures = [];
    polymer.markedFeatures = features;
  }

  /**
   * Creates a new point feature.
   * @param coordinates - The coordinates of the point.
   * @param map - The map to add the point to.
   * @returns A success response with the new marked feature or a failure response with an error message.
   */
  static async createPoint(
    coordinates: Point["coordinates"],
    map?: OpenLayersMap,
    featureID?: string,
  ) {
    const legendID = polymer.association?.[1];
    if (legendID === undefined) return Failure("No legend ID found");

    const name = polymer.legendMapping?.[legendID];
    if (name === undefined) return Failure("No legend name found");

    const [x, y] = coordinates;

    if (x === undefined || y === undefined)
      return Failure("Invalid coordinates");

    const point: Feature<Point> = {
      featureID: featureID ?? this.generateNewFeatureID(),
      geometry: { type: "Point", coordinates },
      name,
      legendID,
      bbox: [x, y, x, y],
      isValidated: null,
    };

    const marked: MarkedFeature<Point> = {
      feature: point,
      originalCoordinates: coordinates,
      isComplete: false,
    };

    if (map !== undefined) {
      this.features.unshift(marked);
      await U.addPoints(map, legendID, [point]);
    }

    return Success(marked);
  }

  /**
   * Creates a new line feature.
   * @param coordinates - The coordinates of the line.
   * @param featureID - The ID of the feature.
   * @returns A success response with the new marked feature or a failure response with an error message.
   */
  static async createLine(
    coordinates: LineString["coordinates"],
    featureID?: string,
  ) {
    const legendID = polymer.association?.[1];
    if (legendID === undefined) return Failure("No legend ID found");

    const name = polymer.legendMapping?.[legendID];
    if (name === undefined) return Failure("No legend name found");

    const bbox = turf.bbox(turf.multiPoint(coordinates));
    if (bbox.length !== 4) return Failure(`Invalid bounding box: ${bbox}`);

    const dashPattern = E.linePatternSelect.value as Feature["dashPattern"];

    const line: Feature<LineString> = {
      featureID: featureID ?? this.generateNewFeatureID(),
      geometry: { type: "LineString", coordinates },
      name,
      legendID,
      bbox,
      isValidated: null,
      dashPattern,
    };

    const marked: MarkedFeature<LineString> = {
      feature: line,
      originalCoordinates: coordinates,
      isComplete: false,
    };

    this.features.unshift(marked);

    return Success(marked);
  }

  /**
   * Removes the last marked feature.
   * @param map - The map to remove the feature from.
   */
  static async removeFeature(map: OpenLayersMap) {
    const [markedFeature] = this.features ?? [];

    if (markedFeature === undefined) return;

    const { featureID, legendID } = markedFeature.feature;

    const feature = U.getFeatureFromLegendIDAndFeatureID(
      map,
      legendID,
      featureID,
    );

    this.features.shift();
    await U.removeFeature(map, feature);
  }

  /**
   * Generates a new feature ID.
   */
  static generateNewFeatureID() {
    // const features = this.features ?? [];
    // const featureCount = features.length;
    // return featureCount.toString();

    return crypto.randomUUID();
  }
}
