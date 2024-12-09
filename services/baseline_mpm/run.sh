# --
# Start server

source .secrets
poetry run python baseline_mpm/server.py

# --
# In another shell ... 

source .secrets

# launch model
MODEL_RUN_ID=$(curl -X 'POST' \
  'https://api.cdr.land/v1/prospectivity/prospectivity_model_run' \
  -H 'accept: application/json' -H "Authorization: Bearer $CDR_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d @payloads/new.json | jq .model_run_id)

# look at model run result
curl -X 'GET' \
  "https://api.cdr.land/v1/prospectivity/model_run?model_run_id=${MODEL_RUN_ID}" \
  -H 'accept: application/json' -H "Authorization: Bearer $CDR_API_TOKEN" | jq .

# get url of likelihood output layer
LIKELIHOOD_URL=$(curl -X 'GET' \
  "https://api.cdr.land/v1/prospectivity/prospectivity_output_layers?model_run_id=${MODEL_RUN_ID}" \
  -H 'accept: application/json' -H "Authorization: Bearer $CDR_API_TOKEN" | jq '.[] | select(.output_type=="likelihood") | .download_url')

# download likelihood output layer
wget $LIKELIHOOD_URL -O likelihood.tif

# false color plot
python scripts/false_color.py likelihood.tif
