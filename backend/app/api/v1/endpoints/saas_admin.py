import re
import secrets
import csv
import io
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_saas_admin_user
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.core.security import get_password_hash
from app.models.saas_audit_log import SaasAuditLog
from app.models.saas_billing_event import SaasBillingEvent
from app.models.saas_lead import SaasLead
from app.models.saas_support_ticket import SaasSupportTicket
from app.models.tenant import PlanTenant, Tenant, TenantUser
from app.models.usuario import RolUsuario, Usuario

router = APIRouter()


PLAN_MRR_ESTIMATE = {
    PlanTenant.FREE.value: 0,
    PlanTenant.BASIC.value: 199000,
    PlanTenant.PRO.value: 399000,
    PlanTenant.ENTERPRISE.value: 799000,
}

LEAD_STAGES = {
    "NUEVO",
    "CONTACTADO",
    "DEMO_AGENDADA",
    "PROPUESTA_ENVIADA",
    "CERRADO_GANADO",
    "CERRADO_PERDIDO",
}

SUBSCRIPTION_STATUSES = {"TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"}
BILLING_CYCLES = {"MONTHLY", "QUARTERLY", "YEARLY"}
MODULE_TENANTS = "saas_tenants_manage"
MODULE_BILLING = "saas_billing_manage"
MODULE_USERS = "saas_users_manage"
MODULE_AUDIT = "saas_audit_read"
MODULE_PIPELINE = "saas_pipeline_manage"
MODULE_SUPPORT = "saas_support_manage"
SUPPORT_STATUSES = {"OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
SUPPORT_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


class TenantAdminUpdate(BaseModel):
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    is_demo: Optional[bool] = None
    demo_ends_at: Optional[datetime] = None
    subscription_status: Optional[str] = None
    billing_cycle: Optional[str] = None
    monthly_fee: Optional[float] = None
    next_billing_at: Optional[datetime] = None
    last_payment_at: Optional[datetime] = None


class SaasUserCreate(BaseModel):
    email: EmailStr
    password: str
    nombre_completo: str
    cedula: str
    tipo_documento: Optional[str] = "CEDULA"
    telefono: Optional[str] = None
    rol: RolUsuario = RolUsuario.ADMIN
    is_active: bool = True
    permisos_modulos: Optional[list[str]] = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not value or len(value) < 6:
            raise ValueError("La contraseña debe tener al menos 6 caracteres")
        return value


class SaasUserUpdate(BaseModel):
    nombre_completo: Optional[str] = None
    telefono: Optional[str] = None
    rol: Optional[RolUsuario] = None
    is_active: Optional[bool] = None
    permisos_modulos: Optional[list[str]] = None


class SaasUserPasswordReset(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not value or len(value) < 6:
            raise ValueError("La contraseña debe tener al menos 6 caracteres")
        return value


class SaasLeadCreate(BaseModel):
    escuela_nombre: str
    contacto_nombre: str
    contacto_email: Optional[EmailStr] = None
    contacto_telefono: Optional[str] = None
    ciudad: Optional[str] = None
    source: Optional[str] = "manual"
    plan_interes: Optional[str] = None
    estado: Optional[str] = "NUEVO"
    valor_estimado_mrr: Optional[float] = None
    proxima_accion_at: Optional[datetime] = None
    notas: Optional[str] = None


class SaasLeadUpdate(BaseModel):
    escuela_nombre: Optional[str] = None
    contacto_nombre: Optional[str] = None
    contacto_email: Optional[EmailStr] = None
    contacto_telefono: Optional[str] = None
    ciudad: Optional[str] = None
    source: Optional[str] = None
    plan_interes: Optional[str] = None
    estado: Optional[str] = None
    valor_estimado_mrr: Optional[float] = None
    proxima_accion_at: Optional[datetime] = None
    notas: Optional[str] = None


class SaasLeadConvertToTenant(BaseModel):
    admin_email: EmailStr
    admin_nombre_completo: str
    admin_cedula: str
    admin_telefono: Optional[str] = None
    admin_password: Optional[str] = None


class BillingPaymentCreate(BaseModel):
    amount: Optional[float] = None
    paid_at: Optional[datetime] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    next_billing_at: Optional[datetime] = None
    set_status_active: bool = True


class SaasSupportTicketCreate(BaseModel):
    tenant_id: int
    subject: str
    description: Optional[str] = None
    category: Optional[str] = "GENERAL"
    priority: Optional[str] = "MEDIUM"
    requester_name: Optional[str] = None
    requester_email: Optional[EmailStr] = None
    requester_phone: Optional[str] = None
    due_at: Optional[datetime] = None


class SaasSupportTicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    owner_email: Optional[EmailStr] = None
    requester_name: Optional[str] = None
    requester_email: Optional[EmailStr] = None
    requester_phone: Optional[str] = None
    due_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None


def _normalize_permisos(permisos: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in (permisos or []):
        value = str(raw or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    if not normalized:
        normalized.append("saas_admin")
    return normalized


def _serialize_saas_user(user: Usuario) -> dict:
    raw_permisos = user.permisos_modulos if isinstance(user.permisos_modulos, list) else []
    permisos = [str(p).strip().lower() for p in raw_permisos if str(p or "").strip()]
    return {
        "id": user.id,
        "email": user.email,
        "nombre_completo": user.nombre_completo,
        "cedula": user.cedula,
        "tipo_documento": user.tipo_documento,
        "telefono": user.telefono,
        "rol": user.rol.value if hasattr(user.rol, "value") else str(user.rol),
        "is_active": user.is_active,
        "created_at": user.created_at,
        "last_login": user.last_login,
        "must_change_password": bool(getattr(user, "must_change_password", False)),
        "password_changed_at": getattr(user, "password_changed_at", None),
        "permisos_modulos": permisos,
    }


def _has_saas_module(actor: Usuario, module_scope: str) -> bool:
    raw_permisos = actor.permisos_modulos if isinstance(actor.permisos_modulos, list) else []
    scopes = {str(p).strip().lower() for p in raw_permisos if str(p or "").strip()}
    return "saas_admin" in scopes or module_scope in scopes


def _require_saas_module(actor: Usuario, module_scope: str, label: str) -> None:
    if not _has_saas_module(actor, module_scope):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permiso insuficiente para {label}",
        )


def _require_any_saas_module(actor: Usuario, module_scopes: list[str], label: str) -> None:
    if any(_has_saas_module(actor, scope) for scope in module_scopes):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Permiso insuficiente para {label}",
    )


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "value"):
        return getattr(value, "value")
    return value


def _write_audit_log(
    db: Session,
    actor: Usuario,
    request: Request,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    payload: Optional[dict] = None,
) -> None:
    db.add(SaasAuditLog(
        actor_user_id=actor.id,
        actor_email=(actor.email or "").strip().lower(),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        summary=summary,
        payload=_json_safe(payload or {}),
        ip_address=(request.client.host if request and request.client else None),
        user_agent=request.headers.get("user-agent") if request else None,
    ))


def _serialize_audit(log: SaasAuditLog) -> dict:
    return {
        "id": log.id,
        "actor_user_id": log.actor_user_id,
        "actor_email": log.actor_email,
        "action": log.action,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "summary": log.summary,
        "payload": log.payload or {},
        "ip_address": log.ip_address,
        "created_at": log.created_at,
    }


def _normalize_stage(stage: Optional[str]) -> str:
    value = str(stage or "NUEVO").strip().upper()
    if value not in LEAD_STAGES:
        raise HTTPException(status_code=400, detail="Estado de lead inválido")
    return value


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return base[:100] if base else ""


def _ensure_unique_tenant_slug(db: Session, seed: str) -> str:
    raw = _slugify(seed) or f"escuela-{int(datetime.utcnow().timestamp())}"
    candidate = raw
    n = 2
    while db.query(Tenant).filter(Tenant.slug == candidate).first() is not None:
        suffix = f"-{n}"
        candidate = f"{raw[:max(1, 100 - len(suffix))]}{suffix}"
        n += 1
    return candidate


def _serialize_lead(lead: SaasLead) -> dict:
    return {
        "id": lead.id,
        "escuela_nombre": lead.escuela_nombre,
        "contacto_nombre": lead.contacto_nombre,
        "contacto_email": lead.contacto_email,
        "contacto_telefono": lead.contacto_telefono,
        "ciudad": lead.ciudad,
        "source": lead.source,
        "plan_interes": lead.plan_interes,
        "estado": lead.estado,
        "valor_estimado_mrr": float(lead.valor_estimado_mrr) if lead.valor_estimado_mrr is not None else None,
        "owner_email": lead.owner_email,
        "proxima_accion_at": lead.proxima_accion_at,
        "converted_tenant_id": lead.converted_tenant_id,
        "converted_admin_user_id": lead.converted_admin_user_id,
        "converted_at": lead.converted_at,
        "notas": lead.notas,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
    }


def _serialize_billing_event(event: SaasBillingEvent) -> dict:
    return {
        "id": event.id,
        "tenant_id": event.tenant_id,
        "tenant_slug": event.tenant.slug if event.tenant else None,
        "tenant_nombre": event.tenant.nombre if event.tenant else None,
        "event_type": event.event_type,
        "status": event.status,
        "amount": float(event.amount or 0),
        "currency": event.currency,
        "paid_at": event.paid_at,
        "due_at": event.due_at,
        "reference": event.reference,
        "notes": event.notes,
        "created_at": event.created_at,
    }


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


def _cycle_days(cycle: Optional[str]) -> int:
    value = str(cycle or "MONTHLY").strip().upper()
    if value == "YEARLY":
        return 365
    if value == "QUARTERLY":
        return 90
    return 30


def _billing_currency(amount: float) -> str:
    return f"${amount:,.0f} COP".replace(",", ".")


def _build_overdue_email_body(tenant: Tenant, days_overdue: int) -> str:
    tenant_name = tenant.display_name or tenant.nombre or tenant.slug
    due_text = tenant.next_billing_at.strftime("%Y-%m-%d") if tenant.next_billing_at else "N/A"
    fee = float(tenant.monthly_fee or 0)
    return (
        f"Hola equipo de {tenant_name},\n\n"
        f"Este es un recordatorio de facturación de {settings.SMTP_FROM_NAME}.\n"
        f"Tienen un cobro pendiente por {_billing_currency(fee)} con fecha {due_text}.\n"
        f"Días de atraso: {max(1, int(days_overdue))}.\n\n"
        "Por favor coordinar el pago para evitar interrupciones en el servicio.\n"
        "Si ya realizaron el pago, ignoren este mensaje.\n\n"
        "Gracias,\n"
        f"{settings.SMTP_FROM_NAME} - Backoffice SaaS"
    )


def _build_school_access_link(tenant_slug: str) -> str:
    base_portal = (settings.PORTAL_URL or "").strip().rstrip("/")
    if base_portal:
        return f"{base_portal}/login?tenant={tenant_slug}"
    base_app = (settings.APP_URL or "").strip().rstrip("/")
    return f"{base_app}/login?tenant={tenant_slug}"


def _build_school_access_email_body(tenant: Tenant, target_name: str | None = None) -> str:
    school_name = tenant.display_name or tenant.nombre or tenant.slug
    login_url = _build_school_access_link(tenant.slug)
    greeting = f"Hola {target_name}," if target_name else "Hola,"
    return (
        f"{greeting}\n\n"
        f"Compartimos el enlace oficial de acceso para {school_name}.\n\n"
        f"- Codigo de escuela: {tenant.slug}\n"
        f"- URL de ingreso: {login_url}\n\n"
        "Te recomendamos guardar este enlace en favoritos para ingresar siempre con la marca de tu escuela.\n\n"
        f"{settings.SMTP_FROM_NAME} - Backoffice SaaS"
    )


def _build_support_sla_email_body(ticket: SaasSupportTicket) -> str:
    tenant_name = ticket.tenant.nombre if ticket.tenant else f"Tenant #{ticket.tenant_id}"
    due_text = ticket.due_at.strftime("%Y-%m-%d %H:%M") if ticket.due_at else "Sin fecha límite"
    return (
        f"Hola,\n\n"
        f"Ticket #{ticket.id} ({ticket.subject}) requiere atención.\n"
        f"Tenant: {tenant_name}\n"
        f"Estado: {ticket.status}\n"
        f"Prioridad: {ticket.priority}\n"
        f"Vence: {due_text}\n\n"
        "Revisa el backoffice SaaS para actualizarlo.\n\n"
        f"{settings.SMTP_FROM_NAME} - Soporte SaaS"
    )


def _build_support_resolution_email_body(ticket: SaasSupportTicket, actor_name: str | None = None) -> str:
    tenant_name = ticket.tenant.nombre if ticket.tenant else f"Tenant #{ticket.tenant_id}"
    greeting = f"Hola {ticket.requester_name}," if ticket.requester_name else "Hola,"
    resolved_at_text = ticket.resolved_at.strftime("%Y-%m-%d %H:%M") if ticket.resolved_at else datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    resolution = ticket.resolution_notes or "Tu solicitud fue atendida por el equipo de soporte."
    return (
        f"{greeting}\n\n"
        f"Tu ticket #{ticket.id} fue actualizado a estado {ticket.status}.\n\n"
        f"Tenant: {tenant_name}\n"
        f"Asunto: {ticket.subject}\n"
        f"Fecha de actualización: {resolved_at_text}\n"
        f"Responsable: {(actor_name or 'Equipo de soporte SaaS')}\n\n"
        f"Resolución:\n{resolution}\n\n"
        "Si necesitas más ayuda, responde este correo o crea un nuevo ticket desde el portal.\n\n"
        f"{settings.SMTP_FROM_NAME} - Soporte SaaS"
    )


def _build_support_in_progress_email_body(ticket: SaasSupportTicket, actor_name: str | None = None) -> str:
    tenant_name = ticket.tenant.nombre if ticket.tenant else f"Tenant #{ticket.tenant_id}"
    greeting = f"Hola {ticket.requester_name}," if ticket.requester_name else "Hola,"
    return (
        f"{greeting}\n\n"
        f"Tu ticket #{ticket.id} ya fue tomado por nuestro equipo y está en estado IN_PROGRESS.\n\n"
        f"Tenant: {tenant_name}\n"
        f"Asunto: {ticket.subject}\n"
        f"Responsable: {(actor_name or 'Equipo de soporte SaaS')}\n\n"
        "Te mantendremos informado con novedades de la atención.\n\n"
        f"{settings.SMTP_FROM_NAME} - Soporte SaaS"
    )


def _bump_session_version(user: Usuario) -> None:
    current = int(getattr(user, "session_version", 1) or 1)
    user.session_version = current + 1


@router.get("/summary")
def get_saas_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_TENANTS, MODULE_BILLING], "resumen SaaS")
    total_tenants = db.query(func.count(Tenant.id)).scalar() or 0
    active_tenants = db.query(func.count(Tenant.id)).filter(Tenant.is_active.is_(True)).scalar() or 0
    inactive_tenants = total_tenants - active_tenants
    demo_tenants = db.query(func.count(Tenant.id)).filter(Tenant.is_demo.is_(True)).scalar() or 0

    by_plan = (
        db.query(Tenant.plan, func.count(Tenant.id).label("total"))
        .group_by(Tenant.plan)
        .all()
    )
    plan_counts = {row.plan: int(row.total or 0) for row in by_plan}
    mrr_estimado = 0
    for plan, count in plan_counts.items():
        mrr_estimado += int(PLAN_MRR_ESTIMATE.get(plan, 0)) * int(count)
    mrr_real = db.query(func.coalesce(func.sum(Tenant.monthly_fee), 0)).filter(
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
        Tenant.is_active.is_(True),
    ).scalar() or 0

    demos_por_vencer = db.query(func.count(Tenant.id)).filter(
        Tenant.is_demo.is_(True),
        Tenant.demo_ends_at.isnot(None),
        Tenant.demo_ends_at <= (datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=0)),
    ).scalar() or 0
    overdue_tenants = db.query(func.count(Tenant.id)).filter(
        Tenant.subscription_status == "PAST_DUE",
        Tenant.is_active.is_(True),
    ).scalar() or 0
    overdue_amount = db.query(func.coalesce(func.sum(Tenant.monthly_fee), 0)).filter(
        Tenant.subscription_status == "PAST_DUE",
        Tenant.is_active.is_(True),
    ).scalar() or 0

    return {
        "total_tenants": int(total_tenants),
        "active_tenants": int(active_tenants),
        "inactive_tenants": int(inactive_tenants),
        "demo_tenants": int(demo_tenants),
        "demos_por_vencer": int(demos_por_vencer),
        "plan_counts": plan_counts,
        "mrr_estimado": int(mrr_estimado),
        "mrr_real": float(mrr_real or 0),
        "overdue_tenants": int(overdue_tenants),
        "overdue_amount": float(overdue_amount or 0),
    }


