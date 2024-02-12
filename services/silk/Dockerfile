FROM oven/bun:debian AS ui-dist

WORKDIR /app/silk/ui
COPY . /app/silk

RUN bun install
RUN bun run build
RUN bun run css

FROM python:3.11-slim-bullseye

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/silk
COPY --from=ui-dist /app/silk/static/css/*.css static/css/
COPY --from=ui-dist /app/silk/static/js/*.js static/js/

RUN mkdir -p /home/apps/db
RUN mkdir -p /home/apps/docs

RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/silk

RUN --mount=type=cache,mode=0755,target=/root/.cache/pip pip install --upgrade pip --user
RUN --mount=type=cache,mode=0755,target=/root/.cache/pip pip install --user /home/apps/silk

CMD ["uvicorn", "silk.http.api:api", "--host", "0.0.0.0", "--port", "3000", "--log-config", "logging.yaml", "--workers", "1"]
