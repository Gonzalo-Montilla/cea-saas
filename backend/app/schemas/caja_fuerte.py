from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from app.models.caja import TipoMovimiento
from app.models.pago import MetodoPago
from app.models.caja_fuerte import EstadoMovimientoCajaFuerte


class CajaFuerteResumen(BaseModel):
    id: int
    saldo_efectivo: Decimal
    saldo_nequi: Decimal
    saldo_daviplata: Decimal
    saldo_transferencia_bancaria: Decimal
    saldo_tarjeta_debito: Decimal
    saldo_tarjeta_credito: Decimal
    saldo_credismart: Decimal
    saldo_sistecredito: Decimal
    saldo_total: Decimal

    class Config:
        from_attributes = True


class MovimientoCajaFuerteCreate(BaseModel):
    tipo: TipoMovimiento
    metodo_pago: MetodoPago
    concepto: str
    categoria: Optional[str] = None
    monto: Decimal
    fecha: Optional[datetime] = None
    observaciones: Optional[str] = None
    inventario_items: Optional[List['InventarioItem']] = None

    @field_validator("monto")
    @classmethod
    def validate_monto(cls, v):
        if v <= 0:
            raise ValueError("El monto debe ser mayor a cero")
        return v

    @field_validator("concepto")
    @classmethod
    def validate_concepto(cls, v):
        if not v or len(v.strip()) < 3:
            raise ValueError("El concepto debe tener al menos 3 caracteres")
        return v.strip().upper()


class MovimientoCajaFuerteUpdate(BaseModel):
    tipo: Optional[TipoMovimiento] = None
    metodo_pago: Optional[MetodoPago] = None
    concepto: Optional[str] = None
    categoria: Optional[str] = None
    monto: Optional[Decimal] = None
    fecha: Optional[datetime] = None
    observaciones: Optional[str] = None
    inventario_items: Optional[List['InventarioItem']] = None

    @field_validator("monto")
    @classmethod
    def validate_monto(cls, v):
        if v is not None and v <= 0:
            raise ValueError("El monto debe ser mayor a cero")
        return v


class InventarioItem(BaseModel):
    denominacion: int
    cantidad: int
    total: Optional[Decimal] = None

    @field_validator("denominacion")
    @classmethod
    def validate_denominacion(cls, v):
        if v <= 0:
            raise ValueError("La denominación debe ser positiva")
        return v

    @field_validator("cantidad")
    @classmethod
    def validate_cantidad(cls, v):
        if v < 0:
            raise ValueError("La cantidad no puede ser negativa")
        return v


class InventarioUpdate(BaseModel):
    items: List[InventarioItem]


class InventarioResponse(BaseModel):
    items: List[InventarioItem]
    total_efectivo: Decimal


MovimientoCajaFuerteCreate.model_rebuild()
MovimientoCajaFuerteUpdate.model_rebuild()


class MovimientoCajaFuerteResponse(BaseModel):
    id: int
    caja_fuerte_id: int
    caja_id: Optional[int]
    tipo: TipoMovimiento
    metodo_pago: MetodoPago
    concepto: str
    categoria: Optional[str]
    monto: Decimal
    fecha: datetime
    observaciones: Optional[str]
    inventario_detalle: Optional[List[InventarioItem]] = None
    estado: EstadoMovimientoCajaFuerte
    motivo_anulacion: Optional[str] = None
    anulado_at: Optional[datetime] = None
    anulado_por_nombre: Optional[str] = None
    usuario_nombre: str
    created_at: datetime

    class Config:
        from_attributes = True


class MovimientoCajaFuerteAnular(BaseModel):
    motivo_anulacion: str
    inventario_items: Optional[List['InventarioItem']] = None

    @field_validator("motivo_anulacion")
    @classmethod
    def validate_motivo_anulacion(cls, v):
        if not v or len(v.strip()) < 5:
            raise ValueError("El motivo de anulación debe tener al menos 5 caracteres")
        return v.strip()


MovimientoCajaFuerteAnular.model_rebuild()
