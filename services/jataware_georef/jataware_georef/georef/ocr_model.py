# pretty sure we can just delete this file

# """
#     ocr_model.py
#     From : ngrf/corner/helpers.py
# """

import torch
from torch import nn
from torchvision import models

torch.backends.cudnn.deterministic = True


# undefined??
def _parse_str(args, *vargs):
    pass


class CornerMapperCharacter:
    def __init__(self, fnames=None):
        pass

    def encode(self, fname):
        lat = fname.split(".")[-2].split("_")[-2]
        _, lat_deg0, lat_deg1, lat_min0, lat_min1, lat_sec0, lat_sec1 = _parse_str(lat)

        lon = fname.split(".")[-2].split("_")[-1]
        lon_deg0, lon_deg1, lon_deg2, lon_min0, lon_min1, lon_sec0, lon_sec1 = _parse_str(lon)

        out = {
            "lat_deg0": lat_deg0,
            "lat_deg1": lat_deg1,
            "lat_min0": lat_min0,
            "lat_min1": lat_min1,
            "lat_sec0": lat_sec0,
            "lat_sec1": lat_sec1,
            "lon_deg0": lon_deg0,
            "lon_deg1": lon_deg1,
            "lon_deg2": lon_deg2,
            "lon_min0": lon_min0,
            "lon_min1": lon_min1,
            "lon_sec0": lon_sec0,
            "lon_sec1": lon_sec1,
        }

        # elat = plat - (int(lat) / 10_000)
        # elon = plon - (int(lon) / 10_000)

        return out

    def decode(self, x):
        return {
            "lat": (
                (x["lat_deg0"] * 10 + x["lat_deg1"] * 1)
                + (x["lat_min0"] * 10 + x["lat_min1"] * 1) / 60
                + (x["lat_sec0"] * 10 + x["lat_sec1"] * 1) / 3600
            ),
            "lon": (
                (x["lon_deg0"] * 100 + x["lon_deg1"] * 10 + x["lon_deg2"] * 1)
                + (x["lon_min0"] * 10 + x["lon_min1"] * 1) / 60
                + (x["lon_sec0"] * 10 + x["lon_sec1"] * 1) / 3600
            ),
        }


class CornerModelCharacter(nn.Module):
    def __init__(self, size_dim, crop_dim, mapper):
        super().__init__()

        self.mapper = mapper
        self.encoder = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
        self.encoder.fc = nn.Sequential()

        self.heads = nn.ModuleDict(
            {
                "lat_deg0": nn.Linear(512, 10),
                "lat_deg1": nn.Linear(512, 10),
                "lat_min0": nn.Linear(512, 10),
                "lat_min1": nn.Linear(512, 10),
                "lat_sec0": nn.Linear(512, 10),
                "lat_sec1": nn.Linear(512, 10),
                "lon_deg0": nn.Linear(512, 10),
                "lon_deg1": nn.Linear(512, 10),
                "lon_deg2": nn.Linear(512, 10),
                "lon_min0": nn.Linear(512, 10),
                "lon_min1": nn.Linear(512, 10),
                "lon_sec0": nn.Linear(512, 10),
                "lon_sec1": nn.Linear(512, 10),
                "corner_r": nn.Linear(512, crop_dim),
                "corner_c": nn.Linear(512, crop_dim),
            }
        )

        self.size_dim = size_dim
        self.crop_dim = crop_dim

    def forward(self, x):
        enc = self.encoder(x)
        logits = {head_name: head(enc) for head_name, head in self.heads.items()}
        logits["_enc"] = enc
        return logits

    def predict(self, x):
        with torch.no_grad():
            bs, _, h, w = x.shape
            assert bs == 1

            logits = self.forward(x)
            pred = {k: int(logits[k].argmax()) for k in logits.keys() if ("lat_" in k) or ("lon_" in k)}
            pred = self.mapper.decode(pred)

            # !! Depends on the data augmentation ... ideally could invert that
            pred["r"] = float(logits["corner_r"].softmax(dim=-1)[0] @ torch.arange(h).float())
            pred["c"] = float(logits["corner_c"].softmax(dim=-1)[0] @ torch.arange(w).float())

            # Return embedding
            pred["_enc"] = logits["_enc"]

            return pred
