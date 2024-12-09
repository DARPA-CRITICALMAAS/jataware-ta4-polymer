import autocomplete from "autocompleter";
import statePolygonData from "../json/simplified_states_geojson_file.json";

let states = statePolygonData.features.map((featureData) => {
  let value = featureData.geometry;
  if (featureData.geometry.type === "Polygon") {
    value = {
      type: "MultiPolygon",
      coordinates: [featureData.geometry.coordinates],
    };
  }

  return {
    label: featureData.properties["NAME"],
    value,
  };
});

export const initAutocomplete = (elem, valueElem, containerElem) => {
  autocomplete({
    input: elem,
    fetch: (text, update) => {
      text = text.toLowerCase();
      let suggestions = states.filter((n) =>
        n.label.toLowerCase().startsWith(text),
      );
      update(suggestions);
    },
    preventSubmit: "Always",

    onSelect: function (item) {
      elem.value = item.label;
      valueElem.value = JSON.stringify(item.value);
      valueElem.dataset.label = item.label;
    },
    keyup: () => {
      if (!elem.value) {
        valueElem.value = null;
        valueElem.dataset.label = "";
      }
    },
    minLength: 1,
    container: containerElem,

    customize: (input_elem, rect, autocomplete_elem, max_height) => {
      autocomplete_elem.style.top = `${rect.y + rect.height - 52}px`;
      autocomplete_elem.style.left = `${rect.x - 13}px`;
    },
    render: (suggestion, current_value) => {
      const div = document.createElement("div");
      div.textContent = suggestion.label;
      div.className = "w-full hover:bg-neutral/150 p-1";
      return div;
    },
  });

  // Meh.. library we grabbed isn't exactly amazing, even if simple
  // worked around limitations by removing values if there may be some confusion...
  elem.addEventListener("blur", (e) => {
    setTimeout(() => {
      // elem.value is what the user entered in the autocomplete box, which must match the dataset attr exactly
      // we don't allow partial contents to be left over to reduce user confusion
      if (
        !valueElem.dataset.label ||
        valueElem.dataset.label.toLowerCase() !== elem.value.toLowerCase()
      ) {
        elem.value = "";
        valueElem.value = null;
        valueElem.dataset.label = "";
      }
    });
  });
};
