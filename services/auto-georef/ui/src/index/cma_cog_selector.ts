/**
 * Disable focusing of the input box for cog-cma selector since the value is
 * autopopulated by the user selections from dropdown menu instead (like a select)
 * but with multiple values allowed.
 */
window.updateCMAInput = function (cog_id) {
  const selectedCMAsInput = document.querySelector(
    `.cma-cog-assoc-input[data-cog_id="${cog_id}"]`,
  );

  function removeInputFocus(elem) {
    const menu = elem.closest("div").querySelector(".dropdown-content");
    menu.focus();
  }
  selectedCMAsInput.addEventListener("click", (e) => {
    removeInputFocus(e.target);
  });
  selectedCMAsInput.addEventListener("focus", (e) => {
    removeInputFocus(e.target);
  });
};

/**
 * Actually modifies the cog-cma-link textbox with the selected values
 * from the dropdown menu. The menu checkbox values themselves are driven by the server
 * template using htmx.
 */
window.toggleCMAInput = function (cog_id, mineral, isSelected) {
  const selectedCMAsInput = document.querySelector(
    `.cma-cog-assoc-input[data-cog_id="${cog_id}"]`,
  );

  if (isSelected === "True") {
    const selectedMinerals = selectedCMAsInput.value.split(",");
    // was empty, selected first value:
    if (!selectedMinerals.length || selectedMinerals[0] === "") {
      selectedCMAsInput.value = mineral;
    } else { // had previous value(s), join with commas
      selectedMinerals.push(mineral);
      selectedCMAsInput.value = selectedMinerals.join(",");
    }
  } else { // deselected- ensure to filter out and join remaining with ","
    const selectedMinerals = selectedCMAsInput.value.split(",");
    // TODO FIXME? we're matching on mineral, but multiple CMAs may have the same mineral
    // hence this will be bugged when there is more than 1 CMA with that mineral
    // USE CMA_id instead...? Confirm that long-term CMAs can have repeated minerals and
    // this isn't just for testing data
    const newMinerals = selectedMinerals.filter((m) => m !== mineral);

    selectedCMAsInput.value = newMinerals.join(",");
  }
};
