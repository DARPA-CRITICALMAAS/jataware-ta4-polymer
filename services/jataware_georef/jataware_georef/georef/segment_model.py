# """
#     segment_model.py
#     From: ngrf/segment/helpers.py
# """

import segmentation_models_pytorch as smp
import torch
from PIL import Image
from torch import nn

Image.MAX_IMAGE_PIXELS = None
torch.backends.cudnn.deterministic = True


class NGMSegmentationModel(nn.Module):
    def __init__(self, arch, encoder_name, in_channels, classes, **kwargs):
        super().__init__()

        self.model = smp.create_model(
            arch, encoder_name=encoder_name, in_channels=in_channels, classes=classes, **kwargs
        )

        params = smp.encoders.get_preprocessing_params(encoder_name)
        self.register_buffer("std", torch.tensor(params["std"]).view(1, 3, 1, 1))
        self.register_buffer("mean", torch.tensor(params["mean"]).view(1, 3, 1, 1))

    def forward(self, x):
        x = (x - self.mean) / self.std
        x = self.model(x)
        return x
