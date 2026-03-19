from typing import Tuple

from sqlalchemy.orm import Session

from app.core.precios import es_certificado_sin_practica, obtener_categoria_licencia
from app.models.estudiante import TipoServicio
from app.models.tenant_service_rule import TenantServiceRule


DEFAULT_HOURS_BY_CATEGORY = {
    "A2": (28, 15),
    "B1": (30, 20),
    "C1": (36, 30),
}


def horas_default_por_servicio(tipo_servicio: TipoServicio) -> Tuple[int, int]:
    """Horas por defecto (comportamiento legado)."""
    if es_certificado_sin_practica(tipo_servicio):
        return (0, 0)

    categoria = obtener_categoria_licencia(tipo_servicio)
    return DEFAULT_HOURS_BY_CATEGORY.get(str(categoria), (0, 0))


def obtener_horas_requeridas_por_servicio(
    db: Session,
    tenant_id: int,
    tipo_servicio: TipoServicio,
) -> Tuple[int, int]:
    """
    Devuelve horas configuradas por tenant o fallback al esquema legado.
    """
    regla = (
        db.query(TenantServiceRule)
        .filter(
            TenantServiceRule.tenant_id == tenant_id,
            TenantServiceRule.tipo_servicio == tipo_servicio,
            TenantServiceRule.activo == True,
        )
        .first()
    )

    if regla:
        return (
            int(regla.horas_teoricas_requeridas or 0),
            int(regla.horas_practicas_requeridas or 0),
        )

    return horas_default_por_servicio(tipo_servicio)

