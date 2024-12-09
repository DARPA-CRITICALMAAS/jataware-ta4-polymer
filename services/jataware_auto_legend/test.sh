#!/bin/bash

# test.sh

cp .env-sample .env
# set anthropic token ; set cdr token

conda create -y -n al_env python=3.10
conda activate al_env
pip install poetry
poetry install

uvicorn jataware_auto_legend.http.api:api --host 0.0.0.0 --port 3003 --log-config logging.yaml --workers 1 --reload
# Might take a while to start up...

# --
# Test standard endpoint

curl -X POST "http://0.0.0.0:3003/legend/auto_legend" \
  -H "Content-Type: application/json" \
  -d "$(cat payloads/test.json)"

# --
# Test streaming endpoint

curl --no-buffer -X POST "http://0.0.0.0:3003/legend/auto_legend/stream" \
  -H "Content-Type: application/json" \
  -d "$(cat payloads/test.json)" \
  --output -