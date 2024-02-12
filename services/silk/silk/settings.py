from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    s3_endpoint_url: str = "https://s3.amazonaws.com"
    s3_documents_bucket: str = "protected.polymer.rocks"
    s3_documents_prefix: str = "silk/pdfs"
    s3_aws_profile: str | None = ""
    openai_api_key: str
    templates_dir: str = "silk/templates"

    sqlite_db: str = "/home/apps/db/silk.db"
    doc_cache: str = "/home/apps/docs"

    # zotero_user: str = Field(validation_alias="zotero_user")
    # zotero_token: SecretStr = ""

    zotero_library_id: str = "4530692"
    zotero_library_type: str = "group"

    class Config:
        case_sensitive = False
        env_prefix = "silk_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
