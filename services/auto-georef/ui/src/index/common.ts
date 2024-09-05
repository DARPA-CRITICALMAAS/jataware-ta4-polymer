
export function expandSearchResults(container, results, icon, opts) {
  const invert = opts?.invert;

  if (invert) {
    container.classList.add("hidden");
    results.classList.remove("bottom-28");
    icon.classList.add("rotate-180");
  } else {
    container.classList.remove("hidden");
    results.classList.add("bottom-28");
    icon.classList.remove("rotate-180");
  }
}