@router.get("/tenants")
def list_tenants_admin(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    plan: Optional[str] = None,
    is_demo: Optional[bool] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_TENANTS, MODULE_BILLING], "listar tenants")
    query = db.query(Tenant)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            func.lower(Tenant.nombre).like(term) |
            func.lower(Tenant.slug).like(term) |
            func.lower(func.coalesce(Tenant.contacto_email, "")).like(term)
        )
    if plan:
        query = query.filter(Tenant.plan == plan)
    if is_demo is not None:
        query = query.filter(Tenant.is_demo.is_(is_demo))
    if is_active is not None:
        query = query.filter(Tenant.is_active.is_(is_active))

    total = query.count()
    items = query.order_by(Tenant.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "items": [
            {
                "id": t.id,
                "slug": t.slug,
                "nombre": t.nombre,
                "display_name": t.display_name,
                "plan": t.plan,
                "is_active": t.is_active,
                "is_demo": t.is_demo,
                "demo_ends_at": t.demo_ends_at,
                "contacto_email": t.contacto_email,
                "subscription_status": t.subscription_status,
                "billing_cycle": t.billing_cycle,
                "monthly_fee": float(t.monthly_fee or 0),
                "next_billing_at": t.next_billing_at,
                "last_payment_at": t.last_payment_at,
                "created_at": t.created_at,
            }
            for t in items
        ],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.put("/tenants/{tenant_id}")
def update_tenant_admin(
    tenant_id: int,
    payload: TenantAdminUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant no encontrado")

    data = payload.model_dump(exclude_unset=True)
    billing_fields = {"subscription_status", "billing_cycle", "monthly_fee", "next_billing_at", "last_payment_at"}
    tenant_fields = {"plan", "is_active", "is_demo", "demo_ends_at"}
    if any(k in data for k in tenant_fields):
        _require_saas_module(admin, MODULE_TENANTS, "actualizar tenant")
    if any(k in data for k in billing_fields):
        _require_saas_module(admin, MODULE_BILLING, "gestionar facturación")
    if "last_payment_at" in data:
        raise HTTPException(
            status_code=400,
            detail="Último pago se actualiza automáticamente al registrar pagos",
        )

    requested_status: Optional[str] = None
    if "subscription_status" in data and data["subscription_status"] is not None:
        requested_status = str(data["subscription_status"]).strip().upper()
        if requested_status not in SUBSCRIPTION_STATUSES:
            raise HTTPException(status_code=400, detail="Estado de suscripción inválido")
    requested_is_demo: Optional[bool] = bool(data["is_demo"]) if "is_demo" in data else None

    if requested_status is not None:
        if requested_status == "TRIAL":
            requested_is_demo = True
        elif requested_is_demo is None:
            requested_is_demo = False
    if requested_is_demo is not None:
        if requested_is_demo:
            requested_status = "TRIAL"
        elif requested_status == "TRIAL" or requested_status is None:
            requested_status = "ACTIVE"

    if "plan" in data and data["plan"]:
        plan_value = str(data["plan"]).strip().upper()
        valid = {p.value for p in PlanTenant}
        if plan_value not in valid:
            raise HTTPException(status_code=400, detail="Plan inválido")
        tenant.plan = plan_value
    if "is_active" in data:
        tenant.is_active = bool(data["is_active"])
    if requested_is_demo is not None:
        tenant.is_demo = bool(requested_is_demo)
    if "demo_ends_at" in data:
        tenant.demo_ends_at = data["demo_ends_at"]
    if requested_status is not None:
        tenant.subscription_status = requested_status
    if "billing_cycle" in data and data["billing_cycle"] is not None:
        cycle_value = str(data["billing_cycle"]).strip().upper()
        if cycle_value not in BILLING_CYCLES:
            raise HTTPException(status_code=400, detail="Ciclo de cobro inválido")
        tenant.billing_cycle = cycle_value
    if "monthly_fee" in data and data["monthly_fee"] is not None:
        fee = float(data["monthly_fee"] or 0)
        if fee < 0:
            raise HTTPException(status_code=400, detail="La tarifa mensual no puede ser negativa")
        tenant.monthly_fee = fee
    if "next_billing_at" in data:
        tenant.next_billing_at = data["next_billing_at"]
    if tenant.is_demo and tenant.subscription_status != "TRIAL":
        tenant.subscription_status = "TRIAL"
    if not tenant.is_demo and tenant.subscription_status == "TRIAL":
        tenant.subscription_status = "ACTIVE"

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.updated",
        entity_type="tenant",
        entity_id=str(tenant.id),
        summary=f"Actualizó tenant {tenant.slug}",
        payload={"changes": data, "tenant_slug": tenant.slug},
    )
    db.commit()
    db.refresh(tenant)
    return {
        "id": tenant.id,
        "slug": tenant.slug,
        "nombre": tenant.nombre,
        "plan": tenant.plan,
        "is_active": tenant.is_active,
        "is_demo": tenant.is_demo,
        "demo_ends_at": tenant.demo_ends_at,
        "subscription_status": tenant.subscription_status,
        "billing_cycle": tenant.billing_cycle,
        "monthly_fee": float(tenant.monthly_fee or 0),
        "next_billing_at": tenant.next_billing_at,
        "last_payment_at": tenant.last_payment_at,
    }


@router.post("/tenants/{tenant_id}/resend-access-link")
def resend_tenant_access_link(
    tenant_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_TENANTS, "reenviar enlace de acceso de escuela")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")

    admin_user = (
        db.query(Usuario)
        .filter(
            Usuario.tenant_id == tenant.id,
            Usuario.rol == RolUsuario.ADMIN,
            Usuario.is_active.is_(True),
        )
        .order_by(Usuario.id.asc())
        .first()
    )
    recipient_email = (tenant.contacto_email or "").strip().lower() or (admin_user.email if admin_user else "")
    if not recipient_email:
        raise HTTPException(status_code=400, detail="El tenant no tiene correo de contacto para reenviar acceso")

    sent = send_email(
        recipient_email,
        f"[{settings.SMTP_FROM_NAME}] Enlace de acceso - {tenant.display_name or tenant.nombre or tenant.slug}",
        _build_school_access_email_body(tenant, admin_user.nombre_completo if admin_user else None),
    )
    access_link = _build_school_access_link(tenant.slug)

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.access_link_resent",
        entity_type="tenant",
        entity_id=str(tenant.id),
        summary=f"Reenvió enlace de acceso para tenant {tenant.slug}",
        payload={"to": recipient_email, "sent": bool(sent), "access_link": access_link},
    )
    db.commit()
    return {
        "sent": bool(sent),
        "to_email": recipient_email,
        "access_link": access_link,
    }


