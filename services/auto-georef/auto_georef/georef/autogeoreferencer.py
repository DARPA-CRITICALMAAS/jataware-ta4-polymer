import os

import albumentations as A
import joblib
import numpy as np
import torch
from albumentations.pytorch.transforms import ToTensorV2
from PIL import Image
from skimage.measure import label

from .helpers import to_numpy
from .ocr_model import CornerMapperCharacter, CornerModelCharacter
from .segment_model import NGMSegmentationModel

# """
#     main.py

#         - seg_model_path is from './output/segment/seg_model-4.pt',
#         - ocr_model_path is from './output/corners/corner_model-char-31.pt',

#     See `https://github.com/jataware/neural-georef/tree/202308` for more detailed code on model building, etc.
# """


Image.MAX_IMAGE_PIXELS = None
torch.backends.cudnn.deterministic = True

SEG_INFER_DIM = 1024
OCR_ORIG_DIM = 512
OCR_SIZE_DIM = 256
OCR_CROP_DIM = 224


class AutoGeoreferencer:
    def __init__(
        self,
        seg_model_name="seg_model.pt",
        ocr_model_name="ocr_model.pt",
        prune_model_name="prune_model.pkl",
        model_root="./auto_georef/models",
        device="cpu",
    ):
        self.device = device

        # --
        # Load segmentation model

        self.seg_tfm = A.Compose([ToTensorV2()])
        self.seg_model = NGMSegmentationModel("FPN", "resnet34", in_channels=3, classes=2)
        _ = self.seg_model.load_state_dict(
            torch.load(os.path.join(model_root, seg_model_name), map_location=torch.device("cpu"))
        )
        _ = self.seg_model.to(device)
        _ = self.seg_model.eval()

        # --
        # Load OCR model

        self.ocr_tfm = A.Compose(
            [
                A.Resize(OCR_SIZE_DIM, OCR_SIZE_DIM),
                A.CenterCrop(OCR_CROP_DIM, OCR_CROP_DIM),
                A.Normalize(),
                ToTensorV2(),
            ],
            keypoint_params=A.KeypointParams(format="xy"),
        )
        self.ocr_model = CornerModelCharacter(
            size_dim=OCR_SIZE_DIM, crop_dim=OCR_CROP_DIM, mapper=CornerMapperCharacter()
        )
        _ = self.ocr_model.load_state_dict(
            torch.load(os.path.join(model_root, ocr_model_name), map_location=torch.device("cpu"))
        )
        _ = self.ocr_model.to(device)
        _ = self.ocr_model.eval()

        # --
        # Load `prune` model

        self.prune_model = joblib.load(os.path.join(model_root, prune_model_name))

    @torch.no_grad()
    def _get_map_mask(self, img):
        """
        Replaces: ngrf.segment.infer
        """

        _img = img.resize((SEG_INFER_DIM, SEG_INFER_DIM), Image.BILINEAR)
        _img = np.array(_img)
        _img = self.seg_tfm(image=_img)["image"]
        _img = _img.to(self.device)

        logits_mask = self.seg_model.forward(_img[None])
        logits_cmask = logits_mask[:, [1]]
        prob_cmask = logits_cmask.sigmoid()
        prob_cmask = to_numpy(prob_cmask)
        prob_cmask = prob_cmask.squeeze()

        return prob_cmask

    def _get_corners(self, img, prob_cmask, thresh=0.5, crop_dim=512):
        """
        Replaces: ngrf.segment.crop
        """
        ncol, nrow = img.size
        labs = label(prob_cmask > thresh)

        out = []
        for lab in np.unique(labs):
            if lab == 0:
                continue
            if (labs == lab).sum() < 100:
                continue

            r, c = np.where(labs == lab)
            r, c = r.mean(), c.mean()
            r = int((r / 1024) * nrow)
            c = int((c / 1024) * ncol)

            left = c - crop_dim // 2
            right = c + crop_dim // 2
            upper = r - crop_dim // 2
            lower = r + crop_dim // 2

            crop = img.crop((left, upper, right, lower))
            out.append({"crop": crop, "lab": lab, "r": r, "c": c})

        return out

    @torch.no_grad()
    def _infer_char(self, crops):
        """
        Replaces: ngrf.corner.infer_char

        TODO:
            - Could batch this, I think?
        """

        out = []
        for crop in crops:
            _img = np.array(crop["crop"])

            h, w, _ = _img.shape
            assert h == OCR_ORIG_DIM
            assert w == OCR_ORIG_DIM

            _img = self.ocr_tfm(image=_img, keypoints=[[0, 0]])["image"]
            _img = _img.to(self.device)
            pred = self.ocr_model.predict(_img[None])

            pred["r"] = pred["r"] + (OCR_SIZE_DIM - OCR_CROP_DIM) // 2  # undo scale + crop
            pred["r"] = pred["r"] * (OCR_ORIG_DIM / OCR_SIZE_DIM)  # scale back to input space

            pred["c"] = pred["c"] + (OCR_SIZE_DIM - OCR_CROP_DIM) // 2  # undo scale + crop
            pred["c"] = pred["c"] * (OCR_ORIG_DIM / OCR_SIZE_DIM)  # scale back to input space

            out.append(
                {
                    "crop_r": crop["r"],
                    "crop_c": crop["c"],
                    "x": -1 * pred["lon"],  # BUG/TODO: Only works for Western Hemisphere
                    "y": 1 * pred["lat"],  # BUG/TODO: Only works for Northern Hemisphere
                    "row": pred["r"] + crop["r"] - h // 2,
                    "col": pred["c"] + crop["c"] - w // 2,
                    "enc": to_numpy(pred["_enc"]),
                    "crs": "EPSG:4267",  # BUG/TODO: When in doubt ... just guess NAD27
                }
            )

        return out

    def _prune_ctrl_pts(self, cps):
        """
        Replaces: ngrf.corner.model_prune
        """
        encs = np.row_stack([p["enc"] for p in cps])
        encs = encs / np.sqrt((encs**2).sum(axis=-1, keepdims=True))
        keep = self.prune_model.predict(encs)
        return [p for i, p in enumerate(cps) if keep[i]]

    def extract_control_points(self, img):
        prob_cmask = self._get_map_mask(img)
        crops = self._get_corners(img, prob_cmask)
        cps = self._infer_char(crops)
        if len(cps)<1:
            return []
        cps = self._prune_ctrl_pts(cps)

        # >>
        for cp in cps:
            del cp["enc"]
        # <<
        return cps

    def compute_projection(self, img, cps):
        # !! See routes/map.py ... but that functionality should be moved here
        raise NotImplementedError
