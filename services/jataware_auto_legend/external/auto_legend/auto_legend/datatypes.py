import numpy as np
from math import floor, ceil
from dataclasses import dataclass

@dataclass
class BBox:
    l: int
    t: int
    r: int
    b: int
    
    def __init__(self, l, t, r, b):
        assert l < r
        assert t < b
        
        self.l = int(floor(l))
        self.t = int(floor(t))
        self.r = int(ceil(r))
        self.b = int(ceil(b))
    
    def __str__(self):
        return f'BBox[{self.l:05d}_{self.t:05d}_{self.r:05d}_{self.b:05d}]'
    
    @property
    def width(self):
        return self.r - self.l
    
    @property
    def height(self):
        return self.b - self.t
    
    @property
    def area(self):
        return self.width * self.height
    
    @property
    def center(self):
        return [(self.l + self.r) / 2, (self.t + self.b) / 2]
    
    @classmethod
    def from_poly(cls, polygon):
        l = min(point[0] for point in polygon)
        t = min(point[1] for point in polygon)
        r = max(point[0] for point in polygon)
        b = max(point[1] for point in polygon)
        return cls(l, t, r, b)
    
    @classmethod
    def from_xywh(cls, x, y, w, h):
        return cls(x, y, x+w, y+h)
    
    @property
    def xyxy(self):
        return [self.l, self.t, self.r, self.b]
    
    @property
    def xywh(self):
        return [self.l, self.t, self.width, self.height]
    
    @classmethod
    def merge(cls, bboxes):
        l = min([bb.l for bb in bboxes])
        t = min([bb.t for bb in bboxes])
        r = max([bb.r for bb in bboxes])
        b = max([bb.b for bb in bboxes])
        return cls(l, t, r, b)
    
    def expand(self, pix_buffer=0, pct_buffer=0):
        if pix_buffer:
            l = self.l - pix_buffer
            t = self.t - pix_buffer
            r = self.r + pix_buffer
            b = self.b + pix_buffer
        
        if pct_buffer:
            width  = r - l
            height = b - t
            
            l = self.l - width  * pct_buffer
            t = self.t - height * pct_buffer
            r = self.r + width  * pct_buffer
            b = self.b + height * pct_buffer
        
        return BBox(l, t, r, b)
    
    def pad(self, pad):
        """ transformation if padding is added to image """
        return BBox(self.l + pad, self.t + pad, self.r + pad, self.b + pad)
    
    def unpad(self, unpad):
        """ transformation if padding is removed from image """
        return BBox(self.l - unpad, self.t - unpad, self.r - unpad, self.b - unpad)
    
    def flip_y(self, img_height):
        return BBox(self.l, img_height - self.b, self.r, img_height - self.t)
    
    def relative_to(self, max_bbox):
        return BBox(self.l - max_bbox.l, self.t - max_bbox.t, self.r - max_bbox.l, self.b - max_bbox.t)
    
    def iou(self, other):
        """ Intersection over Union """
        x1 = max(self.l, other.l)
        y1 = max(self.t, other.t)
        x2 = min(self.r, other.r)
        y2 = min(self.b, other.b)
        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        union = self.area + other.area - intersection
        return intersection / union

# --

@dataclass
class BBoxPred:
    bbox: BBox
    score: float
    label: int
    label_name: str
    
    @classmethod
    def from_detr(cls, pred, cat2field):
        bbox_preds = []
        for score, label, box in zip(pred['scores'], pred['labels'], pred['boxes']):
            bbox_pred = cls(bbox=BBox(*box.tolist()), score=float(score), label=int(label), label_name=cat2field[int(label)])
            bbox_preds.append(bbox_pred)
        
        return bbox_preds