@router.get("/billing/events")
def list_billing_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=300),
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    event_type: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "consultar eventos de facturación")
    query = db.query(SaasBillingEvent).join(Tenant, Tenant.id == SaasBillingEvent.tenant_id)
    if tenant_id is not None:
        query = query.filter(SaasBillingEvent.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(SaasBillingEvent.status == status_filter.strip().upper())
    if event_type:
        query = query.filter(SaasBillingEvent.event_type == event_type.strip().upper())
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Tenant.nombre).like(term),
                func.lower(Tenant.slug).like(term),
                func.lower(func.coalesce(SaasBillingEvent.reference, "")).like(term),
                func.lower(func.coalesce(SaasBillingEvent.notes, "")).like(term),
            )
        )
    total = query.count()
    items = query.order_by(SaasBillingEvent.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_billing_event(row) for row in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.post("/billing/tenants/{tenant_id}/record-payment")
def record_tenant_payment(
    tenant_id: int,
    payload: BillingPaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_BILLING, "registrar pagos")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    amount = float(payload.amount if payload.amount is not None else (tenant.monthly_fee or 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto de pago debe ser mayor a 0")
    paid_at = payload.paid_at or datetime.utcnow()
    event = SaasBillingEvent(
        tenant_id=tenant.id,
        event_type="PAYMENT_RECORDED",
        status="PAID",
        amount=amount,
        currency="COP",
        paid_at=paid_at,
        due_at=tenant.next_billing_at,
        reference=_normalize_text(payload.reference),
        notes=_normalize_text(payload.notes),
    )
    db.add(event)

    tenant.last_payment_at = paid_at
    if payload.next_billing_at:
        tenant.next_billing_at = payload.next_billing_at
    else:
        base = tenant.next_billing_at if tenant.next_billing_at and tenant.next_billing_at > paid_at else paid_at
        tenant.next_billing_at = base + timedelta(days=_cycle_days(tenant.billing_cycle))
    if payload.set_status_active:
        tenant.subscription_status = "ACTIVE"

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.payment_recorded",
        entity_type="tenant",
        entity_id=str(tenant.id),
        summary=f"Registró pago para tenant {tenant.slug}",
        payload={
            "amount": amount,
            "paid_at": paid_at,
            "next_billing_at": tenant.next_billing_at,
            "reference": event.reference,
        },
    )
    db.commit()
    db.refresh(tenant)
    db.refresh(event)
    return {
        "tenant": {
            "id": tenant.id,
            "slug": tenant.slug,
            "subscription_status": tenant.subscription_status,
            "next_billing_at": tenant.next_billing_at,
            "last_payment_at": tenant.last_payment_at,
        },
        "event": _serialize_billing_event(event),
    }


@router.post("/billing/run-overdue-check")
def run_billing_overdue_check(
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_BILLING, "ejecutar control de vencimientos")
    now = datetime.utcnow()
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at < now,
        Tenant.subscription_status.in_(["ACTIVE", "TRIAL"]),
    ).all()
    updated = 0
    for tenant in candidates:
        tenant.subscription_status = "PAST_DUE"
        db.add(SaasBillingEvent(
            tenant_id=tenant.id,
            event_type="STATUS_CHANGED",
            status="OVERDUE",
            amount=float(tenant.monthly_fee or 0),
            currency="COP",
            due_at=tenant.next_billing_at,
            notes="Marcado automáticamente como vencido por fecha de cobro.",
        ))
        updated += 1

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.overdue_check_run",
        entity_type="billing",
        entity_id="overdue-check",
        summary=f"Ejecutó control de vencimientos SaaS ({updated} tenants marcados PAST_DUE)",
        payload={"updated_tenants": updated},
    )
    db.commit()
    return {"updated_tenants": updated}


