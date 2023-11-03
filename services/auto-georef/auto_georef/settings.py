from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = None
    open_ai_key: str = None
    s3_tiles_bucket: str = "common.polymer.rocks"
    s3_tiles_prefix: str = "tiles"
    es_endpoint_url: str = "http://localhost:9200/"

    class Config:
        case_sensitive = False
        env_prefix = "autogeoref_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
