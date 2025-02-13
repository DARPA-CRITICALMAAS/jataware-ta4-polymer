import { Fill, Stroke, Style } from "ol/style";
import CircleStyle from 'ol/style/Circle';

export enum Feature {
    Polygon = "polygon",
    Point = "point",
    Line = "line",
}

/**
 *
 */
export function removeLayersMatching(substring: string): boolean {
    const my_map = window.polymer_map;
    const layers = my_map.getLayers();
    let fullSuccess = false;

    layers.forEach((layer) => {
        // TODO debug why this is so... later
        if (!layer) {
            fullSuccess = false;
            return;
        }

        const id = layer.get("id");

        if (id.includes(substring)) {
            my_map.removeLayer(layer);
        }
    });

    return fullSuccess;
}

/**
 *
 */
export function removeVectorTileLayers() {
    const fullSuccess = removeLayersMatching("tile");
    if (!fullSuccess) {
        removeLayersMatching("tile");
    }
}

/**
 *
 */
export function toggleLayerVisibility(_: any, termKey: string) {
    const [feature, termText] = termKey.split("-");
    const terms = termText.split(/\s+/);

    // find layer, then call setVisible(!getVisible)
    window.polymer_map.getLayers().forEach((layer) => {
        if (layer) {
            const layerID = layer.get("id");
            const includesFeature = layerID.includes(`feature_type=${feature}`);

            if (terms[0] === "*") {
                if (includesFeature && !layerID.includes("search_terms=")) {
                    layer.setVisible(!layer.getVisible());
                }
            } else {
                // We need to check if the layer includes the full layer text
                // since we split the whitespace as separate terms with a search_terms= for each
                const includesAllTerms = terms.every(str => layerID.includes(`search_terms=${str}`));

                if (includesFeature && includesAllTerms) {
                    layer.setVisible(!layer.getVisible());
                }
            }
        }
    });
}

/**
 * Creates style properties for given Feature type
 * using the color as base for it to select Fill|Stroke|CircleStyle etc
 */
export function styleFactory(color: string) {
    let style = {
        stroke: new Stroke({
            width: 2.75,
            color: color,
        })
    };

    style.fill = new Fill({
        color: color + "80"
    });
    return new Style(style);
}
