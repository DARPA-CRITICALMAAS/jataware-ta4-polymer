// General utility functions
const georefencer_url = "https://georef.polymer.rocks"
// const georefencer_url = "http://localhost:8080"
const georef_api = "https://ex.polymer.rocks/api"
// const georef_api = "http://localhost:3000"

const georef_token = "Bearer 9KuK9LZyYVs0xusru4P4eFrV4WHAKF63WV0eauuhrShcRsj7GjDOstjb243U0F4Z"
function returnButtonText(data) {

  if (data.validated) {
    return "Polymer Projection";
  } else if (data.georeferenced) {
    return "Polymer Projections";
  } else {
    return "Georeference";
  }
}

function returnRowColor(map) {
  if (map['not_a_map']) return "lightgray"
  if (map['validated']) return "#3a9679"
  if (map['georeferenced']) return '#fabc60'
  return '#e16262'
}

const config = { childList: true, subtree: false };

const callback = function (mutationsList) {
  for (let mutation of mutationsList) {
    if (mutation.type === 'childList') {
      if (mutation.addedNodes.length > 0) {
        for (let result of mutation.addedNodes) {
          updateResult(result)
        }
      }
    }
  }
};

const observer = new MutationObserver(callback);

const catalogCallback = function (mutationsList) {
  processCatalogViewPage(mutationsList[0].target)
}

const catalogObserver = new MutationObserver(catalogCallback);

function updateResult(element) {
  var childId = element.id
  let year = getDate(element)
  let scale = getScale(element)
  let publisher = checkPub(element)
  let title = getTitle(element)
  let authors = getAuthors(element)
  if (childId) {
    fetch(georef_api + '/map/maps_lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        "X-Token": georef_token
      },
      body: JSON.stringify({ "map_publication_id": String(childId) })
    })
      .then(response => {
        if (!response.ok) {
          // throw new Error('Network response was not ok ' + response.statusText);
          return null
        }
        return response.json();
      })
      .then(data => {
        if (data !== null) {
          const button = makeButton()
          button.textContent = returnButtonText(data);
          button.style.backgroundColor = returnRowColor(data)

          button.addEventListener("click", function () {

            if (data.validated) {
              window.open(georefencer_url + "/projections/" + String(data.map_id));
            } else if (data.georeferenced) {
              window.open(georefencer_url + "/projections/" + String(data.map_id));
            } else {
              window.open(georefencer_url + "/points/" + String(data.map_id));
            }
          });
          if (element) element.appendChild(button);

        } else {
          const fileInput = makeFileInput()
          let fileInputId = String(childId);
          fileInput.id = fileInputId
          if (element) element.appendChild(fileInput);

          const button = makeButton()
          button.style.backgroundColor = "#F0F8FF"

          button.textContent = "Upload to Polymer";

          button.addEventListener("click", function () {
            button.disabled = true;
            button.textContent = 'processing...'
            const fileElement = element.querySelector('input');
            fileInput.style.zIndex = '1000';
            fileInput.style.pointerEvents = "auto";
            let files = fileElement.files

            if (files.length === 0) {
              alert("Please select a file.");
              return;
            }
            const file = files[0];

            const formData = new FormData();

            formData.append("file", file);
            formData.append('map_name', "_" + String(childId))
            formData.append('organization', publisher)
            formData.append('title', title)
            formData.append('scale', scale)
            formData.append('year', year)
            formData.append("authors", authors)
            fetch(georef_api + '/map/processMap', {
              method: 'POST',
              mode: "cors",
              headers: {
                "X-Token": georef_token
              },
              body: formData
            })
              .then(response => {
                if (!response.ok) {
                  throw new Error('Network response was not ok ' + response.statusText);
                }
                return response.json();
              })
              .then(data => {
                console.log(data)
                button.disabled = false;
                button.textContent = "Upload to Polymer";
                if (data.validated) {
                  window.open(georefencer_url + "/projections/" + String(data.map_id));
                } else if (data.georeferenced) {
                  window.open(georefencer_url + "/projections/" + String(data.map_id));
                } else {
                  window.open(georefencer_url + "/points/" + String(data.map_id));
                }
              })
              .catch(error => {
                console.error('Error:', error);
              });
          });
          if (element) element.appendChild(button);
        }
      })
      .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
      });
  }
}

