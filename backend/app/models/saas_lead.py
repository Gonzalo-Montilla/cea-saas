from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, Numeric, String, Text

from app.core.database import Base


class SaasLead(Base):
    __tablename__ = "saas_leads"

    id = Column(Integer, primary_key=True, index=True)
    escuela_nombre = Column(String(255), nullable=False, index=True)
    contacto_nombre = Column(String(255), nullable=False)
    contacto_email = Column(String(255), index=True)
    contacto_telefono = Column(String(50))
    ciudad = Column(String(120))
    source = Column(String(80), default="manual", nullable=False)
    plan_interes = Column(String(30))
    estado = Column(String(40), default="NUEVO", nullable=False, index=True)
    valor_estimado_mrr = Column(Numeric(12, 2))
    owner_email = Column(String(255), nullable=False, index=True)
    proxima_accion_at = Column(DateTime)
    converted_tenant_id = Column(Integer, index=True)
    converted_admin_user_id = Column(Integer, index=True)
    converted_at = Column(DateTime, index=True)
    notas = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
