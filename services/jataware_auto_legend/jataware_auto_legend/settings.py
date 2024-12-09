import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = None
    cdr_endpoint_url: str = "http://192.168.1.72:8333/v1/maps/publish/auto_legend"
    cdr_bearer_token: str = "Bearer a0d45e47f4884fa5c3f9d13154a6ddf389373c184f224a1d4dbe88ed2e96b151"
    secret_token: str = ""
    detr_model_path: str = os.path.expanduser(
        "~/.cache/auto_legend/column_abbr_002_custom_detr_detector_model_0095.pth"
    )
    device: str = "cpu"
    anthropic_api_key: str = None

    class Config:
        extra = "allow"
        case_sensitive = False
        env_prefix = "auto_legend_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
