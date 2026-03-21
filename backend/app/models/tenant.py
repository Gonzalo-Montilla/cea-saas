from datetime import datetime
import enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class PlanTenant(str, enum.Enum):
    FREE = "FREE"
    BASIC = "BASIC"
    PRO = "PRO"
    ENTERPRISE = "ENTERPRISE"


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    nombre = Column(String(255), nullable=False)
    plan = Column(String(30), default=PlanTenant.FREE.value, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_demo = Column(Boolean, default=False, nullable=False)
    demo_ends_at = Column(DateTime)
    subscription_status = Column(String(30), default="TRIAL", nullable=False)
    billing_cycle = Column(String(20), default="MONTHLY", nullable=False)
    monthly_fee = Column(Numeric(12, 2), default=0, nullable=False)
    next_billing_at = Column(DateTime)
    last_payment_at = Column(DateTime)

    # Branding y contacto (base para white-label)
    display_name = Column(String(255))
    logo_url = Column(Text)
    contacto_email = Column(String(255))
    contacto_telefono = Column(String(50))
    nit = Column(String(50))

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = relationship("TenantUser", back_populates="tenant", cascade="all, delete-orphan")


class TenantUser(Base):
    __tablename__ = "tenant_users"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_tenant_user"),)

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    rol = Column(String(30), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="members")
    user = relationship("Usuario")
