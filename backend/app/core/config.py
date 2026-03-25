from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """
    Configuración de la aplicación desde variables de entorno
    """
    # Aplicación
    APP_ENV: str = "local"
    APP_NAME: str = "SIAEC_SAAS"
    APP_URL: str = "http://127.0.0.1:8000"
    PORTAL_URL: str = "http://localhost:5173"
    PROJECT_NAME: str = "SIAEC API"
    BRAND_SHORT_NAME: str = "SIAEC"
    BRAND_FULL_NAME: str = "Sistema Integral de Administración para Escuelas de Conducción"
    API_V1_STR: str = "/api/v1"
    
    # Base de datos PostgreSQL
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/cea_educar"
    
    # Seguridad JWT
    SECRET_KEY: str = "cea-educar-secret-key-change-in-production-2024"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 días
    
    # CORS
    BACKEND_CORS_ORIGINS: list = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    # Tenancy
    TENANT_HEADER_NAME: str = "X-Tenant-Slug"
    BRANCH_HEADER_NAME: str = "X-Branch-Id"
    DEFAULT_TENANT_SLUG: Optional[str] = None
    DEFAULT_TENANT_NAME: Optional[str] = None
    TENANT_STRICT_MODE: bool = False
    ALLOW_TENANT_BOOTSTRAP: bool = False
    ALLOW_SCHOOL_ONBOARDING: bool = False
    SCHOOL_ONBOARDING_KEY: Optional[str] = None
    ALLOW_PUBLIC_SCHOOL_SIGNUP: bool = False
    SAAS_ADMIN_EMAILS: Optional[str] = None
    SAAS_SUPPORT_ALERT_EMAILS: Optional[str] = None
    SAAS_ADMIN_ALLOWED_ROLES: str = "ADMIN,GERENTE"
    SAAS_LOGIN_MAX_ATTEMPTS: int = 5
    SAAS_LOGIN_LOCK_MINUTES: int = 15
    MFA_TOTP_ISSUER: str = "SIAEC SaaS"
    DEFAULT_DEMO_DAYS: int = 15

    # Email (SMTP)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_NAME: str = "SIAEC"
    SMTP_USE_TLS: bool = True
    BRAND_LOGO_PATH: Optional[str] = None

    # Habeas Data
    HABEAS_RAZON_SOCIAL: str = "SIAEC - Sistema Integral de Administración para Escuelas de Conducción"
    HABEAS_NIT: str = "901463869-8"
    HABEAS_CONTACTO: str = "+57 314 3005442"
    HABEAS_CORREO: str = "ceaeducardelcaucasas@gmail.com"
    HABEAS_POLITICA_URL: Optional[str] = None
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
