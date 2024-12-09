from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="allow",
        env_prefix="segment_api_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    cdr_bearer_token: str = "Bearer a0d45e47f4884fa5c3f9d13154a6ddf389373c184f224a1d4dbe88ed2e96b1512"

    cdr_s3_endpoint_url: str = "http://192.168.1.196:9000"  # "https://s3.amazonaws.com"
    cdr_public_bucket: str = "public.cdr.land"
    cdr_s3_cog_prefix: str = "cogs"

    aws_s3_endpoint_url: str = "https://s3.amazonaws.com"
    polymer_public_bucket: str = "common.polymer.rocks"

    s3_cog_embedding_prefix: str = "embeddings"

    redis_host: str = "redis.nyl.on"
    redis_port: int = 6379
    redis_cache_timeout: int = 10000

    disk_cache_dir: str = "/home/apps/segment_api/disk_cache"
    sam_model_path: str = "/home/apps/segment_api/model_weights/sam_model_best.pth"
    time_per_embedding: int = 10_000


app_settings = Settings()
