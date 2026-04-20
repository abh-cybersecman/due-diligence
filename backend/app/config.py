from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://isdd_user:changeme@db:5432/isdd"
    postgres_db: str = "isdd"
    postgres_user: str = "isdd_user"
    postgres_password: str = "changeme"

    # Admin
    admin_username: str = "admin"
    admin_password_hash: str = ""

    # JWT
    jwt_secret_key: str = "changeme"
    jwt_algorithm: str = "HS256"
    admin_jwt_expire_minutes: int = 480
    vendor_jwt_expire_minutes: int = 120
    ir_jwt_expire_minutes: int = 120

    # App
    app_base_path: str = "/due-diligence"

    # File storage
    upload_dir: str = "/app/uploads"
    ir_upload_dir: str = "/app/uploads/ir"
    backup_dir: str = "/app/backups"

    # Upload limits (vendor)
    vendor_max_file_size_mb: int = 25
    vendor_max_files_per_engagement: int = 20
    vendor_max_total_upload_mb: int = 100

    # Upload limits (IR)
    ir_max_file_size_mb: int = 25
    ir_max_files_per_engagement: int = 20
    ir_max_total_upload_mb: int = 100

    # Document numbering
    doc_number_start: int = 1001
    doc_number_prefix: str = "ABHIT-IST-DD-"

    # AI (Phase 3)
    anthropic_api_key: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
