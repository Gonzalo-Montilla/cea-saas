from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.api.v1.endpoints.saas_admin import (
    _build_dunning_email_body,
    _build_support_sla_email_body,
    _compute_dunning_stage,
    _tenant_period_amounts,
)
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
    reminders_by_stage: dict[str, int] = field(default_factory=dict)
    sla_evaluated: int = 0
    sla_sent: int = 0


def run_billing_overdue_check(db: Session, now: datetime) -> int:
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at < now,
        Tenant.subscription_status == "ACTIVE",
    ).all()
    updated = 0
    for tenant in candidates:
        pricing = _tenant_period_amounts(db, tenant)
        tenant.subscription_status = "PAST_DUE"
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="STATUS_CHANGED",
                status="OVERDUE",
                amount=float(pricing["total"]),
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
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
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
        pricing = _tenant_period_amounts(db, tenant)
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="INVOICE_ISSUED",
                status="DUE",
                amount=float(pricing["total"]),
                currency="COP",
                due_at=due_at,
                notes=f"Cargo generado por ciclo {tenant.billing_cycle}.",
            )
        )
        created += 1
    return created


def run_billing_overdue_reminders(db: Session, now: datetime) -> tuple[int, int, dict[str, int]]:
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
        Tenant.next_billing_at.isnot(None),
        Tenant.contacto_email.isnot(None),
    ).all()
    evaluated = 0
    sent = 0
    stage_counts: dict[str, int] = {}
    for tenant in candidates:
        email = (tenant.contacto_email or "").strip().lower()
        if not email:
            continue
        stage_code, stage_label, days_delta = _compute_dunning_stage(tenant, now)
        if not stage_code:
            continue
        evaluated += 1
        stage_marker = f"stage={stage_code}"
        existing_stage = (
            db.query(SaasBillingEvent)
            .filter(
                SaasBillingEvent.tenant_id == tenant.id,
                SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
                SaasBillingEvent.due_at == tenant.next_billing_at,
                SaasBillingEvent.notes.ilike(f"%{stage_marker}%"),
            )
            .first()
        )
        if existing_stage:
            continue
        pricing = _tenant_period_amounts(db, tenant)
        ok = send_email(
            to_email=email,
            subject=f"Cobranza SaaS - {stage_label}",
            body=_build_dunning_email_body(tenant, stage_code, stage_label or stage_code, days_delta, pricing["total"]),
        )
        if not ok:
            continue
        db.add(
            SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="OVERDUE_REMINDER_SENT",
                status="INFO",
                amount=float(pricing["total"]),
                currency="COP",
                due_at=tenant.next_billing_at,
                notes=(
                    f"Dunning reminder sent to {email}; stage={stage_code}; "
                    f"stage_label={stage_label}; days_delta={int(days_delta)}."
                ),
            )
        )
        sent += 1
        stage_counts[stage_code] = int(stage_counts.get(stage_code, 0) + 1)
    return evaluated, sent, stage_counts


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
    result.reminders_evaluated, result.reminders_sent, result.reminders_by_stage = run_billing_overdue_reminders(db, now)
    result.sla_evaluated, result.sla_sent = run_support_sla_alerts(db, now)
    return result


def main() -> None:
    lock_path = Path(__file__).resolve().parent / ".run_saas_automation.lock"
    if lock_path.exists():
        print("SKIP: saas_automation already running (lock file present).")
        return
    lock_path.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    db = SessionLocal()
    try:
        result = run_all(db)
        db.commit()
        stage_text = ",".join([f"{k}:{v}" for k, v in sorted((result.reminders_by_stage or {}).items())]) or "none"
        print(
            "OK: saas_automation | "
            f"overdue_updated={result.overdue_updated} | "
            f"cycle_charges_created={result.cycle_charges_created} | "
            f"reminders={result.reminders_sent}/{result.reminders_evaluated} | "
            f"reminders_by_stage={stage_text} | "
            f"sla_alerts={result.sla_sent}/{result.sla_evaluated}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        if lock_path.exists():
            lock_path.unlink()


if __name__ == "__main__":
    main()
