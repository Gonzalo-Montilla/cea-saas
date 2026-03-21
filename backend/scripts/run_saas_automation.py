from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.api.v1.endpoints.saas_admin import _build_overdue_email_body, _build_support_sla_email_body
from app.core.database import SessionLocal
from app.core.email import send_email
from app.models.saas_billing_event import SaasBillingEvent
from app.models.saas_support_ticket import SaasSupportTicket
from app.models.tenant import Tenant


@dataclass
class AutomationResult:
    overdue_updated: int = 0
    cycle_charges_created: int = 0
    reminders_evaluated: int = 0
    reminders_sent: int = 0
    sla_evaluated: int = 0
    sla_sent: int = 0


def run_billing_overdue_check(db: Session, now: datetime) -> int:
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at < now,
        Tenant.subscription_status.in_(["ACTIVE", "TRIAL"]),
    ).all()
    updated = 0
    for tenant in candidates:
        tenant.subscription_status = "PAST_DUE"
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="STATUS_CHANGED",
                status="OVERDUE",
                amount=float(tenant.monthly_fee or 0),
                currency="COP",
                due_at=tenant.next_billing_at,
                notes="Marcado automáticamente como vencido por fecha de cobro.",
            )
        )
        updated += 1
    return updated


def run_billing_cycle_charges(db: Session, now: datetime) -> int:
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status.in_(["ACTIVE", "TRIAL", "PAST_DUE"]),
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at <= now,
    ).all()
    created = 0
    for tenant in candidates:
        due_at = tenant.next_billing_at
        existing = (
            db.query(SaasBillingEvent)
            .filter(
                SaasBillingEvent.tenant_id == tenant.id,
                SaasBillingEvent.event_type == "INVOICE_ISSUED",
                SaasBillingEvent.due_at == due_at,
            )
            .first()
        )
        if existing:
            continue
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="INVOICE_ISSUED",
                status="DUE",
                amount=float(tenant.monthly_fee or 0),
                currency="COP",
                due_at=due_at,
                notes=f"Cargo generado por ciclo {tenant.billing_cycle}.",
            )
        )
        created += 1
    return created


def run_billing_overdue_reminders(db: Session, now: datetime) -> tuple[int, int]:
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status == "PAST_DUE",
        Tenant.next_billing_at.isnot(None),
        Tenant.contacto_email.isnot(None),
    ).all()
    evaluated = 0
    sent = 0
    for tenant in candidates:
        email = (tenant.contacto_email or "").strip().lower()
        if not email:
            continue
        evaluated += 1
        recent = (
            db.query(SaasBillingEvent)
            .filter(
                SaasBillingEvent.tenant_id == tenant.id,
                SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
                SaasBillingEvent.created_at >= (now - timedelta(hours=24)),
            )
            .first()
        )
        if recent:
            continue
        days_overdue = (now.date() - tenant.next_billing_at.date()).days if tenant.next_billing_at else 0
        ok = send_email(
            to_email=email,
            subject="Recordatorio de pago pendiente",
            body=_build_overdue_email_body(tenant, days_overdue),
        )
        if not ok:
            continue
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="OVERDUE_REMINDER_SENT",
                status="INFO",
                amount=float(tenant.monthly_fee or 0),
                currency="COP",
                due_at=tenant.next_billing_at,
                notes=f"Recordatorio enviado a {email}.",
            )
        )
        sent += 1
    return evaluated, sent


def run_support_sla_alerts(db: Session, now: datetime) -> tuple[int, int]:
    candidates = db.query(SaasSupportTicket).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS"]),
        SaasSupportTicket.due_at.isnot(None),
    ).all()
    evaluated = 0
    sent = 0
    for ticket in candidates:
        due_delta_hours = (ticket.due_at - now).total_seconds() / 3600
        if due_delta_hours > 24:
            continue
        evaluated += 1
        if ticket.last_sla_alert_at and ticket.last_sla_alert_at >= (now - timedelta(hours=12)):
            continue
        target_email = ((ticket.owner_email or "").strip().lower() or (ticket.requester_email or "").strip().lower())
        if not target_email:
            continue
        ok = send_email(
            to_email=target_email,
            subject=f"Alerta SLA ticket #{ticket.id}",
            body=_build_support_sla_email_body(ticket),
        )
        if not ok:
            continue
        ticket.last_sla_alert_at = now
        sent += 1
    return evaluated, sent


def run_all(db: Session) -> AutomationResult:
    # Keep naive UTC for compatibility with existing DB datetime fields.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = AutomationResult()
    result.overdue_updated = run_billing_overdue_check(db, now)
    result.cycle_charges_created = run_billing_cycle_charges(db, now)
    result.reminders_evaluated, result.reminders_sent = run_billing_overdue_reminders(db, now)
    result.sla_evaluated, result.sla_sent = run_support_sla_alerts(db, now)
    return result


def main() -> None:
    db = SessionLocal()
    try:
        result = run_all(db)
        db.commit()
        print(
            "OK: saas_automation | "
            f"overdue_updated={result.overdue_updated} | "
            f"cycle_charges_created={result.cycle_charges_created} | "
            f"reminders={result.reminders_sent}/{result.reminders_evaluated} | "
            f"sla_alerts={result.sla_sent}/{result.sla_evaluated}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
