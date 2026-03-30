import re
import secrets
import csv
import io
import os
import base64
import urllib.request
from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, or_, text, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.api.deps import get_saas_admin_user
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.core.security import get_password_hash
from app.models.saas_audit_log import SaasAuditLog
from app.models.saas_billing_event import SaasBillingEvent
from app.models.saas_payment_receipt import SaasPaymentReceipt
from app.models.saas_lead import SaasLead
from app.models.saas_support_ticket import SaasSupportTicket
from app.models.tenant_branch import TenantBranch, TenantUserBranch
from app.models.tenant import PlanTenant, Tenant, TenantUser
from app.models.usuario import RolUsuario, Usuario

router = APIRouter()


PLAN_ALIASES = {
    "DEMO": PlanTenant.FREE.value,
    "FREE": PlanTenant.FREE.value,
    "BASIC": PlanTenant.BASIC.value,
    "BASICO": PlanTenant.BASIC.value,
    "PRO": PlanTenant.PRO.value,
    "EMPRENDEDOR": PlanTenant.PRO.value,
    "ENTERPRISE": PlanTenant.ENTERPRISE.value,
    "EMPRESA": PlanTenant.ENTERPRISE.value,
}
PLAN_PUBLIC_LABELS = {
    PlanTenant.FREE.value: "DEMO",
    PlanTenant.BASIC.value: "BASICO",
    PlanTenant.PRO.value: "EMPRENDEDOR",
    PlanTenant.ENTERPRISE.value: "EMPRESA",
}
PLAN_BILLING_POLICY = {
    PlanTenant.FREE.value: {
        "duration_days": 15,
        "billing_cycle": "QUARTERLY",
        "base_fee": 0.0,
        "extra_branch_fee": 0.0,
    },
    PlanTenant.BASIC.value: {
        "duration_days": 90,
        "billing_cycle": "QUARTERLY",
        "base_fee": 450000.0,
        "extra_branch_fee": 250000.0,
    },
    PlanTenant.PRO.value: {
        "duration_days": 180,
        "billing_cycle": "SEMIANNUAL",
        "base_fee": 850000.0,
        "extra_branch_fee": 450000.0,
    },
    PlanTenant.ENTERPRISE.value: {
        "duration_days": 365,
        "billing_cycle": "YEARLY",
        "base_fee": 1500000.0,
        "extra_branch_fee": 650000.0,
    },
}
FREE_BRANCHES_PER_TENANT = 1
VAT_RATE = 0.19
DUNNING_STAGE_RULES = [
    ("OVERDUE_14D", "Atraso 14+ días", 14),
    ("OVERDUE_7D", "Atraso 7+ días", 7),
    ("OVERDUE_3D", "Atraso 3+ días", 3),
    ("OVERDUE_0D", "Vencido hoy", 0),
    ("PRE_DUE_3D", "Por vencer (3 días)", -3),
]
PLAN_MRR_ESTIMATE = {
    code: int((float(meta.get("base_fee", 0.0)) / max(1, float(meta.get("duration_days", 30))) * 30.0))
    for code, meta in PLAN_BILLING_POLICY.items()
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
BILLING_CYCLES = {"QUARTERLY", "SEMIANNUAL", "YEARLY"}
MODULE_TENANTS = "saas_tenants_manage"
MODULE_BILLING = "saas_billing_manage"
MODULE_USERS = "saas_users_manage"
MODULE_AUDIT = "saas_audit_read"
MODULE_PIPELINE = "saas_pipeline_manage"
MODULE_SUPPORT = "saas_support_manage"
MODULE_BRANCHES = "saas_branches_manage"
SUPPORT_STATUSES = {"OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"}
SUPPORT_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
SAAS_RECEIPTS_DIR = Path("uploads") / "saas_receipts"
SAAS_RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
SAAS_COMPANY_NAME = "Prometheus Tech"
SAAS_COMPANY_NIT = "123.123.123-1"
SAAS_COMPANY_EMAIL = "softwaresiaec@gmail.com"
SAAS_COMPANY_PHONES = "(+57) 323 5492939 - (+57)316 5393281"


class TenantAdminUpdate(BaseModel):
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    is_demo: Optional[bool] = None
    demo_ends_at: Optional[datetime] = None
    contacto_nombre: Optional[str] = None
    contacto_email: Optional[EmailStr] = None
    contacto_telefono: Optional[str] = None
    subscription_status: Optional[str] = None
    billing_cycle: Optional[str] = None
    monthly_fee: Optional[float] = None
    next_billing_at: Optional[datetime] = None
    last_payment_at: Optional[datetime] = None


class SaasTenantCreate(BaseModel):
    nombre_escuela: str
    slug: Optional[str] = None
    display_name: Optional[str] = None
    plan: Optional[str] = PlanTenant.FREE.value
    contacto_nombre: Optional[str] = None
    contacto_email: EmailStr
    contacto_telefono: Optional[str] = None
    nit: Optional[str] = None
    logo_url: Optional[str] = None
    admin_email: EmailStr
    admin_password: Optional[str] = None
    admin_nombre_completo: str
    admin_cedula: str
    admin_telefono: Optional[str] = None
    send_welcome_email: bool = True
    activate_tenant: bool = True


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


class SaasBranchCreate(BaseModel):
    nombre: str
    codigo: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    contacto_telefono: Optional[str] = None
    contacto_email: Optional[EmailStr] = None
    observaciones: Optional[str] = None
    is_active: bool = True
    is_primary: bool = False


class SaasBranchUpdate(BaseModel):
    nombre: Optional[str] = None
    codigo: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    contacto_telefono: Optional[str] = None
    contacto_email: Optional[EmailStr] = None
    observaciones: Optional[str] = None
    is_active: Optional[bool] = None


class SaasTenantUserBranchUpdate(BaseModel):
    branch_ids: list[int]
    is_active: bool = True
    mode: str = "replace"


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


class BillingReceiptResendRequest(BaseModel):
    to_email: Optional[EmailStr] = None


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


def _resolve_plan_code(plan_value: Optional[str]) -> str:
    raw = str(plan_value or PlanTenant.FREE.value).strip().upper()
    resolved = PLAN_ALIASES.get(raw)
    if not resolved:
        raise HTTPException(status_code=400, detail="Plan inválido")
    return resolved


def _plan_policy_for(plan_code: str) -> dict:
    return PLAN_BILLING_POLICY.get(plan_code, PLAN_BILLING_POLICY[PlanTenant.FREE.value])


def _plan_public_label(plan_code: str) -> str:
    return PLAN_PUBLIC_LABELS.get(plan_code, plan_code)


def _get_active_branches_count(db: Session, tenant_id: int) -> int:
    active_count = db.query(func.count(TenantBranch.id)).filter(
        TenantBranch.tenant_id == tenant_id,
        TenantBranch.is_active.is_(True),
    ).scalar() or 0
    return int(active_count)


def _tenant_period_amounts(db: Session, tenant: Tenant) -> dict:
    plan_code = str(tenant.plan or PlanTenant.FREE.value).strip().upper()
    policy = _plan_policy_for(plan_code)
    base_fee = float(tenant.monthly_fee or policy.get("base_fee", 0.0) or 0.0)
    active_branches_total = _get_active_branches_count(db, int(tenant.id))
    active_additional_branches = max(0, active_branches_total - 1)
    included_free_branches_used = min(active_additional_branches, FREE_BRANCHES_PER_TENANT)
    billable_branches = max(0, active_additional_branches - included_free_branches_used)
    extra_branch_fee = float(policy.get("extra_branch_fee", 0.0) or 0.0)
    branch_amount = float(billable_branches) * extra_branch_fee
    subtotal = max(0.0, base_fee + branch_amount)
    iva_amount = round(subtotal * VAT_RATE, 2) if subtotal > 0 else 0.0
    total = round(subtotal + iva_amount, 2)
    return {
        "plan_code": plan_code,
        "plan_label": _plan_public_label(plan_code),
        "duration_days": int(policy.get("duration_days", 30) or 30),
        "billing_cycle": str(policy.get("billing_cycle", tenant.billing_cycle or "QUARTERLY")).upper(),
        "base_fee": round(base_fee, 2),
        "free_branches": FREE_BRANCHES_PER_TENANT,
        "included_free_branches_used": included_free_branches_used,
        "active_branches_total": active_branches_total,
        "active_additional_branches": active_additional_branches,
        "billable_branches": billable_branches,
        "extra_branch_fee": round(extra_branch_fee, 2),
        "branch_amount": round(branch_amount, 2),
        "subtotal": round(subtotal, 2),
        "iva_rate": VAT_RATE,
        "iva_amount": iva_amount,
        "total": total,
    }


def _normalize_branch_code(value: Optional[str], fallback_name: str) -> str:
    seed = value or fallback_name
    code = re.sub(r"[^A-Z0-9]+", "-", str(seed or "").strip().upper()).strip("-")
    code = code[:50]
    return code or "SUCURSAL"


def _serialize_branch(branch: TenantBranch) -> dict:
    return {
        "id": branch.id,
        "tenant_id": branch.tenant_id,
        "nombre": branch.nombre,
        "codigo": branch.codigo,
        "is_active": branch.is_active,
        "is_primary": branch.is_primary,
        "direccion": branch.direccion,
        "ciudad": branch.ciudad,
        "contacto_telefono": branch.contacto_telefono,
        "contacto_email": branch.contacto_email,
        "observaciones": branch.observaciones,
        "created_at": branch.created_at,
        "updated_at": branch.updated_at,
    }


def _ensure_primary_branch(db: Session, tenant: Tenant) -> TenantBranch:
    primary = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
        TenantBranch.is_primary.is_(True),
    ).first()
    if primary:
        return primary
    fallback = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
    ).order_by(TenantBranch.id.asc()).first()
    if fallback:
        fallback.is_primary = True
        fallback.is_active = True
        return fallback
    created = TenantBranch(
        tenant_id=tenant.id,
        nombre=(tenant.display_name or tenant.nombre or "Sede Principal").strip(),
        codigo="PRINCIPAL",
        is_active=True,
        is_primary=True,
        direccion=None,
        ciudad=None,
        contacto_telefono=tenant.contacto_telefono,
        contacto_email=tenant.contacto_email,
    )
    db.add(created)
    db.flush()
    return created


def _ensure_user_primary_branch_access(
    db: Session,
    tenant: Tenant,
    user_id: int,
) -> TenantUserBranch:
    primary = _ensure_primary_branch(db, tenant)
    access = db.query(TenantUserBranch).filter(
        TenantUserBranch.tenant_id == tenant.id,
        TenantUserBranch.user_id == user_id,
        TenantUserBranch.branch_id == primary.id,
    ).first()
    if access:
        access.is_active = True
        return access
    access = TenantUserBranch(
        tenant_id=tenant.id,
        user_id=user_id,
        branch_id=primary.id,
        is_active=True,
    )
    db.add(access)
    db.flush()
    return access


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


