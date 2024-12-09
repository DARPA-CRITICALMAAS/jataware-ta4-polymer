/**
 * Collapse/expand map search results on right-hand side of landing
 * page.
 */
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

/**
 * Toggle a 'hidden' element for a few seconds, then re-hide.
 * Useful for error/warning banners.
 */
export function displayElemTemporarily(elem, seconds = 5) {
  elem.classList.remove("hidden");

  setTimeout(() => {
    elem.classList.add("hidden");
  }, seconds * 1000);
}

/* Expand 10k -> 10,000 ; 10m -> 10,000,000 */
export function expandMetricPrefix(input) {
  const metricPrefixes = {
    k: 1e3,
    m: 1e6,
  };

  const value = parseFloat(input);
  if (isNaN(value)) {
    return 0;
  }
  const prefix = input.charAt(input.length - 1).toLowerCase();

  if (metricPrefixes.hasOwnProperty(prefix)) {
    return value * metricPrefixes[prefix];
  } else {
    return value;
  }
}

/**
 * Use to add some timeout wait time in between await promise calls
 * @param Time in ms to "sleep" until promise is resolved
 * @returns undefined
 */
export function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 
 */
export function generateHexColor(): string {
  let color = Math.floor(Math.random()*16777215).toString(16);
  return color.padEnd(6, "0");
}

const SLOW_JOB_WAIT_TIME = 15000; // 15 seconds in millis

/**
 * Waits longer the more time goes on while waiting for a job to finish.
 */
export async function pollCallSuccess(url, initial_poll_interval) {
  let wait = initial_poll_interval; // eg 5000ms
  let totalSecondsWaited = 0;

  while (true) {
    try {
      await sleep(wait);
      totalSecondsWaited += wait / 1000;
      const res = await fetch(url);
      const data = await res.json();

      if (!["running", "pending"].includes(data.status)) {
        return data.status;
      }
      if (totalSecondsWaited >= 90 && wait < SLOW_JOB_WAIT_TIME) {
        wait = SLOW_JOB_WAIT_TIME; 
      }
    } catch (e) {
      // TODO check if these should be returned or if we shouldn't handle and
      //     let caller do so instead.
      return e;
    }
  }
}

/**
 * 
 */
export function downloadFileSameHost(url: string, fileName = "") {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function downloadFile(url: string, fileName = "") {
  const response = await fetch(url);
  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName || url.split('/').pop(); // Fallback to original filename
  document.body.appendChild(link);
  link.click();

  // Clean up
  document.body.removeChild(link);
  window.URL.revokeObjectURL(blobUrl);
}

const fallbackCopyTextToClipboard = (text: string) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand("copy");
    const msg = successful ? "successful" : "unsuccessful";
    console.log("Fallback: Copying text command was " + msg);
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
};

export const copyTextToClipboard = (text: string) => {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    function () {
      console.log("Copying to clipboard was successful!");
    },
    function (err) {
      console.error("Could not copy text: ", err);
    },
  );
};

export function enableDialogDragging(dialog, dialogContents, title) {
  dialog.style.backgroundColor = "#00000024";

  let offsetX = 0;
  let offsetY = 0;
  let isDragging = false;

  dialogContents.style.transform = "none !important";
  dialogContents.style.position = "fixed";

  title.addEventListener('mousedown', (e) => {
    if(e.buttons === 1) {
      isDragging = true;
      offsetX = e.clientX - dialogContents.offsetLeft;
      offsetY = e.clientY - dialogContents.offsetTop;
    }
  });

  document.body.addEventListener('mousemove', (e) => {
    if (isDragging) {
      let left = e.clientX - offsetX;
      let top = e.clientY - offsetY;

      // Ensure the dialog stays within the window borders
      left = Math.max(0, Math.min(left, window.innerWidth - dialogContents.offsetWidth));
      top = Math.max(0, Math.min(top, window.innerHeight - dialogContents.offsetHeight));

      dialogContents.style.left = `${left}px`;
      dialogContents.style.top = `${top}px`;
    }
  });

  document.body.addEventListener('mouseup', () => { isDragging = false; });

}

/**
 * 
 */
export function removeElementChildren(domElement) {
  while (domElement.firstChild) {
    domElement.removeChild(domElement.firstChild);
  }
}

/* Given a dom elem, disables htmx interactions for its nth child, clearing the nth child's children as well. */
export function disableNthChild(parent, n, shouldEmpty=false) {
  if (parent && parent.children[n]) {
    const target = parent.children[n];
    target.setAttribute("hx-disable", "true");
    if (shouldEmpty) {
      removeElementChildren(target);
    }
  }
}

window.copyTextToClipboard = copyTextToClipboard;