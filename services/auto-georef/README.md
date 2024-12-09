
# Polymer UI Server

Find, georeference, and review maps.

## Install Dependencies

```
poetry install

cd ui/

npm install
```

## One-time Environment Configuration

- Get a free MapTiler key at https://www.maptiler.com/

Copy `./.env-sample` to `./.env`'.
**New vars for v2 UI**, which should be added when running locally in development (without a caddy server in front):
```
AUTOGEOREF_template_prefix=""                       #  "/ui" on prod
AUTOGEOREF_maps_ui_base_url="http://localhost:8080" #  "" on prod
AUTOGEOREF_maptiler_key = ""                        # the maptiler key described above, needed both on prod and dev
```

## Start App for Development

### Start Application Server:

```
AWS_PROFILE=minio poetry run dev
```

Application will start on http://localhost:3000

### Watch UI js/css for changes

Run both of these, on separate shells, under `.ui/` directory:

For Javascript assets:

```
bun dev
```

For CSS assets:
```
bun css:watch
```

These need to be run at least once. If no need to watch or changes:
```
npm run build
npm run css
```

#### UI Tests:

```
bun run test
```

*Using `run` on the above command is important, else bun will use its own internal runner, ignore some test configs, and fail.


## Links

### Front End Resources

https://htmx.org/ <br/>
https://daisyui.com/ <br/>
https://openlayers.org/ <br/>
https://heroicons.com/ <br/>
https://tailwindcss.com/docs/installation <br />
