FROM python:3.10-slim

RUN apt-get update && apt-get clean && apt-get install -y --no-install-recommends \
    tesseract-ocr

RUN rm -rf /var/lib/apt/lists/*

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/auto-georef

RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/auto-georef

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/auto-georef

CMD ["uvicorn", "auto_georef.http.api:api", "--host", "0.0.0.0", "--port", "3000", "--log-config", "logging.yaml", "--workers", "1"]
