FROM python:3.11
RUN apt update 
RUN apt -y install libgdal-dev
RUN pip install gdal==3.6.0

RUN rm -rf /var/lib/apt/lists/*

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/jataware_georef

RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/jataware_georef

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/jataware_georef
# RUN pip install git+https://github.com/DARPA-CRITICALMAAS/cdr_schemas.git

CMD ["uvicorn", "jataware_georef.http.api:api", "--host", "0.0.0.0", "--port", "3000", "--log-config", "logging.yaml", "--workers", "1", "--reload"]
