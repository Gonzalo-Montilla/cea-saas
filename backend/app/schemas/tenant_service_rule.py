from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.estudiante import TipoServicio


class TenantServiceRuleUpdate(BaseModel):
    horas_teoricas_requeridas: int
    horas_practicas_requeridas: int
    activo: Optional[bool] = True

    @field_validator("horas_teoricas_requeridas", "horas_practicas_requeridas")
    @classmethod
    def validar_horas(cls, value: int) -> int:
        if value < 0:
            raise ValueError("Las horas no pueden ser negativas")
        if value > 500:
            raise ValueError("Las horas no pueden ser mayores a 500")
        return value


class TenantServiceRuleResolved(BaseModel):
    tipo_servicio: TipoServicio
    horas_teoricas_requeridas: int
    horas_practicas_requeridas: int
    activo: bool
    es_personalizado: bool
    updated_at: Optional[datetime] = None

