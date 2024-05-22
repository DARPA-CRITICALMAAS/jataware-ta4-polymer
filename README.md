# Polymer

This project is Jataware's offerning to DARPA's CriticalMAAS AIE as a Human Machine Interface (HMI) and associated services to allow users to find, annotate, and/or correct map digitizations (TA2) and find, view, and annotate reports relevant to Critical Mineral Assessments (CMA).

![Polymer Georeferencing](./images/polymer_projection.png)

# Architecture

![Polymer Architecture](./images/polymer_arch.png)

## Install Requirements

- Poetry [https://python-poetry.org/]
- Python 3.12 environment
- NPM (Tested with 8.17.0)
- Docker
- Docker Compose
- make
- Get a free MapTiler key at https://www.maptiler.com/
- Create an OPENAPI token and ask to get it asssociated with the Jataware group.

## Configuration

### Polymer Service Layer (FastAPI)

Polymer assumes a running CriticalMAAS Data Repository (CDR) to connect to map data. You must therefore register two services with the CDR to get Polymer working correctly. Please see https://github.com/jataware/cdr first before installing this project.

**Polymer HMI** (This is used for the user pushing validated map results to the CDR)

```
system: polymer
system_version: 0.0.1
```

For this one you'll want to use the following JSON:

```
{
  "name": "polymer",
  "version": "0.0.1",
  "callback_url": "http://localhost:3001/",
  "webhook_secret": "",
  "auth_header": "",
  "auth_token": "",
  "events": [
  ]
}
```

**Jataware Georeferencer** (This is Jataware's Georeferencer Service that take requests from the CDR to georeference maps, and submits results on demand.)

```
system: jataware_georef
system_version: 0.1.0
```

For this one you'll want to use the following JSON:

```
{
    "name": "jataware_georef",
    "version": "0.1.0",
    "callback_url": "http://localhost:3001/map/project",
    "webhook_secret": "",
    "auth_header": "",
    "auth_token": "",
    "events": [
        "map.process"
    ]
}
```

For the CDR instructions at https://github.com/jataware/cdr?tab=readme-ov-file#creation-of-users-tokens-assignment-of-roles to regiester both pair of systems above by first creating a user, user token, and giving your tokens the appropriate roles, and then register your systems via the CDR API's using your token.

![Polymer Registrastion with CDR](./images/polymer_register.png)

Create `.env` file in `services/auto-georef/` with the following:

```

AUTOGEOREF_OPEN_AI_KEY="YOUR_KEY"
AUTOGEOREF_CDR_BEARER_TOKEN="Bearer YOUR_CDR_TOKEN"
AUTOGEOREF_cdr_s3_endpoint_url="http://localhost:9000"
AUTOGEOREF_cdr_es_endpoint_url="http://localhost:9200"
AUTOGEOREF_cdr_endpoint_url="http://localhost:8333"
AUTOGEOREF_polymer_es_endpoint_url="http:/localhost:9200"
AUTOGEOREF_polymer_s3_endpoint_url="http://localhost:9000"
AUTOGEOREF_polymer_public_bucket="common.polymer.rocks"
AUTOGEOREF_ES_ENDPOINT_URL="http://elastic:9200"

AWS_PROFILE=default
CPL_CURL_VERBOSE=1

```

## Build and Run For Development (via Docker Containers)

Build Polymer API Service layer

`make docker-build-georef`

Build Jataware Georeferencer

`make docker-build-jataware-georef`

Build Polymer HMI

`make docker-build-maps-ui`

## Prepopulate Data to minio

If you would like to preload data into minio add it to the `load/` directory with the format of `{name}/{name}.cog.tif`

Example

```

./load/test/
./load/test/test.cog.tif

```

## Start services

This will start elasticsearch + minio

```

make up.a

```

Verify:

minio admin http://localhost:9000 u: miniouser p: miniopass

elastic http://localhost:9200/

### Auto Georef

Setup AWS profile

modify `~/.aws/credentials` add the following profile. Make sure your shell does not have
`AWS_ACCESS_KEY_ID` `AWS_SECRET_ACCESS_KEY` already in the environment

```

[minio]
aws_access_key_id = miniouser
aws_secret_access_key = miniopass

```

Setup `services/auto-georef/.env`

```

AUTOGEOREF_S3_ENDPOINT_URL=http://0.0.0.0:9000
AWS_PROFILE=minio

```

Start

```

cd services/auto-georef
poetry install
AWS_PROFILE=minio poetry run dev

```

Verify: http://0.0.0.0:3000/docs

### Maps UI

Create an `maps_ui/.env`

Example config:

```

VITE_TIFF_URL="http://0.0.0.0:9000/polymer-rocks/"
VITE_MAPTILER_KEY="{key}"

```

Run:

```

cd maps_ui
npm install
npm run start

```

Verify: http://localhost:8080/

```

```
