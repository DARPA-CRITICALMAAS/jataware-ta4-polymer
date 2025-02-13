import { createPackagingData } from "./packaging";
import { pollCallSuccess, sleep, enableDialogDragging, removeElementChildren, disableNthChild } from "../common";
import { process as htmxProcess } from "htmx.org";

/**
 *
 */
function identifierFromData(data) {
  const {
    cma_id,
    sgmc_geology_major_1,
    sgmc_geology_major_2,
    sgmc_geology_major_3,
    sgmc_geology_minor_1,
    sgmc_geology_minor_2,
    sgmc_geology_minor_3,
    sgmc_geology_minor_4,
    sgmc_geology_minor_5,
  } = data;

  let identifier = "";

  // Extract the CMA name from the cma_id
  const split_arr = cma_id.split("_");
  const cma_name = split_arr[split_arr.length - 1];
  identifier += `cma-${cma_name}`;

  // Dynamically add all available sgmc_geology arrays to the identifier
  const geologyKeys = [
    sgmc_geology_major_1,
    sgmc_geology_major_2,
    sgmc_geology_major_3,
    sgmc_geology_minor_1,
    sgmc_geology_minor_2,
    sgmc_geology_minor_3,
    sgmc_geology_minor_4,
    sgmc_geology_minor_5,
  ];

  geologyKeys.forEach((geologyArray, index) => {
    if (Array.isArray(geologyArray) && geologyArray.length > 0) {
      const cleanedArray = geologyArray.map((item) => item.replace(/\s+/g, ""));
      identifier += `-${cleanedArray.join("_")}`;
    }
  });

  return identifier;
}


const SLOW_JOB_WAIT_TIME = 15; // 15 seconds

/**
 * 
 */
async function waitForLayerDataFromEvent(event_id) {
  let waitSeconds = 5; // for 5 seconds, but js uses ms
  let timeoutRetries = 5;
  let totalSecondsWaited = 0;

  while (true) {
    const waitTimeMillis = waitSeconds * 1000;  // now we actually use seconds instead of ms

    try {
      const response = await fetch(window.processed_data_layers_uri + `?event_id=${event_id}`)
      const data = await response.json();

      if (data.length) {
        return data;
      } else {
        // sleep some time, then repeat loop to check
        await sleep(waitTimeMillis);
        totalSecondsWaited += waitSeconds;
        if (totalSecondsWaited >= 90 && waitSeconds < SLOW_JOB_WAIT_TIME) {
          waitSeconds = SLOW_JOB_WAIT_TIME;
        }
      }
    } catch (e) {
      console.log("e", e);
      if (e.message === 'Failed to fetch' && timeoutRetries > 0) {
        --timeoutRetries;
        console.log("Request timed out, allowing us to retry for now.")
      } else {
        throw e;
      }
    }
  }
}


/**
 *  returns it with leading ., like: .cog.tif or .tif or .zip, etc
 */
function getFileExtension(url) {
  const parts = url.split('/');
  const filename = parts.pop();

  const extension = filename.substring(filename.indexOf('.'));
  return extension;
}

const dialog = document.getElementById("create-raster-dialog");
const dialogContents = dialog.querySelector(".modal-box");
const dialogTitle = document.getElementById("raster-title");

enableDialogDragging(dialog, dialogContents, dialogTitle);


/**
 * TODO refactor this- no time so far...
 * Ideally we use an htmx dialog, from there it polls with its own scripts and htmx,
 * and once jobs have a result, it maybe calls a js function to properly start the download.
 */
