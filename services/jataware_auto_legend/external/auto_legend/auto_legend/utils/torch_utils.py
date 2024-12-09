#!/usr/bin/env python3
"""
    torch_utils.py
"""

import torch
import random
import numpy as np

from torchvision.ops import box_iou
from transformers import BatchFeature
from scipy.optimize import linear_sum_assignment

def set_seeds(seed):
    _ = np.random.seed(seed)
    _ = random.seed(seed + 111)
    _ = torch.manual_seed(seed + 222)


def to_device(x, device):
    if isinstance(x, BatchFeature):
        return BatchFeature({k: to_device(v, device) for k, v in x.items()})
    elif isinstance(x, torch.Tensor):
        return x.to(device)
    elif isinstance(x, dict):
        return {k: to_device(v, device) for k, v in x.items()}
    elif isinstance(x, list):
        return [to_device(v, device) for v in x]
    elif isinstance(x, tuple):
        return tuple(to_device(v, device) for v in x)
    elif hasattr(x, 'to'):
        return x.to(device)
    else:
        return x


def compute_metrics(preds, targets, thresh=0.9):
    if len(preds) == 0 and len(targets) == 0: # if no GT boxes and no preds, call it a 1
        return {'iou'  : 1.0, 'prec50' : 1.0, 'rec50'  : 1.0, 'prec90' : 1.0, 'rec90'  : 1.0}
    
    if len(preds) == 0 and len(targets) != 0: # if GT boxes but no preds, call it a 0
        return {'iou'  : 0.0, 'prec50' : 0.0, 'rec50'  : 0.0, 'prec90' : 0.0, 'rec90'  : 0.0}
    
    if len(preds) != 0 and len(targets) == 0: # if preds but no GT boxes, call it a 0
        return {'iou'  : 0.0, 'prec50' : 0.0, 'rec50'  : 0.0, 'prec90' : 0.0, 'rec90'  : 0.0}
    
    if isinstance(preds, list):
        preds = torch.Tensor(preds)
    
    if isinstance(targets, list):
        targets = torch.Tensor(targets)
    
    # IoU matrix
    ious = box_iou(preds, targets)
    
    # Hungarian algorithm
    row_idx, col_idx = linear_sum_assignment(ious, maximize=True)
    
    out = torch.zeros_like(ious)
    out[(row_idx, col_idx)] = ious[(row_idx, col_idx)]
    
    iou    = (out.max(axis=0).values.mean() + out.max(axis=1).values.mean()) / 2
    prec50 = (out > 0.5).any(axis=1).float().mean()
    rec50  = (out > 0.5).any(axis=0).float().mean()
    prec90 = (out > 0.9).any(axis=1).float().mean()
    rec90  = (out > 0.9).any(axis=0).float().mean()
    
    return {
        'iou'    : float(iou),
        'prec50' : float(prec50),
        'rec50'  : float(rec50),
        'prec90' : float(prec90),
        'rec90'  : float(rec90),
    }
