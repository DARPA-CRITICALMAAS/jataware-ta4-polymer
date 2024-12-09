import os
from time import time
from auto_legend.modeling.abbr_detr_predict import AbbrModel

t = time()
_ = AbbrModel(
    model_path = os.path.expanduser("~/.cache/auto_legend/column_abbr_002_custom_detr_detector_model_0095.pth"),
    device     = 'cpu',
)
print(f'AbbrModel loaded. {time() - t:.2f}s')