from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.api.deps import get_admin_or_gerente, get_required_tenant
from app.models.usuario import Usuario
from app.models.tarifa import Tarifa
from app.models.tenant import Tenant
from app.schemas.tarifa import TarifaCreate, TarifaUpdate, TarifaResponse


router = APIRouter()


@router.get("/", response_model=List[TarifaResponse])
def listar_tarifas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    return db.query(Tarifa).filter(
        Tarifa.tenant_id == current_tenant.id
    ).order_by(Tarifa.tipo_servicio.asc()).all()


@router.get("/{tarifa_id}", response_model=TarifaResponse)
def obtener_tarifa(
    tarifa_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    tarifa = db.query(Tarifa).filter(
        Tarifa.id == tarifa_id,
        Tarifa.tenant_id == current_tenant.id,
    ).first()
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")
    return tarifa


@router.post("/", response_model=TarifaResponse, status_code=status.HTTP_201_CREATED)
def crear_tarifa(
    payload: TarifaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    existente = db.query(Tarifa).filter(
        Tarifa.tipo_servicio == payload.tipo_servicio,
        Tarifa.tenant_id == current_tenant.id,
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Ya existe una tarifa para ese servicio")

    tarifa = Tarifa(
        tipo_servicio=payload.tipo_servicio,
        tenant_id=current_tenant.id,
        precio_base=payload.precio_base,
        costo_practica=payload.costo_practica or 0,
        activo=payload.activo if payload.activo is not None else True
    )
    db.add(tarifa)
    db.commit()
    db.refresh(tarifa)
    return tarifa


@router.put("/{tarifa_id}", response_model=TarifaResponse)
def actualizar_tarifa(
    tarifa_id: int,
    payload: TarifaUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    tarifa = db.query(Tarifa).filter(
        Tarifa.id == tarifa_id,
        Tarifa.tenant_id == current_tenant.id,
    ).first()
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(tarifa, field, value)

    db.commit()
    db.refresh(tarifa)
    return tarifa


@router.delete("/{tarifa_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_tarifa(
    tarifa_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    tarifa = db.query(Tarifa).filter(
        Tarifa.id == tarifa_id,
        Tarifa.tenant_id == current_tenant.id,
    ).first()
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")
    tarifa.activo = False
    db.commit()
    return None
