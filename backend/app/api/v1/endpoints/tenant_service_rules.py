from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_or_gerente, get_required_tenant
from app.core.database import get_db
from app.core.formacion import horas_default_por_servicio
from app.core.precios import es_certificado_sin_practica
from app.models.estudiante import TipoServicio
from app.models.tenant import Tenant
from app.models.tenant_service_rule import TenantServiceRule
from app.models.usuario import Usuario
from app.schemas.tenant_service_rule import TenantServiceRuleResolved, TenantServiceRuleUpdate

router = APIRouter()


def _build_resolved_rule(
    tipo_servicio: TipoServicio,
    regla: TenantServiceRule | None,
) -> TenantServiceRuleResolved:
    if regla and regla.activo:
        return TenantServiceRuleResolved(
            tipo_servicio=tipo_servicio,
            horas_teoricas_requeridas=int(regla.horas_teoricas_requeridas or 0),
            horas_practicas_requeridas=int(regla.horas_practicas_requeridas or 0),
            activo=True,
            es_personalizado=True,
            updated_at=regla.updated_at,
        )

    horas_teoria, horas_practica = horas_default_por_servicio(tipo_servicio)
    return TenantServiceRuleResolved(
        tipo_servicio=tipo_servicio,
        horas_teoricas_requeridas=horas_teoria,
        horas_practicas_requeridas=horas_practica,
        activo=True,
        es_personalizado=False,
        updated_at=None,
    )


@router.get("/", response_model=List[TenantServiceRuleResolved])
def listar_reglas_servicio_tenant(
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    reglas = (
        db.query(TenantServiceRule)
        .filter(TenantServiceRule.tenant_id == current_tenant.id)
        .all()
    )
    reglas_map = {r.tipo_servicio: r for r in reglas}

    result: list[TenantServiceRuleResolved] = []
    for tipo_servicio in TipoServicio:
        result.append(_build_resolved_rule(tipo_servicio, reglas_map.get(tipo_servicio)))

    return result


@router.put("/{tipo_servicio}", response_model=TenantServiceRuleResolved)
def upsert_regla_servicio_tenant(
    tipo_servicio: TipoServicio,
    payload: TenantServiceRuleUpdate,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    if es_certificado_sin_practica(tipo_servicio):
        if payload.horas_teoricas_requeridas != 0 or payload.horas_practicas_requeridas != 0:
            raise HTTPException(
                status_code=400,
                detail="Los servicios sin practica deben conservar 0 horas teoricas y 0 practicas",
            )

    regla = (
        db.query(TenantServiceRule)
        .filter(
            TenantServiceRule.tenant_id == current_tenant.id,
            TenantServiceRule.tipo_servicio == tipo_servicio,
        )
        .first()
    )

    if not regla:
        regla = TenantServiceRule(
            tenant_id=current_tenant.id,
            tipo_servicio=tipo_servicio,
        )
        db.add(regla)

    regla.horas_teoricas_requeridas = payload.horas_teoricas_requeridas
    regla.horas_practicas_requeridas = payload.horas_practicas_requeridas
    regla.activo = payload.activo if payload.activo is not None else True

    db.commit()
    db.refresh(regla)
    return _build_resolved_rule(tipo_servicio, regla)


@router.delete("/{tipo_servicio}", response_model=TenantServiceRuleResolved)
def reset_regla_servicio_tenant(
    tipo_servicio: TipoServicio,
    db: Session = Depends(get_db),
    _current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    regla = (
        db.query(TenantServiceRule)
        .filter(
            TenantServiceRule.tenant_id == current_tenant.id,
            TenantServiceRule.tipo_servicio == tipo_servicio,
        )
        .first()
    )
    if regla:
        db.delete(regla)
        db.commit()
    return _build_resolved_rule(tipo_servicio, None)

