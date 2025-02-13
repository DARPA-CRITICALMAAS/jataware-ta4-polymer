#!/usr/bin/env python3
"""
    baseline.py
    
    Baseline RandomForestClassifier model for CMAAS
"""

import json
import logging
from logging import Logger
from pathlib import Path

import httpx
import zipfile
import numpy as np
import rasterio as rio
from sklearn.metrics import roc_auc_score
from sklearn.ensemble import RandomForestClassifier
from tqdm import tqdm
from pydantic import BaseModel
from typing import List
from baseline_mpm.settings import app_settings

logger: Logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.ERROR)

from cdr_schemas.prospectivity_input import ProspectivityOutputLayer

class Metric(BaseModel):
    name: str
    value: float
    description: str

class ModelRunMetrics(BaseModel):
    train: List[Metric]
    valid: List[Metric]
    test: List[Metric]

class BaselineModel:
    SYSTEM_NAME = app_settings.system_name
    SYSTEM_VERSION =  app_settings.system_version
    ML_MODEL_NAME = app_settings.ml_model_name
    ML_MODEL_VERSION = app_settings.ml_model_version
    LOCAL_CACHE = False
    DEV_CACHE = False

    def __init__(self, payload, cdr_host, cdr_token, file_logger, root="./data"):

        self.client = httpx.Client(follow_redirects=True, headers={"Authorization": f"{cdr_token}"})

        self.cdr_host = cdr_host
        self.model_run_id = payload.model_run_id
        self.cma = payload.cma
        self.evidence_layers = payload.evidence_layers
        self.cma_id = self.cma.cma_id
        self.train_config = payload.train_config
        self.file_logger = file_logger
        print(f"BaselineModel: {self.model_run_id} {self.cma_id} {self.train_config}")
        logger.info(f"BaselineModel: {self.model_run_id} {self.cma_id} {self.train_config}")

        # Filesystem
        self.inpdir = Path(root) / self.model_run_id / "inp"
        self.outdir = Path(root) / self.model_run_id / "out"

        self.inpdir.mkdir(parents=True, exist_ok=True)
        self.outdir.mkdir(parents=True, exist_ok=True)

        if self.DEV_CACHE:
            import pickle

            pickle.dump(self.cma, open("cma.pkl", "wb"))
            pickle.dump(self.evidence_layers, open("evidence_layers.pkl", "wb"))

    def get_targets(self) -> np.ndarray:
        """Get the target labels for the CMA"""

        # find single layer where label_raster == True
        target_layers = [layer for layer in self.evidence_layers if layer.label_raster]
        assert len(target_layers) == 1
        target_layer = target_layers[0]

        # read the target labels (over the network)
        with rio.open(target_layer.download_url.replace(" ", "%20")) as src:
            self._y = src.read(1)

            if np.nansum(self._y) == 0:
                raise Exception("!! No positive training locations found")

            self._meta = src.meta
            return self._y, self._meta

    def get_inputs(self):
        """Get the input layers for the CMA"""
        logger.info("getting inputs")
        X = []
        for layer in self.evidence_layers:
            # skip label layers
            if layer.label_raster:
                continue

            logger.info(f"BaselineModel.get_inputs: {layer.download_url}")

            # read the input layer
            with rio.open(layer.download_url) as src:
                tmp = src.read(1)  # [TODO] are these always single-band tifs?
                X.append(tmp)

        self._X = np.stack(X)

        # np.save('_X.npy', self._X)

        return self._X

    def fit_predict(self, X, y):
        """Fit the model and predict"""

        logger.info("BaselineModel: fit")
        n_unlabeled = self.train_config.n_unlabeled
        n_estimators = self.train_config.n_estimators

        params = dict(n_estimators=n_estimators, verbose=1, n_jobs=-1, oob_score=True)

        # --
        # drop locations where all inputs are NaN + flatten

        drop = np.isnan(X).all(axis=0)
        X_flat = X.transpose(1, 2, 0)[~drop]
        y_flat = y[~drop]

        # --
        # inmpute missing values

        meds = np.nanmedian(X_flat, axis=0)
        X_flat = np.where(np.isnan(X_flat), meds, X_flat)

        y_nans_cnt = np.isnan(y_flat).sum()
        if y_nans_cnt > 0:
            print(f"!! {y_nans_cnt} / {y_flat.shape[0]} NaNs in target labels - filling with 0s")
            y_flat = np.nan_to_num(y_flat, nan=0)

        # --
        # Scale + center
        # (Doesn't really matter ... but just to make numbers nicer)
        # [TODO - BUG] can cause numerical under or overflow

        X_flat = X_flat - X_flat.min(axis=0, keepdims=True)
        X_flat = X_flat / (X_flat.max(axis=0, keepdims=True) + 1e-10)

        # --
        # SUBSAMPLE FOR TRAINING

        pos_sel = np.where(y_flat == 1)[0]
        unlabeled_indices = np.where(y_flat == 0)[0]
        n_unlabeled_min = min(len(unlabeled_indices), n_unlabeled)
        logger.info(f'n_unlabled_indices {n_unlabeled_min}')
        neg_sel = np.sort(np.random.choice(unlabeled_indices, n_unlabeled_min, replace=False))

        sel = np.zeros(X_flat.shape[0]).astype(bool)
        sel[np.hstack([pos_sel, neg_sel])] = True
        logger.info(
            f"BaselineModel: fit_predict: {sel.sum()} / {sel.shape[0]} points as training data (POS={pos_sel.shape[0]} NEG={neg_sel.shape[0]})"
        )

        # --
        # FIT+PREDICT

        clf = RandomForestClassifier(**params).fit(X_flat[sel], y_flat[sel])
        preds = clf.predict_proba(X_flat)[:, 1]

        roc_auc_train = float(roc_auc_score(y_flat[sel], preds[sel]))

        # replace training data predictions w/ OOB scores
        # [Q] Is this OK?
        # [A] It's just a shortcut instead of doing proper CV ... However, the
        #     training samples are estimated w/ only (1 - 1/n)**n% of the estimators ... If performance
        #     is not plateaued at n_estimators / 3, this might look weird.
        preds[sel] = clf.oob_decision_function_[:, 1]

        roc_auc_test = float(roc_auc_score(y_flat, preds))

        # clamp positive training points to 1
        preds[pos_sel] = 1

        # likelihood
        # [TODO] How to calibrate? I don't think it's possible in the PU setting, esp.
        #        if we don't have a prevalance estimate?  We could calibrate on the
        #        training data - the interpretation would be "x% of points in [x-eps,x+eps] are
        #        positive training sites".  But I don't think that's what USGS would want.
        p_hat = np.zeros_like(X[0])
        p_hat[:] = np.nan
        p_hat[np.where(~drop)] = preds

        # uncertainty
        # [TODO] This is entropy ... but what do they actually want here?
        #        My best guess is isolation forest scores ...
        u_hat = -p_hat * np.log(p_hat + np.nanmin(p_hat[p_hat != 0]) / 10)

        self._clf = clf
        self._p_hat = p_hat
        self._u_hat = u_hat

        metrics = ModelRunMetrics(
            train = [
                Metric(name="Area under ROC", value=roc_auc_train, description="In-sample AUC for training points only"),
            ],
            valid = [],
            test  = [
                Metric(name="Area under ROC", value=roc_auc_test, description="OOB AUC for all points"),
            ]
        )
        return p_hat, u_hat, metrics

    def save_outputs(self, p_hat, u_hat, metrics, meta):
        """Save the outputs to the filesystem AND submit to CDR"""

        out_layers = [
            (p_hat, "Likelihoods", "tif"),
            (u_hat, "Uncertainty", "tif"),
            (metrics, "metrics", "zip"),
        ]
        out_layer_ids = []
        for _layer, _type, _format in tqdm(out_layers):

            out_layer = ProspectivityOutputLayer(
                **{
                    "system": self.SYSTEM_NAME,
                    "system_version": self.SYSTEM_VERSION,
                    "model": self.ML_MODEL_NAME,
                    "model_version": self.ML_MODEL_VERSION,
                    "model_run_id": self.model_run_id,
                    "cma_id": self.cma_id,
                    "output_type": _type,
                    "title": f"{_type}.{_format}",
                }
            )

            # save to
            outpath = self.outdir / f"{_type}.{_format}"
            if _format == "tif":
                with rio.open(outpath, "w", **meta) as dst:
                    dst.write(_layer, 1)

            elif _format == "zip":
                with zipfile.ZipFile(outpath, 'w') as zf:
                    zf.writestr(f'{_type}.json', _layer.model_dump_json(exclude_none=True))

            # submit to CDR
            resp = self.client.post(
                f"{self.cdr_host}/v1/prospectivity/prospectivity_output_layer",
                data={"metadata": out_layer.model_dump_json(exclude_none=True)},
                files={"input_file": (f"{_type}.{_format}", open(outpath, "rb"), "application/octet-stream")},
            )

            if resp.status_code not in [200, 204]:
                self.file_logger.error("BaselineModel.save_outputs: ERROR")
                self.file_logger.info(resp.text)
            else:
                out_layer_ids.append(resp.json()["layer_id"])

        return out_layer_ids

    @classmethod
    def run_pipeline(cls, *args, **kwargs):
        logger.info("#### Starting model run ####")
        model = cls(*args, **kwargs)

        y, meta = model.get_targets()
        # logger.info(y)
        # logger.info(meta)

        X = model.get_inputs()
        p_hat, u_hat, metrics = model.fit_predict(X, y)
        out_layer_ids = model.save_outputs(p_hat, u_hat, metrics, meta)
        print(
            json.dumps(
                {
                    "out_layer_ids": out_layer_ids,
                }
            )
        )
        logger.error(
            json.dumps(
                {
                    "out_layer_ids": out_layer_ids,
                }
            )
        )
        logger.info("#### Finished model run #####")
