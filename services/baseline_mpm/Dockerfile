FROM python:3.11
ENV PATH=/home/apps/bin:/home/apps/.local/bin:$PATH

COPY . /home/apps/baseline_mpm
RUN useradd --user-group --create-home apps
RUN chown -v -R apps:apps /home/apps

USER apps
WORKDIR /home/apps/baseline_mpm

RUN pip install --upgrade pip --user
RUN pip install --user /home/apps/baseline_mpm

CMD ["uvicorn", "baseline_mpm.http.api:api", "--host", "0.0.0.0", "--port", "4000", "--log-config", "logging.yaml", "--workers", "1", "--reload"]

