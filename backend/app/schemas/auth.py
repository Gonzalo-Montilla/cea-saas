from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
from app.models.usuario import RolUsuario


class UserLogin(BaseModel):
    """Schema para login de usuario"""
    email: EmailStr
    password: str
    mfa_code: Optional[str] = None
    backup_code: Optional[str] = None


class UserRegister(BaseModel):
    """Schema para registro de usuario"""
    email: EmailStr
    password: str
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = "CEDULA"
    telefono: str
    rol: RolUsuario


class Token(BaseModel):
    """Schema para respuesta de tokens"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Schema para datos del token decodificado"""
    user_id: int
    tenant_id: Optional[int] = None
    tenant_slug: Optional[str] = None
    session_version: Optional[int] = None


class UserResponse(BaseModel):
    """Schema para respuesta de usuario"""
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
    must_change_password: bool = False
    password_changed_at: Optional[datetime] = None
    mfa_enabled: bool = False
    mfa_backup_codes_remaining: int = 0

    class Config:
        from_attributes = True


class GlobalPasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if not value or len(value) < 6:
            raise ValueError("La nueva contraseña debe tener al menos 6 caracteres")
        return value


class GlobalMfaEnableRequest(BaseModel):
    code: str


class GlobalMfaDisableRequest(BaseModel):
    password: str
    code: str


class GlobalMfaRegenerateBackupCodesRequest(BaseModel):
    password: str
    code: str