@router.post("/billing/run-cycle-charges")
def run_billing_cycle_charges(
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_BILLING, "generar cargos por ciclo")
    now = datetime.utcnow()
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status.in_(["ACTIVE", "TRIAL", "PAST_DUE"]),
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at <= now,
    ).all()
    created = 0
    for tenant in candidates:
        due_at = tenant.next_billing_at
        existing = db.query(SaasBillingEvent).filter(
            SaasBillingEvent.tenant_id == tenant.id,
            SaasBillingEvent.event_type == "INVOICE_ISSUED",
            SaasBillingEvent.due_at == due_at,
        ).first()
        if existing:
            continue
        db.add(SaasBillingEvent(
            tenant_id=tenant.id,
            event_type="INVOICE_ISSUED",
            status="DUE",
            amount=float(tenant.monthly_fee or 0),
            currency="COP",
            due_at=due_at,
            notes=f"Cargo generado por ciclo {tenant.billing_cycle}.",
        ))
        created += 1

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.cycle_charges_run",
        entity_type="billing",
        entity_id="cycle-charges",
        summary=f"Generó cargos por ciclo SaaS ({created} eventos)",
        payload={"created_events": created},
    )
    db.commit()
    return {"created_events": created}


@router.post("/billing/send-overdue-reminders")
def send_billing_overdue_reminders(
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_BILLING, "enviar recordatorios de cartera")
    now = datetime.utcnow()
    candidates = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status == "PAST_DUE",
        Tenant.next_billing_at.isnot(None),
        Tenant.contacto_email.isnot(None),
    ).all()
    sent = 0
    evaluated = 0
    for tenant in candidates:
        email = (tenant.contacto_email or "").strip().lower()
        if not email:
            continue
        evaluated += 1
        recent = db.query(SaasBillingEvent).filter(
            SaasBillingEvent.tenant_id == tenant.id,
            SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
            SaasBillingEvent.created_at >= (now - timedelta(hours=24)),
        ).first()
        if recent:
            continue
        days_overdue = (now.date() - tenant.next_billing_at.date()).days if tenant.next_billing_at else 0
        ok = send_email(
            to_email=email,
            subject=f"[{settings.SMTP_FROM_NAME}] Recordatorio de pago pendiente",
            body=_build_overdue_email_body(tenant, days_overdue),
        )
        if ok:
            db.add(SaasBillingEvent(
                tenant_id=tenant.id,
                event_type="OVERDUE_REMINDER_SENT",
                status="INFO",
                amount=float(tenant.monthly_fee or 0),
                currency="COP",
                due_at=tenant.next_billing_at,
                notes=f"Recordatorio enviado a {email}.",
            ))
            sent += 1

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.overdue_reminders_sent",
        entity_type="billing",
        entity_id="overdue-reminders",
        summary=f"Ejecutó recordatorios de cartera (evaluados={evaluated}, enviados={sent})",
        payload={"evaluated": evaluated, "sent": sent},
    )
    db.commit()
    return {"evaluated": evaluated, "sent": sent}


