"""
    abbr_detr_predict.py
"""

import argparse
import numpy as np

import torch
import albumentations as A
from torchvision.ops import nms
from transformers import AutoImageProcessor, DeformableDetrForObjectDetection

from PIL import Image, ImageDraw, ImageFont
from typing import List, Tuple

from auto_legend.utils.torch_utils import to_device
from auto_legend.datatypes import BBox, BBoxPred

MODEL_STR = "Aryn/deformable-detr-DocLayNet"

# --
# Data

# Create sliding windows of rows
def sliding_crop(image, window_size, stride):
    h, w = image.shape[:2]
    crops, windows = [], []
    for y in range(0, h - window_size[0] + 1, stride[0]):
        for x in range(0, w - window_size[1] + 1, stride[1]):
            print('sliding_crop', y, y+window_size[0], x, x+window_size[1])
            window = image[y:y+window_size[0], x:x+window_size[1]]
            crops.append(window)
            windows.append(BBox(x, y, x + window_size[1], y + window_size[0]))
    
    return crops, windows


class AbbrModel:
    
    IMG_DIM   = 800

    FIELD2CAT = { # [BKJ] - arbitrary mapping to pretrained categories, but whatever ... should I use custom head?
        'abbr'       : 7,  # Picture
    }
        
    CAT2FIELD = {v:k for k,v in FIELD2CAT.items()}
    
    def __init__(self, model_path, device='cuda'):
        self.processor = AutoImageProcessor.from_pretrained(MODEL_STR)
        self.model     = DeformableDetrForObjectDetection.from_pretrained(MODEL_STR)
        self.model     = self.model.to(device)
        _              = self.model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
        _              = self.model.eval()
        self.device    = device
    
    def predict(self, image:Image.Image) -> Tuple[Image.Image, List[BBoxPred]]:
        image = np.array(image)
        
        scale_factor = self.IMG_DIM / image.shape[1]
        tfm = A.Compose([
            A.Resize(width=self.IMG_DIM, height=int(scale_factor * image.shape[0]), interpolation=1),
            A.PadIfNeeded(
                min_height         = None,
                min_width          = 800,
                pad_height_divisor = 800, # Might be inefficient ...
                border_mode        = 0,
                value              = 0,
                position           = "random",
            ),
            # A.SmallestMaxSize(max_size=self.IMG_DIM, interpolation=1) # This works for tall images ... not for wide images
        ], bbox_params=A.BboxParams(format='pascal_voc'))

        # Preprocess image
        _tmp       = tfm(image=image, bboxes=[[0, 0, image.shape[1], image.shape[0], -1]])
        image_tfm  = _tmp['image']
        bbox_tfm   = BBox(*_tmp['bboxes'][0][:4])
        
        crops, bboxes = sliding_crop(
            image_tfm, 
            window_size = (self.IMG_DIM, self.IMG_DIM), 
            stride      = (self.IMG_DIM // 2, self.IMG_DIM // 2)
        )
        
        for iii, crop in enumerate(crops):
            Image.fromarray(crop).save(f'crop_{iii:03d}.png')
        
        # Process the batch
        with torch.no_grad():
            batch = torch.stack([torch.from_numpy(window).permute(2, 0, 1) for window in crops])
            _inputs = self.processor(images=batch, return_tensors="pt")
            _inputs = to_device(_inputs, self.device)
            outputs = self.model(**_inputs)
            del _inputs

        # Post-process
        all_preds = self.processor.post_process_object_detection(outputs, target_sizes=torch.tensor([(self.IMG_DIM, self.IMG_DIM)] * len(batch)))
        all_preds = to_device(all_preds, 'cpu')

        # Convert to unwindowed coordinates (img_tfm)
        
        flat_preds = []
        for preds, bbox in zip(all_preds, bboxes):
            preds = BBoxPred.from_detr(preds, self.CAT2FIELD)
            for pred in preds:
                pred.bbox = BBox(
                    pred.bbox.l + bbox.l,
                    pred.bbox.t + bbox.t,
                    pred.bbox.r + bbox.l,
                    pred.bbox.b + bbox.t,
                )
                flat_preds.append(pred)
        
        if len(flat_preds) > 0:
            # non-maximum suppression
            nms_idxs = nms(
                boxes         = torch.FloatTensor([pred.bbox.xyxy for pred in flat_preds]),
                scores        = torch.FloatTensor([pred.score for pred in flat_preds]),
                iou_threshold = 0.5
            )
            flat_preds = [flat_preds[i] for i in nms_idxs]
            
            # sort by top-to-bottom
            flat_preds = sorted(flat_preds, key=lambda x: x.bbox.t)

        # Convert to original coordinates (img)
        flat_preds_orig = []
        for pred in flat_preds:
            flat_preds_orig.append(BBox(
                (pred.bbox.l - bbox_tfm.l) / scale_factor,
                (pred.bbox.t - bbox_tfm.t) / scale_factor,
                (pred.bbox.r - bbox_tfm.l) / scale_factor,
                (pred.bbox.b - bbox_tfm.t) / scale_factor,
            ))
        
        return Image.fromarray(image_tfm), flat_preds, flat_preds_orig
    
    def annotate_image(self, image:Image.Image, preds:List[BBoxPred], draw_bbox:bool=False) -> Image.Image:
        _image = image.copy()
        _draw = ImageDraw.Draw(_image)
        
        if len(preds) == 0:
            return _image.convert('RGB')
        
        avg_height = sum(pred.bbox.b - pred.bbox.t for pred in preds) / len(preds)
        for pred_idx, pred in enumerate(preds):
            bbox = pred.bbox
            
            if draw_bbox:
                _draw.rectangle([bbox.l, bbox.t, bbox.r, bbox.b], outline='red', width=2)
            
            font = ImageFont.load_default(size=int(avg_height / 1.5))
            text = f"{pred_idx:02d}"
            text_bbox = _draw.textbbox((bbox.l, bbox.t), text, font=font, anchor='mm')
            
            # Create a semi-transparent white background
            bg_img = Image.new('RGBA', _image.size, (255, 255, 255, 0))
            bg_draw = ImageDraw.Draw(bg_img)
            bg_draw.rectangle(text_bbox, fill=(255, 255, 255, 255))  # 128 is 0.5 alpha
            
            # Composite the background onto the main image
            _image = Image.alpha_composite(_image.convert('RGBA'), bg_img)
            _draw = ImageDraw.Draw(_image)
            
            # Draw the text
            _draw.text((bbox.l, bbox.t), text, fill="red", font=font, anchor='mm')

        return _image.convert('RGB')