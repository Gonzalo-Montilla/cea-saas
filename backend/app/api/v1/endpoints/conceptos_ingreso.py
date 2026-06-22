from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_or_coordinador_or_cajero, get_admin_or_gerente, get_required_tenant
from app.core.database import get_db
from app.models.concepto_ingreso_tenant import ConceptoIngresoTenant
from app.models.tenant import Tenant
from app.models.usuario import Usuario
from app.schemas.concepto_ingreso_tenant import (
    ConceptoIngresoTenantCreate,
    ConceptoIngresoTenantResponse,
    ConceptoIngresoTenantUpdate,
)

router = APIRouter()


@router.get("/", response_model=List[ConceptoIngresoTenantResponse])
def listar_conceptos_ingreso(
    include_inactivos: bool = Query(False, description="Si incluye conceptos inactivos"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    query = db.query(ConceptoIngresoTenant).filter(ConceptoIngresoTenant.tenant_id == current_tenant.id)
    if not include_inactivos:
        query = query.filter(ConceptoIngresoTenant.activo.is_(True))
    return query.order_by(ConceptoIngresoTenant.nombre.asc()).all()


@router.post("/", response_model=ConceptoIngresoTenantResponse, status_code=status.HTTP_201_CREATED)
def crear_concepto_ingreso(
    payload: ConceptoIngresoTenantCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    existente = db.query(ConceptoIngresoTenant).filter(
        ConceptoIngresoTenant.tenant_id == current_tenant.id,
        ConceptoIngresoTenant.nombre == payload.nombre,
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Ya existe un concepto con ese nombre")

    concepto = ConceptoIngresoTenant(
        tenant_id=current_tenant.id,
        nombre=payload.nombre,
        categoria=payload.categoria.value,
        valor_default=payload.valor_default,
        activo=payload.activo,
    )
    db.add(concepto)
    db.commit()
    db.refresh(concepto)
    return concepto


@router.put("/{concepto_id}", response_model=ConceptoIngresoTenantResponse)
def actualizar_concepto_ingreso(
    concepto_id: int,
    payload: ConceptoIngresoTenantUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    concepto = db.query(ConceptoIngresoTenant).filter(
        ConceptoIngresoTenant.id == concepto_id,
        ConceptoIngresoTenant.tenant_id == current_tenant.id,
    ).first()
    if not concepto:
        raise HTTPException(status_code=404, detail="Concepto no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "nombre" in update_data:
        nombre_existente = db.query(ConceptoIngresoTenant).filter(
            ConceptoIngresoTenant.tenant_id == current_tenant.id,
            ConceptoIngresoTenant.nombre == update_data["nombre"],
            ConceptoIngresoTenant.id != concepto.id,
        ).first()
        if nombre_existente:
            raise HTTPException(status_code=400, detail="Ya existe un concepto con ese nombre")

    if "categoria" in update_data and update_data["categoria"] is not None:
        update_data["categoria"] = update_data["categoria"].value

    for field, value in update_data.items():
        setattr(concepto, field, value)

    db.commit()
    db.refresh(concepto)
    return concepto


@router.delete("/{concepto_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_concepto_ingreso(
    concepto_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    concepto = db.query(ConceptoIngresoTenant).filter(
        ConceptoIngresoTenant.id == concepto_id,
        ConceptoIngresoTenant.tenant_id == current_tenant.id,
    ).first()
    if not concepto:
        raise HTTPException(status_code=404, detail="Concepto no encontrado")
    concepto.activo = False
    db.commit()
    return None
