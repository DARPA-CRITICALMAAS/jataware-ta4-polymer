
window.updateCMAInput = function(cog_id) {
  const selectedCMAsInput = document.querySelector(`.cma-cog-assoc-input[data-cog_id="${cog_id}"]`);

  function removeInputFocus(elem) {
    const menu = elem.closest("div").querySelector(".dropdown-content");
    menu.focus();
  }
  selectedCMAsInput.addEventListener("click", e => {
    removeInputFocus(e.target);
  });
  selectedCMAsInput.addEventListener("focus", e => {
    removeInputFocus(e.target);
  });
}

window.toggleCMAInput = function(cog_id, mineral, isSelected) {
  const selectedCMAsInput = document.querySelector(`.cma-cog-assoc-input[data-cog_id="${cog_id}"]`);

  if (isSelected === "True") {
    const selectedMinerals = selectedCMAsInput.value.split(",");
    if (!selectedMinerals.length || selectedMinerals[0] === "") {
      selectedCMAsInput.value = mineral;
    }
    else {
      selectedMinerals.push(mineral);
      selectedCMAsInput.value = selectedMinerals.join(",");
    }
  } else {
    const selectedMinerals = selectedCMAsInput.value.split(",");
    const newMinerals = selectedMinerals.filter(m => m !== mineral);

    selectedCMAsInput.value = newMinerals.join(",");
  }
}
