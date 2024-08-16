from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="allow",
        env_prefix="autogeoref_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    open_ai_key: str
    cdr_bearer_token: str = "Bearer a0d45e47f4884fa5c3f9d13154a6ddf389373c184f224a1d4dbe88ed2e96b1512"

    cdr_s3_endpoint_url: str = "http://192.168.1.95:9000"  # "https://s3.amazonaws.com"
    cdr_public_bucket: str = "public.cdr.land"
    cdr_s3_cog_prefix: str = "cogs"
    cdr_s3_px_extractions_prefix: str = "px_results"
    cdr_es_endpoint_url: str = "http://192.168.1.95:9200"
    cdr_endpoint_url: str = "http://192.168.1.95:8333"

    polymer_es_endpoint_url: str = "http://192.168.1.95:9200"
    polymer_s3_endpoint_url: str = "http://192.168.1.95:9000"
    polymer_public_bucket: str = "public.cdr.land"
    polymer_s3_cog_prefix: str = "cogs"
    polymer_s3_cog_projections_prefix: str = "cogs/projections"
    polymer_s3_cog_embedding_prefix: str = "embeddings"
    polymer_gcps_index: str = "polymer_gcps"
    polymer_projections_index: str = "polymer_projections"
    polymer_legend_extractions: str = "polymer_legend_extractions"
    polymer_area_extractions: str = "polymer_area_extractions"

    polymer_auto_georef_system: str = "polymer"
    polymer_auto_georef_system_version: str = "0.0.1"

    ui_templates_dir: str = "auto_georef/templates"
    template_prefix: str = "/ui"

    redis_host: str = "redis.nyl.on"
    redis_port: int = 6379
    redis_cache_timeout: int = 10000

    disk_cache_dir: str = "/home/apps/auto-georef/disk_cache"
    sam_model_path: str = "/home/apps/auto-georef/model_weights/sam_model_best.pth"


app_settings = Settings()
