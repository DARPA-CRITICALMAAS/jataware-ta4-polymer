import './htmx.js';
import './alpine.js';
import { filesize } from 'filesize';

htmx.on('#form', 'htmx:xhr:progress', function (evt) {
  // htmx.find('#progress').setAttribute('value', evt.detail.loaded / evt.detail.total * 100)
  const pbar = htmx.find('#pbar');
  const p = (evt.detail.loaded / evt.detail.total) * 100;
  pbar.innerHTML = p + '%';
  pbar.style.width = p + '%';
});

document.body.addEventListener('htmx:responseError', function (e) {
  const error = e.detail.xhr.response;
  console.log(error);
  alert(error);
});

window.filesize = filesize;
