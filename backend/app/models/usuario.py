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
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login = Column(DateTime)
    
    # Relaciones
    estudiante = relationship("Estudiante", back_populates="usuario", uselist=False)
    
    def __repr__(self):
        return f"<Usuario {self.email} - {self.rol}>"
