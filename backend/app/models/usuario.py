from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum as SQLEnum, JSON, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.core.database import Base


class RolUsuario(str, enum.Enum):
    """Roles de usuario en el sistema"""
    ADMIN = "ADMIN"
    GERENTE = "GERENTE"
    COORDINADOR = "COORDINADOR"
    INSTRUCTOR = "INSTRUCTOR"
    ESTUDIANTE = "ESTUDIANTE"
    CAJERO = "CAJERO"


class Usuario(Base):
    """Modelo de Usuario base para todo el sistema"""
    __tablename__ = "usuarios"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    nombre_completo = Column(String(255), nullable=False)
    cedula = Column(String(20), unique=True, index=True, nullable=False)
    tipo_documento = Column(String(30), default="CEDULA", nullable=False)
    telefono = Column(String(20))
    rol = Column(SQLEnum(RolUsuario), nullable=False)
    permisos_modulos = Column(JSON, default=list)
    
    # Estado
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False)
    must_change_password = Column(Boolean, default=False, nullable=False)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    lockout_until = Column(DateTime)
    last_failed_login_at = Column(DateTime)
    session_version = Column(Integer, default=1, nullable=False)
    mfa_enabled = Column(Boolean, default=False, nullable=False)
    mfa_secret = Column(String(255))
    mfa_backup_codes_hashes = Column(JSON, default=list)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime)
    password_changed_at = Column(DateTime)
    
    # Relaciones
    estudiante = relationship("Estudiante", back_populates="usuario", uselist=False)
    movimientos_caja_fuerte = relationship(
        "MovimientoCajaFuerte",
        foreign_keys="[MovimientoCajaFuerte.usuario_id]",
        primaryjoin="Usuario.id == MovimientoCajaFuerte.usuario_id",
        back_populates="usuario",
    )
    movimientos_caja_fuerte_anulados = relationship(
        "MovimientoCajaFuerte",
        foreign_keys="[MovimientoCajaFuerte.anulado_por_id]",
        primaryjoin="Usuario.id == MovimientoCajaFuerte.anulado_por_id",
        back_populates="anulado_por",
    )
    
    def __repr__(self):
        return f"<Usuario {self.email} - {self.rol}>"
