FROM oven/bun:debian AS ui-dist

WORKDIR /app/auto-georef/ui
COPY . /app/auto-georef

RUN bun install
RUN bun run build
RUN bun run css

FROM python:3.11
RUN apt update 
RUN apt -y install libgdal-dev 

RUN pip install gdal==3.6.0

RUN apt-get update && apt-get clean && apt-get install -y --no-install-recommends \
    tesseract-ocr && apt-get install -y --no-install-recommends sshpass \
    && apt-get install -y --no-install-recommends libgl1-mesa-glx

RUN rm -rf /var/lib/apt/lists/*

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/auto-georef
COPY ./policy.xml /etc/ImageMagick-6/policy.xml

COPY --from=ui-dist /app/auto-georef/static/css/*.css /home/apps/auto-georef/static/css/
COPY --from=ui-dist /app/auto-georef/static/js /home/apps/auto-georef/static/js
COPY --from=ui-dist /app/auto-georef/static/webfonts/* /home/apps/auto-georef/static/webfonts/

RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/auto-georef

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/auto-georef

CMD ["uvicorn", "auto_georef.http.api:api", "--host", "0.0.0.0", "--port", "3000", "--log-config", "logging.yaml", "--workers", "1", "--reload"]