export function createRasterJobs(layerUrls: string[]) {
  const jobStatusSpan = document.getElementById("raster-status");
  const jobStatusBreakdown = dialog.querySelector(".job-status-breakdown");
  const dialogTitleText = dialogTitle.querySelector("h3");
  const failedList = document.getElementById("raster-failed-job-ids");
  const packageCaption = dialog.querySelector(".caption");
  const alertMessage = dialog.querySelector(".alert > span");
  const step1 = document.getElementById("raster-step-1");
  const step2 = document.getElementById("raster-step-2");
  const step3 = document.getElementById("raster-step-3");
  const downloadLinksContainer = step3.querySelector("#layer-download-links");

  const packageData = layerUrls.map(layerUrl => createPackagingData(layerUrl));
  const identifiers = packageData.map(data => identifierFromData(data));
  const titles = [];

  let textInputDom = '';

  identifiers.forEach((k, idx) => {
    textInputDom += `
    <label class="form-control w-full max-w-xs">
      <div class="label">
        <span class="label-text">Layer ${idx + 1}</span>
      </div>
      <input type="text" required value="${k}" class="input input-bordered w-full max-w-xs" />
    </label>
      `;
  });

  step1.insertAdjacentHTML('beforeend', textInputDom);

  step1.insertAdjacentHTML('beforeend', `
    <div class="flex justify-end items-center mt-2">
      <button id="cancel-rasterize-start" class="btn btn-error text-base-100">Cancel</button>
      &nbsp;
      &nbsp;
      <button id="submit-rasterize-job" class="btn btn-primary">Submit</button>
    </div>
    `);

  const closeResetDialog = () => {

    // add pointer events back to form
    document.getElementById("features-main-pane").style["pointer-events"] = "unset";
    dialog.querySelector(".modal-action").classList.add("hidden");
    dialog.classList.remove("modal-open");
    dialog.querySelector(".loading").classList.remove("hidden");

    dialogTitle.classList.remove("bg-success", "bg-error", "bg-warning");
    dialogTitle.classList.add("bg-info");

    alertMessage.parentElement.classList.remove("hidden");

    dialogTitleText.textContent = "Raster Evidence Layers in CDR";

    packageCaption.classList.remove("hidden");
    jobStatusBreakdown.classList.remove("hidden");
    packageCaption.textContent = "Name each raster layer. Submit to start evidence layer creation.";
    step1.classList.remove("hidden");
    step2.classList.add("hidden");
    step3.classList.add("hidden");

    removeElementChildren(failedList);
    removeElementChildren(downloadLinksContainer);
    removeElementChildren(step1);
    removeElementChildren(jobStatusBreakdown);
  };

  document.getElementById("cancel-rasterize-start")
    .addEventListener("click", closeResetDialog);

  dialog.classList.add("modal-open");

  document.getElementById("submit-rasterize-job")
    ?.addEventListener("click", (e) => {

      const titleInputs = document.querySelectorAll("#raster-step-1 input");
      const anyEmpty = [...titleInputs].some(title => title.value === "");

      if (anyEmpty) {
        return;
      }

      e.preventDefault();

      packageCaption.textContent = "Sending raster requests and waiting for them to finish. Staying on this page will ensure that the result is downloadable, but you may also check back later in the CDR.";

      step1.classList.add("hidden");
      step2.classList.remove("hidden");

      const reqPromises = packageData.map((data, idx) => {
        const title = titleInputs[idx].value;
        titles.push(title)
        const dataIn = { ...data, title }; // titles not yet from the text inputs

        // this should be the titles requested, but lets leave like filenames for now
        return fetch(window.rasterize_evidence_layers_uri, {
          method: "post",
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dataIn)
        })
          .then(response => response.json())
      });

      const jobCount = reqPromises.length;
      let remainingJobs = jobCount; // initial value; we'll count down until there are no remaining
      const noMatch = [];
      const failedJobs = [];

      jobStatusSpan.textContent = `Waiting for creation of ${remainingJobs} rasterized evidence layers.`;

      const finalPromises = reqPromises.map((job_promise, idx) => {
        return job_promise.then(async (job_id) => {

          const statusUrl = `${window.job_status_uris[0]}?job_id=${job_id}`;
          const resultUrl = `${window.job_status_uris[1]}?job_id=${job_id}`;

          jobStatusBreakdown.insertAdjacentHTML("beforeend", `
            <div hx-trigger="every 5s" 
                hx-get="/features/job-status-tracker?job_id=${job_id}&title=${titles[idx]}&job_type=raster"
                hx-swap="outerHTML"
                >
            </div>
            `);
          htmxProcess(jobStatusBreakdown);

          try {
            await pollCallSuccess(statusUrl, 5000);

            const r = await fetch(resultUrl);
            const jsonJobResult = await r.json();

            const event_id = jsonJobResult?.result?.event_id;
            const identifier = identifiers[idx];

            if (jsonJobResult.state === "success" && !event_id) {
              noMatch.push(identifier);
            } else if (jsonJobResult.state !== "success") {
              throw new Error(`${jsonJobResult?.state}, ${JSON.stringify(jsonJobResult?.result)}`);
            } else {
              // Stop status child for that created raster
              disableNthChild(jobStatusBreakdown, idx, true); // true->empty children contents

              jobStatusBreakdown.insertAdjacentHTML("beforeend", `
                <div class="flex gap-2" id="raster-event-${event_id}">
                <div 
                  onclick="window.copyTextToClipboard('${event_id}')"
                  class="tooltip tooltip-right"
                  data-tip="Click to copy raster input layer Event ID, in order to check details through the CDR API."
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
                    class="cursor-pointer size-6 text-primary">
                    <path
                      d="M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 0 1 3.75 3.75v1.875C13.5 8.161 14.34 9 15.375 9h1.875A3.75 3.75 0 0 1 21 12.75v3.375C21 17.16 20.16 18 19.125 18h-9.75A1.875 1.875 0 0 1 7.5 16.125V3.375Z" />
                    <path
                      d="M15 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 17.25 7.5h-1.875A.375.375 0 0 1 15 7.125V5.25ZM4.875 6H6v10.125A3.375 3.375 0 0 0 9.375 19.5H16.5v1.125c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V7.875C3 6.839 3.84 6 4.875 6Z" />
                  </svg>
                </div>
                <p class="m-0">Waiting to receive raster file for <span class="text-primary">${titles[idx]}</span>.</p>
                </div>
                `);

              // make new request to get raster download_url
              const rasterLayerData = await waitForLayerDataFromEvent(event_id);

              const eventStatus = document.getElementById(`raster-event-${event_id}`);
              eventStatus.querySelector("p").textContent = `Raster complete for ${titles[idx]}.`;

              const { title, download_url } = rasterLayerData[0];
              const ext = getFileExtension(download_url);
              const filename = `${title}${ext}`;
              downloadLinksContainer.insertAdjacentHTML('beforeend', `<li><a href="${download_url}" download="${filename}">${filename}</a></li>`);

              step3.classList.remove("hidden");
            }
            remainingJobs -= 1;
            jobStatusSpan.textContent = `Waiting for creation of ${remainingJobs} rasterized evidence layers.`;
          } catch (e) {
            failedJobs.push({ id: job_id, reason: e.message });
            return false;
          }
        });
      });

      Promise.all(finalPromises).then(() => {
        alertMessage.parentElement.classList.add("hidden");
        packageCaption.classList.add("hidden");
        step2.classList.add("hidden");
        dialog.querySelector(".modal-action").classList.remove("hidden");

        if (failedJobs.length) { // Any failed..
          step2.classList.remove("hidden");

          dialogTitle.classList.remove("bg-info");
          dialogTitle.classList.add("bg-error");
          dialogTitleText.textContent = "An Unexpected Error Ocurred";

          jobStatusSpan.textContent = "Creation of rasterizing evidence layers in CDR failed.";
          jobStatusSpan.textContent += " You may use the CDR API to check for details for the following job IDs:"

          failedJobs.forEach(d => {
            const li = document.createElement("li");
            li.innerHTML = `<span class="text-info">${d.id}</span>: <span class="text-error">${d.reason}</span>`;
            failedList.appendChild(li);
          });
          failedList.classList.add("mb-4");

        } else if (noMatch.length < jobCount) {
          jobStatusSpan.textContent = "";
          dialogTitle.classList.remove("bg-info");
          dialogTitle.classList.add("bg-success");
          dialogTitleText.textContent = "Raster Layers Created";
        } else {
          jobStatusSpan.textContent = "";
          dialogTitle.classList.remove("bg-info");
          dialogTitle.classList.add("bg-warning");
          dialogTitleText.textContent = "No Features Found";
        }

        if (noMatch.length) {
          step2.classList.remove("hidden");
          jobStatusSpan.textContent = "The following layers were skipped, as there are no matches in the CDR:";
          failedList.classList.add("mb-4");

          jobStatusBreakdown.classList.add("hidden");
        }
        noMatch.forEach(no_match_filename => {
          const li = document.createElement("li");
          li.innerHTML = `<span>${no_match_filename}</span>`;
          failedList.appendChild(li);
        });

        dialog.querySelector(".loading").classList.add("hidden");
      });

    });

  dialog.classList.add("modal-open");

  // remove pointer events from form
  document.getElementById("features-main-pane").style["pointer-events"] = "none";

  // TODO instead of using js, we should re-fetch the dialog template from htmx server
  dialog.querySelector(".modal-action > button")
    .addEventListener("click", closeResetDialog);
}