@router.get("/billing/aging-summary")
def get_billing_aging_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "consultar aging de cartera")
    now = datetime.utcnow()
    rows = db.query(Tenant).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status == "PAST_DUE",
        Tenant.next_billing_at.isnot(None),
    ).all()
    buckets = {
        "0_30": {"tenants": 0, "amount": 0.0},
        "31_60": {"tenants": 0, "amount": 0.0},
        "61_plus": {"tenants": 0, "amount": 0.0},
    }
    for t in rows:
        days = max(0, (now.date() - t.next_billing_at.date()).days)
        fee = float(t.monthly_fee or 0)
        if days <= 30:
            key = "0_30"
        elif days <= 60:
            key = "31_60"
        else:
            key = "61_plus"
        buckets[key]["tenants"] += 1
        buckets[key]["amount"] += fee
    return {
        "generated_at": now,
        "total_past_due_tenants": int(sum(v["tenants"] for v in buckets.values())),
        "total_past_due_amount": float(sum(v["amount"] for v in buckets.values())),
        "buckets": buckets,
    }


@router.get("/support/summary")
def get_support_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_SUPPORT, "resumen de soporte")
    by_status = db.query(SaasSupportTicket.status, func.count(SaasSupportTicket.id)).group_by(SaasSupportTicket.status).all()
    by_priority = db.query(SaasSupportTicket.priority, func.count(SaasSupportTicket.id)).group_by(SaasSupportTicket.priority).all()
    status_counts = {str(s): int(c or 0) for s, c in by_status}
    priority_counts = {str(s): int(c or 0) for s, c in by_priority}
    open_total = int(status_counts.get("OPEN", 0) + status_counts.get("IN_PROGRESS", 0))
    overdue_open = db.query(func.count(SaasSupportTicket.id)).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS"]),
        SaasSupportTicket.due_at.isnot(None),
        SaasSupportTicket.due_at < datetime.utcnow(),
    ).scalar() or 0
    due_soon_open = db.query(func.count(SaasSupportTicket.id)).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS"]),
        SaasSupportTicket.due_at.isnot(None),
        SaasSupportTicket.due_at >= datetime.utcnow(),
        SaasSupportTicket.due_at <= (datetime.utcnow() + timedelta(hours=24)),
    ).scalar() or 0
    return {
        "status_counts": status_counts,
        "priority_counts": priority_counts,
        "open_total": open_total,
        "overdue_open": int(overdue_open),
        "due_soon_open": int(due_soon_open),
    }


