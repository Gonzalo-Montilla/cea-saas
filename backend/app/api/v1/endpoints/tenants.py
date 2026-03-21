import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.deps import get_admin_or_gerente, get_required_tenant
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.core.security import get_password_hash
from app.models.usuario import RolUsuario, Usuario
from app.models.tenant import PlanTenant, Tenant, TenantUser

router = APIRouter()


class TenantBrandingUpdate(BaseModel):
    display_name: str | None = None
    logo_url: str | None = None
    contacto_email: str | None = None
    contacto_telefono: str | None = None
    nit: str | None = None


class SchoolOnboardingRequest(BaseModel):
    nombre_escuela: str = Field(min_length=3, max_length=255)
    slug: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=255)
    plan: PlanTenant = PlanTenant.FREE
    contacto_email: EmailStr
    contacto_telefono: str | None = Field(default=None, max_length=50)
    nit: str | None = Field(default=None, max_length=50)
    logo_url: str | None = None
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=128)
    admin_nombre_completo: str = Field(min_length=3, max_length=255)
    admin_cedula: str = Field(min_length=5, max_length=20)
    admin_telefono: str | None = Field(default=None, max_length=20)
    send_welcome_email: bool = True
    activate_tenant: bool = True


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return base[:100] if base else ""


def _ensure_onboarding_access(key: str | None) -> None:
    if not settings.ALLOW_SCHOOL_ONBOARDING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Onboarding de escuelas deshabilitado en este entorno",
        )
    expected_key = settings.SCHOOL_ONBOARDING_KEY
    if expected_key:
        if not key or key.strip() != expected_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Llave de onboarding inválida",
            )


def _ensure_public_signup_enabled() -> None:
    if not settings.ALLOW_PUBLIC_SCHOOL_SIGNUP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registro público de escuelas deshabilitado en este entorno",
        )


def _send_onboarding_welcome_email(
    school_name: str,
    school_slug: str,
    login_email: str,
    admin_name: str,
) -> bool:
    base_portal = (settings.PORTAL_URL or "").strip().rstrip("/")
    login_url = f"{base_portal}/login?tenant={school_slug}" if base_portal else f"/login?tenant={school_slug}"
    subject = f"Bienvenido a {settings.BRAND_SHORT_NAME}: tu escuela ya esta activa"
    body = (
        f"Hola {admin_name},\n\n"
        f"Bienvenido a {settings.BRAND_SHORT_NAME}. Tu escuela {school_name} ya fue creada y activada.\n\n"
        "Datos de acceso inicial:\n"
        f"- Codigo de escuela: {school_slug}\n"
        f"- Correo: {login_email}\n"
        f"- URL de ingreso: {login_url}\n\n"
        "Guarda este enlace en favoritos para ingresar siempre con tu marca.\n\n"
        "Recomendaciones de seguridad:\n"
        "- Inicia sesion y cambia la contrasena temporal cuanto antes.\n"
        "- Registra el logo y datos de contacto de la escuela en configuracion.\n\n"
        "Si necesitas ayuda con la puesta en marcha, respondemos por este mismo correo.\n\n"
        f"{settings.BRAND_SHORT_NAME}\n"
        f"{settings.BRAND_FULL_NAME}\n"
    )
    return send_email(login_email, subject, body)


def _create_school_and_admin(db: Session, payload: SchoolOnboardingRequest) -> tuple[Tenant, Usuario]:
    normalized_nombre = _normalize_str(payload.nombre_escuela)
    if not normalized_nombre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nombre de escuela inválido")

    slug_candidate = _normalize_str(payload.slug) or _slugify(normalized_nombre)
    if not slug_candidate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fue posible generar un slug válido para la escuela",
        )
    if not re.fullmatch(r"[a-z0-9-]{3,100}", slug_candidate):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slug inválido: usa solo minusculas, numeros y guiones (3-100 caracteres)",
        )

    existing_tenant = db.query(Tenant).filter(Tenant.slug == slug_candidate).first()
    if existing_tenant:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El slug de la escuela ya existe")

    admin_email = payload.admin_email.strip().lower()
    existing_admin_email = db.query(Usuario).filter(Usuario.email == admin_email).first()
    if existing_admin_email:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El correo del administrador ya existe")

    admin_cedula = payload.admin_cedula.strip()
    existing_admin_cedula = db.query(Usuario).filter(Usuario.cedula == admin_cedula).first()
    if existing_admin_cedula:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La cédula del administrador ya existe")

    tenant = Tenant(
        slug=slug_candidate,
        nombre=normalized_nombre,
        display_name=_normalize_str(payload.display_name) or normalized_nombre,
        plan=payload.plan.value,
        is_active=payload.activate_tenant,
        is_demo=(payload.plan == PlanTenant.FREE),
        demo_ends_at=(
            datetime.utcnow() + timedelta(days=max(1, settings.DEFAULT_DEMO_DAYS))
            if payload.plan == PlanTenant.FREE
            else None
        ),
        contacto_email=_normalize_str(str(payload.contacto_email).lower()),
        contacto_telefono=_normalize_str(payload.contacto_telefono),
        nit=_normalize_str(payload.nit),
        logo_url=_normalize_str(payload.logo_url),
    )
    db.add(tenant)
    db.flush()

    admin_user = Usuario(
        email=admin_email,
        password_hash=get_password_hash(payload.admin_password),
        nombre_completo=payload.admin_nombre_completo.strip(),
        cedula=admin_cedula,
        telefono=_normalize_str(payload.admin_telefono),
        rol=RolUsuario.ADMIN,
        tenant_id=tenant.id,
        is_active=True,
        is_verified=True,
    )
    db.add(admin_user)
    db.flush()

    membership = TenantUser(
        tenant_id=tenant.id,
        user_id=admin_user.id,
        rol=RolUsuario.ADMIN.value,
        is_active=True,
    )
    db.add(membership)
    db.commit()
    return tenant, admin_user


