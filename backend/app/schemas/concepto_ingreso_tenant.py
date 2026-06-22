from decimal import Decimal
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.caja import ConceptoMovimientoCaja


ALLOWED_INGRESO_CATEGORIAS = {
    ConceptoMovimientoCaja.ESTUDIANTE_NO_REGISTRADO,
    ConceptoMovimientoCaja.PAGO_PRESTAMO_EMPLEADO,
    ConceptoMovimientoCaja.VENTA_MATERIAL,
    ConceptoMovimientoCaja.INGRESO_ADMINISTRATIVO,
    ConceptoMovimientoCaja.OTROS,
}


def _validate_ingreso_categoria(value: ConceptoMovimientoCaja) -> ConceptoMovimientoCaja:
    if value not in ALLOWED_INGRESO_CATEGORIAS:
        raise ValueError("Categoria no permitida para conceptos de ingreso")
    return value


class ConceptoIngresoTenantBase(BaseModel):
    nombre: str
    categoria: ConceptoMovimientoCaja = ConceptoMovimientoCaja.OTROS
    valor_default: Decimal

    @field_validator("nombre")
    @classmethod
    def validate_nombre(cls, value: str) -> str:
        nombre = (value or "").strip().upper()
        if len(nombre) < 3:
            raise ValueError("El nombre debe tener al menos 3 caracteres")
        return nombre

    @field_validator("valor_default")
    @classmethod
    def validate_valor_default(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise ValueError("El valor por defecto no puede ser negativo")
        return value

    @field_validator("categoria")
    @classmethod
    def validate_categoria(cls, value: ConceptoMovimientoCaja) -> ConceptoMovimientoCaja:
        return _validate_ingreso_categoria(value)


class ConceptoIngresoTenantCreate(ConceptoIngresoTenantBase):
    activo: bool = True


class ConceptoIngresoTenantUpdate(BaseModel):
    nombre: Optional[str] = None
    categoria: Optional[ConceptoMovimientoCaja] = None
    valor_default: Optional[Decimal] = None
    activo: Optional[bool] = None

    @field_validator("nombre")
    @classmethod
    def validate_nombre(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        nombre = value.strip().upper()
        if len(nombre) < 3:
            raise ValueError("El nombre debe tener al menos 3 caracteres")
        return nombre

    @field_validator("categoria")
    @classmethod
    def validate_categoria(cls, value: Optional[ConceptoMovimientoCaja]) -> Optional[ConceptoMovimientoCaja]:
        if value is None:
            return value
        return _validate_ingreso_categoria(value)

    @field_validator("valor_default")
    @classmethod
    def validate_valor_default(cls, value: Optional[Decimal]) -> Optional[Decimal]:
        if value is None:
            return value
        if value < 0:
            raise ValueError("El valor por defecto no puede ser negativo")
        return value


class ConceptoIngresoTenantResponse(BaseModel):
    id: int
    nombre: str
    categoria: ConceptoMovimientoCaja
    valor_default: Decimal
    activo: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True