@router.get("/support/tickets")
def list_support_tickets(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=300),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_SUPPORT, "listar tickets de soporte")
    query = db.query(SaasSupportTicket).join(Tenant, Tenant.id == SaasSupportTicket.tenant_id)
    if status_filter:
        query = query.filter(SaasSupportTicket.status == str(status_filter).strip().upper())
    if priority:
        query = query.filter(SaasSupportTicket.priority == str(priority).strip().upper())
    if tenant_id is not None:
        query = query.filter(SaasSupportTicket.tenant_id == tenant_id)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Tenant.nombre).like(term),
                func.lower(Tenant.slug).like(term),
                func.lower(SaasSupportTicket.subject).like(term),
                func.lower(func.coalesce(SaasSupportTicket.owner_email, "")).like(term),
            )
        )
    total = query.count()
    items = query.order_by(SaasSupportTicket.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_support_ticket(row) for row in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.post("/support/tickets", status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    payload: SaasSupportTicketCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_SUPPORT, "crear tickets de soporte")
    tenant = db.query(Tenant).filter(Tenant.id == payload.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    priority = str(payload.priority or "MEDIUM").strip().upper()
    if priority not in SUPPORT_PRIORITIES:
        raise HTTPException(status_code=400, detail="Prioridad inválida")
    ticket = SaasSupportTicket(
        tenant_id=tenant.id,
        status="OPEN",
        priority=priority,
        category=str(payload.category or "GENERAL").strip().upper(),
        subject=payload.subject.strip(),
        description=_normalize_text(payload.description),
        owner_email=(admin.email or "").strip().lower(),
        requester_name=_normalize_text(payload.requester_name),
        requester_email=(str(payload.requester_email).strip().lower() if payload.requester_email else None),
        requester_phone=_normalize_text(payload.requester_phone),
        due_at=payload.due_at,
    )
    db.add(ticket)
    db.flush()
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="support.ticket_created",
        entity_type="support_ticket",
        entity_id=str(ticket.id),
        summary=f"Creó ticket de soporte #{ticket.id} para tenant {tenant.slug}",
        payload={"tenant_id": tenant.id, "priority": ticket.priority, "status": ticket.status},
    )
    db.commit()
    db.refresh(ticket)
    return _serialize_support_ticket(ticket)


@router.put("/support/tickets/{ticket_id}")
def update_support_ticket(
    ticket_id: int,
    payload: SaasSupportTicketUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_SUPPORT, "actualizar tickets de soporte")
    ticket = db.query(SaasSupportTicket).filter(SaasSupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket de soporte no encontrado")
    previous_status = str(ticket.status or "").strip().upper()
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        status_value = str(data["status"]).strip().upper()
        if status_value not in SUPPORT_STATUSES:
            raise HTTPException(status_code=400, detail="Estado de ticket inválido")
        ticket.status = status_value
        if status_value in {"RESOLVED", "CLOSED"} and ticket.resolved_at is None:
            ticket.resolved_at = datetime.utcnow()
    if "priority" in data and data["priority"] is not None:
        priority_value = str(data["priority"]).strip().upper()
        if priority_value not in SUPPORT_PRIORITIES:
            raise HTTPException(status_code=400, detail="Prioridad inválida")
        ticket.priority = priority_value
    if "category" in data and data["category"] is not None:
        ticket.category = str(data["category"]).strip().upper()
    if "subject" in data and data["subject"] is not None:
        ticket.subject = str(data["subject"]).strip()
    if "description" in data:
        ticket.description = _normalize_text(data["description"])
    if "owner_email" in data:
        ticket.owner_email = str(data["owner_email"]).strip().lower() if data["owner_email"] else None
    if "requester_name" in data:
        ticket.requester_name = _normalize_text(data["requester_name"])
    if "requester_email" in data:
        ticket.requester_email = str(data["requester_email"]).strip().lower() if data["requester_email"] else None
    if "requester_phone" in data:
        ticket.requester_phone = _normalize_text(data["requester_phone"])
    if "due_at" in data:
        ticket.due_at = data["due_at"]
    if "resolution_notes" in data:
        ticket.resolution_notes = _normalize_text(data["resolution_notes"])

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="support.ticket_updated",
        entity_type="support_ticket",
        entity_id=str(ticket.id),
        summary=f"Actualizó ticket de soporte #{ticket.id}",
        payload={"changes": data},
    )

    new_status = str(ticket.status or "").strip().upper()
    moved_to_in_progress = previous_status == "OPEN" and new_status == "IN_PROGRESS"
    if moved_to_in_progress:
        target_email = (
            (ticket.requester_email or "").strip().lower()
            or (ticket.tenant.contacto_email.strip().lower() if ticket.tenant and ticket.tenant.contacto_email else "")
        )
        sent = False
        if target_email:
            sent = send_email(
                to_email=target_email,
                subject=f"[{settings.SMTP_FROM_NAME}] Ticket #{ticket.id} en atención",
                body=_build_support_in_progress_email_body(ticket, admin.nombre_completo),
            )
        _write_audit_log(
            db=db,
            actor=admin,
            request=request,
            action="support.ticket_in_progress_notified",
            entity_type="support_ticket",
            entity_id=str(ticket.id),
            summary=f"Notificación de inicio de atención ticket #{ticket.id}",
            payload={"to": target_email or None, "sent": bool(sent), "status": new_status},
        )

    moved_to_resolved = (
        previous_status not in {"RESOLVED", "CLOSED"}
        and new_status in {"RESOLVED", "CLOSED"}
    )
    if moved_to_resolved:
        target_email = (
            (ticket.requester_email or "").strip().lower()
            or (ticket.tenant.contacto_email.strip().lower() if ticket.tenant and ticket.tenant.contacto_email else "")
        )
        sent = False
        if target_email:
            sent = send_email(
                to_email=target_email,
                subject=f"[{settings.SMTP_FROM_NAME}] Ticket #{ticket.id} {new_status}",
                body=_build_support_resolution_email_body(ticket, admin.nombre_completo),
            )
        _write_audit_log(
            db=db,
            actor=admin,
            request=request,
            action="support.ticket_resolution_notified",
            entity_type="support_ticket",
            entity_id=str(ticket.id),
            summary=f"Notificación de resolución de ticket #{ticket.id}",
            payload={"to": target_email or None, "sent": bool(sent), "status": new_status},
        )

    db.commit()
    db.refresh(ticket)
    return _serialize_support_ticket(ticket)


@router.post("/support/run-sla-alerts")
def run_support_sla_alerts(
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_SUPPORT, "ejecutar alertas SLA de soporte")
    now = datetime.utcnow()
    candidates = db.query(SaasSupportTicket).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS"]),
        SaasSupportTicket.due_at.isnot(None),
    ).all()
    evaluated = 0
    sent = 0
    for ticket in candidates:
        due_delta_hours = (ticket.due_at - now).total_seconds() / 3600
        should_alert = due_delta_hours <= 24
        if not should_alert:
            continue
        evaluated += 1
        if ticket.last_sla_alert_at and ticket.last_sla_alert_at >= (now - timedelta(hours=12)):
            continue
        target_email = (
            (ticket.owner_email or "").strip().lower()
            or (ticket.requester_email or "").strip().lower()
        )
        if not target_email:
            continue
        ok = send_email(
            to_email=target_email,
            subject=f"[{settings.SMTP_FROM_NAME}] Alerta SLA ticket #{ticket.id}",
            body=_build_support_sla_email_body(ticket),
        )
        if not ok:
            continue
        ticket.last_sla_alert_at = now
        _write_audit_log(
            db=db,
            actor=admin,
            request=request,
            action="support.sla_alert_sent",
            entity_type="support_ticket",
            entity_id=str(ticket.id),
            summary=f"Alerta SLA enviada para ticket #{ticket.id}",
            payload={"to": target_email, "due_at": ticket.due_at, "status": ticket.status},
        )
        sent += 1

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="support.sla_alerts_run",
        entity_type="support",
        entity_id="sla-alerts",
        summary=f"Ejecutó alertas SLA de soporte (evaluados={evaluated}, enviados={sent})",
        payload={"evaluated": evaluated, "sent": sent},
    )
    db.commit()
    return {"evaluated": evaluated, "sent": sent}


