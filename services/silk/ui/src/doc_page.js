import './alpine.js';

import ImageLayer from 'ol/layer/Image.js';
import Map from 'ol/Map.js';
import Projection from 'ol/proj/Projection.js';
import Static from 'ol/source/ImageStatic.js';

import View from 'ol/View.js';
import { getCenter, getTopLeft, getBottomRight } from 'ol/extent.js';
import Draw, {
  createBox
} from 'ol/interaction/Draw.js';

import {
  defaults as defaultInteractions
} from 'ol/interaction.js';

import { defaults as defaultControls } from 'ol/control.js';

import { Vector as VectorSource } from 'ol/source.js';
import { Vector as VectorLayer } from 'ol/layer.js';

// import { Fill, Style } from 'ol/style.js';
// const style = new Style({
//   fill: new Fill({
//     color: '#eeeeee'
//   })
// });

// // GEOTiff
// import GeoTIFF from 'ol/source/GeoTIFF.js';
// const map_source = new GeoTIFF({
//   sources: [
//     {
//       url: "https://s3.amazonaws.com/common.polymer.rocks/tiles/GEO_0001/GEO_0001.cog.tif",
//       nodata: 0,
//     }
//   ],
//   convertToRGB: true,
//   interpolate: false,
// });

// I think we can calculate the extent from an image page after the image has loaded on the page
// if we keep this script after the image tag it _should_ be loaded?
// this is all race condition questionable

const map = new Map({
  target: 'map',
  interactions: defaultInteractions({
    doubleClickZoom: false,
    dragAndDrop: false,
    dragPan: true,
    keyboardPan: false,
    keyboardZoom: false,
    mouseWheelZoom: true,
    pointer: false,
    select: false
  }),
  controls: defaultControls({
    attribution: false,
    zoom: true
  })
});
// const layers = [];
let source = null;
let vector = null;
let draw = null;
let staticImage = null;

function clearDrawings () {
  vector.getSource().clear();
}

