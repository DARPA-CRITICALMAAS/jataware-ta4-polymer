import { pollCallSuccess, copyTextToClipboard } from "../common";

/**
 * File for handling UPLOAD MAP TO CDR from landing page functionality.
 **/

const INITIAL_POLL_INTERVAL = 5 * 1000; // every 5 seconds for ^

const failContainer = document.getElementById("upload-failed");
const jobIdBtn = document.getElementById("copy-job-id");

export function handleMapUpload(e) {
  e.preventDefault();

  const title = document.getElementById("upload-title-input").value;
  const map_data = document.getElementById("map-data-input");
  map_data.value = `{
    "title": "${title}",
    "system": "",
    "system_version": ""
  }`;

  const form = this.form;
  const url = this.form.dataset.url;
  const body = new FormData(form);
  const jobUrl = this.form.dataset.job_url;

  form.classList.add("hidden");
  document.getElementById("upload-loading").classList.remove("hidden");

  const messageElem = document.getElementById("map-processing-message");
  messageElem.innerText = "Uploading Map. Please stay on this page until processed.";

  document.getElementById("upload-failed").classList.add("hidden");

  fetch(url, {
    method: "POST",
    body
  })
    .then((res) => {
      if ([200, 422].includes(res.status)) {
        return res.json();
      } else {
        throw new Error(res.statusText);
      }
    })
    .then((data) => {
      if (!data.job_id) {
        throw new Error(`Upload file failed.`);
      }

      messageElem.innerText = "Uploaded. Processing Map. Please stay on this page until processed.";
      document.getElementById("reload-job-queue-button").click();

      const jobUrlId = `${jobUrl}?job_id=${data.job_id}`;
      jobIdBtn.classList.remove("hidden");

      jobIdBtn.addEventListener("click", (e) => {
        copyTextToClipboard(data.job_id);
      });

      return pollCallSuccess(jobUrlId, INITIAL_POLL_INTERVAL).then((job_result) => {
        console.log("Job completed.");

        const jobResultUrl = jobUrlId.replace(/status/, "result");

        return fetch(jobResultUrl)
          .then((d) => {
            if (d.status == 200) {
              return d.json();
            }
            throw new Error("Upload Map processing job failed.");
          })
          .then((result) => {
            console.log("Job result:", result);
            console.log("Job result details:", result.result);

            // Temporary to better debug issues, as we've had multiple problems
            // that are hard to debug in prod:
            window.localStorage.setItem(
              "polymer:cdr-last-map-upload-result",
              JSON.stringify(result),
            );

            try {
              const { map_id, georeferenced, message, Ingested, Invalid } =
                result.result;

              if (Invalid) {
                throw new Error(
                  "An invalid file was provided. Please try again with valid tif, pdf, or map file.",
                );
              }

              const mapExisted = Boolean(map_id);
              // map ID to use, from either pre-existing or new map:
              const mapIDTarget = map_id || Ingested;
              let navUrl = `/points/${mapIDTarget}`;

              messageElem.innerText = "";

              if (mapExisted) {
                if (message) {
                  messageElem.innerText = message + " ";
                }

                if (georeferenced) {
                  // nav to map extracction / GCPs page
                  navUrl = `/projections/${map_id}`;
                }
              } else {
                messageElem.innerText = "Done processing new map. ";
              }

              if (mapIDTarget) {
                messageElem.innerText += " Redirecting to map page.";
                setTimeout(() => {
                  window.location.href = navUrl;
                }, 3000);
              } else {
                messageElem.innerText = "";
                throw new Error(
                  "Job succeeded but unable to redirect: no cog ID received.",
                );
              }
            } catch (e) {
              if (e.name === "TypeError") {
                throw new Error("No job result data available.");
              } else {
                throw e;
              }
            }
          });
      });
    })
    .catch((e) => {
      form.classList.remove("hidden");
      document.getElementById("upload-loading").classList.add("hidden");

      failContainer.innerText = e;
      failContainer.classList.remove("hidden");
    });
}

if (import.meta.env) {
  document
    .getElementById("upload-button")
    .addEventListener("click", handleMapUpload);

  function handleUploadCancel(e) {
    e.preventDefault();
    document.getElementById("map-upload-details").classList.add("hidden");
    document.getElementById("cdr-map-file-input").value = null;
    failContainer.classList.add("hidden");
  }

  document
    .getElementById("upload-cancel-button")
    .addEventListener("click", handleUploadCancel);
}