function checkPub(element) {
  const spanElement = element.querySelector('span.recPub.searchItem');

  if (spanElement) {
    return spanElement.textContent
  } else {
    console.log("No 'span' element found");
    return ""
  }
}

function getTitle(element) {
  const spanElement = element.querySelector('span.recTitle.searchItem');

  if (spanElement) {
    return spanElement.textContent
  } else {
    console.log("No 'span' element found");
    return ""
  }
}

function getDate(element) {
  const spanElement = element.querySelector('span.recDate.searchItem');

  if (spanElement) {
    return Number(spanElement.textContent)
  } else {
    console.log("No 'span' element found");
    return ""
  }
}

function getScale(element) {
  const spanElement = element.querySelector('span.recScale.searchItem');

  if (spanElement) {
    return Number(spanElement.textContent.split(":")[1].replace(/,/g, ""))
  } else {
    console.log("No 'span' element found");
    return ""
  }
}
function getAuthors(element) {
  const spanElement = element.querySelector('span.recAuth.searchItem');

  if (spanElement) {
    return spanElement.textContent
  } else {
    console.log("No 'span' element found");
    return ""
  }
}

function processChildIDfromURL(url) {
  const idDescriptor = url.split("/").pop()
  return idDescriptor.split("_").pop().split(".")[0]
}

function getCurrentURL() {
  return window.location.toString();
}

// Parse values out of general info section of the product page
function parseGeneralInfo() {
  var generalInfoDiv = document.getElementById('general_info');
  var infoList = generalInfoDiv.getElementsByTagName('li');
  var infoDict = {};

  for (var i = 0; i < infoList.length; i++) {
    var listItem = infoList[i];
    var strongElement = listItem.querySelector('strong');
    var textNode = listItem.childNodes[1];

    // This is to deal with the inconsistency of the structure of the general info
    if (textNode.hasChildNodes()) {
      href = textNode.querySelector('a');
      if (href) {
        textNode = href;
      } else {
        textNode = textNode.childNodes[1];
      }
    }

    if (strongElement && textNode) {
      var key = strongElement.textContent.trim().replace(':', '');
      var value = textNode.textContent.trim();
      infoDict[key] = value;
    }
  }

  //Process north, south, east, west data from string to number
  // Regular expression to match the float number inside the parenthesis
  let number_regex = /\((-?\d+\.\d+)\)/;
  let keys_list = ["North Latitude", "South Latitude", "East Longitude", "West Longitude"]


  for (let key in infoDict) {
    if (keys_list.includes(key)) {
      match = infoDict[key].match(number_regex);

      // If a match is found, get the float number (it will be in the first capturing group)
      let result = match ? parseFloat(match[1]) : null;
      console.log("Result:", result);

      infoDict[key] = result;
    }
  }

  return infoDict;
}


// UI Element generation functions

function makeButton() {
  let button = document.createElement("button");
  button.style.width = "auto"
  button.style.height = "20px"
  button.style.color = "#000000";
  button.style.paddingLeft = "6px";
  button.style.paddingRight = "6px";
  button.style.textAlign = "center";
  button.style.display = "inline-block";
  button.style.fontSize = "12px";
  button.style.cursor = "pointer";
  button.style.pointerEvents = "auto";
  button.style.borderRadius = "999px";
  button.style.border = "3px solid black";
  button.style.boxShadow = "0px 1px 2px rgba(0,0,0,0.3)";
  button.style.fontWeight = 'bold';
  button.style.zIndex = 1000;
  return button
}

function makeCatalogButton() {
  // const extensionId = chrome.runtime.id;
  const image = chrome.runtime.getURL("images/polymer-48.png");
  let button = document.createElement("button");
  button.style.width = "30px";
  button.style.height = "30px";
  button.style.color = "#ffffff";
  button.style.backgroundImage = 'url(' + image + ')';
  button.style.backgroundSize = "cover";
  // button.style.background = "#ff8c00";
  button.style.borderRadius = "50%";
  button.style.textAlign = "center";
  button.style.lineHeight = "30px";
  button.style.marginTop = "-5px";
  button.style.marginRight = "5px";
  button.style.marginLeft = "0px";
  button.style.borderRadius = "999px";
  button.style.border = "2px solid transparent";
  button.style.cursor = "pointer";
  button.style.fontWeight = "bold";
  button.style.verticalAlign = "middle";
  button.style.zIndex = 1000;

  return button;
}