function addDrawInteraction (imgH, imgW, scale, rotation, cb) {
  console.log(arguments);
  console.log('selecting');
  const geometryFunction = createBox();

  draw = new Draw({
    source,
    type: 'Circle',
    geometryFunction
  });

  draw.on('drawend', function (event) {
    map.removeInteraction(draw);
    const f = event.feature;
    // let features = vector.getSource().getFeatures();
    // features = features.concat(f);
    const coords = f.getGeometry().getCoordinates();
    console.log(coords);
    // let {height: imgH, width: imgW } = staticImage.image.getImage();
    // const imgBoundW = imgW * scale;
    const imgBoundH = imgH * scale;

    const pixelCoords = coords[0].map((p) => map.getPixelFromCoordinate(p));
    const xs = pixelCoords.map(x => x[0]);
    const ys = pixelCoords.map(y => y[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // const pixelExtent = [minX, minY, maxX, maxY];
    let w = Math.abs(minX - maxX);
    let h = Math.abs(minY - maxY);
    let ext = f.getGeometry().getExtent();


    // Rotation
    //const xy = getCenter(ext);
    //const geo = f.getGeometry();
    //console.log('rotation', rotation);
    //geo.rotate(rotation * (Math.PI / 180), xy);
    //console.log('ext', ext);
    //ext = geo.getExtent();
    //console.log('rotated', ext);

    let [x0, y0] = getTopLeft(ext);
    y0 = imgBoundH - y0;
    // y0 = Math.max(0, y0)
    // x0 = Math.max(0, x0)
    // x0 = Math.max(0, x0)
    // x0 = Math.min(imgBoundW, x0)
    // y0 = Math.min(imgBoundH, y0)

    let [x1, y1] = getBottomRight(ext);
    y1 = imgBoundH - y1;

    // x1 = Math.max(0, x1)
    // y1 = Math.max(0, y1)
    // x1 = Math.min(imgBoundW, x1)
    // y1 = Math.min(imgBoundH, y1)
    w = x1 - x0;
    h = y1 - y0;

    // const mapCanvas = document.createElement('canvas');
    // const size = map.getSize();
    // mapCanvas.width = w
    // mapCanvas.height = h

    // let srcImage = document.getElementById("src-image");
    // const mapContext = mapCanvas.getContext('2d');
    // console.log(x0, y0, w, h)
    // mapContext.drawImage(staticImage.image.getImage(), x0, y0, w, h, 0, 0, w, h);
    // const ximg = document.getElementById("x-image");
    // ximg.src = mapCanvas.toDataURL();

    // let selection = {
    //   dataUrl: mapCanvas.toDataURL(),
    //   x: x0,
    //   y: y0,
    //   w,
    //   h,
    // }
    // const link = document.getElementById('image-download');
    // link.href = mapCanvas.toDataURL();
    // link.click();

    console.log('xyxy4:', x0 / 4, y0 / 4, (x0 + w) / 4, (y0 + h) / 4);
    const sel = {
      x0: x0 / scale,
      y0: y0 / scale,
      x1: (x0 + w) / scale,
      y1: (y0 + h) / scale
    };
    cb(sel);
  });
  map.addInteraction(draw);
};

async function renderMap (imgUrl, imgH, imgW, scale, cb) {
  console.log(arguments);
  // const imgSrc = document.getElementById("src-image");
  // const {height: srcImageH, width: srcImageW} =imgSrc;
  const ih = imgH; const iw = imgW;

  const extent = [0, 0, iw * scale, ih * scale];

  const projection = new Projection({
    code: 'static-image',
    units: 'pixels',
    extent
  });

  source = new VectorSource({ wrapX: false });
  vector = new VectorLayer({
    source
  });

  staticImage = new Static({
    url: imgUrl,
    projection,
    imageExtent: extent
  });

  map.getLayers().forEach((l) => { map.removeLayer(l); });
  map.addLayer(
    new ImageLayer({
      source: staticImage
    })
  );
  map.addLayer(vector);
  map.setView(new View({
    projection,
    center: getCenter(extent),
    zoom: 1,
    maxZoom: 8
  }));

  console.log('render complete');
  cb();
  // const map = new Map({
  //   layers: [
  //     vector,
  //   ],
  //   target: 'map',
  //   view: new View({
  //     projection: projection,
  //     center: getCenter(extent),
  //     zoom: 2,
  //     maxZoom: 8,
  //   }),
  // });

  // map.once('rendercomplete', () => {
  //   let geometryFunction = createBox();
  //   let draw = new Draw({
  //     source: source,
  //     type: "Circle",
  //     geometryFunction: geometryFunction,
  //   });

  //   draw.on('drawend', function (event) {
  //     map.removeInteraction(draw);
  //     var feature = event.feature;
  //     var features = vector.getSource().getFeatures();
  //     features = features.concat(feature);
  //     features.forEach((f) => {
  //       let coords = f.getGeometry().getCoordinates();
  //       let {height: imgH, width: imgW } = staticImage.image.getImage();

  //       let pixelCoords = coords[0].map((p) => map.getPixelFromCoordinate(p)),
  //           xs = pixelCoords.map(x => x[0]),
  //           ys = pixelCoords.map(y => y[1]),
  //           minX = Math.min(...xs),
  //           maxX = Math.max(...xs),
  //           minY = Math.min(...ys),
  //           maxY = Math.max(...ys),
  //           pixelExtent = [minX, minY, maxX, maxY],
  //           w = Math.abs(minX - maxX),
  //           h = Math.abs(minY - maxY);
  //       let ext = f.getGeometry().getExtent();
  //       let [x0, y0] = getTopLeft(ext)
  //       y0 = 3168 - y0
  //       x0 = Math.max(0, x0)
  //       x0 = Math.max(0, x0)
  //       x0 = Math.min(imgW, x0)
  //       y0 = Math.min(imgH, y0)

  //       let [x1, y1] = getBottomRight(ext)
  //       y1 = 3168 - y1

  //       x1 = Math.max(0, x1)
  //       y1 = Math.max(0, y1)
  //       x1 = Math.min(imgW, x1)
  //       y1 = Math.min(imgH, y1)
  //       w = x1 - x0
  //       h = y1 - y0

  //       const mapCanvas = document.createElement('canvas');
  //       const size = map.getSize();
  //       mapCanvas.width = w
  //       mapCanvas.height = h

  //       // let layer = map.getViewport().querySelectorAll('.ol-layer canvas, canvas.ol-layer')[0];
  //       // console.log(layer);

  //       let srcImage = document.getElementById("src-image");

  //       // CanvasRenderingContext2D.prototype.setTransform.apply(
  //       //    mapContext,
  //       //    [
  //       //      parseFloat(layer.style.width) / layer.width,
  //       //      0,
  //       //      0,
  //       //      parseFloat(layer.style.height) / layer.height,
  //       //      0,
  //       //      0,
  //       //    ]
  //       // );
  //       const mapContext = mapCanvas.getContext('2d');
  //       console.log(x0, y0, w, h)
  //       //document.getElementById("coords").innerText = `x: ${x0}, y: ${y0}, w: ${w}, h: ${h}`
  //       mapContext.drawImage(staticImage.image.getImage(), x0, y0, w, h, 0, 0, w, h);
  //       //mapContext.drawImage(layer, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  //       const ximg = document.getElementById("x-image");
  //       ximg.src = mapCanvas.toDataURL();
  //       // const link = document.getElementById('image-download');
  //       // link.href = mapCanvas.toDataURL();
  //       // link.click();
  //     });

  //   });

  //   map.addInteraction(draw);
  // })
}

function dispatchEvent (selector, name, msg) {
  const el = document.querySelector(selector);
  if (el) {
    el.dispatchEvent(
      new CustomEvent(name, { detail: { text: msg }, bubbles: true })
    );
    console.log('event triggered', selector, name);
  } else {
    console.log('WARNING: no element found for selector - ', selector);
  }
}

window.OL = {
  renderMap,
  addDrawInteraction,
  clearDrawings,
  dispatchEvent
};
