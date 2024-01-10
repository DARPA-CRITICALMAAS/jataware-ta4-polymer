from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = None
    open_ai_key: str = None
    s3_tiles_bucket: str = "common.polymer.rocks"
    s3_tiles_prefix: str = "tiles"
    s3_tiles_prefix_v2: str = "cogs"
    es_endpoint_url: str = "http://elastic:9200"
    maps_index: str = "maps2"
    gcps_index: str = "gcps2"
    epsgs_index: str = "epsgs2"
    proj_files_index: str = "proj_files2"

    class Config:
        case_sensitive = False
        env_prefix = "autogeoref_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