function makeFileInput() {
  let fileInput = document.createElement("input");
  fileInput.style.zIndex = 1000;
  fileInput.style.appearance = "none";
  fileInput.style.pointerEvents = "auto";
  fileInput.style.backgroundColor = "#F0F8FF";
  fileInput.style.borderRadius = "15px";
  fileInput.type = "file";
  return fileInput
}

function makeLoadingDiv() {
  let loading_div = document.createElement("div");
  loading_div.id = "_loading";
  loading_div.textContent = "Loading...";
  loading_div.style.display = "none";
  loading_div.style.color = "red";
  return loading_div;

}

function makePolymerProductPageDiv(button, uploader = null) {
  if (uploader != null) {
    let loading_div = document.createElement("div");
    loading_div.id = "_loading";
    loading_div.textContent = "Loading...";
    loading_div.style.display = "none";
    polymer_div = document.createElement("div");
    uploader.style.borderRadius = "2px";
    polymer_div.appendChild(loading_div);
    polymer_div.appendChild(uploader);
    polymer_div.appendChild(button);
    polymer_div.style.width = "100%";
    polymer_div.style.marginLeft = "62px";
    polymer_div.style.marginBottom = "10px";
    return polymer_div;
  }
  polymer_div = document.createElement("div");
  polymer_info = document.createElement("p");
  polymer_info.textContent = "Open in Polymer";
  polymer_div.appendChild(button);
  polymer_div.appendChild(polymer_info);
  polymer_div.style.width = "100%";
  polymer_div.style.marginLeft = "62px";
  polymer_div.style.marginBottom = "10px";
  polymer_div.style.display = "flex";
  return polymer_div;
}

function modifyLegendEntry(legendElement, button) {
  info_span = document.createElement("span");
  info_span.textContent = "Open in Polymer";
  info_span.className = "detail_text";
  info_span.style.textAlign = "center";
  info_span.style.fontSize = "14px";
  info_span.style.color = "#3c3c3c";
  legendElement.appendChild(button);
  legendElement.appendChild(info_span);
}

// Processing functions

// Function processing MapView page
function processMapViewPage(listElement) {
  console.log("Processing MapView page");
  const element = listElement.childNodes;
  if (!element) {
    console.log("No elements found");
    return;
  }
  observer.observe(listElement, config);
  if (element.length <= 0) {
    return;
  }
  for (let i = 0; i < element.length; i++) {

    const childId = element[i].id
    let year = getDate(element[i])
    let scale = getScale(element[i])
    let publisher = checkPub(element[i])
    let title = getTitle(element[i])
    let authors = getAuthors(element[i])

    if (childId) {
      fetch(georef_api + '/map/maps_lookup', {

        method: 'POST',
        mode: "cors",
        headers: {
          'Content-Type': 'application/json',
          "X-Token": georef_token
        },
        body: JSON.stringify({ "map_publication_id": String(childId) })
      })
        .then(response => {
          if (!response.ok) {
            // throw new Error('Network response was not ok ' + response.statusText);
            return null
          }
          return response.json();
        })
        .then(data => {
          if (data !== null) {
            const button = makeButton()
            button.textContent = returnButtonText(data);
            button.style.backgroundColor = returnRowColor(data)

            button.addEventListener("click", function () {
              if (data.validated) {
                window.open(georefencer_url + "/projections/" + String(data.map_id));
              } else if (data.georeferenced) {
                window.open(georefencer_url + "/projections/" + String(data.map_id));
              } else {
                window.open(georefencer_url + "/points/" + String(data.map_id));
              }
            });
            if (element[i]) element[i].appendChild(button);

          } else {
            const fileInput = makeFileInput()
            let fileInputId = String(childId);
            fileInput.id = fileInputId
            if (element[i] && (element[i].querySelector('input') == null)) element[i].appendChild(fileInput);

            const button = makeButton(element)
            button.textContent = "Upload to Polymer";
            button.style.backgroundColor = "#F0F8FF"

            loading_div = makeLoadingDiv()
            element[i].appendChild(loading_div);


            button.addEventListener("click", function () {
              const fileElement = element[i].querySelector('input');
              let files = fileElement.files

              if (files.length === 0) {
                alert("Please select a file.");
                return;
              }
              const file = files[0];

              loading_div = document.getElementById('_loading');
              loading_div.style.display = "block";

              const formData = new FormData();

              formData.append("file", file);
              formData.append('map_name', "_" + String(childId))
              formData.append('organization', publisher)
              formData.append('title', title)
              formData.append('scale', scale)
              formData.append('year', year)
              formData.append("authors", authors)
              fetch(georef_api + '/map/processMap', {
                method: 'POST',
                mode: "cors",
                headers: {
                  "X-Token": georef_token
                },
                body: formData
              }).then(response => {
                if (!response.ok) {
                  throw new Error('Network response was not ok ' + response.statusText);
                }
                loading_div = document.getElementById('_loading');
                loading_div.style.display = "none";
                return response.json();
              }).then(data => {
                console.log(data)
                georeferenced = data["georeferenced"];
                id = data["map_id"];
                if (georeferenced) {
                  console.log("Opening new tab");
                  chrome.runtime.sendMessage({ action: "openNewTab", url: georefencer_url + "/projections/" + id });
                }
                else {
                  console.log("Opening new tab");
                  chrome.runtime.sendMessage({ action: "openNewTab", url: georefencer_url + "/points/" + id });
                }
              }).catch(error => {
                console.error('Error:', error);
              });
            });

            if (element[i] && (element[i].querySelector('button') == null)) element[i].appendChild(button);

          }
        })
        .catch(error => {
          console.log(error)
          console.error('There was a problem with the fetch operation:', error);
        });
    }
  }
}

