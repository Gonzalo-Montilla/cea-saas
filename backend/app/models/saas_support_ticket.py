from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class SaasSupportTicket(Base):
    __tablename__ = "saas_support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="OPEN", index=True)  # OPEN | IN_PROGRESS | RESOLVED | CLOSED
    priority = Column(String(20), nullable=False, default="MEDIUM", index=True)  # LOW | MEDIUM | HIGH | CRITICAL
    category = Column(String(40), nullable=False, default="GENERAL", index=True)
    subject = Column(String(255), nullable=False)
    description = Column(Text)
    owner_email = Column(String(255), index=True)
    requester_name = Column(String(255))
    requester_email = Column(String(255), index=True)
    requester_phone = Column(String(50))
    resolution_notes = Column(Text)
    due_at = Column(DateTime)
    resolved_at = Column(DateTime)
    last_sla_alert_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
