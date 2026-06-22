from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
from app.models.usuario import RolUsuario


class UsuarioCreate(BaseModel):
    email: EmailStr
    password: str
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = "CEDULA"
    telefono: Optional[str] = None
    rol: RolUsuario
    is_active: Optional[bool] = True
    permisos_modulos: Optional[list[str]] = None
    branch_ids: Optional[list[int]] = None


class UsuarioUpdate(BaseModel):
    email: Optional[EmailStr] = None
    nombre_completo: Optional[str] = None
    cedula: Optional[str] = None
    tipo_documento: Optional[str] = None
    telefono: Optional[str] = None
    rol: Optional[RolUsuario] = None
    is_active: Optional[bool] = None
    permisos_modulos: Optional[list[str]] = None
    branch_ids: Optional[list[int]] = None


class UsuarioPasswordUpdate(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validar_password(cls, v: str) -> str:
        if not v or len(v) < 6:
            raise ValueError("La contraseña debe tener al menos 6 caracteres")
        return v


class UsuarioResponse(BaseModel):
    id: int
    email: str
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = None
    telefono: Optional[str]
    rol: RolUsuario
    is_active: bool
    is_verified: bool
    created_at: datetime
    last_login: Optional[datetime]
    permisos_modulos: Optional[list[str]] = None
    branch_ids: Optional[list[int]] = None

    class Config:
        from_attributes = True