@router.get("/users")
def list_saas_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_USERS, "listar usuarios SaaS")
    query = db.query(Usuario).filter(Usuario.tenant_id.is_(None))
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Usuario.nombre_completo).like(term),
                func.lower(Usuario.email).like(term),
                func.lower(func.coalesce(Usuario.cedula, "")).like(term),
            )
        )
    if is_active is not None:
        query = query.filter(Usuario.is_active.is_(is_active))
    total = query.count()
    items = query.order_by(Usuario.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_saas_user(user) for user in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_saas_user(
    payload: SaasUserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_USERS, "crear usuarios SaaS")
    email = payload.email.strip().lower()
    existing_user = db.query(Usuario).filter(or_(Usuario.email == email, Usuario.cedula == payload.cedula)).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="El email o cédula ya existe")
    new_user = Usuario(
        tenant_id=None,
        email=email,
        password_hash=get_password_hash(payload.password),
        nombre_completo=payload.nombre_completo.strip(),
        cedula=payload.cedula.strip(),
        tipo_documento=(payload.tipo_documento or "CEDULA").strip(),
        telefono=(payload.telefono or "").strip() or None,
        rol=payload.rol,
        is_active=bool(payload.is_active),
        is_verified=True,
        must_change_password=True,
        password_changed_at=None,
        permisos_modulos=_normalize_permisos(payload.permisos_modulos),
    )
    db.add(new_user)
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="saas_user.created",
        entity_type="saas_user",
        entity_id=email,
        summary=f"Creó usuario SaaS {email}",
        payload={
            "email": email,
            "rol": payload.rol.value if hasattr(payload.rol, "value") else str(payload.rol),
            "is_active": bool(payload.is_active),
        },
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="El email o cédula ya existe")
    db.refresh(new_user)
    return _serialize_saas_user(new_user)


@router.put("/users/{user_id}")
def update_saas_user(
    user_id: int,
    payload: SaasUserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_USERS, "actualizar usuarios SaaS")
    user = db.query(Usuario).filter(Usuario.id == user_id, Usuario.tenant_id.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario SaaS no encontrado")
    data = payload.model_dump(exclude_unset=True)
    if "nombre_completo" in data and data["nombre_completo"] is not None:
        user.nombre_completo = str(data["nombre_completo"]).strip()
    if "telefono" in data:
        user.telefono = (str(data["telefono"]).strip() if data["telefono"] else None)
    if "rol" in data and data["rol"] is not None:
        user.rol = data["rol"]
    if "is_active" in data:
        user.is_active = bool(data["is_active"])
    if "permisos_modulos" in data:
        user.permisos_modulos = _normalize_permisos(data["permisos_modulos"])
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="saas_user.updated",
        entity_type="saas_user",
        entity_id=str(user.id),
        summary=f"Actualizó usuario SaaS {user.email}",
        payload={
            "changes": data,
            "email": user.email,
        },
    )
    db.commit()
    db.refresh(user)
    return _serialize_saas_user(user)


@router.put("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_saas_user_password(
    user_id: int,
    payload: SaasUserPasswordReset,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_USERS, "resetear contraseñas SaaS")
    user = db.query(Usuario).filter(Usuario.id == user_id, Usuario.tenant_id.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario SaaS no encontrado")
    user.password_hash = get_password_hash(payload.new_password)
    user.must_change_password = True
    user.password_changed_at = None
    _bump_session_version(user)
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="saas_user.password_reset",
        entity_type="saas_user",
        entity_id=str(user.id),
        summary=f"Reseteó contraseña de usuario SaaS {user.email}",
        payload={"email": user.email},
    )
    db.commit()
    return None


@router.get("/audit-logs")
def list_saas_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    action: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_AUDIT, "consultar auditoría SaaS")
    query = db.query(SaasAuditLog)
    if action:
        query = query.filter(SaasAuditLog.action == action.strip())
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(SaasAuditLog.actor_email).like(term),
                func.lower(SaasAuditLog.summary).like(term),
                func.lower(SaasAuditLog.entity_id).like(term),
            )
        )
    total = query.count()
    items = query.order_by(SaasAuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_audit(log) for log in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.get("/audit-logs/export.csv")
def export_saas_audit_logs_csv(
    action: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_AUDIT, "exportar auditoría SaaS")
    query = db.query(SaasAuditLog)
    if action:
        query = query.filter(SaasAuditLog.action == action.strip())
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(SaasAuditLog.actor_email).like(term),
                func.lower(SaasAuditLog.summary).like(term),
                func.lower(SaasAuditLog.entity_id).like(term),
            )
        )
    rows = query.order_by(SaasAuditLog.created_at.desc()).limit(5000).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["fecha_utc", "actor_email", "action", "entity_type", "entity_id", "summary", "ip_address"])
    for row in rows:
        writer.writerow([
            row.created_at.isoformat() if row.created_at else "",
            row.actor_email or "",
            row.action or "",
            row.entity_type or "",
            row.entity_id or "",
            row.summary or "",
            row.ip_address or "",
        ])

    content = output.getvalue()
    output.close()
    filename = f"saas_audit_logs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pipeline/summary")
def get_pipeline_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_PIPELINE, "resumen de pipeline")
    by_stage = db.query(SaasLead.estado, func.count(SaasLead.id)).group_by(SaasLead.estado).all()
    stage_counts = {str(stage): int(total or 0) for stage, total in by_stage}

    open_stages = ["NUEVO", "CONTACTADO", "DEMO_AGENDADA", "PROPUESTA_ENVIADA"]
    mrr_potencial = db.query(func.coalesce(func.sum(SaasLead.valor_estimado_mrr), 0)).filter(
        SaasLead.estado.in_(open_stages)
    ).scalar() or 0
    mrr_cerrado = db.query(func.coalesce(func.sum(SaasLead.valor_estimado_mrr), 0)).filter(
        SaasLead.estado == "CERRADO_GANADO"
    ).scalar() or 0
    overdue_followups = db.query(func.count(SaasLead.id)).filter(
        SaasLead.estado.in_(open_stages),
        SaasLead.proxima_accion_at.isnot(None),
        SaasLead.proxima_accion_at < datetime.utcnow(),
    ).scalar() or 0
    total_leads = db.query(func.count(SaasLead.id)).scalar() or 0

    return {
        "total_leads": int(total_leads),
        "stage_counts": stage_counts,
        "mrr_potencial": float(mrr_potencial or 0),
        "mrr_cerrado": float(mrr_cerrado or 0),
        "overdue_followups": int(overdue_followups),
    }


