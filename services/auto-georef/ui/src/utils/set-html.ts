/**
 * Sets the inner HTML of an element in such a way that script tags are executed.
 * @param element - The element to set the inner HTML of.
 * @param html - The HTML to set.
 */
export function setInnerHTML(element: Element, html: string) {
  element.innerHTML = html;
  element.querySelectorAll("script").forEach((oldScript) => {
    const newScript = document.createElement("script");

    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });

    const scriptText = document.createTextNode(oldScript.innerHTML);
    newScript.appendChild(scriptText);

    oldScript.parentNode?.replaceChild(newScript, oldScript);
  });
}
