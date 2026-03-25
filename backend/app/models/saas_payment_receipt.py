from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import relationship

from app.core.database import Base


class SaasPaymentReceipt(Base):
    __tablename__ = "saas_payment_receipts"

    id = Column(Integer, primary_key=True, index=True)
    billing_event_id = Column(Integer, ForeignKey("saas_billing_events.id"), nullable=False, unique=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    receipt_number = Column(String(80), nullable=False, unique=True, index=True)
    subtotal_amount = Column(Numeric(12, 2), nullable=False, default=0)
    iva_rate = Column(Numeric(6, 4), nullable=False, default=0.19)
    iva_amount = Column(Numeric(12, 2), nullable=False, default=0)
    total_amount = Column(Numeric(12, 2), nullable=False, default=0)
    file_path = Column(String(500), nullable=False)
    sent_to_email = Column(String(255))
    sent_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    billing_event = relationship("SaasBillingEvent", back_populates="receipt")
    tenant = relationship("Tenant")
