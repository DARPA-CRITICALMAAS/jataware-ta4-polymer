## Baseline CDR-enabled MGM modeling

Based off of `https://github.com/DARPA-CRITICALMAAS/cdr_client_examples`

### Requirements

```
python >= 3.10
poetry
```

You also need some authentication tokens:
 - `export NGROK_AUTHTOKEN=...`
   - This sample uses ngrok (https://dashboard.ngrok.com/signup) to obtain and use a throw-away public secure webhook. If you want to try this code as is, please sign up to get an auth token. It's free!
 - `export CDR_API_TOKEN=...`
   - In order to use you must have a CDR token **_with georef_** access. Please ensure your token has this before running by asking CDR admin.

### Install

`poetry install`

### Run

See `run.sh`

#### Likelihood
![likelihood](./static/likelihood.png)

#### Uncertainty
![uncertainty](./static/uncertainty.png)

### Todo

- [ ] Support for RandomForest parameters
- [ ] Possible issue w/ numeric under-/over-flow
- [ ] Various modeling improvements (better uncertainty model, validation metric computation, ...)
- [ ] Testing
