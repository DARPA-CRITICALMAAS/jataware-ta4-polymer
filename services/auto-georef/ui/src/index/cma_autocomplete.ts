import autocomplete from "autocompleter";
import {
  transformPolygonCoordinates,
  drawMultiPolygonOpenLayers,
  clearShapeOpenLayers,
  openLayersDefaultProjection,
  cdrDefaultProjection,
  isCRSRegistered,
  register_proj,
} from "../geo";

export const CMA_LAYER_ID = "from-cma";

const fetchCMAs = () =>
  fetch(window.list_cmas_uri)
    .then((r) => r.json())
    .then((CMAs) =>
      CMAs.map((cma) => ({
        label: cma.mineral,
        id: cma.cma_id,
        value: cma.extent,
        crs: cma.crs,
      })),
    );

export const initAutocomplete = async (elem, valueElem, containerElem, changedCalled) => {
  const cmas = await fetchCMAs();

  autocomplete({
    input: elem,
    fetch: (text, update) => {
      text = text.toLowerCase();
      let suggestions = cmas.filter((n) =>
        n.label.toLowerCase().includes(text),
      );
      update(suggestions);
    },
    preventSubmit: "Always",

    onSelect: async function (item) {
      elem.value = item.label;
      valueElem.dataset.label = item.label;
      valueElem.dataset.id = item.id;

      // draw the polygon coordinates for CMA on map using cdr->openlayers projection
      let OLmultiPolygonCoordinates = item.value.coordinates;

      if (item.crs !== openLayersDefaultProjection) {
        if (!isCRSRegistered(item.crs)) {
          await register_proj(item.crs);
        }

        OLmultiPolygonCoordinates = OLmultiPolygonCoordinates.map((polygon) => {
          return transformPolygonCoordinates(
            polygon,
            // We trust "known" set of valid crs up-front, under ../geo.ts:
            item.crs,
            openLayersDefaultProjection,
          );
        });
      }

      // clear previous ol area preview
      clearShapeOpenLayers(CMA_LAYER_ID);

      drawMultiPolygonOpenLayers(
        window.polymer_map,
        {
          type: item.value.type,
          coordinates: OLmultiPolygonCoordinates,
        },
        CMA_LAYER_ID,
      );

      let CDR_multiPolygonCoordinates = item.value.coordinates;

      if (item.crs !== cdrDefaultProjection) {
        CDR_multiPolygonCoordinates = CDR_multiPolygonCoordinates.map(
          (polygon) => {
            return transformPolygonCoordinates(
              polygon,
              // We trust "known" set of valid crs up-front, under ../geo.ts:
              item.crs,
              cdrDefaultProjection,
            );
          },
        );
      }

      valueElem.value = JSON.stringify({
        type: item.value.type,
        coordinates: CDR_multiPolygonCoordinates,
      });
    },
    keyup: () =>
      // {event, fetch}
      {
        if (!elem.value) {
          valueElem.value = null;
          valueElem.dataset.label = "";
          // clear previous ol area preview
          clearShapeOpenLayers(CMA_LAYER_ID);
        }
      },
    minLength: 0,
    container: containerElem,
    showOnFocus: true,

    customize: (input_elem, rect, autocomplete_elem, max_height) => {
      autocomplete_elem.style.top = `${rect.y + rect.height - 52}px`;
      autocomplete_elem.style.left = `${rect.x - 13}px`;
      autocomplete_elem.style["max-height"] = "15rem";
    },
    render: (suggestion, current_value) => {
      const div = document.createElement("div");
      div.textContent = suggestion.label;
      div.className = "w-full hover:bg-neutral/150 p-1";
      return div;
    },
  });

  elem.addEventListener("blur", (e) => {
    setTimeout(() => {
      // elem.value is the input box autocompleted value, which should match the label of dropdown
      if (
        !valueElem.dataset.label ||
        valueElem.dataset.label.toLowerCase() !== elem.value.toLowerCase()
      ) {
        elem.value = "";
        valueElem.value = null;
        valueElem.dataset.label = "";
        // clear previous ol area preview
        clearShapeOpenLayers(CMA_LAYER_ID);
        changedCalled("");
      } else {
        changedCalled(elem.value);
      }
    });
  });
};
