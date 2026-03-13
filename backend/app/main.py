from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
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