def _serialize_billing_event(event: SaasBillingEvent, include_receipt: bool = True) -> dict:
    receipt = None
    if include_receipt:
        try:
            receipt = event.receipt if hasattr(event, "receipt") else None
        except Exception:
            receipt = None
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
        "receipt": _serialize_payment_receipt(receipt),
        "receipt_available": bool(receipt and receipt.file_path),
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
    value = str(cycle or "QUARTERLY").strip().upper()
    if value == "YEARLY":
        return 365
    if value == "SEMIANNUAL":
        return 180
    # Backward compatibility for legacy tenants not yet normalized.
    if value == "MONTHLY":
        return 30
    if value == "QUARTERLY":
        return 90
    return 90


def _billing_currency(amount: float) -> str:
    return f"${amount:,.0f} COP".replace(",", ".")


def _split_total_with_vat(total_amount: float, iva_rate: float = VAT_RATE) -> tuple[float, float]:
    if total_amount <= 0:
        return 0.0, 0.0
    divisor = 1.0 + max(0.0, float(iva_rate or 0.0))
    subtotal = round(float(total_amount) / divisor, 2)
    iva_amount = round(float(total_amount) - subtotal, 2)
    return subtotal, iva_amount


def _next_receipt_number(db: Session) -> str:
    current_year = datetime.utcnow().year
    prefix = f"REC-SAA-{current_year}-"
    latest = db.query(SaasPaymentReceipt).filter(
        SaasPaymentReceipt.receipt_number.like(f"{prefix}%")
    ).order_by(SaasPaymentReceipt.id.desc()).first()
    if latest and latest.receipt_number:
        try:
            seq = int(str(latest.receipt_number).split("-")[-1]) + 1
        except Exception:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:06d}"


