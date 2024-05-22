import "./htmx.js";
import { filesize } from "filesize";

document.body.addEventListener("htmx:responseError", function (e) {
  const error = e.detail.xhr.response;
  console.log(error);
  alert(error);
});


function toggleSearchType(){
  let which = document.querySelector("input[name=which]:checked").value;
  let searchBy = document.querySelector("input[name=search_by]:checked").value;
  let elDefault = document.querySelector("input[value='title']");


  switch(which){
  case "cdr":
    if (["term"].includes(searchBy)){
      elDefault.checked = true;
    }
    Array.from(document.getElementsByClassName("cdronly")).forEach(e => e.classList.remove("hidden"))
    Array.from(document.getElementsByClassName("pubsonly")).forEach(e => e.classList.add("hidden"))
    break;
  case "pubs":
    if (["prov", "url"].includes(searchBy)){
      elDefault.checked = true;
    }
    Array.from(document.getElementsByClassName("pubsonly")).forEach(e => e.classList.remove("hidden"))
    Array.from(document.getElementsByClassName("cdronly")).forEach(e => e.classList.add("hidden"))
    break;
  default:
    console.log(which);
    console.log(searchBy);
  }

}

const searchPage = { toggleSearchType };

window.searchPage = searchPage;
window.filesize = filesize;


