from pydantic import BaseModel, EmailStr, field_validator
import re
from typing import Optional, List, TYPE_CHECKING
from datetime import date, datetime
from decimal import Decimal
from app.models.estudiante import CategoriaLicencia, EstadoEstudiante, OrigenCliente, TipoServicio

if TYPE_CHECKING:
    from app.schemas.caja import PagoResponse


class EstudianteBase(BaseModel):
    """Schema base para Estudiante"""
    fecha_nacimiento: date
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    barrio: Optional[str] = None
    tipo_sangre: Optional[str] = None
    eps: Optional[str] = None
    ocupacion: Optional[str] = None
    estado_civil: Optional[str] = None
    nivel_educativo: Optional[str] = None
    estrato: Optional[int] = None
    nivel_sisben: Optional[str] = None
    necesidades_especiales: Optional[str] = None
    contacto_emergencia_nombre: Optional[str] = None
    contacto_emergencia_telefono: Optional[str] = None


class EstudianteCreate(EstudianteBase):
    """Schema para crear un estudiante (solo datos personales)"""
    email: EmailStr
    password: str
    nombre_completo: Optional[str] = None
    primer_nombre: str
    segundo_nombre: Optional[str] = None
    primer_apellido: str
    segundo_apellido: Optional[str] = None
    cedula: str
    tipo_documento: str = "CEDULA"
    telefono: str
    foto_base64: str  # Foto en base64
    autorizacion_tratamiento: bool

    @field_validator('primer_nombre', 'primer_apellido')
    @classmethod
    def validate_partes_obligatorias(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError('Este campo es obligatorio')
        return value

    @field_validator('cedula')
    @classmethod
    def validate_cedula(cls, v: str, info) -> str:
        value = v.strip().upper()
        tipo = (info.data.get("tipo_documento") or "CEDULA").upper()
        if tipo == "PASAPORTE":
            if not re.fullmatch(r'[A-Z0-9\-]{5,20}', value):
                raise ValueError('El pasaporte debe tener entre 5 y 20 caracteres')
        else:
            if not re.fullmatch(r'\d{5,20}', value):
                raise ValueError('El documento debe tener entre 5 y 20 dígitos')
        return value

    @field_validator('tipo_documento')
    @classmethod
    def validate_tipo_documento(cls, v: str) -> str:
        value = v.strip().upper()
        allowed = {"CEDULA", "TARJETA_IDENTIDAD", "PASAPORTE", "CEDULA_EXTRANJERIA"}
        if value not in allowed:
            raise ValueError('Tipo de documento inválido')
        return value

    @field_validator('telefono')
    @classmethod
    def validate_telefono(cls, v: str) -> str:
        value = v.strip()
        if not re.fullmatch(r'\d{7,15}', value):
            raise ValueError('El teléfono debe tener entre 7 y 15 dígitos')
        return value

    @field_validator('foto_base64')
    @classmethod
    def validate_foto_base64(cls, v: str) -> str:
        value = v.strip()
        if not value.startswith('data:image/'):
            raise ValueError('La foto debe ser una imagen válida')
        if len(value) > 3_000_000:
            raise ValueError('La foto es demasiado grande')
        return value

    @field_validator('autorizacion_tratamiento')
    @classmethod
    def validate_autorizacion(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError('Debe aceptar el tratamiento de datos personales')
        return v


class EstudianteUpdate(BaseModel):
    """Schema para actualizar un estudiante"""
    nombre_completo: Optional[str] = None
    primer_nombre: Optional[str] = None
    segundo_nombre: Optional[str] = None
    primer_apellido: Optional[str] = None
    segundo_apellido: Optional[str] = None
    email: Optional[EmailStr] = None
    cedula: Optional[str] = None
    tipo_documento: Optional[str] = None
    telefono: Optional[str] = None
    foto_base64: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    barrio: Optional[str] = None
    tipo_sangre: Optional[str] = None
    eps: Optional[str] = None
    ocupacion: Optional[str] = None
    estado_civil: Optional[str] = None
    nivel_educativo: Optional[str] = None
    estrato: Optional[int] = None
    nivel_sisben: Optional[str] = None
    necesidades_especiales: Optional[str] = None
    contacto_emergencia_nombre: Optional[str] = None
    contacto_emergencia_telefono: Optional[str] = None
    estado: Optional[EstadoEstudiante] = None
    horas_teoricas_completadas: Optional[int] = None
    horas_practicas_completadas: Optional[int] = None
    saldo_pendiente: Optional[Decimal] = None

    @field_validator('nombre_completo')
    @classmethod
    def validate_nombre_update(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            raise ValueError('El nombre_completo es obligatorio')
        return value

    @field_validator('primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido')
    @classmethod
    def validate_partes_nombre(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            return None
        return value

    @field_validator('cedula')
    @classmethod
    def validate_cedula_update(cls, v: Optional[str], info) -> Optional[str]:
        if v is None:
            return v
        value = v.strip().upper()
        tipo = (info.data.get("tipo_documento") or "CEDULA").upper()
        if tipo == "PASAPORTE":
            if not re.fullmatch(r'[A-Z0-9\-]{5,20}', value):
                raise ValueError('El pasaporte debe tener entre 5 y 20 caracteres')
        else:
            if not re.fullmatch(r'\d{5,20}', value):
                raise ValueError('El documento debe tener entre 5 y 20 dígitos')
        return value

    @field_validator('tipo_documento')
    @classmethod
    def validate_tipo_documento_update(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip().upper()
        allowed = {"CEDULA", "TARJETA_IDENTIDAD", "PASAPORTE", "CEDULA_EXTRANJERIA"}
        if value not in allowed:
            raise ValueError('Tipo de documento inválido')
        return value

    @field_validator('telefono')
    @classmethod
    def validate_telefono_update(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not re.fullmatch(r'\d{7,15}', value):
            raise ValueError('El teléfono debe tener entre 7 y 15 dígitos')
        return value

    @field_validator('foto_base64')
    @classmethod
    def validate_foto_base64_update(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value.startswith('data:image/'):
            raise ValueError('La foto debe ser una imagen válida')
        if len(value) > 3_000_000:
            raise ValueError('La foto es demasiado grande')
        return value


class EstudianteResponse(BaseModel):
    """Schema para respuesta de estudiante"""
    id: int
    usuario_id: int
    matricula_numero: Optional[str]
    fecha_nacimiento: date
    direccion: Optional[str]
    ciudad: Optional[str]
    barrio: Optional[str]
    tipo_sangre: Optional[str]
    eps: Optional[str]
    ocupacion: Optional[str]
    estado_civil: Optional[str]
    nivel_educativo: Optional[str]
    estrato: Optional[int]
    nivel_sisben: Optional[str]
    necesidades_especiales: Optional[str]
    contacto_emergencia_nombre: Optional[str]
    contacto_emergencia_telefono: Optional[str]
    foto_url: Optional[str]
    tipo_servicio: Optional[TipoServicio]
    categoria: Optional[CategoriaLicencia]  # Opcional hasta definir servicio
    origen_cliente: Optional[OrigenCliente]  # DIRECTO o REFERIDO
    referido_por: Optional[str]  # Nombre de quien refirió
    telefono_referidor: Optional[str]  # Teléfono del referidor
    estado: EstadoEstudiante
    fecha_inscripcion: datetime
    fecha_graduacion: Optional[datetime]
    no_certificado: Optional[str]
    horas_teoricas_completadas: int = 0
    horas_practicas_completadas: int = 0
    horas_teoricas_requeridas: int = 0
    horas_practicas_requeridas: int = 0
    valor_total_curso: Optional[Decimal] = None  # Opcional hasta definir servicio
    saldo_pendiente: Optional[Decimal] = None
    created_at: datetime
    updated_at: Optional[datetime]
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = None
    email: str
    telefono: str
    progreso_teorico: float = 0.0
    progreso_practico: float = 0.0
    esta_listo_para_examen: bool = False
    historial_pagos: List = []  # List[PagoResponse] causaría circular import, se popula manualmente
    clases_historial: List = []
    servicios: List = []
    servicio_activo_id: Optional[int] = None

    class Config:
        from_attributes = True


class EstudianteListItem(BaseModel):
    """Schema para lista de estudiantes"""
    id: int
    usuario_id: int
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = None
    email: str
    telefono: str
    foto_url: Optional[str] = None
    matricula_numero: Optional[str] = None
    tipo_servicio: Optional[TipoServicio] = None
    categoria: Optional[CategoriaLicencia] = None
    estado: EstadoEstudiante
    fecha_inscripcion: datetime
    progreso_teorico: float = 0.0
    progreso_practico: float = 0.0
    saldo_pendiente: Optional[Decimal] = None
    
    class Config:
        from_attributes = True


class EstudiantesListResponse(BaseModel):
    """Schema para respuesta paginada de estudiantes"""
    items: List[EstudianteListItem]
    total: int
    skip: int
    limit: int


class EstudianteOtpResendRequest(BaseModel):
    session_token: str

    @field_validator("session_token")
    @classmethod
    def validate_session_token(cls, v: str) -> str:
        value = v.strip()
        if len(value) < 24:
            raise ValueError("Token OTP inválido")
        return value


class EstudianteOtpVerifyRequest(BaseModel):
    session_token: str
    otp_code: str

    @field_validator("session_token")
    @classmethod
    def validate_session_token(cls, v: str) -> str:
        value = v.strip()
        if len(value) < 24:
            raise ValueError("Token OTP inválido")
        return value

    @field_validator("otp_code")
    @classmethod
    def validate_otp_code(cls, v: str) -> str:
        value = v.strip()
        if not re.fullmatch(r"\d{6}", value):
            raise ValueError("El OTP debe tener 6 dígitos")
        return value


class EstudianteOtpStartResponse(BaseModel):
    session_token: str
    expires_at: datetime
    cooldown_seconds: int = 60
    email: str
    otp_sent: bool = True
    debug_otp_code: Optional[str] = None
    warning_message: Optional[str] = None


class EstudianteOtpVerifyResponse(BaseModel):
    estudiante: EstudianteResponse
    habeas_email_sent: bool


class DefinirServicioRequest(BaseModel):
    """Schema para definir el servicio de un estudiante"""
    tipo_servicio: TipoServicio
    es_recategorizacion: bool = False
    categoria_actual: Optional[CategoriaLicencia] = None
    categoria_nueva: Optional[CategoriaLicencia] = None
    origen_cliente: OrigenCliente
    valor_total_curso: Optional[Decimal] = None  # Referidos o descuento en DIRECTO (Admin/Gerente)
    referido_por: Optional[str] = None  # Nombre de quien refirió (obligatorio si es REFERIDO)
    telefono_referidor: Optional[str] = None  # Teléfono del referidor
    observaciones: Optional[str] = None
    
    @field_validator('valor_total_curso')
    @classmethod
    def validate_valor(cls, v, info):
        if v is not None and v <= 0:
            raise ValueError('El valor_total_curso debe ser mayor a 0')
        # Si es cliente referido, el valor es obligatorio
        if info.data.get('origen_cliente') == OrigenCliente.REFERIDO and v is None:
            raise ValueError('El valor_total_curso es obligatorio para clientes referidos')
        return v


class AmpliarServicioRequest(BaseModel):
    """Schema para ampliar servicio a combo"""
    tipo_servicio_nuevo: TipoServicio
    valor_total_curso: Optional[Decimal] = None  # Solo si es cliente referido
    observaciones: Optional[str] = None


class CorregirServicioRequest(BaseModel):
    """Schema para corregir servicio mal definido"""
    tipo_servicio_nuevo: TipoServicio
    valor_total_curso: Optional[Decimal] = None
    motivo: str
    password: str

    @field_validator('valor_total_curso')
    @classmethod
    def validate_valor(cls, v, info):
        if v is not None and v <= 0:
            raise ValueError('El valor_total_curso debe ser mayor a 0')
        return v


class AcreditarHorasRequest(BaseModel):
    """Registrar horas de clase para un estudiante"""
    tipo: str  # TEORICA o PRACTICA
    horas: int
    observaciones: Optional[str] = None
    instructor_id: Optional[int] = None
    vehiculo_id: Optional[int] = None

    @field_validator('tipo')
    @classmethod
    def validate_tipo(cls, v: str) -> str:
        value = v.strip().upper()
        if value not in ["TEORICA", "PRACTICA"]:
            raise ValueError('El tipo debe ser TEORICA o PRACTICA')
        return value

    @field_validator('horas')
    @classmethod
    def validate_horas(cls, v: int) -> int:
        if v <= 0:
            raise ValueError('Las horas deben ser mayores a 0')
        return v
