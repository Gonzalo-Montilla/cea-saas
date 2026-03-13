from fastapi import APIRouter
from app.api.v1.endpoints import auth, estudiantes, caja, reportes, instructores, uploads, vehiculos, tarifas, usuarios, caja_fuerte, tenants

api_router = APIRouter()

# Incluir routers de endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
api_router.include_router(estudiantes.router, prefix="/estudiantes", tags=["Estudiantes"])
api_router.include_router(caja.router, prefix="/caja", tags=["Caja y Pagos"])
api_router.include_router(caja_fuerte.router, prefix="/caja-fuerte", tags=["Caja Fuerte"])
api_router.include_router(reportes.router, prefix="/reportes", tags=["Reportes"])
api_router.include_router(instructores.router, prefix="/instructores", tags=["Instructores"])
api_router.include_router(uploads.router, prefix="/uploads", tags=["Uploads"])
api_router.include_router(vehiculos.router, prefix="/vehiculos", tags=["Vehículos"])
api_router.include_router(tarifas.router, prefix="/tarifas", tags=["Tarifas"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["Usuarios"])

# Aquí se agregarán más routers cuando se creen los módulos
# api_router.include_router(registro.router, prefix="/registro", tags=["Registro"])
# api_router.include_router(clases.router, prefix="/clases", tags=["Clases"])