// Function processing CatalogView page
function processCatalogViewPage(listElement) {

  const element = listElement.childNodes;
  if (element) {
    catalogObserver.observe(listElement, config);
    if (element.length > 0) {
      for (let i = 0; i < element.length; i++) {
        //Find the href item that has the URL that contains the ID.
        const url_ref = element[i].querySelector('.bib_item p a');
        if (url_ref == null) continue;
        //Process the ID out of the URL.
        href_string = url_ref.href.toString();
        childId = processChildIDfromURL(href_string);
        //Check polymer for the ID.
        if (childId) {
          fetch(georef_api + '/map/maps_lookup', {
            method: 'POST',
            mode: "cors",
            headers: {
              'Content-Type': 'application/json',
              "X-Token": georef_token
            },
            body: JSON.stringify({ "map_publication_id": String(childId) })
          })
            .then(response => {
              if (!response.ok) {
                // throw new Error('Network response was not ok ' + response.statusText);
                return null
              }
              return response.json();
            })
            .then(data => {
              if (data !== null) {
                const button = makeCatalogButton()
                button.style.borderColor = returnRowColor(data)

                button.addEventListener("click", function () {
                  if (data.validated) {
                    window.open(georefencer_url + "/projections/" + String(data.map_id));
                  } else if (data.georeferenced) {
                    window.open(georefencer_url + "/projections/" + String(data.map_id));
                  } else {
                    window.open(georefencer_url + "/points/" + String(data.map_id));
                  }
                });
                if (element[i]) {
                  element[i].firstChild.insertBefore(button, element[i].firstChild.firstChild);
                  element[i].firstChild.style.display = "inline-flex";
                  if (element[i].firstChild.childNodes.length > 2) {
                    element[i].firstChild.style.marginLeft = "-40px";
                    element[i].firstChild.style.width = "100px";
                  }
                }

              }
            }).catch(error => {
              console.log(error)
              console.error('There was a problem with the fetch operation:', error);
            });

        }
      }
    } else {
      console.log("Element not found.");
    }
  }
}

