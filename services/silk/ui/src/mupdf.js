import * as mupdf from "mupdf"

const fitz = {};


fitz["open"] = async function openFile(file) {
  let pdf = mupdf.Document.openDocument(await file.arrayBuffer(), file.name)
  return pdf;
}

fitz["destroy"] = async function destroy(pdf) {
  pdf.destroy();
}

fitz["getTitle"] = async function getTitle(pdf) {
  return pdf.getMetaData(mupdf.Document.META_INFO_TITLE);
}

fitz["getPageCount"] = async function getPageCount(pdf) {
  return pdf.countPages()
}

fitz["getPageText"] = async function getPageText(pdf, page_number) {
  let page = pdf.loadPage(page_number)
  let text = page.toStructuredText().asJSON()
  return JSON.parse(text)
}

fitz["drawPageAsPixmap"] = async function(pdf, page_number, dpi) {
  const doc_to_screen = mupdf.Matrix.scale(dpi / 72, dpi / 72)
  let page = pdf.loadPage(page_number)
  let bbox = mupdf.Rect.transform(page.getBounds(), doc_to_screen)

  let pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true)
  pixmap.clear(255)

  let device = new mupdf.DrawDevice(doc_to_screen, pixmap)
  page.run(device, mupdf.Matrix.identity)
  device.close()

  let imageData = new ImageData(pixmap.getPixels().slice(), pixmap.getWidth(), pixmap.getHeight())
  pixmap.destroy()

  return imageData
}

fitz["resize"] = async function(imgData, maxHeight) {
  let scale = maxHeight / imgData.height;
  if (scale > 1) { scale = 1; }
  let bmp = await createImageBitmap(imgData, {resizeWidth: imgData.width * scale, resizeHeight: imgData.height * scale});
  return bmp;
}

window.render = async function(maxHeight) {
  const el = document.getElementById("dropzone-file");
  const c1 = document.getElementById("p1");
  const c2 = document.getElementById("p2");
  const txt = document.getElementById("p1text");

  const title = document.getElementsByName("title")[0];

  const file = el.files[0];
  let pdf = await fitz.open(file);
  title.value = await fitz.getTitle(pdf)

  let p0 = await fitz.drawPageAsPixmap(pdf, 0, 72);
  let p1 = await fitz.drawPageAsPixmap(pdf, 1, 72);

  let img1 = await fitz.resize(p0, maxHeight);
  const ctx1 = c1.getContext("2d");
  c1.width = img1.width;
  c1.height = img1.height;

  ctx1.drawImage(img1, 0, 0);

  let img2 = await fitz.resize(p1, maxHeight);
  const ctx2 = c2.getContext("2d");
  c2.width = img2.width;
  c2.height = img2.height;

  ctx2.drawImage(img2, 0, 0);


  let { blocks } = await fitz.getPageText(pdf, 0);

  let s = blocks.filter( b => b.type == "text" ).map(
    b => b.lines.flatMap(
      l => l.text)).reduce(
        (a,l) => a + l + "\n", "")

  txt.innerHTML = s;

  fitz.destroy(pdf);

}

window.fitz = fitz;


/*
  var el = document.getElementById("dropzone-file")
  var pdf = await window.fitz.open(el.files[0]);
  var c = document.createElement("canvas")
let p1 = await fitz.drawPageAsPixmap(pdf, 1, 72)




let img =
  const ctx = c.getContext( "2d" );
  c.width = img.width;
  c.height = img.height;

  const imageData = new ImageData(); // This example assumes that you already have ImageData object

        // 1. Render ImageData inside <canvas>
        const canvas = document.createElement( "canvas" );
        canvas.width = imageData.width;
        canvas.height = imageData.height;

        const ctx = canvas.getContext( "2d" );
        ctx.putImageData( imageData, 0, 0 );

        // 2. Extract data from <canvas> to <img>
        const image = document.querySelector( "img" );
        image.src = canvas.toDataURL();




*/
