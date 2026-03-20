from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class SaasAuditLog(Base):
    __tablename__ = "saas_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False, index=True)
    actor_email = Column(String(255), nullable=False, index=True)
    action = Column(String(80), nullable=False, index=True)
    entity_type = Column(String(40), nullable=False, index=True)
    entity_id = Column(String(80), nullable=False, index=True)
    summary = Column(String(255), nullable=False)
    payload = Column(JSON)
    ip_address = Column(String(80))
    user_agent = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    actor = relationship("Usuario")