def _render_payment_receipt_pdf(
    receipt_number: str,
    tenant: Tenant,
    event: SaasBillingEvent,
    pricing: dict,
    recorded_amount: float,
) -> bytes:
    def _resolve_logo_for_pdf_saas() -> Optional[object]:
        # SaaS receipt must always use SIAEC brand logo (never tenant logo).
        raw = settings.BRAND_LOGO_PATH or os.getenv("BRAND_LOGO_PATH") or ""
        repo_root = Path(__file__).resolve().parents[5]
        if not raw:
            fallback_candidates = [
                repo_root / "frontend" / "public" / "logo-siaec-sin-fondo.png",
                repo_root / "frontend" / "public" / "logo-siaec.png",
                repo_root / "frontend" / "assets" / "logo-siaec-sin-fondo.png",
                repo_root / "frontend" / "assets" / "logo-siaec.png",
            ]
            for default_logo in fallback_candidates:
                if default_logo.exists():
                    return str(default_logo)
            return None
        if raw.startswith("data:image"):
            try:
                _header, encoded = raw.split(",", 1)
                return BytesIO(base64.b64decode(encoded))
            except Exception:
                return None
        if raw.startswith("http://") or raw.startswith("https://"):
            try:
                req = urllib.request.Request(raw, headers={"User-Agent": "SIAEC-SaaS-PDF/1.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return BytesIO(resp.read())
            except Exception:
                return None
        if raw.startswith("/"):
            rel = raw.lstrip("/")
            candidates = [
                repo_root / "frontend" / "public" / rel,
                repo_root / "frontend" / "assets" / rel,
            ]
            for path in candidates:
                if path.exists():
                    return str(path)
        if os.path.exists(raw):
            return raw
        return None

    def _pdf_kv(c: canvas.Canvas, label: str, value: str, y: int) -> int:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(120, y, f"{label}:")
        c.setFont("Helvetica", 10)
        c.drawString(300, y, value)
        return y - 18

    def _pdf_section(c: canvas.Canvas, title: str, y: int) -> int:
        title = title.upper()
        x = 80
        section_width = 452
        section_height = 18
        rect_y = y - 12
        c.setFillColor(colors.Color(0.95, 0.96, 0.98))
        c.setStrokeColor(colors.Color(0.88, 0.90, 0.94))
        c.rect(x, rect_y, section_width, section_height, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 11)
        text_width = c.stringWidth(title, "Helvetica-Bold", 11)
        c.drawString(x + (section_width - text_width) / 2, y - 8, title)
        return y - 24

    subtotal_amount = float(pricing.get("subtotal", 0.0) or 0.0)
    iva_rate = float(pricing.get("iva_rate", VAT_RATE) or VAT_RATE)
    iva_amount = float(pricing.get("iva_amount", 0.0) or 0.0)
    total_amount = float(pricing.get("total", 0.0) or 0.0)
    plan_label = str(pricing.get("plan_label") or _plan_public_label(tenant.plan))
    duration_days = int(pricing.get("duration_days", 30) or 30)
    base_fee = float(pricing.get("base_fee", 0.0) or 0.0)
    active_additional = int(pricing.get("active_additional_branches", 0) or 0)
    free_included = int(pricing.get("included_free_branches_used", 0) or 0)
    billable_branches = int(pricing.get("billable_branches", 0) or 0)
    extra_branch_fee = float(pricing.get("extra_branch_fee", 0.0) or 0.0)
    branch_amount = float(pricing.get("branch_amount", 0.0) or 0.0)
    paid_at_text = event.paid_at.strftime("%Y-%m-%d %H:%M:%S") if event.paid_at else "-"
    due_at_text = event.due_at.strftime("%Y-%m-%d") if event.due_at else "-"

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)

    logo_src = _resolve_logo_for_pdf_saas()
    if logo_src:
        try:
            logo = ImageReader(logo_src)
            pdf.drawImage(logo, 186, 675, width=240, height=120, preserveAspectRatio=True, mask='auto')
        except Exception:
            pass

    pdf.setFont("Helvetica", 11)
    pdf.drawCentredString(306, 664, f"{SAAS_COMPANY_NAME} | NIT {SAAS_COMPANY_NIT}")
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawCentredString(306, 648, "Recibo de pago")

    y = 618
    pdf.setLineWidth(0.5)
    pdf.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(pdf, "Datos del recibo", y)
    y = _pdf_kv(pdf, "Número", receipt_number, y)
    y = _pdf_kv(pdf, "Fecha emisión", f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC", y)
    y = _pdf_kv(pdf, "Moneda", event.currency or "COP", y)

    y -= 6
    y = _pdf_section(pdf, "Datos de la escuela", y)
    y = _pdf_kv(pdf, "Escuela", str(tenant.display_name or tenant.nombre or tenant.slug), y)
    y = _pdf_kv(pdf, "Código", str(tenant.slug), y)
    y = _pdf_kv(pdf, "NIT", str(tenant.nit or "-"), y)
    y = _pdf_kv(pdf, "Email contacto", str(tenant.contacto_email or "-"), y)
    y = _pdf_kv(pdf, "Plan comercial", f"{plan_label} ({duration_days} días)", y)

    y -= 6
    y = _pdf_section(pdf, "Detalle de cobro del período", y)
    y = _pdf_kv(pdf, "Fecha pago registrado", paid_at_text, y)
    y = _pdf_kv(pdf, "Referencia", str(event.reference or "-"), y)
    y = _pdf_kv(pdf, "Corte/período", f"vence {due_at_text}", y)
    y = _pdf_kv(pdf, "Tarifa base plan (sin IVA)", _billing_currency(base_fee), y)
    y = _pdf_kv(pdf, "Sucursales adicionales activas", str(active_additional), y)
    y = _pdf_kv(pdf, "Sucursales incluidas sin costo", str(free_included), y)
    y = _pdf_kv(
        pdf,
        "Sucursales cobradas",
        f"{billable_branches} x {_billing_currency(extra_branch_fee)} ({_billing_currency(branch_amount)})",
        y,
    )

    y -= 6
    y = _pdf_section(pdf, "Resumen de cobro", y)
    y = _pdf_kv(pdf, "Subtotal (sin IVA)", _billing_currency(subtotal_amount), y)
    y = _pdf_kv(pdf, f"IVA ({int(round(iva_rate * 100))}%)", _billing_currency(iva_amount), y)
    y = _pdf_kv(pdf, "Total período (con IVA)", _billing_currency(total_amount), y)
    y = _pdf_kv(pdf, "Monto registrado en esta transacción", _billing_currency(recorded_amount), y)

    y -= 6
    y = _pdf_section(pdf, "Observaciones", y)
    y = _pdf_kv(pdf, "Notas", str(event.notes or "-"), y)
    y -= 4
    pdf.setFont("Helvetica", 9)
    pdf.drawCentredString(306, y, f"Generado por {SAAS_COMPANY_NAME} | Plataforma SIAEC")

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.read()


def _save_receipt_pdf(receipt_number: str, pdf_bytes: bytes) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", receipt_number).strip("-") or "recibo-saas"
    file_path = SAAS_RECEIPTS_DIR / f"{safe_name}.pdf"
    file_path.write_bytes(pdf_bytes)
    return str(file_path.resolve())


def _build_payment_receipt_email_body(
    tenant: Tenant,
    receipt_number: str,
    event: SaasBillingEvent,
    total_amount: float,
) -> str:
    school_name = tenant.display_name or tenant.nombre or tenant.slug
    paid_at_text = event.paid_at.strftime("%Y-%m-%d %H:%M") if event.paid_at else datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    return (
        f"Hola equipo de {school_name},\n\n"
        "Adjuntamos el comprobante de pago SaaS.\n\n"
        f"- Recibo: {receipt_number}\n"
        f"- Fecha de pago: {paid_at_text}\n"
        f"- Total pagado: {_billing_currency(total_amount)}\n"
        f"- Referencia: {event.reference or '-'}\n\n"
        "Gracias por su pago.\n\n"
        f"{settings.SMTP_FROM_NAME} - Backoffice SaaS"
    )


def _serialize_payment_receipt(receipt: SaasPaymentReceipt | None) -> Optional[dict]:
    if not receipt:
        return None
    return {
        "id": receipt.id,
        "receipt_number": receipt.receipt_number,
        "subtotal_amount": float(receipt.subtotal_amount or 0),
        "iva_rate": float(receipt.iva_rate or 0),
        "iva_amount": float(receipt.iva_amount or 0),
        "total_amount": float(receipt.total_amount or 0),
        "sent_to_email": receipt.sent_to_email,
        "sent_at": receipt.sent_at,
        "created_at": receipt.created_at,
    }


def _saas_receipts_table_exists(db: Session) -> bool:
    try:
        exists = db.execute(
            text("SELECT to_regclass('public.saas_payment_receipts')")
        ).scalar()
        return bool(exists)
    except Exception:
        return False


def _build_overdue_email_body(tenant: Tenant, days_overdue: int, pending_amount: Optional[float] = None) -> str:
    tenant_name = tenant.display_name or tenant.nombre or tenant.slug
    due_text = tenant.next_billing_at.strftime("%Y-%m-%d") if tenant.next_billing_at else "N/A"
    fee = float(pending_amount if pending_amount is not None else (tenant.monthly_fee or 0))
    return (
        f"Hola equipo de {tenant_name},\n\n"
        f"Este es un recordatorio de facturación de {settings.SMTP_FROM_NAME}.\n"
        f"Tienen un cobro pendiente por {_billing_currency(fee)} (IVA incluido) con fecha {due_text}.\n"
        f"Días de atraso: {max(1, int(days_overdue))}.\n\n"
        "Por favor coordinar el pago para evitar interrupciones en el servicio.\n"
        "Si ya realizaron el pago, ignoren este mensaje.\n\n"
        "Gracias,\n"
        f"{settings.SMTP_FROM_NAME} - Backoffice SaaS"
    )


def _compute_dunning_stage(tenant: Tenant, now: datetime) -> tuple[Optional[str], Optional[str], int]:
    if not tenant.next_billing_at:
        return None, None, 0
    due_date = tenant.next_billing_at.date()
    days_delta = (now.date() - due_date).days
    if tenant.subscription_status == "PAST_DUE":
        if days_delta >= 14:
            return "OVERDUE_14D", "Atraso 14+ días", days_delta
        if days_delta >= 7:
            return "OVERDUE_7D", "Atraso 7+ días", days_delta
        if days_delta >= 3:
            return "OVERDUE_3D", "Atraso 3+ días", days_delta
        return "OVERDUE_0D", "Vencido hoy", days_delta
    if tenant.subscription_status == "ACTIVE" and -3 <= days_delta < 0:
        return "PRE_DUE_3D", "Por vencer (3 días)", days_delta
    return None, None, days_delta


def _build_dunning_email_body(
    tenant: Tenant,
    stage_code: str,
    stage_label: str,
    days_delta: int,
    pending_amount: Optional[float] = None,
) -> str:
    tenant_name = tenant.display_name or tenant.nombre or tenant.slug
    due_text = tenant.next_billing_at.strftime("%Y-%m-%d") if tenant.next_billing_at else "N/A"
    fee = float(pending_amount if pending_amount is not None else (tenant.monthly_fee or 0))
    if stage_code == "PRE_DUE_3D":
        status_line = f"Su próximo cobro vence en {abs(int(days_delta))} día(s)."
        action_line = "Este es un aviso preventivo para programar el pago con anticipación."
    elif stage_code == "OVERDUE_0D":
        status_line = "Su cobro está venciendo hoy."
        action_line = "Agradecemos realizar el pago hoy para evitar entrar en mora."
    elif stage_code == "OVERDUE_3D":
        status_line = f"Días de atraso: {max(1, int(days_delta))}."
        action_line = "Te solicitamos priorizar este pago durante el día."
    elif stage_code == "OVERDUE_7D":
        status_line = f"Días de atraso: {max(1, int(days_delta))}."
        action_line = "Tu cuenta requiere regularización prioritaria para evitar medidas operativas."
    else:
        status_line = f"Días de atraso: {max(1, int(days_delta))}."
        action_line = "Último aviso de cobro antes de escalar a gestión manual."
    return (
        f"Hola equipo de {tenant_name},\n\n"
        f"Recordatorio de facturación ({stage_label}) de {settings.SMTP_FROM_NAME}.\n"
        f"Valor pendiente estimado: {_billing_currency(fee)} (IVA incluido).\n"
        f"Fecha de cobro: {due_text}.\n"
        f"{status_line}\n\n"
        f"{action_line}\n\n"
        "Por favor coordinar el pago para mantener continuidad del servicio.\n"
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
    month_ref: Optional[str] = Query(
        None,
        description="Mes de análisis en formato YYYY-MM. Si no se envía, usa el mes actual.",
    ),
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_TENANTS, MODULE_BILLING], "resumen SaaS")
    now = datetime.utcnow()
    if month_ref:
        try:
            selected_month_start = datetime.strptime(month_ref, "%Y-%m").replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            raise HTTPException(status_code=400, detail="month_ref inválido. Usa formato YYYY-MM")
    else:
        selected_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month_start = (selected_month_start + timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    selected_month_end = min(now, next_month_start - timedelta(microseconds=1))

    month_start = selected_month_start
    prev_month_end = month_start - timedelta(microseconds=1)
    prev_month_start = prev_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rolling_30d_start = now - timedelta(days=30)

    total_tenants = db.query(func.count(Tenant.id)).scalar() or 0
    active_tenants = db.query(func.count(Tenant.id)).filter(Tenant.is_active.is_(True)).scalar() or 0
    inactive_tenants = total_tenants - active_tenants
    demo_tenants = db.query(func.count(Tenant.id)).filter(Tenant.is_demo.is_(True)).scalar() or 0

    by_plan = (
        db.query(Tenant.plan, func.count(Tenant.id).label("total"))
        .filter(Tenant.is_active.is_(True))
        .group_by(Tenant.plan)
        .all()
    )
    plan_counts = {row.plan: int(row.total or 0) for row in by_plan}

    # MRR estimado: proyección mensual basada en tarifa efectiva por período + sucursales cobrables.
    mrr_estimado = 0.0
    mrr_real = 0.0
    overdue_amount = 0.0
    active_billable_tenants = db.query(Tenant).filter(
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
        Tenant.is_active.is_(True),
        Tenant.is_demo.is_(False),
    ).all()
    for tenant in active_billable_tenants:
        pricing = _tenant_period_amounts(db, tenant)
        duration_days = max(1, int(pricing["duration_days"]))
        mrr_estimado += (float(pricing["total"]) / duration_days) * 30.0
        if tenant.subscription_status == "PAST_DUE":
            overdue_amount += float(pricing["total"])

    paid_30d_sum, paid_30d_count = db.query(
        func.coalesce(func.sum(SaasBillingEvent.amount), 0),
        func.count(SaasBillingEvent.id),
    ).filter(
        SaasBillingEvent.event_type == "PAYMENT_RECORDED",
        SaasBillingEvent.status == "PAID",
        SaasBillingEvent.paid_at.isnot(None),
        SaasBillingEvent.paid_at >= rolling_30d_start,
    ).first()
    mrr_real = float(paid_30d_sum or 0)
    pagos_30d = int(paid_30d_count or 0)

    ingresos_mes_actual_raw = db.query(
        func.coalesce(func.sum(SaasBillingEvent.amount), 0),
    ).filter(
        SaasBillingEvent.event_type == "PAYMENT_RECORDED",
        SaasBillingEvent.status == "PAID",
        SaasBillingEvent.paid_at.isnot(None),
        SaasBillingEvent.paid_at >= month_start,
        SaasBillingEvent.paid_at <= selected_month_end,
    ).scalar()
    ingresos_mes_actual = float(ingresos_mes_actual_raw or 0)
    ticket_promedio_30d = (mrr_real / pagos_30d) if pagos_30d > 0 else 0.0
    arpu_estimado = (mrr_estimado / len(active_billable_tenants)) if active_billable_tenants else 0.0

    # Revenue analytics (MVP): compara ingresos por tenant entre mes previo y mes actual.
    paid_date_expr = func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at)
    current_rows = (
        db.query(
            SaasBillingEvent.tenant_id.label("tenant_id"),
            func.coalesce(func.sum(SaasBillingEvent.amount), 0).label("amount"),
        )
        .filter(
            SaasBillingEvent.event_type == "PAYMENT_RECORDED",
            SaasBillingEvent.status == "PAID",
            paid_date_expr >= month_start,
            paid_date_expr <= selected_month_end,
        )
        .group_by(SaasBillingEvent.tenant_id)
        .all()
    )
    previous_rows = (
        db.query(
            SaasBillingEvent.tenant_id.label("tenant_id"),
            func.coalesce(func.sum(SaasBillingEvent.amount), 0).label("amount"),
        )
        .filter(
            SaasBillingEvent.event_type == "PAYMENT_RECORDED",
            SaasBillingEvent.status == "PAID",
            paid_date_expr >= prev_month_start,
            paid_date_expr <= prev_month_end,
        )
        .group_by(SaasBillingEvent.tenant_id)
        .all()
    )
    current_by_tenant = {int(row.tenant_id): float(row.amount or 0) for row in current_rows}
    prev_by_tenant = {int(row.tenant_id): float(row.amount or 0) for row in previous_rows}
    all_tenant_ids = set(current_by_tenant.keys()) | set(prev_by_tenant.keys())

    new_mrr = 0.0
    expansion_mrr = 0.0
    contraction_mrr = 0.0
    churn_mrr = 0.0
    logo_churn = 0

    for tenant_id in all_tenant_ids:
        prev_amount = float(prev_by_tenant.get(tenant_id, 0.0))
        curr_amount = float(current_by_tenant.get(tenant_id, 0.0))
        if prev_amount <= 0 and curr_amount > 0:
            new_mrr += curr_amount
        elif prev_amount > 0 and curr_amount <= 0:
            churn_mrr += prev_amount
            logo_churn += 1
        elif prev_amount > 0 and curr_amount > prev_amount:
            expansion_mrr += (curr_amount - prev_amount)
        elif prev_amount > 0 and 0 < curr_amount < prev_amount:
            contraction_mrr += (prev_amount - curr_amount)

    starting_mrr = float(sum(prev_by_tenant.values()) or 0.0)
    ending_mrr = float(sum(current_by_tenant.values()) or 0.0)
    ending_existing_mrr = float(
        sum(current_by_tenant.get(tid, 0.0) for tid, prev in prev_by_tenant.items() if float(prev or 0) > 0)
    )
    nrr_pct = (ending_existing_mrr / starting_mrr * 100.0) if starting_mrr > 0 else 100.0
    net_new_mrr = (new_mrr + expansion_mrr) - (contraction_mrr + churn_mrr)

    demos_por_vencer = db.query(func.count(Tenant.id)).filter(
        Tenant.is_demo.is_(True),
        Tenant.demo_ends_at.isnot(None),
        Tenant.demo_ends_at <= now.replace(hour=23, minute=59, second=59, microsecond=0),
    ).scalar() or 0
    overdue_tenants = db.query(func.count(Tenant.id)).filter(
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
        "active_billable_tenants": int(len(active_billable_tenants)),
        "mrr_estimado": float(mrr_estimado or 0),
        "mrr_real": float(mrr_real or 0),
        "ingresos_30d": float(mrr_real or 0),
        "pagos_30d": int(pagos_30d),
        "ingresos_mes_actual": float(ingresos_mes_actual or 0),
        "ticket_promedio_30d": float(ticket_promedio_30d or 0),
        "arpu_estimado": float(arpu_estimado or 0),
        "overdue_tenants": int(overdue_tenants),
        "overdue_amount": float(overdue_amount or 0),
        "revenue_analytics": {
            "period_current_start": month_start.isoformat(),
            "period_current_end": selected_month_end.isoformat(),
            "period_previous_start": prev_month_start.isoformat(),
            "period_previous_end": prev_month_end.isoformat(),
            "starting_mrr": float(starting_mrr or 0),
            "ending_mrr": float(ending_mrr or 0),
            "new_mrr": float(new_mrr or 0),
            "expansion_mrr": float(expansion_mrr or 0),
            "contraction_mrr": float(contraction_mrr or 0),
            "churn_mrr": float(churn_mrr or 0),
            "net_new_mrr": float(net_new_mrr or 0),
            "logo_churn": int(logo_churn),
            "nrr_pct": float(nrr_pct or 0),
        },
    }


@router.get("/summary/data-quality")
def get_saas_summary_data_quality(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_TENANTS, MODULE_BILLING], "resumen de calidad de datos")
    now = datetime.utcnow()
    rolling_30d_start = now - timedelta(days=30)

    tenant_trial_without_demo = (
        db.query(func.count(Tenant.id))
        .filter(Tenant.subscription_status == "TRIAL", Tenant.is_demo.is_(False))
        .scalar()
        or 0
    )
    tenant_demo_without_trial = (
        db.query(func.count(Tenant.id))
        .filter(Tenant.is_demo.is_(True), Tenant.subscription_status != "TRIAL")
        .scalar()
        or 0
    )
    inactive_with_paid_status = (
        db.query(func.count(Tenant.id))
        .filter(Tenant.is_active.is_(False), Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]))
        .scalar()
        or 0
    )
    missing_next_billing = (
        db.query(func.count(Tenant.id))
        .filter(
            Tenant.is_active.is_(True),
            Tenant.is_demo.is_(False),
            Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
            Tenant.next_billing_at.is_(None),
        )
        .scalar()
        or 0
    )
    payment_without_reference_30d = (
        db.query(func.count(SaasBillingEvent.id))
        .filter(
            SaasBillingEvent.event_type == "PAYMENT_RECORDED",
            SaasBillingEvent.status == "PAID",
            func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at) >= rolling_30d_start,
            func.length(func.trim(func.coalesce(SaasBillingEvent.reference, ""))) == 0,
        )
        .scalar()
        or 0
    )
    payment_paid_without_date = (
        db.query(func.count(SaasBillingEvent.id))
        .filter(
            SaasBillingEvent.event_type == "PAYMENT_RECORDED",
            SaasBillingEvent.status == "PAID",
            SaasBillingEvent.paid_at.is_(None),
        )
        .scalar()
        or 0
    )

    checks = [
        {
            "key": "tenant_trial_without_demo",
            "label": "Tenants TRIAL sin bandera demo",
            "count": int(tenant_trial_without_demo),
            "severity": "warning",
        },
        {
            "key": "tenant_demo_without_trial",
            "label": "Tenants demo con estado distinto a TRIAL",
            "count": int(tenant_demo_without_trial),
            "severity": "warning",
        },
        {
            "key": "inactive_with_paid_status",
            "label": "Tenants inactivos en estado ACTIVE/PAST_DUE",
            "count": int(inactive_with_paid_status),
            "severity": "warning",
        },
        {
            "key": "missing_next_billing",
            "label": "Tenants facturables sin proxima fecha de cobro",
            "count": int(missing_next_billing),
            "severity": "critical",
        },
        {
            "key": "payment_without_reference_30d",
            "label": "Pagos de 30 dias sin referencia",
            "count": int(payment_without_reference_30d),
            "severity": "warning",
        },
        {
            "key": "payment_paid_without_date",
            "label": "Pagos PAID sin fecha paid_at",
            "count": int(payment_paid_without_date),
            "severity": "critical",
        },
    ]
    total_issues = sum(int(item["count"] or 0) for item in checks)
    return {
        "generated_at": now.isoformat(),
        "healthy": total_issues == 0,
        "total_issues": int(total_issues),
        "checks": checks,
    }


