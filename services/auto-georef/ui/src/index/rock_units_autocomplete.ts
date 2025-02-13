import autocomplete from "autocompleter";

const STORAGE_KEY_PREFIX = "polymer_rock_unit_";
const MAJOR_TYPES = [
  "Major1",
  "Major2",
  "Major3",
  "Minor1",
  "Minor2",
  "Minor3",
  "Minor4",
  "Minor5",
];

function fetchGeologyRockUnits() {
  const allDataPromises = MAJOR_TYPES.map((mt) => {
    const key = `${STORAGE_KEY_PREFIX}${mt}`;
    if (sessionStorage.getItem(key)) {
      // console.log("key", key, "already contains values. Skipping");
      return Promise.resolve(true);
    }

    return fetch(`${window.rock_units_uri}?major_type=${mt}`)
      .then((r) => r.json())
      .then((mtValues) => {
        if (Array.isArray(mtValues)) {
          sessionStorage.setItem(key, JSON.stringify(mtValues));
        } else {
          console.error(
            "Rock unit detail response is not an array, not setting to session storage. Details:",
            mtValues,
          );
        }
      });
  });

  return Promise.all(allDataPromises);
}

async function prepareAutocomplete() {
  await fetchGeologyRockUnits();

  const rock_units = [];

  MAJOR_TYPES.forEach((mt) => {
    const formatted = JSON.parse(
      sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${mt}`),
    ).map((label) => ({ label: label, value: label, group: mt }));

    Array.prototype.push.apply(rock_units, formatted);
  });

  return rock_units;
}

const selectedRockUnitsElem = document.getElementById("selected-rock-units");
const selectedItems = [];

function addRockUnitBadge(selection) {
  const newElem = !selectedItems.find(
    (si) => si.value === selection.value && si.group === selection.group,
  );
  if (newElem) {
    selectedItems.push(selection);
    renderRockUnitBadges();
  }
}

function removeAtIndex(arr, idx) {
  arr.splice(idx, 1);
}

function renderRockUnitBadges() {
  const deleteClickFn = (e) => {
    const { dataset } = e.target;
    removeRockUnitBadge(dataset.idx);
  };

  document.querySelectorAll(".rock_unit_badge_delete").forEach((badge_x) => {
    badge_x.removeEventListener("click", deleteClickFn);
  });

  selectedRockUnitsElem.innerHTML = "";

  selectedItems.forEach((i, idx) => {
    const newBadge = document.createElement("li");
    newBadge.className =
      "badge text-slate-500 dark:text-slate-400 rounded-sm border-slate-400/25 badge-ghost badge-outline badge-xs mb-1";
    newBadge.style["text-transform"] = "lowercase";
    newBadge.style["padding"] = "0.75rem 0.25rem 0.75rem 0.1rem";

    newBadge.innerHTML = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      data-idx="${idx}"
      class="inline-block h-4 w-4 stroke-current rock_unit_badge_delete cursor-pointer">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M6 18L18 6M6 6l12 12"></path>
    </svg>
    ${i.group}:<span class="text-accent">${i.label}</span>
`;
    selectedRockUnitsElem.appendChild(newBadge);
  });

  selectedRockUnitsElem.classList.remove("hidden");

  document.querySelectorAll(".rock_unit_badge_delete").forEach((badge_x) => {
    badge_x.addEventListener("click", deleteClickFn);
  });
}

function removeRockUnitBadge(index) {
  removeAtIndex(selectedItems, index);
  renderRockUnitBadges();
  updateFormInputs();
}

function updateFormInputs() {
  const initial_acc = MAJOR_TYPES.reduce((acc, type_name) => {
    acc[type_name] = [];
    return acc;
  }, {});

  const formatted_selected = selectedItems.reduce((acc, curr) => {
    acc[curr.group].push(curr.value);
    return acc;
  }, initial_acc);

  for (let i of MAJOR_TYPES) {
    const formattedType = i.toLowerCase().replace(/([0-9])/, "_$1");
    document.querySelector(`input[name=sgmc_geology_${formattedType}]`).value =
      JSON.stringify(formatted_selected[i]);
  }
}

export const initAutocomplete = async (elem, containerElem) => {
  const rock_units = await prepareAutocomplete();

  document.getElementById("rock-units-section").classList.remove("hidden");

  autocomplete({
    input: elem,
    fetch: (text, update) => {
      text = text.toLowerCase();
      let suggestions = rock_units.filter((n) =>
        n.label.toLowerCase().includes(text),
      );
      update(suggestions);
    },
    preventSubmit: "Always",

    onSelect: function (item) {
      addRockUnitBadge(item);
      updateFormInputs();
    },
    click: (e) => {
      if (elem.value) {
        return e.fetch();
      }
    },
    // NOTE shouldn't clear when input is empty as we're selecting multiple options
    // keyup: (event) => {
    //   if (!elem.value) {
    //     valueElem.value = null;
    //   }
    // },
    minLength: 1,
    container: containerElem,

    customize: (input_elem, rect, autocomplete_elem, max_height) => {
      autocomplete_elem.style.top = `${rect.y + rect.height - 52}px`;
      autocomplete_elem.style.left = `${rect.x - 13}px`;
      autocomplete_elem.style["max-height"] = "12rem";
      autocomplete_elem.style['zIndex'] = 6;
    },
    render: (suggestion, current_value) => {
      const div = document.createElement("div");
      div.className = "w-full px-2 py-1";
      div.textContent = suggestion.label;
      return div;
    },
    renderGroup: function (groupName, currentValue) {
      var div = document.createElement("div");
      div.className =
        "text-white bg-primary dark:text-neutral-color dark:bg-neutral pl-1 border-bottom border-neutral border-solid";
      div.textContent = groupName;
      return div;
    },
  });
};