@router.get("/pipeline/leads")
def list_pipeline_leads(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=300),
    search: Optional[str] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_PIPELINE, "listar leads")
    query = db.query(SaasLead)
    if estado:
        query = query.filter(SaasLead.estado == _normalize_stage(estado))
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(SaasLead.escuela_nombre).like(term),
                func.lower(SaasLead.contacto_nombre).like(term),
                func.lower(func.coalesce(SaasLead.contacto_email, "")).like(term),
                func.lower(func.coalesce(SaasLead.owner_email, "")).like(term),
            )
        )
    total = query.count()
    items = query.order_by(SaasLead.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_lead(lead) for lead in items],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.post("/pipeline/leads", status_code=status.HTTP_201_CREATED)
def create_pipeline_lead(
    payload: SaasLeadCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_PIPELINE, "crear leads")
    lead = SaasLead(
        escuela_nombre=payload.escuela_nombre.strip(),
        contacto_nombre=payload.contacto_nombre.strip(),
        contacto_email=(str(payload.contacto_email).strip().lower() if payload.contacto_email else None),
        contacto_telefono=(payload.contacto_telefono or "").strip() or None,
        ciudad=(payload.ciudad or "").strip() or None,
        source=(payload.source or "manual").strip().lower(),
        plan_interes=(payload.plan_interes or "").strip().upper() or None,
        estado=_normalize_stage(payload.estado),
        valor_estimado_mrr=payload.valor_estimado_mrr,
        owner_email=(admin.email or "").strip().lower(),
        proxima_accion_at=payload.proxima_accion_at,
        notas=(payload.notas or "").strip() or None,
    )
    db.add(lead)
    db.flush()
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="lead.created",
        entity_type="lead",
        entity_id=str(lead.id),
        summary=f"Creó lead {lead.escuela_nombre}",
        payload={"estado": lead.estado, "owner_email": lead.owner_email},
    )
    db.commit()
    db.refresh(lead)
    return _serialize_lead(lead)


@router.put("/pipeline/leads/{lead_id}")
def update_pipeline_lead(
    lead_id: int,
    payload: SaasLeadUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_PIPELINE, "actualizar leads")
    lead = db.query(SaasLead).filter(SaasLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    data = payload.model_dump(exclude_unset=True)
    if "estado" in data and data["estado"] is not None:
        data["estado"] = _normalize_stage(data["estado"])
    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip()
            if field == "contacto_email":
                value = value.lower()
            if value == "":
                value = None
        setattr(lead, field, value)
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="lead.updated",
        entity_type="lead",
        entity_id=str(lead.id),
        summary=f"Actualizó lead {lead.escuela_nombre}",
        payload={"changes": data},
    )
    db.commit()
    db.refresh(lead)
    return _serialize_lead(lead)


@router.post("/pipeline/leads/{lead_id}/convert-to-tenant")
def convert_lead_to_tenant(
    lead_id: int,
    payload: SaasLeadConvertToTenant,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_PIPELINE, "convertir leads a tenant")
    _require_saas_module(admin, MODULE_TENANTS, "crear tenant desde lead")
    lead = db.query(SaasLead).filter(SaasLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if lead.converted_tenant_id:
        raise HTTPException(status_code=409, detail="Este lead ya fue convertido a tenant")

    admin_email = payload.admin_email.strip().lower()
    existing_user = db.query(Usuario).filter(Usuario.email == admin_email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="El correo del administrador ya existe")
    cedula = payload.admin_cedula.strip()
    if db.query(Usuario).filter(Usuario.cedula == cedula).first():
        raise HTTPException(status_code=409, detail="La cédula del administrador ya existe")

    plan_value = str((lead.plan_interes or "FREE")).strip().upper()
    valid_plans = {p.value for p in PlanTenant}
    if plan_value not in valid_plans:
        plan_value = PlanTenant.FREE.value
    is_demo = True
    demo_days = max(1, int(settings.DEFAULT_DEMO_DAYS or 14))
    tenant = Tenant(
        slug=_ensure_unique_tenant_slug(db, lead.escuela_nombre),
        nombre=(lead.escuela_nombre or "").strip(),
        display_name=(lead.escuela_nombre or "").strip(),
        plan=plan_value,
        is_active=True,
        is_demo=is_demo,
        demo_ends_at=datetime.utcnow() + timedelta(days=demo_days),
        subscription_status="TRIAL",
        billing_cycle="MONTHLY",
        monthly_fee=float(PLAN_MRR_ESTIMATE.get(plan_value, 0)),
        next_billing_at=datetime.utcnow() + timedelta(days=demo_days),
        contacto_email=(lead.contacto_email or "").strip().lower() or None,
        contacto_telefono=_normalize_text(lead.contacto_telefono),
    )
    db.add(tenant)
    db.flush()

    temp_password = payload.admin_password.strip() if payload.admin_password and payload.admin_password.strip() else secrets.token_urlsafe(8)
    admin_user = Usuario(
        tenant_id=tenant.id,
        email=admin_email,
        password_hash=get_password_hash(temp_password),
        nombre_completo=payload.admin_nombre_completo.strip(),
        cedula=cedula,
        telefono=_normalize_text(payload.admin_telefono),
        rol=RolUsuario.ADMIN,
        is_active=True,
        is_verified=True,
        must_change_password=True,
        permisos_modulos=None,
    )
    db.add(admin_user)
    db.flush()
    db.add(TenantUser(
        tenant_id=tenant.id,
        user_id=admin_user.id,
        rol=RolUsuario.ADMIN.value,
        is_active=True,
    ))

    lead.estado = "CERRADO_GANADO"
    lead.converted_tenant_id = tenant.id
    lead.converted_admin_user_id = admin_user.id
    lead.converted_at = datetime.utcnow()
    lead.updated_at = datetime.utcnow()
    db.add(SaasBillingEvent(
        tenant_id=tenant.id,
        event_type="STATUS_CHANGED",
        status="INFO",
        amount=float(tenant.monthly_fee or 0),
        currency="COP",
        due_at=tenant.next_billing_at,
        notes="Tenant creado desde lead en modo demo/trial.",
    ))

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="lead.converted_to_tenant",
        entity_type="lead",
        entity_id=str(lead.id),
        summary=f"Convirtió lead {lead.escuela_nombre} a tenant {tenant.slug}",
        payload={
            "tenant_id": tenant.id,
            "tenant_slug": tenant.slug,
            "admin_email": admin_user.email,
        },
    )
    db.commit()
    db.refresh(lead)

    return {
        "lead": _serialize_lead(lead),
        "tenant": {
            "id": tenant.id,
            "slug": tenant.slug,
            "nombre": tenant.nombre,
            "plan": tenant.plan,
            "is_demo": tenant.is_demo,
            "demo_ends_at": tenant.demo_ends_at,
        },
        "admin_user": {
            "id": admin_user.id,
            "email": admin_user.email,
            "must_change_password": bool(admin_user.must_change_password),
            "temporary_password": temp_password,
        },
    }