@router.post("/summary/data-quality/fix")
def run_saas_summary_data_quality_fix(
    request: Request,
    check_key: str = Query(..., min_length=3, max_length=80),
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(admin, [MODULE_TENANTS, MODULE_BILLING], "corregir calidad de datos")
    key = (check_key or "").strip().lower()
    now = datetime.utcnow()

    fixed_count = 0
    summary = ""

    if key == "tenant_trial_without_demo":
        target_tenants = db.query(Tenant).filter(
            Tenant.subscription_status == "TRIAL",
            Tenant.is_demo.is_(False),
        ).all()
        for tenant in target_tenants:
            tenant.is_demo = True
            if tenant.demo_ends_at is None:
                tenant.demo_ends_at = now + timedelta(days=max(1, int(settings.DEFAULT_DEMO_DAYS)))
        fixed_count = len(target_tenants)
        summary = f"Sincronizó {fixed_count} tenants TRIAL -> demo"

    elif key == "tenant_demo_without_trial":
        target_tenants = db.query(Tenant).filter(
            Tenant.is_demo.is_(True),
            Tenant.subscription_status != "TRIAL",
        ).all()
        for tenant in target_tenants:
            tenant.is_demo = False
        fixed_count = len(target_tenants)
        summary = f"Sincronizó {fixed_count} tenants demo fuera de TRIAL"

    elif key == "missing_next_billing":
        target_tenants = db.query(Tenant).filter(
            Tenant.is_active.is_(True),
            Tenant.is_demo.is_(False),
            Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
            Tenant.next_billing_at.is_(None),
        ).all()
        for tenant in target_tenants:
            duration_days = int(_tenant_period_amounts(db, tenant).get("duration_days", 30) or 30)
            tenant.next_billing_at = now + timedelta(days=max(1, duration_days))
        fixed_count = len(target_tenants)
        summary = f"Definió next_billing_at para {fixed_count} tenants"

    elif key == "payment_paid_without_date":
        rows = db.query(SaasBillingEvent).filter(
            SaasBillingEvent.event_type == "PAYMENT_RECORDED",
            SaasBillingEvent.status == "PAID",
            SaasBillingEvent.paid_at.is_(None),
        ).all()
        for event in rows:
            event.paid_at = event.created_at or now
        fixed_count = len(rows)
        summary = f"Normalizó paid_at en {fixed_count} pagos"

    else:
        raise HTTPException(status_code=400, detail="check_key no soportado para autocorrección")

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="summary.data_quality_fix_run",
        entity_type="summary_data_quality",
        entity_id=key,
        summary=summary or f"Ejecutó autocorrección de calidad para {key}",
        payload={"check_key": key, "fixed_count": int(fixed_count)},
    )
    db.commit()
    return {
        "ok": True,
        "check_key": key,
        "fixed_count": int(fixed_count),
        "summary": summary,
    }


