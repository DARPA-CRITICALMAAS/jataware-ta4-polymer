// See https://github.com/openlayers/openlayers/issues/16004

/**
 * @module ol/interaction/DoubleClickZoom
 */
import Interaction, { zoomByDelta } from "ol/interaction/Interaction.js";
import MapBrowserEventType from "ol/MapBrowserEventType.js";

/**
 * @typedef {Object} Options
 * @property {number} [duration=250] Animation duration in milliseconds.
 * @property {number} [delta=1] The zoom delta applied on each double click.
 * @property {import("../coordinate.js").Coordinate|undefined} [anchorCoordinate=undefined] The
 * coordinate to zoom to. Zooms to the double-clicked location if not set.
 */

/**
 * @classdesc
 * Allows the user to zoom by double-clicking on the map.
 * @api
 */
class DoubleClickZoom extends Interaction {
  /**
   * @param {Options} [options] Options.
   */
  constructor(options) {
    super();

    options = options ? options : {};

    /**
     * @private
     * @type {number}
     */
    this.delta_ = options.delta ? options.delta : 1;

    /**
     * @private
     * @type {number}
     */
    this.duration_ = options.duration !== undefined ? options.duration : 250;

    /**
     * @private
     * @type {import("../coordinate.js").Coordinate|undefined}
     */
    this.anchorCoordinate_ = options.anchorCoordinate;
  }

  /**
   * Handles the {@link module:ol/MapBrowserEvent~MapBrowserEvent map browser event} (if it was a
   * doubleclick) and eventually zooms the map.
   * @param {import("../MapBrowserEvent.js").default} mapBrowserEvent Map browser event.
   * @return {boolean} `false` to stop event propagation.
   * @override
   */
  handleEvent(mapBrowserEvent) {
    let stopEvent = false;
    if (mapBrowserEvent.type == MapBrowserEventType.DBLCLICK) {
      const browserEvent = /** @type {MouseEvent} */ (
        mapBrowserEvent.originalEvent
      );
      const map = mapBrowserEvent.map;
      const anchor = this.anchorCoordinate_
        ? this.anchorCoordinate_
        : mapBrowserEvent.coordinate;
      const delta = browserEvent.shiftKey ? -this.delta_ : this.delta_;
      const view = map.getView();
      zoomByDelta(view, delta, anchor, this.duration_);
      browserEvent.preventDefault();
      stopEvent = true;
    }
    return !stopEvent;
  }

  /**
   * Sets the coordinate to zoom around. If undefined, the interaction will zoom around the
   * double-clicked coordinate.
   * @param {import("../coordinate.js").Coordinate|undefined} coordinate The coordinate to zoom around.
   * @api
   */
  setAnchorCoordinate(coordinate) {
    this.anchorCoordinate_ = coordinate;
  }
}

export default DoubleClickZoom;
