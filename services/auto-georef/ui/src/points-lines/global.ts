import type { LineString, Point } from "geojson";
import type { PropertyReplace } from "@/utils/property-replace";

declare global {
  /**
   * Represents the global Polymer object with its properties.
   * @property cogID - The COG ID of the image.
   * @property cogURL - The URL of the COG image.
   * @property rawFeatures - The raw features returned from the request.
   * @property rawPolymerFeatures - The raw features of the latest 'polymer' system.
   * @property features - The formatted features.
   * @property polymerFeatures - The formatted features of the latest 'polymer' system.
   * @property mode - The page mode.
   * @property association - The current group and legend association (in that order).
   * @property markedFeatures - The features marked by the user during validation.
   * @property didPanAfterCenter - Whether the user panned after centering the map on a new feature.
   */
  const polymer: {
    cogID: string;
    cogURL: string;
    rawFeatures?: FeatureGroup<RawFeatureResponse>;
    rawPolymerFeatures?: FeatureGroup<RawFeatureResponse>;
    features?: FeatureGroup;
    polymerFeatures?: FeatureGroup;
    mode?: PageMode;
    association?: [string, string];
    markedFeatures?: MarkedFeature[];
    canMark?: boolean;
  };

  /**
   * Represents a group of features, where each feature is an array of type T.
   * @template T - The type of the features in the group.
   */
  type FeatureGroup<T = Feature> = Record<string, T[]>;

  /**
   * Represents a request to get features.
   */
  type GetFeaturesRequest = Record<string, any> & {
    cog_id: string;
    ftype: string;
    system: string;
    version: string;
  };

  /**
   * Represents a feature with a unique identifier, geometry, name, legend ID, bounding box, and validation status.
   * @template T - The type of geometry (LineString or Point).
   */
  type Feature<T = LineString | Point> = {
    featureID: string;
    geometry: T;
    name: string;
    legendID: string;
    bbox: [number, number, number, number];
    isValidated: boolean | null;
  };

  /**
   * Represents the response of a raw feature returned from the request.
   */
  type RawFeatureResponse = PropertyReplace<
    Feature,
    [
      { from: "featureID"; to: "feature_id" },
      { from: "legendID"; to: "legend_id" },
      { from: "isValidated"; to: "is_validated" },
    ]
  >;

  /**
   * Represents a marked feature with its validation status.
   */
  type MarkedFeature<T extends LineString | Point = LineString | Point> = {
    feature: Feature<T>;
    originalCoordinates: Feature<T>["geometry"]["coordinates"];
    isComplete: boolean;
  };

  /**
   * Represents the page mode.
   */
  type PageMode = "view" | "validate";
}