@router.get("/summary/income-breakdown")
def get_saas_summary_income_breakdown(
    fecha_inicio: Optional[datetime] = Query(None),
    fecha_fin: Optional[datetime] = Query(None),
    limit: int = Query(250, ge=1, le=1000),
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "consultar ingresos en resumen SaaS")
    if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
        raise HTTPException(status_code=400, detail="El rango de fechas es inválido")

    paid_date_expr = func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at)
    filters = [
        SaasBillingEvent.event_type == "PAYMENT_RECORDED",
        SaasBillingEvent.status == "PAID",
    ]
    if fecha_inicio:
        filters.append(paid_date_expr >= fecha_inicio)
    if fecha_fin:
        filters.append(paid_date_expr <= fecha_fin)

    total_amount_raw, total_payments_raw = (
        db.query(
            func.coalesce(func.sum(SaasBillingEvent.amount), 0),
            func.count(SaasBillingEvent.id),
        )
        .join(Tenant, Tenant.id == SaasBillingEvent.tenant_id)
        .filter(*filters)
        .first()
    )

    by_tenant_rows = (
        db.query(
            Tenant.id.label("tenant_id"),
            Tenant.slug.label("tenant_slug"),
            Tenant.nombre.label("tenant_nombre"),
            func.coalesce(func.sum(SaasBillingEvent.amount), 0).label("total_amount"),
            func.count(SaasBillingEvent.id).label("payments_count"),
            func.max(paid_date_expr).label("last_payment_at"),
        )
        .join(Tenant, Tenant.id == SaasBillingEvent.tenant_id)
        .filter(*filters)
        .group_by(Tenant.id, Tenant.slug, Tenant.nombre)
        .order_by(func.coalesce(func.sum(SaasBillingEvent.amount), 0).desc(), Tenant.nombre.asc())
        .all()
    )

    payment_rows = (
        db.query(SaasBillingEvent)
        .join(Tenant, Tenant.id == SaasBillingEvent.tenant_id)
        .filter(*filters)
        .order_by(paid_date_expr.desc(), SaasBillingEvent.id.desc())
        .limit(limit)
        .all()
    )

    return {
        "fecha_inicio": fecha_inicio.isoformat() if fecha_inicio else None,
        "fecha_fin": fecha_fin.isoformat() if fecha_fin else None,
        "total_amount": float(total_amount_raw or 0),
        "total_payments": int(total_payments_raw or 0),
        "by_tenant": [
            {
                "tenant_id": int(row.tenant_id),
                "tenant_slug": row.tenant_slug,
                "tenant_nombre": row.tenant_nombre,
                "total_amount": float(row.total_amount or 0),
                "payments_count": int(row.payments_count or 0),
                "last_payment_at": row.last_payment_at.isoformat() if row.last_payment_at else None,
            }
            for row in by_tenant_rows
        ],
        "payments": [_serialize_billing_event(row, include_receipt=False) for row in payment_rows],
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
        query = query.filter(Tenant.plan == _resolve_plan_code(plan))
    if is_demo is not None:
        query = query.filter(Tenant.is_demo.is_(is_demo))
    if is_active is not None:
        query = query.filter(Tenant.is_active.is_(is_active))

    total = query.count()
    items = query.order_by(Tenant.created_at.desc()).offset(skip).limit(limit).all()
    tenant_ids = [int(t.id) for t in items]
    admin_contacts: dict[int, dict[str, Optional[str]]] = {}
    if tenant_ids:
        admin_users = db.query(Usuario).filter(
            Usuario.tenant_id.in_(tenant_ids),
            Usuario.rol == RolUsuario.ADMIN,
        ).order_by(Usuario.tenant_id.asc(), Usuario.id.asc()).all()
        for admin_user in admin_users:
            tid = int(admin_user.tenant_id or 0)
            if not tid or tid in admin_contacts:
                continue
            admin_contacts[tid] = {
                "admin_nombre_contacto": admin_user.nombre_completo,
                "admin_email_contacto": admin_user.email,
                "admin_telefono_contacto": admin_user.telefono,
            }
    pricing_by_tenant: dict[int, dict] = {}
    for tenant in items:
        pricing_by_tenant[int(tenant.id)] = _tenant_period_amounts(db, tenant)

    return {
        "items": [
            {
                "id": t.id,
                "slug": t.slug,
                "nombre": t.nombre,
                "display_name": t.display_name,
                "logo_url": t.logo_url,
                "plan": t.plan,
                "plan_label": _plan_public_label(t.plan),
                "is_active": t.is_active,
                "is_demo": t.is_demo,
                "demo_ends_at": t.demo_ends_at,
                "contacto_nombre": t.contacto_nombre,
                "contacto_email": t.contacto_email,
                "contacto_telefono": t.contacto_telefono,
                "subscription_status": t.subscription_status,
                "billing_cycle": t.billing_cycle,
                "monthly_fee": float(t.monthly_fee or 0),
                "base_fee_effective": float((pricing_by_tenant.get(int(t.id)) or {}).get("base_fee", float(t.monthly_fee or 0))),
                "period_duration_days": int((pricing_by_tenant.get(int(t.id)) or {}).get("duration_days", 30)),
                "period_total": float((pricing_by_tenant.get(int(t.id)) or {}).get("total", float(t.monthly_fee or 0))),
                "period_subtotal": float((pricing_by_tenant.get(int(t.id)) or {}).get("subtotal", float(t.monthly_fee or 0))),
                "iva_rate": float((pricing_by_tenant.get(int(t.id)) or {}).get("iva_rate", VAT_RATE)),
                "iva_amount": float((pricing_by_tenant.get(int(t.id)) or {}).get("iva_amount", 0.0)),
                "active_branches_total": int((pricing_by_tenant.get(int(t.id)) or {}).get("active_branches_total", 0)),
                "active_additional_branches": int((pricing_by_tenant.get(int(t.id)) or {}).get("active_additional_branches", 0)),
                "included_free_branches_used": int((pricing_by_tenant.get(int(t.id)) or {}).get("included_free_branches_used", 0)),
                "billable_branches": int((pricing_by_tenant.get(int(t.id)) or {}).get("billable_branches", 0)),
                "extra_branch_fee": float((pricing_by_tenant.get(int(t.id)) or {}).get("extra_branch_fee", 0.0)),
                "branch_amount": float((pricing_by_tenant.get(int(t.id)) or {}).get("branch_amount", 0.0)),
                "next_billing_at": t.next_billing_at,
                "last_payment_at": t.last_payment_at,
                "created_at": t.created_at,
                "admin_nombre_contacto": (admin_contacts.get(int(t.id)) or {}).get("admin_nombre_contacto"),
                "admin_email_contacto": (admin_contacts.get(int(t.id)) or {}).get("admin_email_contacto"),
                "admin_telefono_contacto": (admin_contacts.get(int(t.id)) or {}).get("admin_telefono_contacto"),
            }
            for t in items
        ],
        "total": int(total),
        "skip": skip,
        "limit": limit,
    }


@router.post("/tenants", status_code=status.HTTP_201_CREATED)
def create_tenant_admin(
    payload: SaasTenantCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_TENANTS, "crear tenant")

    school_name = _normalize_text(payload.nombre_escuela)
    if not school_name or len(school_name) < 3:
        raise HTTPException(status_code=400, detail="Nombre de escuela inválido")

    raw_slug = _normalize_text(payload.slug)
    if raw_slug:
        slug_candidate = _slugify(raw_slug)
        if not re.fullmatch(r"[a-z0-9-]{3,100}", slug_candidate):
            raise HTTPException(
                status_code=400,
                detail="Slug inválido: usa solo minúsculas, números y guiones (3-100 caracteres)",
            )
        if db.query(Tenant).filter(Tenant.slug == slug_candidate).first():
            raise HTTPException(status_code=409, detail="El código de escuela ya existe")
    else:
        slug_candidate = _ensure_unique_tenant_slug(db, school_name)

    plan_value = _resolve_plan_code(payload.plan)
    plan_policy = _plan_policy_for(plan_value)

    tenant_contact_email = str(payload.contacto_email).strip().lower()
    admin_email = str(payload.admin_email).strip().lower()
    if db.query(Usuario).filter(Usuario.email == admin_email).first():
        raise HTTPException(status_code=409, detail="El correo del administrador ya existe")

    admin_cedula = str(payload.admin_cedula or "").strip()
    if len(admin_cedula) < 5:
        raise HTTPException(status_code=400, detail="La cédula del administrador es obligatoria")
    if db.query(Usuario).filter(Usuario.cedula == admin_cedula).first():
        raise HTTPException(status_code=409, detail="La cédula del administrador ya existe")
    admin_full_name = str(payload.admin_nombre_completo or "").strip()
    if len(admin_full_name) < 3:
        raise HTTPException(status_code=400, detail="Nombre del administrador inválido")

    temporary_password = (payload.admin_password or "").strip() or f"Siaec#{secrets.token_hex(4)}"
    if len(temporary_password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña temporal debe tener mínimo 8 caracteres")

    tenant = Tenant(
        slug=slug_candidate,
        nombre=school_name,
        display_name=_normalize_text(payload.display_name) or school_name,
        plan=plan_value,
        is_active=bool(payload.activate_tenant),
        is_demo=(plan_value == PlanTenant.FREE.value),
        demo_ends_at=(
            datetime.utcnow() + timedelta(days=int(plan_policy.get("duration_days", max(1, settings.DEFAULT_DEMO_DAYS))))
            if plan_value == PlanTenant.FREE.value
            else None
        ),
        contacto_nombre=_normalize_text(payload.contacto_nombre),
        contacto_email=tenant_contact_email,
        contacto_telefono=_normalize_text(payload.contacto_telefono),
        nit=_normalize_text(payload.nit),
        logo_url=_normalize_text(payload.logo_url),
        subscription_status="TRIAL" if plan_value == PlanTenant.FREE.value else "ACTIVE",
        billing_cycle=str(plan_policy.get("billing_cycle", "QUARTERLY")).upper(),
        monthly_fee=float(plan_policy.get("base_fee", 0.0) or 0.0),
        next_billing_at=(
            datetime.utcnow() + timedelta(days=int(plan_policy.get("duration_days", 30)))
            if plan_value != PlanTenant.FREE.value
            else None
        ),
    )
    db.add(tenant)
    db.flush()

    tenant_admin_user = Usuario(
        email=admin_email,
        password_hash=get_password_hash(temporary_password),
        nombre_completo=admin_full_name,
        cedula=admin_cedula,
        telefono=_normalize_text(payload.admin_telefono),
        rol=RolUsuario.ADMIN,
        tenant_id=tenant.id,
        is_active=True,
        is_verified=True,
        must_change_password=True,
    )
    db.add(tenant_admin_user)
    db.flush()

    membership = TenantUser(
        tenant_id=tenant.id,
        user_id=tenant_admin_user.id,
        rol=RolUsuario.ADMIN.value,
        is_active=True,
    )
    db.add(membership)
    _ensure_user_primary_branch_access(db, tenant, tenant_admin_user.id)

    welcome_email_sent = False
    if payload.send_welcome_email:
        try:
            welcome_email_sent = send_email(
                tenant_admin_user.email,
                f"[{settings.SMTP_FROM_NAME}] Enlace de acceso - {tenant.display_name or tenant.nombre or tenant.slug}",
                _build_school_access_email_body(tenant, tenant_admin_user.nombre_completo),
            )
        except Exception:
            welcome_email_sent = False

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.created",
        entity_type="tenant",
        entity_id=str(tenant.id),
        summary=f"Creó tenant {tenant.slug} desde backoffice",
        payload={
            "tenant_slug": tenant.slug,
            "plan": _plan_public_label(tenant.plan),
            "admin_email": tenant_admin_user.email,
            "welcome_email_sent": bool(welcome_email_sent),
        },
    )
    db.commit()
    db.refresh(tenant)

    return {
        "tenant_id": tenant.id,
        "tenant_slug": tenant.slug,
        "tenant_nombre": tenant.nombre,
        "tenant_display_name": tenant.display_name,
        "tenant_plan": tenant.plan,
        "tenant_plan_label": _plan_public_label(tenant.plan),
        "tenant_activo": tenant.is_active,
        "admin_user_id": tenant_admin_user.id,
        "admin_email": tenant_admin_user.email,
        "temporary_password": temporary_password,
        "welcome_email_sent": bool(welcome_email_sent),
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
    tenant_fields = {"plan", "is_active", "is_demo", "demo_ends_at", "contacto_nombre", "contacto_email", "contacto_telefono"}
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
        else:
            # Non-trial statuses always represent paid/operational tenants.
            # Force demo off to avoid status reverting to TRIAL on save.
            requested_is_demo = False
    if requested_is_demo is not None:
        if requested_is_demo:
            requested_status = "TRIAL"
        elif requested_status == "TRIAL" or requested_status is None:
            requested_status = "ACTIVE"

    if "plan" in data and data["plan"]:
        plan_value = _resolve_plan_code(data["plan"])
        tenant.plan = plan_value
        policy = _plan_policy_for(plan_value)
        if "billing_cycle" not in data or data["billing_cycle"] is None:
            tenant.billing_cycle = str(policy.get("billing_cycle", tenant.billing_cycle or "QUARTERLY")).upper()
        if "monthly_fee" not in data or data["monthly_fee"] is None:
            tenant.monthly_fee = float(policy.get("base_fee", 0.0) or 0.0)
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
    if "contacto_nombre" in data:
        tenant.contacto_nombre = _normalize_text(data["contacto_nombre"])
    if "contacto_email" in data:
        tenant.contacto_email = (str(data["contacto_email"]).strip().lower() if data["contacto_email"] else None)
    if "contacto_telefono" in data:
        tenant.contacto_telefono = _normalize_text(data["contacto_telefono"])
    if "is_demo" in data and tenant.is_demo and tenant.subscription_status != "TRIAL":
        tenant.subscription_status = "TRIAL"
    if "is_demo" in data and (not tenant.is_demo) and tenant.subscription_status == "TRIAL":
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
    pricing = _tenant_period_amounts(db, tenant)
    return {
        "id": tenant.id,
        "slug": tenant.slug,
        "nombre": tenant.nombre,
        "plan": tenant.plan,
        "plan_label": _plan_public_label(tenant.plan),
        "is_active": tenant.is_active,
        "is_demo": tenant.is_demo,
        "contacto_nombre": tenant.contacto_nombre,
        "contacto_email": tenant.contacto_email,
        "contacto_telefono": tenant.contacto_telefono,
        "demo_ends_at": tenant.demo_ends_at,
        "subscription_status": tenant.subscription_status,
        "billing_cycle": tenant.billing_cycle,
        "monthly_fee": float(tenant.monthly_fee or 0),
        "base_fee_effective": float(pricing["base_fee"]),
        "period_duration_days": int(pricing["duration_days"]),
        "period_total": float(pricing["total"]),
        "period_subtotal": float(pricing["subtotal"]),
        "iva_rate": float(pricing["iva_rate"]),
        "iva_amount": float(pricing["iva_amount"]),
        "active_branches_total": int(pricing["active_branches_total"]),
        "active_additional_branches": int(pricing["active_additional_branches"]),
        "included_free_branches_used": int(pricing["included_free_branches_used"]),
        "billable_branches": int(pricing["billable_branches"]),
        "extra_branch_fee": float(pricing["extra_branch_fee"]),
        "branch_amount": float(pricing["branch_amount"]),
        "next_billing_at": tenant.next_billing_at,
        "last_payment_at": tenant.last_payment_at,
    }


@router.get("/tenants/{tenant_id}/branches")
def list_tenant_branches_admin(
    tenant_id: int,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_BRANCHES, MODULE_TENANTS], "listar sucursales")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    _ensure_primary_branch(db, tenant)
    db.commit()
    rows = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
    ).order_by(TenantBranch.is_primary.desc(), TenantBranch.created_at.asc()).all()
    return {"items": [_serialize_branch(row) for row in rows], "total": len(rows)}