@router.get("/context")
def get_tenant_context(current_tenant: Tenant = Depends(get_required_tenant)):
    return {
        "id": current_tenant.id,
        "slug": current_tenant.slug,
        "nombre": current_tenant.nombre,
        "display_name": current_tenant.display_name or current_tenant.nombre,
        "plan": current_tenant.plan,
        "is_active": current_tenant.is_active,
        "logo_url": current_tenant.logo_url,
        "contacto_email": current_tenant.contacto_email,
        "contacto_telefono": current_tenant.contacto_telefono,
        "nit": current_tenant.nit,
    }


@router.post("/bootstrap", status_code=status.HTTP_201_CREATED)
def bootstrap_first_tenant(
    slug: str,
    nombre: str,
    db: Session = Depends(get_db),
):
    """
    Crea el primer tenant si aún no existe ninguno.
    Solo para bootstrap local/inicial.
    """
    if not settings.ALLOW_TENANT_BOOTSTRAP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bootstrap deshabilitado en este entorno",
        )

    existing_tenants = db.query(Tenant).count()
    if existing_tenants > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bootstrap deshabilitado: ya existen tenants",
        )

    tenant = Tenant(
        slug=slug.strip().lower(),
        nombre=nombre.strip(),
        display_name=nombre.strip(),
        plan=PlanTenant.FREE.value,
        is_active=True,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    return {"id": tenant.id, "slug": tenant.slug, "nombre": tenant.nombre}


@router.post("/onboarding-school", status_code=status.HTTP_201_CREATED)
def onboarding_school(
    payload: SchoolOnboardingRequest,
    onboarding_key: str | None = Header(default=None, alias="X-Onboarding-Key"),
    db: Session = Depends(get_db),
):
    _ensure_onboarding_access(onboarding_key)
    tenant, admin_user = _create_school_and_admin(db, payload)

    welcome_email_sent = False
    if payload.send_welcome_email:
        welcome_email_sent = _send_onboarding_welcome_email(
            school_name=tenant.display_name or tenant.nombre,
            school_slug=tenant.slug,
            login_email=admin_user.email,
            admin_name=admin_user.nombre_completo,
        )

    return {
        "tenant_id": tenant.id,
        "tenant_slug": tenant.slug,
        "tenant_nombre": tenant.nombre,
        "tenant_display_name": tenant.display_name,
        "tenant_plan": tenant.plan,
        "tenant_activo": tenant.is_active,
        "admin_user_id": admin_user.id,
        "admin_email": admin_user.email,
        "welcome_email_sent": welcome_email_sent,
    }


@router.post("/public-signup", status_code=status.HTTP_201_CREATED)
def public_school_signup(
    payload: SchoolOnboardingRequest,
    db: Session = Depends(get_db),
):
    _ensure_public_signup_enabled()
    tenant, admin_user = _create_school_and_admin(db, payload)

    welcome_email_sent = False
    if payload.send_welcome_email:
        welcome_email_sent = _send_onboarding_welcome_email(
            school_name=tenant.display_name or tenant.nombre,
            school_slug=tenant.slug,
            login_email=admin_user.email,
            admin_name=admin_user.nombre_completo,
        )

    return {
        "tenant_id": tenant.id,
        "tenant_slug": tenant.slug,
        "tenant_nombre": tenant.nombre,
        "tenant_display_name": tenant.display_name,
        "tenant_plan": tenant.plan,
        "tenant_activo": tenant.is_active,
        "admin_user_id": admin_user.id,
        "admin_email": admin_user.email,
        "welcome_email_sent": welcome_email_sent,
    }


@router.put("/branding")
def update_tenant_branding(
    payload: TenantBrandingUpdate,
    db: Session = Depends(get_db),
    current_tenant: Tenant = Depends(get_required_tenant),
    _current_user: Usuario = Depends(get_admin_or_gerente),
):
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(current_tenant, field, value)

    db.commit()
    db.refresh(current_tenant)
    return {
        "id": current_tenant.id,
        "slug": current_tenant.slug,
        "display_name": current_tenant.display_name or current_tenant.nombre,
        "logo_url": current_tenant.logo_url,
        "contacto_email": current_tenant.contacto_email,
        "contacto_telefono": current_tenant.contacto_telefono,
        "nit": current_tenant.nit,
    }
