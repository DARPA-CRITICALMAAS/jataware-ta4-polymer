FROM python:3.10

# --
# System dependencies

RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

# --
# Copy source code

COPY . /home/apps/jataware_auto_legend
RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/jataware_auto_legend

# --
# Python dependencies

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/jataware_auto_legend

# --
# Download Jataware models

RUN mkdir -p ~/.cache/auto_legend
RUN wget http://s3.amazonaws.com/public.cdr.land/weights/auto_legend/column_abbr_002_custom_detr_detector_model_0095.pth \
    -O ~/.cache/auto_legend/column_abbr_002_custom_detr_detector_model_0095.pth

# Download base models
RUN python scripts/_cache_model.py

# --
# Run

CMD ["uvicorn", "jataware_auto_legend.http.api:api", "--host", "0.0.0.0", "--port", "3000", "--log-config", "logging.yaml", "--workers", "1", "--reload"]
