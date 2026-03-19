from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.clase import EstadoClase, TipoClase


class ClaseCreate(BaseModel):
    estudiante_id: int
    instructor_id: int
    vehiculo_id: Optional[int] = None
    tipo: TipoClase
    fecha_programada: datetime
    duracion_horas: int = Field(default=1, ge=1, le=8)
    observaciones: Optional[str] = None


class ClaseComplete(BaseModel):
    acreditar_horas: bool = True
    observaciones: Optional[str] = None


class ClaseCancel(BaseModel):
    motivo: Optional[str] = None


class ClaseReschedule(BaseModel):
    fecha_programada: datetime
    duracion_horas: Optional[int] = Field(default=None, ge=1, le=8)
    instructor_id: Optional[int] = None
    vehiculo_id: Optional[int] = None
    observaciones: Optional[str] = None


class ClaseResponse(BaseModel):
    id: int
    estudiante_id: int
    estudiante_nombre: str
    instructor_id: Optional[int] = None
    instructor_nombre: Optional[str] = None
    vehiculo_id: Optional[int] = None
    vehiculo_label: Optional[str] = None
    tipo: TipoClase
    estado: EstadoClase
    fecha_programada: datetime
    fecha_completada: Optional[datetime] = None
    duracion_horas: int
    created_at: datetime

    class Config:
        from_attributes = True


class ClasesListResponse(BaseModel):
    items: List[ClaseResponse]
    total: int
    skip: int
    limit: int

