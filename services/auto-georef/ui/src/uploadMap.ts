
function sleep(delay) { return new Promise(resolve => setTimeout(resolve, delay)); }

// Vars for waiting for map processing job to finish
const MAX_POLL_RETRIES = 25;
const POLL_INTERVAL = 5 * 1000; // 5 seconds

/**
 * FILE for handling UPLOAD MAP TO CDR from landing page functionality
 **/

async function pollCallSuccess(url) {
  for (let curr_try = 0; curr_try < MAX_POLL_RETRIES; curr_try++) {
    try {
      await sleep(POLL_INTERVAL);
      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== 'running') {
        return data.status;
      }

      console.log('Map upload/processing job still running, retrying after 5 seconds.');
    } catch (e) {
      return e;
    }
  }
}

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

  form.classList.add('hidden');
  document.getElementById('upload-loading').classList.remove('hidden');

  const messageElem = document.getElementById('map-processing-message');
  messageElem.innerText = "Please stay on this page until processed.";

  document.getElementById('upload-failed').classList.add('hidden');

  fetch(url, { method: "POST", body })
    .then(res => {
      if ([200, 422].includes(res.status)) {
        return res.json();
      } else {
        throw new Error(res.statusText);
      }
    })
    .then(data => {
      if (!data.job_id) {
        throw new Error(`Upload file failed.`);
      }

      console.log('Checking for job id:', data.job_id);

      const jobUrlId = `${jobUrl}${data.job_id}`;

      return pollCallSuccess(jobUrlId)
        .then(job_result => {

          console.log('Job completed or retries exhausted.')

          const jobDataUrl = jobUrlId.replace(/status/, 'result');

          return fetch(jobDataUrl)
            .then(d => {
              if (d.status == 200) {
                return d.json();
              }
              throw new Error('Upload Map processing job failed.');
            })
            .then(result => {

              console.log('Job result:', result);
              console.log('Job result details:', result.result);

              // Temporary to better debug issues, as we've had multiple problems
              // that are hard to debug in prod:
              window.localStorage.setItem("polymer:cdr-last-map-upload-result", JSON.stringify(result));

              try {
                const { map_id, georeferenced, message, Ingested, Invalid } = result.result;

                if (Invalid) {
                  throw new Error("An invalid file was provided. Please try again with valid tif, pdf, or map file.");
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
                  throw new Error("Job succeeded but unable to redirect: no cog ID received.");
                }

              } catch(e) {
                if (e.name === "TypeError") {
                  throw new Error("No job result data available.");
                } else {
                  throw e;
                }
              }
            });
        })

    })
    .catch(e => {
      console.log('Map Upload Errors:', e);
      form.classList.remove('hidden');
      document.getElementById('upload-loading').classList.add('hidden');

      const failContainer = document.getElementById('upload-failed');

      failContainer.innerText = e;
      failContainer.classList.remove('hidden');
    });
}
