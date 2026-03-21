from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class SaasBillingEvent(Base):
    __tablename__ = "saas_billing_events"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False, index=True)  # PAYMENT_RECORDED | STATUS_CHANGED
    status = Column(String(20), nullable=False, default="PAID", index=True)  # PAID | OVERDUE | INFO
    amount = Column(Numeric(12, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="COP")
    paid_at = Column(DateTime)
    due_at = Column(DateTime)
    reference = Column(String(120))
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    tenant = relationship("Tenant")
