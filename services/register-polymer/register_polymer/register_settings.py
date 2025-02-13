from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    cdr_endpoint_url: str = "http://localhost:8333"
    cdr_admin_endpoint_url: str = "http://localhost:3333"
    cdr_bearer_token: str = "Bearer a0d45e47f4884fa5c3f9d13154a6ddf389373c184f224a1d4dbe88ed2e96b151"

    cdr_user: str = "jataware"
    jataware_georef_callback_url: str= "http://localhost:3000/map/project"
    baseline_mpm_callback_url: str= "http://localhost:4000/model/project"
    
    class Config:
        extra = "allow"
        case_sensitive = False
        env_prefix = "REGISTER_"
        env_file = ".env"
        env_file_encoding = "utf-8"


app_settings = Settings()
