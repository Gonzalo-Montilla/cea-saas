from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint

from app.core.database import Base


class ConceptoIngresoTenant(Base):
    """Catálogo configurable de conceptos de ingreso por tenant."""

    __tablename__ = "conceptos_ingreso_tenant"
    __table_args__ = (
        UniqueConstraint("tenant_id", "nombre", name="uq_conceptos_ingreso_tenant_nombre"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    nombre = Column(String(120), nullable=False)
    categoria = Column(String(50), nullable=False, default="OTROS")
    valor_default = Column(Numeric(10, 2), nullable=False, default=0)
    activo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
