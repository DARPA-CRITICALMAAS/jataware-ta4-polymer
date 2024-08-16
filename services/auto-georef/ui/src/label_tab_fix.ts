// Fix for tabbing and selecting labels with hidden inputs
for (const label of document.querySelectorAll("label:has(> input.hidden)")) {
  label.addEventListener("focus", (event) => event.preventDefault());
  label.addEventListener("keyup", ({ code }: KeyboardEvent) => {
    if (code !== "Enter" && code !== "Space") return;
    label.querySelector("input").click();
  });
}