@router.post("/tenants/{tenant_id}/branches", status_code=status.HTTP_201_CREATED)
def create_tenant_branch_admin(
    tenant_id: int,
    payload: SaasBranchCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(admin, [MODULE_BRANCHES, MODULE_TENANTS], "crear sucursales")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    nombre = _normalize_text(payload.nombre)
    if not nombre or len(nombre) < 2:
        raise HTTPException(status_code=400, detail="Nombre de sucursal inválido")
    code = _normalize_branch_code(payload.codigo, nombre)
    existing = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
        TenantBranch.codigo == code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="El código de sucursal ya existe para este tenant")

    branch = TenantBranch(
        tenant_id=tenant.id,
        nombre=nombre,
        codigo=code,
        is_active=bool(payload.is_active),
        is_primary=False,
        direccion=_normalize_text(payload.direccion),
        ciudad=_normalize_text(payload.ciudad),
        contacto_telefono=_normalize_text(payload.contacto_telefono),
        contacto_email=(str(payload.contacto_email).strip().lower() if payload.contacto_email else None),
        observaciones=_normalize_text(payload.observaciones),
    )
    db.add(branch)
    db.flush()
    if bool(payload.is_primary):
        db.query(TenantBranch).filter(
            TenantBranch.tenant_id == tenant.id,
            TenantBranch.id != branch.id,
        ).update({"is_primary": False}, synchronize_session=False)
        branch.is_primary = True
        branch.is_active = True
    else:
        _ensure_primary_branch(db, tenant)

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.branch_created",
        entity_type="tenant_branch",
        entity_id=str(branch.id),
        summary=f"Creó sucursal {branch.codigo} para tenant {tenant.slug}",
        payload={"tenant_id": tenant.id, "branch_code": branch.codigo},
    )
    db.commit()
    db.refresh(branch)
    return _serialize_branch(branch)


