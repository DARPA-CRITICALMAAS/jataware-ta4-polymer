from pydantic_settings import BaseSettings

from baseline_mpm.baseline import BaselineModel


class Settings(BaseSettings):
    cdr_endpoint_url: str = "http://172.17.0.1:8333"

    cdr_bearer_token: str = "Bearer a0d45e47f4884fa5c3f9d13154a6ddf389373c184f224a1d4dbe88ed2e96b151"
    secret_token: str = ""

    system_name: str = BaselineModel.SYSTEM_NAME
    system_version: str = BaselineModel.SYSTEM_VERSION
    ml_model_name: str = BaselineModel.ML_MODEL_NAME
    ml_model_version: str = BaselineModel.ML_MODEL_VERSION

    class Config:
        extra = "allow"
        case_sensitive = False
        env_prefix = "BASELINE_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
