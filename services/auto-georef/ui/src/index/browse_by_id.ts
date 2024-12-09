// -----  GO to cog page(s) input widget on center-top of page ------
import { displayElemTemporarily } from "../common";

enum BrowseMode {
  Map = "map",
  Product = "product",
}

const IDBrowseSection = document.getElementById("cog-id-browse");
const goLink = IDBrowseSection.querySelector("button");
const input = IDBrowseSection.querySelector("input");
const select = IDBrowseSection.querySelector("select");
const searchByCogMenu = document.getElementById("search-by-cog-id-menu");

let mode = BrowseMode.Map;

function first(li) {
  return li[0];
}

function last(li) {
  return li[li.length - 1];
}

const toast = document.getElementById("error-toast");

function navToIDPage(ID) {
  if (mode == BrowseMode.Map) {
    window.open(`/points/${ID}`, "_blank");
  } else {
    fetch(`${window.map_by_ngmdb_id}/${ID}`)
      .then((r) => r.json())
      .then((data) => {

        if (data.detail) {
          throw new Error(data.detail.split("For more information")[0]);
        }

        const { images } = data.holdings;

        if (!images || !images.length) {
          throw new Error("No images associated for that product ID.");
        }

        const cog_ids = images
          .map(image => {
            const url = image.cog_url;
            const filename = last(url.split("/"));
            return first(filename.split("."));
          });

        cog_ids.forEach(cog_id => {
          window.open(`/points/${cog_id}`, "_blank");
        });

        return data;
      })
      .catch(e => {
        console.log("e", e);
        toast.querySelector("span").innerText = e.message;
        displayElemTemporarily(toast);
      });
  }
}

goLink.addEventListener("click", (e) => {
  navToIDPage(input.value);
});

input.addEventListener("keyup", (e) => {
  if (e.target.value) {
    goLink.classList.remove("pointer-events-none");
    searchByCogMenu.classList.remove("pointer-events-none");
  } else {
    goLink.classList.add("pointer-events-none");
    searchByCogMenu.classList.add("pointer-events-none");
  }

  if (e.key === "Enter") {
    const { value } = e.target;
    navToIDPage(value);
  }
});

searchByCogMenu.querySelector("button").addEventListener("click", () => {
  document.getElementById("browse-results").classList.remove("hidden");
  document.getElementById("maps-results-count").classList.add("hidden");
});

select.addEventListener("change", e => {
  mode = e.target.value;
  const input = IDBrowseSection.querySelector("label > input");
  const modeText = mode === BrowseMode.Map ? "Map" : "NGMDB Product";
  input.placeholder = `Enter ${modeText} ID`;

  searchByCogMenu.classList.toggle("hidden");
});

