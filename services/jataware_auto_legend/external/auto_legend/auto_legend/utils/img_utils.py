from PIL import Image, ImageDraw
from skimage import img_as_float, img_as_ubyte
from skimage.restoration import denoise_nl_means

from .bbox import BBox

def img_redact(img:Image.Image, bbox:BBox):
    img       = img.copy()
    draw      = ImageDraw.Draw(img)
    draw.rectangle(bbox.xyxy, fill=(255, 255, 255))
    return img

def denoise_image(img):
    out = img.convert('L')
    out = img_as_float(out)
    out = denoise_nl_means(out, h=0.1, fast_mode=True, patch_size=5, patch_distance=6)
    out = img_as_ubyte(out)
    return Image.fromarray(out)

