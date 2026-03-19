from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum as SQLEnum, ForeignKey, Integer, UniqueConstraint

from app.core.database import Base
from app.models.estudiante import TipoServicio


class TenantServiceRule(Base):
    """Reglas de intensidad horaria por tenant y servicio."""

    __tablename__ = "tenant_service_rules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "tipo_servicio", name="uq_tenant_service_rules_tenant_tipo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    tipo_servicio = Column(SQLEnum(TipoServicio, native_enum=False), nullable=False)
    horas_teoricas_requeridas = Column(Integer, nullable=False, default=0)
    horas_practicas_requeridas = Column(Integer, nullable=False, default=0)
    activo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

