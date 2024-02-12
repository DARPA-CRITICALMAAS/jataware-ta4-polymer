

# Silk


## dev


```
poetry install

cd ui/

bun install
```


#### Configure ENV

.env

```
SILK_S3_ENDPOINT_URL=http://0.0.0.0:9000
SILK_OPENAI_API_KEY="openai-key"
AWS_PROFILE=minio
SILK_SQLITE_DB="data/silk.db"
SILK_DOC_CACHE="data/docs"
SILK_S3_AWS_PROFILE=default
```


#### Start
```
poetry run dev

cd ui
bun run css-watch
bun run build-watch

```

http://localhost:3000





### Links


#### Front End Resources

https://bun.sh/ <br/>
https://htmx.org/ <br/>
https://daisyui.com/ <br/>
https://alpinejs.dev/ <br/>
https://openlayers.org/ <br/>
https://heroicons.com/ <br/>

