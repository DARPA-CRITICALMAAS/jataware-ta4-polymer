import { Success, Failure } from "@/utils/result";

export default class FeatureMarker {
  static #FAIL = Failure("Marked features are undefined");

  static get features() {
    return polymer.markedFeatures;
  }

  static set features(features) {
    polymer.markedFeatures = features;
  }

  /**
   * Gets the current feature.
   * @returns A success response with the current feature or a failure response with an error message.
   */
  static getCurrent() {
    return this.features ? Success(this.features[0]) : this.#FAIL;
  }

  /**
   * Rotates the features array placing the current feature in last.
   * @returns The feature marking manager.
   */
  static rotate() {
    const feature = this.features?.shift();
    if (feature) this.features?.push(feature);
    return this;
  }

  /**
   * Gets a new feature to mark.
   * @param isComplete - Whether the new feature should be complete.
   * @returns A success response with the new feature or `null` if all features are complete,
   * or a failure response with an error message.
   */
  static getNew(isComplete?: boolean) {
    // If features are undefined, return a failure response
    if (this.features === undefined) return this.#FAIL;

    // If there is no next feature, return a failure response
    const result = this.rotate().getCurrent();
    if (!result.success) return result;

    // Return the next new feature if there is no `isComplete` condition
    let newFeature = result.value;
    if (isComplete === undefined) return Success(newFeature);

    // Find the next feature that matches the `isComplete` condition
    const i = this.features?.findIndex((f) => f.isComplete === isComplete);
    if (i === -1) return Success();

    // Rotate the features array so that the new feature is first
    const before = this.features.slice(0, i);
    newFeature = this.features[i];
    const after = this.features.slice(i + 1);
    this.features = [newFeature, ...after, ...before];

    // Return the new feature
    return Success(newFeature);
  }
}
