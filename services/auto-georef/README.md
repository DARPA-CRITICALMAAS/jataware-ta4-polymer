
# Polymer UI Server

Find, georeference, and review maps.

## Install Dependencies

```
poetry install

cd ui/

npm install
```

## One-time Environment Configuration

Copy `./ui/.env-sample` to `./ui/.env` and update values to your dev or prod use case.
Only a maptiler key is needed for now:

- Get a free MapTiler key at https://www.maptiler.com/

Copy `./.env-sample` to `./.env`'.
New var, which should be added when running locally in development (without a caddy server in front):
```
AUTOGEOREF_template_prefix=""
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
