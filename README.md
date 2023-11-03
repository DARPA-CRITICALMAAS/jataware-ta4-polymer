

# Nylon Georeferencer

## Install Requirements
- Poetry 1.6.1
- NPM (Tested with 8.17.0)
- Get a free Mapbox key after creating an acccount (https://www.mapbox.com/)
- Get a free MapTiler key at https://www.maptiler.com/
- Install tesseract-ocr - (for linux) sudo apt install tesseract-ocr

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

modify `~/.aws/credentials` add the following profile.  Make sure your shell does not have
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


### UI

Create an `ui/.env`

Example config:

```
VITE_TIFF_URL="http://0.0.0.0:9000/polymer-rocks/"
VITE_MAPTILER_KEY="{key}"
```

Run:
```
cd ui
npm install
npm run start
```

Verify: http://localhost:8080/

