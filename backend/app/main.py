from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1.api import api_router
from app.core.database import SessionLocal
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.middleware("http")
async def tenant_context_middleware(request: Request, call_next):
    """
    Resuelve tenant por header o subdominio.
    Este contexto se usa en dependencias de auth/autorización.
    """
    header_name = settings.TENANT_HEADER_NAME
    tenant_slug = request.headers.get(header_name)

    if not tenant_slug:
        host = request.headers.get("host", "")
        host_without_port = host.split(":")[0]
        host_parts = host_without_port.split(".")
        if len(host_parts) >= 3:
            tenant_slug = host_parts[0]

    if not tenant_slug and settings.DEFAULT_TENANT_SLUG:
        tenant_slug = settings.DEFAULT_TENANT_SLUG

    request.state.tenant_slug = tenant_slug
    response = await call_next(request)
    return response


@app.get("/")
def root():
    return {"message": f"{settings.PROJECT_NAME} - Sistema de Gestión"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/health/ready")
def readiness_check():
    db_ok = False
    db_error = None
    db = None
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        db_error = str(exc)
    finally:
        if db is not None:
            db.close()

    env_checks = {
        "secret_key_configured": bool(settings.SECRET_KEY and "change-in-production" not in settings.SECRET_KEY.lower()),
        "smtp_user_configured": bool((settings.SMTP_USER or "").strip()),
        "smtp_password_configured": bool((settings.SMTP_PASSWORD or "").strip()),
        "portal_url_configured": bool((settings.PORTAL_URL or "").strip()),
    }
    app_env = (settings.APP_ENV or "").strip().lower()
    if app_env == "production":
        app_url = (settings.APP_URL or "").strip().lower()
        portal_url = (settings.PORTAL_URL or "").strip().lower()
        env_checks["app_url_not_localhost"] = bool(app_url and "localhost" not in app_url and "127.0.0.1" not in app_url)
        env_checks["portal_url_not_localhost"] = bool(
            portal_url and "localhost" not in portal_url and "127.0.0.1" not in portal_url
        )
    env_ok = all(env_checks.values())
    ready = bool(db_ok and env_ok)
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "checks": {
            "database": {"ok": db_ok, "error": db_error},
            "environment": {"ok": env_ok, "details": env_checks},
        },
    }
