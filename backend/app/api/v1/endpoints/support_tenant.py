from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_required_tenant
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.models.saas_support_ticket import SaasSupportTicket
from app.models.tenant import Tenant
from app.models.usuario import Usuario

router = APIRouter()

SUPPORT_STATUSES = {"OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
SUPPORT_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


class TenantSupportTicketCreate(BaseModel):
    subject: str
    description: Optional[str] = None
    category: Optional[str] = "GENERAL"
    priority: Optional[str] = "MEDIUM"


def _support_alert_recipients() -> list[str]:
    raw = (settings.SAAS_SUPPORT_ALERT_EMAILS or "").strip()
    if not raw:
        raw = (settings.SAAS_ADMIN_EMAILS or "").strip()
    recipients = [str(x).strip().lower() for x in raw.split(",") if str(x).strip()]
    if not recipients and settings.HABEAS_CORREO:
        recipients = [str(settings.HABEAS_CORREO).strip().lower()]
    unique: list[str] = []
    seen: set[str] = set()
    for email in recipients:
        if email in seen:
            continue
        seen.add(email)
        unique.append(email)
    return unique


def _build_new_ticket_alert_body(ticket: SaasSupportTicket, tenant: Tenant) -> str:
    created_text = ticket.created_at.strftime("%Y-%m-%d %H:%M") if ticket.created_at else datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    description = ticket.description or "(sin descripción)"
    return (
        "Nuevo ticket de soporte recibido desde portal escuela.\n\n"
        f"Ticket: #{ticket.id}\n"
        f"Escuela: {tenant.display_name or tenant.nombre or tenant.slug}\n"
        f"Código escuela: {tenant.slug}\n"
        f"Asunto: {ticket.subject}\n"
        f"Prioridad: {ticket.priority}\n"
        f"Solicitante: {ticket.requester_name or '-'} <{ticket.requester_email or '-'}>\n"
        f"Fecha: {created_text}\n\n"
        f"Descripción:\n{description}\n\n"
        "Ingresa al Backoffice SaaS > Soporte para atenderlo."
    )


def _serialize_support_ticket(ticket: SaasSupportTicket) -> dict:
    now = datetime.utcnow()
    due_in_hours = None
    sla_state = "NO_DUE_DATE"
    if ticket.due_at:
        due_in_hours = (ticket.due_at - now).total_seconds() / 3600
        if ticket.status in {"RESOLVED", "CLOSED"}:
            sla_state = "CLOSED"
        elif due_in_hours < 0:
            sla_state = "OVERDUE"
        elif due_in_hours <= 24:
            sla_state = "DUE_SOON"
        else:
            sla_state = "ON_TIME"
    return {
        "id": ticket.id,
        "tenant_id": ticket.tenant_id,
        "tenant_slug": ticket.tenant.slug if ticket.tenant else None,
        "tenant_nombre": ticket.tenant.nombre if ticket.tenant else None,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "subject": ticket.subject,
        "description": ticket.description,
        "owner_email": ticket.owner_email,
        "requester_name": ticket.requester_name,
        "requester_email": ticket.requester_email,
        "requester_phone": ticket.requester_phone,
        "resolution_notes": ticket.resolution_notes,
        "due_at": ticket.due_at,
        "due_in_hours": due_in_hours,
        "sla_state": sla_state,
        "resolved_at": ticket.resolved_at,
        "last_sla_alert_at": ticket.last_sla_alert_at,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


@router.get("/my-tickets")
def list_my_support_tickets(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_required_tenant),
    user: Usuario = Depends(get_current_active_user),
):
    query = db.query(SaasSupportTicket).filter(SaasSupportTicket.tenant_id == tenant.id)
    if status_filter:
        status_value = str(status_filter).strip().upper()
        if status_value not in SUPPORT_STATUSES:
            raise HTTPException(status_code=400, detail="Estado de ticket inválido")
        query = query.filter(SaasSupportTicket.status == status_value)
    if priority:
        priority_value = str(priority).strip().upper()
        if priority_value not in SUPPORT_PRIORITIES:
            raise HTTPException(status_code=400, detail="Prioridad de ticket inválida")
        query = query.filter(SaasSupportTicket.priority == priority_value)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(SaasSupportTicket.subject).like(term),
                func.lower(func.coalesce(SaasSupportTicket.description, "")).like(term),
                func.lower(func.coalesce(SaasSupportTicket.requester_name, "")).like(term),
                func.lower(func.coalesce(SaasSupportTicket.requester_email, "")).like(term),
            )
        )

    total = query.count()
    items = query.order_by(SaasSupportTicket.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_support_ticket(ticket) for ticket in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
        "requester_email": (user.email or "").strip().lower(),
    }


@router.post("/my-tickets", status_code=status.HTTP_201_CREATED)
def create_my_support_ticket(
    payload: TenantSupportTicketCreate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_required_tenant),
    user: Usuario = Depends(get_current_active_user),
):
    subject = str(payload.subject or "").strip()
    if len(subject) < 6:
        raise HTTPException(status_code=400, detail="El asunto debe tener al menos 6 caracteres")
    priority_value = str(payload.priority or "MEDIUM").strip().upper()
    if priority_value not in SUPPORT_PRIORITIES:
        raise HTTPException(status_code=400, detail="Prioridad de ticket inválida")
    category_value = str(payload.category or "GENERAL").strip().upper() or "GENERAL"

    ticket = SaasSupportTicket(
        tenant_id=tenant.id,
        status="OPEN",
        priority=priority_value,
        category=category_value,
        subject=subject,
        description=(str(payload.description).strip() if payload.description else None),
        requester_name=(user.nombre_completo or "").strip() or None,
        requester_email=(user.email or "").strip().lower() or None,
        requester_phone=(user.telefono or "").strip() or None,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    recipients = _support_alert_recipients()
    if recipients:
        subject = f"[{settings.SMTP_FROM_NAME}] Nuevo ticket #{ticket.id} - {tenant.slug}"
        body = _build_new_ticket_alert_body(ticket, tenant)
        for to_email in recipients:
            try:
                send_email(to_email=to_email, subject=subject, body=body)
            except Exception:
                # El flujo principal no debe fallar por errores de notificación.
                pass
    return _serialize_support_ticket(ticket)
