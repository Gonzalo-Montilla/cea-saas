from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class TenantBranch(Base):
    __tablename__ = "tenant_branches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "codigo", name="uq_tenant_branch_codigo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    codigo = Column(String(50), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_primary = Column(Boolean, default=False, nullable=False)
    direccion = Column(String(255))
    ciudad = Column(String(120))
    contacto_telefono = Column(String(50))
    contacto_email = Column(String(255))
    observaciones = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")


class TenantUserBranch(Base):
    __tablename__ = "tenant_user_branches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "branch_id", name="uq_tenant_user_branch"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("tenant_branches.id"), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant")
    user = relationship("Usuario")
    branch = relationship("TenantBranch")