// Function to process the Product page
function processProductPage(productInfo, productDownload) {
  let url = getCurrentURL();
  let childId = processChildIDfromURL(url);

  // Parse general info
  let generalInfoDict = parseGeneralInfo();
  console.log("General Info:", generalInfoDict);

  if (childId) {
    fetch(georef_api + '/map/maps_lookup', {
      method: 'POST',
      mode: "cors",
      headers: {
        'Content-Type': 'application/json',
        "X-Token": georef_token
      },
      body: JSON.stringify({ "map_publication_id": String(childId) })
    })
      .then(response => {
        if (!response.ok) {
          // throw new Error('Network response was not ok ' + response.statusText);
          return null
        }
        return response.json();
      })
      .then(data => {
        if (data !== null) {
          const button = makeCatalogButton()

          button.addEventListener("click", function () {
            if (data.validated) {
              window.open(georefencer_url + "/projections/" + String(data.map_id));
            } else if (data.georeferenced) {
              window.open(georefencer_url + "/projections/" + String(data.map_id));
            } else {
              window.open(georefencer_url + "/points/" + String(data.map_id));
            }
          });
          // Insert polymer button into the product page by downloads
          polymer_div = makePolymerProductPageDiv(button);
          productDownload.appendChild(polymer_div);
        }
        else {
          const fileInput = makeFileInput()
          let fileInputId = String(childId);
          fileInput.id = fileInputId

          const button = makeButton();
          button.textContent = "Upload to Polymer";
          button.style.backgroundColor = "#F0F8FF";

          button.addEventListener("click", function () {
            button.disabled = true;
            const fileElement = fileInput;
            console.log("File element:", fileElement);
            let files = fileElement.files;

            if (files.length === 0) {
              alert("Please select a file.");
              return;
            }
            loading_div = document.getElementById('_loading');
            loading_div.style.display = "block";
            const file = files[0];

            const formData = new FormData();

            //Process scale data from string to number
            scale = Number(generalInfoDict["Map Scale"].split(":")[1].replace(/,/g, ""));

            formData.append("file", file);
            formData.append('map_name', "_" + String(childId));
            formData.append('organization', generalInfoDict['Publishing Organization']);
            formData.append('title', generalInfoDict['Title']);
            formData.append('scale', scale);
            formData.append('year', generalInfoDict['Publication Date']);
            formData.append("authors", generalInfoDict['Author(s)']);
            formData.append("north", generalInfoDict["North Latitude"]);
            formData.append("south", generalInfoDict["South Latitude"]);
            formData.append("east", generalInfoDict["East Longitude"]);
            formData.append("west", generalInfoDict["West Longitude"]);
            fetch(georef_api + '/map/processMap', {
              method: 'POST',
              mode: "cors",
              headers: {
                "X-Token": georef_token
              },
              body: formData
            }).then(response => {
              if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
              }
              button.disabled = false;
              loading_div = document.getElementById('_loading');
              loading_div.style.display = "none";
              return response.json();
            }).then(data => {
              console.log(data)
              georeferenced = data["georeferenced"];
              id = data["map_id"];
              if (georeferenced) {
                console.log("Opening new tab");
                chrome.runtime.sendMessage({ action: "openNewTab", url: georefencer_url + "/projections/" + id });
              }
              else {
                console.log("Opening new tab");
                chrome.runtime.sendMessage({ action: "openNewTab", url: georefencer_url + "/points/" + id });
              }
            }).catch(error => {
              console.error('Error:', error);
            });
          });

          polymer_div = makePolymerProductPageDiv(button, fileInput);
          productDownload.appendChild(polymer_div);
        }
      }).catch(error => {
        console.log(error)
        console.error('There was a problem with the fetch operation:', error);
      });
  }

}


// Main Function

function checkPage() {
  console.log("Checking page");
  const listElementMapView = document.getElementById("feature-listing");
  const listElementCatalogView = document.getElementById("srh_list");
  if (listElementMapView != null) {
    // On Map View page
    processMapViewPage(listElementMapView);
    clearInterval(intervalId);
    return
  }
  if (listElementCatalogView != null) {
    // On Catalog View page
    legendElement = document.getElementById("srh_online");
    if (legendElement) {
      if (legendElement.querySelector('button') == null && legendElement.childNodes.length) {
        modifyLegendEntry(legendElement, makeCatalogButton());
      }
    }
    processCatalogViewPage(listElementCatalogView);
    clearInterval(intervalId);
    return
  }

  const productInfo = document.getElementById("general_info");
  const productMap = document.getElementById("contain");
  console.log("Product Info:", productInfo);
  console.log("Product Download:", productMap);

  if ((productInfo != null) && (productMap != null)) {
    // On Product page
    processProductPage(productInfo, productMap);
    clearInterval(intervalId);
    return
  }


}

//Setup to automatically run on NGMDB page.

let intervalId;

if (window.location.toString().includes("https://ngmdb.usgs.gov/")) {
  intervalId = setInterval(checkPage, 1500);
}