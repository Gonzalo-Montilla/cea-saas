from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_saas_admin_user
from app.core.database import get_db
from app.core.security import get_password_hash
from app.models.saas_audit_log import SaasAuditLog
from app.models.tenant import PlanTenant, Tenant
from app.models.usuario import RolUsuario, Usuario

router = APIRouter()


PLAN_MRR_ESTIMATE = {
    PlanTenant.FREE.value: 0,
    PlanTenant.BASIC.value: 199000,
    PlanTenant.PRO.value: 399000,
    PlanTenant.ENTERPRISE.value: 799000,
}


class TenantAdminUpdate(BaseModel):
    plan: Optional[str] = None
    is_active: Optional[bool] = None
    is_demo: Optional[bool] = None
    demo_ends_at: Optional[datetime] = None


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


def _normalize_permisos(permisos: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in (permisos or []):
        value = str(raw or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    if "saas_admin" not in seen:
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


@router.get("/summary")
def get_saas_summary(
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
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

    demos_por_vencer = db.query(func.count(Tenant.id)).filter(
        Tenant.is_demo.is_(True),
        Tenant.demo_ends_at.isnot(None),
        Tenant.demo_ends_at <= (datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=0)),
    ).scalar() or 0

    return {
        "total_tenants": int(total_tenants),
        "active_tenants": int(active_tenants),
        "inactive_tenants": int(inactive_tenants),
        "demo_tenants": int(demo_tenants),
        "demos_por_vencer": int(demos_por_vencer),
        "plan_counts": plan_counts,
        "mrr_estimado": int(mrr_estimado),
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
    if "plan" in data and data["plan"]:
        plan_value = str(data["plan"]).strip().upper()
        valid = {p.value for p in PlanTenant}
        if plan_value not in valid:
            raise HTTPException(status_code=400, detail="Plan inválido")
        tenant.plan = plan_value
    if "is_active" in data:
        tenant.is_active = bool(data["is_active"])
    if "is_demo" in data:
        tenant.is_demo = bool(data["is_demo"])
    if "demo_ends_at" in data:
        tenant.demo_ends_at = data["demo_ends_at"]

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
    }


@router.get("/users")
def list_saas_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _admin: Usuario = Depends(get_saas_admin_user),
):
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
    user = db.query(Usuario).filter(Usuario.id == user_id, Usuario.tenant_id.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario SaaS no encontrado")
    user.password_hash = get_password_hash(payload.new_password)
    user.must_change_password = True
    user.password_changed_at = None
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