@router.put("/tenants/{tenant_id}/branches/{branch_id}")
def update_tenant_branch_admin(
    tenant_id: int,
    branch_id: int,
    payload: SaasBranchUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(admin, [MODULE_BRANCHES, MODULE_TENANTS], "actualizar sucursales")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    branch = db.query(TenantBranch).filter(
        TenantBranch.id == branch_id,
        TenantBranch.tenant_id == tenant.id,
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "nombre" in data and data["nombre"] is not None:
        nombre = _normalize_text(data["nombre"])
        if not nombre or len(nombre) < 2:
            raise HTTPException(status_code=400, detail="Nombre de sucursal inválido")
        branch.nombre = nombre
    if "codigo" in data and data["codigo"] is not None:
        code = _normalize_branch_code(data["codigo"], branch.nombre)
        exists = db.query(TenantBranch).filter(
            TenantBranch.tenant_id == tenant.id,
            TenantBranch.codigo == code,
            TenantBranch.id != branch.id,
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="El código de sucursal ya existe para este tenant")
        branch.codigo = code
    if "is_active" in data:
        branch.is_active = bool(data["is_active"])
        if branch.is_primary and not branch.is_active:
            raise HTTPException(status_code=400, detail="No puedes inactivar la sucursal principal")
    if "direccion" in data:
        branch.direccion = _normalize_text(data["direccion"])
    if "ciudad" in data:
        branch.ciudad = _normalize_text(data["ciudad"])
    if "contacto_telefono" in data:
        branch.contacto_telefono = _normalize_text(data["contacto_telefono"])
    if "contacto_email" in data:
        branch.contacto_email = (str(data["contacto_email"]).strip().lower() if data["contacto_email"] else None)
    if "observaciones" in data:
        branch.observaciones = _normalize_text(data["observaciones"])
    _ensure_primary_branch(db, tenant)
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.branch_updated",
        entity_type="tenant_branch",
        entity_id=str(branch.id),
        summary=f"Actualizó sucursal {branch.codigo} de tenant {tenant.slug}",
        payload={"changes": data, "tenant_id": tenant.id},
    )
    db.commit()
    db.refresh(branch)
    return _serialize_branch(branch)


@router.put("/tenants/{tenant_id}/branches/{branch_id}/set-primary")
def set_primary_tenant_branch_admin(
    tenant_id: int,
    branch_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(admin, [MODULE_BRANCHES, MODULE_TENANTS], "definir sucursal principal")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    branch = db.query(TenantBranch).filter(
        TenantBranch.id == branch_id,
        TenantBranch.tenant_id == tenant.id,
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
    ).update({"is_primary": False}, synchronize_session=False)
    branch.is_primary = True
    branch.is_active = True
    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.branch_primary_set",
        entity_type="tenant_branch",
        entity_id=str(branch.id),
        summary=f"Definió sucursal principal {branch.codigo} para tenant {tenant.slug}",
        payload={"tenant_id": tenant.id},
    )
    db.commit()
    db.refresh(branch)
    return _serialize_branch(branch)


@router.get("/tenants/{tenant_id}/branch-users")
def list_tenant_branch_users_admin(
    tenant_id: int,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(_admin, [MODULE_BRANCHES, MODULE_TENANTS, MODULE_USERS], "listar accesos por sucursal")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    _ensure_primary_branch(db, tenant)
    users_query = db.query(Usuario).filter(
        Usuario.tenant_id == tenant.id,
        Usuario.rol != RolUsuario.ESTUDIANTE,
    )
    if search:
        term = f"%{search.strip().lower()}%"
        users_query = users_query.filter(
            or_(
                func.lower(Usuario.nombre_completo).like(term),
                func.lower(Usuario.email).like(term),
                func.lower(func.coalesce(Usuario.cedula, "")).like(term),
            )
        )
    users = users_query.order_by(Usuario.nombre_completo.asc()).all()
    accesses = db.query(TenantUserBranch).filter(
        TenantUserBranch.tenant_id == tenant.id,
    ).all()
    by_user: dict[int, list[TenantUserBranch]] = {}
    for access in accesses:
        by_user.setdefault(access.user_id, []).append(access)
    items = []
    for user in users:
        user_access = by_user.get(user.id, [])
        items.append({
            "user_id": user.id,
            "email": user.email,
            "nombre_completo": user.nombre_completo,
            "rol": user.rol.value if hasattr(user.rol, "value") else str(user.rol),
            "is_active": user.is_active,
            "branch_ids": [int(a.branch_id) for a in user_access if a.is_active],
            "branch_access": [
                {"branch_id": int(a.branch_id), "is_active": bool(a.is_active)}
                for a in user_access
            ],
        })
    db.commit()
    return {"items": items, "total": len(items)}


@router.put("/tenants/{tenant_id}/branch-users/{user_id}")
def update_tenant_user_branch_access_admin(
    tenant_id: int,
    user_id: int,
    payload: SaasTenantUserBranchUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_any_saas_module(admin, [MODULE_BRANCHES, MODULE_TENANTS, MODULE_USERS], "asignar accesos por sucursal")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    user = db.query(Usuario).filter(
        Usuario.id == user_id,
        Usuario.tenant_id == tenant.id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario del tenant no encontrado")
    branch_ids = sorted({int(bid) for bid in (payload.branch_ids or []) if int(bid) > 0})
    if not branch_ids:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos una sucursal")
    branches = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
        TenantBranch.id.in_(branch_ids),
    ).all()
    branch_map = {int(branch.id): branch for branch in branches}
    missing = [bid for bid in branch_ids if bid not in branch_map]
    if missing:
        raise HTTPException(status_code=400, detail=f"Sucursales inválidas para tenant: {missing}")

    mode = str(payload.mode or "replace").strip().lower()
    if mode not in {"replace", "merge"}:
        raise HTTPException(status_code=400, detail="mode inválido. Usa replace o merge")
    existing = db.query(TenantUserBranch).filter(
        TenantUserBranch.tenant_id == tenant.id,
        TenantUserBranch.user_id == user.id,
    ).all()
    existing_by_branch = {int(row.branch_id): row for row in existing}
    selected = set(branch_ids)
    if mode == "replace":
        for row in existing:
            if int(row.branch_id) not in selected:
                row.is_active = False
    for branch_id in branch_ids:
        row = existing_by_branch.get(branch_id)
        if row:
            row.is_active = bool(payload.is_active)
            continue
        db.add(TenantUserBranch(
            tenant_id=tenant.id,
            user_id=user.id,
            branch_id=branch_id,
            is_active=bool(payload.is_active),
        ))
    if user.rol in [RolUsuario.ADMIN, RolUsuario.GERENTE]:
        _ensure_user_primary_branch_access(db, tenant, user.id)

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="tenant.branch_access_updated",
        entity_type="tenant_user_branch",
        entity_id=f"{tenant.id}:{user.id}",
        summary=f"Actualizó accesos de sucursal para usuario {user.email} en tenant {tenant.slug}",
        payload={"branch_ids": branch_ids, "mode": mode, "is_active": bool(payload.is_active)},
    )
    db.commit()
    refreshed = db.query(TenantUserBranch).filter(
        TenantUserBranch.tenant_id == tenant.id,
        TenantUserBranch.user_id == user.id,
        TenantUserBranch.is_active.is_(True),
    ).all()
    return {
        "user_id": user.id,
        "tenant_id": tenant.id,
        "branch_ids": [int(row.branch_id) for row in refreshed],
        "total_active": len(refreshed),
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
    receipts_enabled = _saas_receipts_table_exists(db)
    total = query.count()
    items = query.order_by(SaasBillingEvent.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [_serialize_billing_event(row, include_receipt=receipts_enabled) for row in items],
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
    pricing = _tenant_period_amounts(db, tenant)
    amount = float(payload.amount if payload.amount is not None else pricing["total"])
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
    db.flush()

    receipt = None
    receipt_number = None
    sent_email = False
    recipient_email = (tenant.contacto_email or "").strip().lower()
    receipts_enabled = _saas_receipts_table_exists(db)
    if receipts_enabled:
        subtotal_amount = float(pricing.get("subtotal", 0.0) or 0.0)
        iva_amount = float(pricing.get("iva_amount", 0.0) or 0.0)
        receipt_number = _next_receipt_number(db)
        receipt_pdf_bytes = _render_payment_receipt_pdf(
            receipt_number=receipt_number,
            tenant=tenant,
            event=event,
            pricing=pricing,
            recorded_amount=amount,
        )
        receipt_file_path = _save_receipt_pdf(receipt_number, receipt_pdf_bytes)
        receipt = SaasPaymentReceipt(
            billing_event_id=event.id,
            tenant_id=tenant.id,
            receipt_number=receipt_number,
            subtotal_amount=subtotal_amount,
            iva_rate=VAT_RATE,
            iva_amount=iva_amount,
            total_amount=amount,
            file_path=receipt_file_path,
        )
        db.add(receipt)

        if recipient_email:
            sent_email = send_email(
                to_email=recipient_email,
                subject=f"[{settings.SMTP_FROM_NAME}] Recibo de pago {receipt_number}",
                body=_build_payment_receipt_email_body(tenant, receipt_number, event, amount),
                attachment=(f"{receipt_number}.pdf", receipt_pdf_bytes, "application/pdf"),
            )
            if sent_email:
                receipt.sent_to_email = recipient_email
                receipt.sent_at = datetime.utcnow()

    tenant.last_payment_at = paid_at
    if payload.next_billing_at:
        tenant.next_billing_at = payload.next_billing_at
    else:
        base = tenant.next_billing_at if tenant.next_billing_at and tenant.next_billing_at > paid_at else paid_at
        tenant.next_billing_at = base + timedelta(days=_cycle_days(tenant.billing_cycle))
    if payload.set_status_active:
        tenant.subscription_status = "ACTIVE"
        if tenant.is_demo:
            tenant.is_demo = False
            tenant.demo_ends_at = None

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
            "receipt_number": receipt_number,
            "receipt_sent": bool(sent_email),
            "receipt_email": recipient_email or None,
            "receipts_enabled": bool(receipts_enabled),
        },
    )
    db.commit()
    db.refresh(tenant)
    db.refresh(event)
    if receipt:
        db.refresh(receipt)
    return {
        "tenant": {
            "id": tenant.id,
            "slug": tenant.slug,
            "subscription_status": tenant.subscription_status,
            "next_billing_at": tenant.next_billing_at,
            "last_payment_at": tenant.last_payment_at,
        },
        "event": _serialize_billing_event(event, include_receipt=receipts_enabled),
        "receipt": _serialize_payment_receipt(receipt),
        "receipt_sent": bool(sent_email),
        "receipts_enabled": bool(receipts_enabled),
    }


@router.get("/billing/events/{event_id}/receipt/download")
def download_billing_receipt(
    event_id: int,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "descargar recibo de pago")
    if not _saas_receipts_table_exists(db):
        raise HTTPException(
            status_code=503,
            detail="Recibos SaaS no habilitados aún. Ejecuta la migración create_saas_payment_receipts.",
        )
    event = db.query(SaasBillingEvent).filter(SaasBillingEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento de facturación no encontrado")
    receipt = db.query(SaasPaymentReceipt).filter(
        SaasPaymentReceipt.billing_event_id == event.id
    ).first()
    if not receipt or not receipt.file_path:
        raise HTTPException(status_code=404, detail="Recibo no disponible para este evento")
    file_path = Path(receipt.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Archivo de recibo no encontrado")
    return FileResponse(
        path=str(file_path),
        filename=f"{receipt.receipt_number}.pdf",
        media_type="application/pdf",
    )


@router.post("/billing/events/{event_id}/receipt/resend")
def resend_billing_receipt(
    event_id: int,
    payload: BillingReceiptResendRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(admin, MODULE_BILLING, "reenviar recibo de pago")
    if not _saas_receipts_table_exists(db):
        raise HTTPException(
            status_code=503,
            detail="Recibos SaaS no habilitados aún. Ejecuta la migración create_saas_payment_receipts.",
        )
    event = db.query(SaasBillingEvent).filter(SaasBillingEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento de facturación no encontrado")
    receipt = db.query(SaasPaymentReceipt).filter(
        SaasPaymentReceipt.billing_event_id == event.id
    ).first()
    if not receipt or not receipt.file_path:
        raise HTTPException(status_code=404, detail="Recibo no disponible para este evento")
    tenant = db.query(Tenant).filter(Tenant.id == event.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")

    file_path = Path(receipt.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Archivo de recibo no encontrado")
    target_email = str(payload.to_email or tenant.contacto_email or "").strip().lower()
    if not target_email:
        raise HTTPException(status_code=400, detail="No hay correo destino para enviar el recibo")
    pdf_bytes = file_path.read_bytes()
    sent = send_email(
        to_email=target_email,
        subject=f"[{settings.SMTP_FROM_NAME}] Recibo de pago {receipt.receipt_number}",
        body=_build_payment_receipt_email_body(tenant, receipt.receipt_number, event, float(receipt.total_amount or 0)),
        attachment=(f"{receipt.receipt_number}.pdf", pdf_bytes, "application/pdf"),
    )
    if sent:
        receipt.sent_to_email = target_email
        receipt.sent_at = datetime.utcnow()

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.receipt_resent",
        entity_type="billing_event",
        entity_id=str(event.id),
        summary=f"Reenvió recibo {receipt.receipt_number} del tenant {tenant.slug}",
        payload={"event_id": event.id, "receipt_number": receipt.receipt_number, "to_email": target_email, "sent": bool(sent)},
    )
    db.commit()
    db.refresh(receipt)
    return {"sent": bool(sent), "to_email": target_email, "receipt": _serialize_payment_receipt(receipt)}


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
        Tenant.subscription_status == "ACTIVE",
    ).all()
    updated = 0
    for tenant in candidates:
        tenant.subscription_status = "PAST_DUE"
        pricing = _tenant_period_amounts(db, tenant)
        db.add(SaasBillingEvent(
            tenant_id=tenant.id,
            event_type="STATUS_CHANGED",
            status="OVERDUE",
            amount=float(pricing["total"]),
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
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
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
        pricing = _tenant_period_amounts(db, tenant)
        db.add(SaasBillingEvent(
            tenant_id=tenant.id,
            event_type="INVOICE_ISSUED",
            status="DUE",
            amount=float(pricing["total"]),
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
        Tenant.subscription_status.in_(["ACTIVE", "PAST_DUE"]),
        Tenant.next_billing_at.isnot(None),
        Tenant.contacto_email.isnot(None),
    ).all()
    sent = 0
    evaluated = 0
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
        already_sent_stage = db.query(SaasBillingEvent).filter(
            SaasBillingEvent.tenant_id == tenant.id,
            SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
            SaasBillingEvent.due_at == tenant.next_billing_at,
            SaasBillingEvent.notes.ilike(f"%{stage_marker}%"),
        ).first()
        if already_sent_stage:
            continue
        pricing = _tenant_period_amounts(db, tenant)
        ok = send_email(
            to_email=email,
            subject=f"[{settings.SMTP_FROM_NAME}] Cobranza SaaS - {stage_label}",
            body=_build_dunning_email_body(tenant, stage_code, stage_label or stage_code, days_delta, pricing["total"]),
        )
        if ok:
            db.add(SaasBillingEvent(
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
            ))
            sent += 1
            stage_counts[stage_code] = int(stage_counts.get(stage_code, 0) + 1)

    _write_audit_log(
        db=db,
        actor=admin,
        request=request,
        action="billing.overdue_reminders_sent",
        entity_type="billing",
        entity_id="overdue-reminders",
        summary=f"Ejecutó recordatorios de cartera (evaluados={evaluated}, enviados={sent})",
        payload={"evaluated": evaluated, "sent": sent, "stage_counts": stage_counts},
    )
    db.commit()
    return {"evaluated": evaluated, "sent": sent, "stage_counts": stage_counts}


@router.get("/billing/dunning-summary")
def get_billing_dunning_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "consultar resumen de cobranza inteligente")
    now = datetime.utcnow()
    rolling_30d_start = now - timedelta(days=30)
    rolling_180d_start = now - timedelta(days=180)

    stage_counts: dict[str, int] = {}
    for code, _label, _threshold in DUNNING_STAGE_RULES:
        count = db.query(func.count(SaasBillingEvent.id)).filter(
            SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
            SaasBillingEvent.created_at >= rolling_30d_start,
            SaasBillingEvent.notes.ilike(f"%stage={code}%"),
        ).scalar() or 0
        stage_counts[code] = int(count)

    reminders_sent_30d = int(sum(stage_counts.values()))
    due_soon_3d = db.query(func.count(Tenant.id)).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status == "ACTIVE",
        Tenant.next_billing_at.isnot(None),
        Tenant.next_billing_at >= now,
        Tenant.next_billing_at <= (now + timedelta(days=3)),
    ).scalar() or 0
    past_due_total = db.query(func.count(Tenant.id)).filter(
        Tenant.is_active.is_(True),
        Tenant.subscription_status == "PAST_DUE",
        Tenant.next_billing_at.isnot(None),
    ).scalar() or 0
    in_sequence = db.query(func.count(Tenant.id)).filter(
        Tenant.is_active.is_(True),
        Tenant.next_billing_at.isnot(None),
        or_(
            and_(Tenant.subscription_status == "ACTIVE", Tenant.next_billing_at <= (now + timedelta(days=3)), Tenant.next_billing_at >= now),
            Tenant.subscription_status == "PAST_DUE",
        ),
    ).scalar() or 0

    reminder_events = db.query(SaasBillingEvent).filter(
        SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
        SaasBillingEvent.created_at >= rolling_30d_start,
    ).order_by(SaasBillingEvent.tenant_id.asc(), SaasBillingEvent.due_at.asc(), SaasBillingEvent.created_at.asc(), SaasBillingEvent.id.asc()).all()
    reminder_timeline: dict[tuple[int, str], list[tuple[datetime, str]]] = {}
    for reminder in reminder_events:
        tenant_id = int(reminder.tenant_id or 0)
        due_key = reminder.due_at.isoformat() if reminder.due_at else "__none__"
        stage_match = re.search(r"stage=([A-Z0-9_]+)", str(reminder.notes or ""))
        stage_code = str(stage_match.group(1) if stage_match else "UNKNOWN")
        reminder_timeline.setdefault((tenant_id, due_key), []).append((reminder.created_at, stage_code))

    payment_events = db.query(SaasBillingEvent).filter(
        SaasBillingEvent.event_type == "PAYMENT_RECORDED",
        SaasBillingEvent.status == "PAID",
        func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at) >= rolling_30d_start,
    ).order_by(func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at).asc(), SaasBillingEvent.id.asc()).all()

    # Tendencia mensual (últimos 6 meses): recordatorios enviados vs recuperación atribuida.
    month_keys: list[str] = []
    cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(6):
        month_keys.append(f"{cursor.year}-{cursor.month:02d}")
        cursor = (cursor - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_keys = list(reversed(month_keys))
    monthly_map: dict[str, dict[str, float | int | str]] = {
        key: {
            "month": key,
            "reminders_sent": 0,
            "recovered_payments": 0,
            "recovered_amount": 0.0,
        }
        for key in month_keys
    }

    reminder_events_180 = db.query(SaasBillingEvent).filter(
        SaasBillingEvent.event_type == "OVERDUE_REMINDER_SENT",
        SaasBillingEvent.created_at >= rolling_180d_start,
    ).order_by(SaasBillingEvent.tenant_id.asc(), SaasBillingEvent.due_at.asc(), SaasBillingEvent.created_at.asc(), SaasBillingEvent.id.asc()).all()
    reminder_timeline_180: dict[tuple[int, str], list[tuple[datetime, str]]] = {}
    for reminder in reminder_events_180:
        tenant_id = int(reminder.tenant_id or 0)
        due_key = reminder.due_at.isoformat() if reminder.due_at else "__none__"
        stage_match = re.search(r"stage=([A-Z0-9_]+)", str(reminder.notes or ""))
        stage_code = str(stage_match.group(1) if stage_match else "UNKNOWN")
        reminder_timeline_180.setdefault((tenant_id, due_key), []).append((reminder.created_at, stage_code))
        month_key = f"{reminder.created_at.year}-{reminder.created_at.month:02d}" if reminder.created_at else ""
        if month_key in monthly_map:
            monthly_map[month_key]["reminders_sent"] = int(monthly_map[month_key]["reminders_sent"] or 0) + 1

    payment_events_180 = db.query(SaasBillingEvent).filter(
        SaasBillingEvent.event_type == "PAYMENT_RECORDED",
        SaasBillingEvent.status == "PAID",
        func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at) >= rolling_180d_start,
    ).order_by(func.coalesce(SaasBillingEvent.paid_at, SaasBillingEvent.created_at).asc(), SaasBillingEvent.id.asc()).all()
    for payment in payment_events_180:
        tenant_id = int(payment.tenant_id or 0)
        due_key = payment.due_at.isoformat() if payment.due_at else "__none__"
        timeline = reminder_timeline_180.get((tenant_id, due_key)) or []
        if not timeline:
            continue
        payment_ts = payment.paid_at or payment.created_at
        if not payment_ts:
            continue
        eligible = [row for row in timeline if row[0] <= payment_ts]
        if not eligible:
            continue
        month_key = f"{payment_ts.year}-{payment_ts.month:02d}"
        if month_key not in monthly_map:
            continue
        monthly_map[month_key]["recovered_payments"] = int(monthly_map[month_key]["recovered_payments"] or 0) + 1
        monthly_map[month_key]["recovered_amount"] = float(monthly_map[month_key]["recovered_amount"] or 0.0) + float(payment.amount or 0)

    stage_recovery: dict[str, dict[str, float | int]] = {
        code: {"payments": 0, "amount": 0.0}
        for code, _label, _threshold in DUNNING_STAGE_RULES
    }
    recovered_after_reminder_30d = 0.0
    payments_after_reminder_30d = 0
    for payment in payment_events:
        tenant_id = int(payment.tenant_id or 0)
        due_key = payment.due_at.isoformat() if payment.due_at else "__none__"
        timeline = reminder_timeline.get((tenant_id, due_key)) or []
        if not timeline:
            continue
        payment_ts = payment.paid_at or payment.created_at
        if not payment_ts:
            continue
        eligible = [row for row in timeline if row[0] <= payment_ts]
        if not eligible:
            continue
        stage_code = str(eligible[-1][1] or "UNKNOWN")
        amount = float(payment.amount or 0)
        recovered_after_reminder_30d += amount
        payments_after_reminder_30d += 1
        bucket = stage_recovery.get(stage_code)
        if bucket is None:
            stage_recovery[stage_code] = {"payments": 1, "amount": amount}
        else:
            bucket["payments"] = int(bucket.get("payments", 0) or 0) + 1
            bucket["amount"] = float(bucket.get("amount", 0.0) or 0.0) + amount

    stage_conversion_pct: dict[str, float] = {}
    for code, _label, _threshold in DUNNING_STAGE_RULES:
        sent_count = float(stage_counts.get(code, 0) or 0)
        recovered_count = float((stage_recovery.get(code) or {}).get("payments", 0) or 0)
        stage_conversion_pct[code] = float((recovered_count / sent_count) * 100.0) if sent_count > 0 else 0.0

    return {
        "generated_at": now.isoformat(),
        "window_days": 30,
        "due_soon_3d": int(due_soon_3d),
        "past_due_total": int(past_due_total),
        "in_sequence": int(in_sequence),
        "reminders_sent_30d": int(reminders_sent_30d),
        "stage_counts": stage_counts,
        "payments_after_reminder_30d": int(payments_after_reminder_30d),
        "recovered_after_reminder_30d": float(recovered_after_reminder_30d),
        "stage_recovery": stage_recovery,
        "stage_conversion_pct": stage_conversion_pct,
        "monthly_performance": [monthly_map[key] for key in month_keys],
    }


@router.get("/billing/dunning-summary/export.csv")
def export_billing_dunning_summary_csv(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
    _require_saas_module(_admin, MODULE_BILLING, "exportar resumen de cobranza inteligente")
    summary = get_billing_dunning_summary(db=db, _admin=_admin)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(["section", "stage", "sent_30d", "recovered_payments_30d", "recovered_amount_30d", "conversion_pct_30d"])
    stage_counts = summary.get("stage_counts") or {}
    stage_recovery = summary.get("stage_recovery") or {}
    stage_conversion_pct = summary.get("stage_conversion_pct") or {}
    for code, _label, _threshold in DUNNING_STAGE_RULES:
        bucket = stage_recovery.get(code) or {}
        writer.writerow([
            "stage_performance",
            code,
            int(stage_counts.get(code, 0) or 0),
            int(bucket.get("payments", 0) or 0),
            float(bucket.get("amount", 0.0) or 0.0),
            float(stage_conversion_pct.get(code, 0.0) or 0.0),
        ])

    writer.writerow([])
    writer.writerow(["section", "month", "reminders_sent", "recovered_payments", "recovered_amount"])
    for row in (summary.get("monthly_performance") or []):
        writer.writerow([
            "monthly_performance",
            row.get("month"),
            int(row.get("reminders_sent", 0) or 0),
            int(row.get("recovered_payments", 0) or 0),
            float(row.get("recovered_amount", 0.0) or 0.0),
        ])

    filename = f"saas_dunning_summary_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
        pricing = _tenant_period_amounts(db, t)
        fee = float(pricing["total"])
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
    open_total = int(
        status_counts.get("OPEN", 0)
        + status_counts.get("IN_PROGRESS", 0)
        + status_counts.get("WAITING_CUSTOMER", 0)
    )
    overdue_open = db.query(func.count(SaasSupportTicket.id)).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]),
        SaasSupportTicket.due_at.isnot(None),
        SaasSupportTicket.due_at < datetime.utcnow(),
    ).scalar() or 0
    due_soon_open = db.query(func.count(SaasSupportTicket.id)).filter(
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]),
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
        SaasSupportTicket.status.in_(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"]),
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

    plan_value = _resolve_plan_code(lead.plan_interes or PlanTenant.FREE.value)
    plan_policy = _plan_policy_for(plan_value)
    is_demo = plan_value == PlanTenant.FREE.value
    duration_days = int(plan_policy.get("duration_days", max(1, int(settings.DEFAULT_DEMO_DAYS or 15))))
    tenant = Tenant(
        slug=_ensure_unique_tenant_slug(db, lead.escuela_nombre),
        nombre=(lead.escuela_nombre or "").strip(),
        display_name=(lead.escuela_nombre or "").strip(),
        plan=plan_value,
        is_active=True,
        is_demo=is_demo,
        demo_ends_at=(datetime.utcnow() + timedelta(days=duration_days)) if is_demo else None,
        subscription_status="TRIAL" if is_demo else "ACTIVE",
        billing_cycle=str(plan_policy.get("billing_cycle", "QUARTERLY")).upper(),
        monthly_fee=float(plan_policy.get("base_fee", 0.0) or 0.0),
        next_billing_at=(datetime.utcnow() + timedelta(days=duration_days)) if not is_demo else None,
        contacto_nombre=_normalize_text(lead.contacto_nombre),
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
    _ensure_user_primary_branch_access(db, tenant, admin_user.id)

    lead.estado = "CERRADO_GANADO"
    lead.converted_tenant_id = tenant.id
    lead.converted_admin_user_id = admin_user.id
    lead.converted_at = datetime.utcnow()
    lead.updated_at = datetime.utcnow()
    pricing = _tenant_period_amounts(db, tenant)
    db.add(SaasBillingEvent(
        tenant_id=tenant.id,
        event_type="STATUS_CHANGED",
        status="INFO",
        amount=float(pricing["total"]),
        currency="COP",
        due_at=tenant.next_billing_at,
        notes="Tenant creado desde lead con política comercial vigente.",
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
