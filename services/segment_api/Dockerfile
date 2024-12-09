FROM python:3.11
RUN apt update 
RUN apt -y install libgdal-dev 

RUN apt-get install -y --no-install-recommends libgl1-mesa-glx

ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/segment_api

RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps
RUN wget https://s3.us-east-1.amazonaws.com/public.cdr.land/weights/segment/sam_model_best.pth \
    -O /home/apps/segment_api/model_weights/sam_model_best.pth
USER apps
WORKDIR /home/apps/segment_api

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/segment_api

CMD ["uvicorn", "segment_api.http.api:api", "--host", "0.0.0.0", "--port", "8000", "--log-config", "logging.yaml", "--workers", "1", "--reload"]
