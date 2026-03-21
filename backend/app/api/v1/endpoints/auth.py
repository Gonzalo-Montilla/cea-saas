from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import pyotp
import secrets
from urllib.parse import quote_plus
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_email
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
from app.models.saas_audit_log import SaasAuditLog
from app.models.usuario import Usuario, RolUsuario
from app.models.tenant import Tenant, TenantUser
from app.schemas.auth import (
    GlobalMfaDisableRequest,
    GlobalMfaEnableRequest,
    GlobalMfaRegenerateBackupCodesRequest,
    GlobalPasswordChangeRequest,
    UserLogin,
    UserRegister,
    Token,
    UserResponse,
)
from app.api.deps import get_current_active_user, get_current_active_user_global, get_required_tenant

router = APIRouter()


def _is_saas_admin_email(email: str) -> bool:
    raw = (settings.SAAS_ADMIN_EMAILS or "").strip()
    allowed = {e.strip().lower() for e in raw.split(",") if e.strip()}
    return bool(allowed) and email.strip().lower() in allowed


def _is_saas_admin_role(role: RolUsuario) -> bool:
    raw = (settings.SAAS_ADMIN_ALLOWED_ROLES or "").strip()
    allowed = {r.strip().upper() for r in raw.split(",") if r.strip()}
    if not allowed:
        allowed = {"ADMIN", "GERENTE"}
    role_value = role.value if hasattr(role, "value") else str(role)
    return str(role_value).upper() in allowed


def _has_saas_admin_scope(user: Usuario) -> bool:
    permisos = user.permisos_modulos or []
    if not isinstance(permisos, list):
        return False
    return any(str(p).strip().lower().startswith("saas_") for p in permisos)


def _get_global_lock_minutes() -> int:
    return max(1, int(getattr(settings, "SAAS_LOGIN_LOCK_MINUTES", 15) or 15))


def _get_global_max_attempts() -> int:
    return max(3, int(getattr(settings, "SAAS_LOGIN_MAX_ATTEMPTS", 5) or 5))


def _raise_locked_account(user: Usuario) -> None:
    if user.lockout_until is None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Cuenta bloqueada temporalmente por seguridad",
        )
    mins_left = int((user.lockout_until - datetime.utcnow()).total_seconds() / 60) + 1
    mins_left = max(1, mins_left)
    raise HTTPException(
        status_code=status.HTTP_423_LOCKED,
        detail=f"Cuenta bloqueada temporalmente. Intenta nuevamente en {mins_left} minuto(s)",
    )


def _check_and_cleanup_lock(user: Usuario, db: Session) -> None:
    now = datetime.utcnow()
    if user.lockout_until and user.lockout_until > now:
        _raise_locked_account(user)
    if user.lockout_until and user.lockout_until <= now:
        user.lockout_until = None
        user.failed_login_attempts = 0
        db.commit()


def _register_failed_global_attempt(user: Usuario, db: Session) -> None:
    now = datetime.utcnow()
    max_attempts = _get_global_max_attempts()
    lock_minutes = _get_global_lock_minutes()

    current = int(user.failed_login_attempts or 0) + 1
    user.failed_login_attempts = current
    user.last_failed_login_at = now

    if current >= max_attempts:
        user.lockout_until = now + timedelta(minutes=lock_minutes)
        db.commit()
        _raise_locked_account(user)

    db.commit()
    remaining = max_attempts - current
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=f"Email o contraseña incorrectos. Intentos restantes: {remaining}",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _bump_session_version(user: Usuario) -> None:
    current = int(getattr(user, "session_version", 1) or 1)
    user.session_version = current + 1


def _ensure_global_admin_identity(user: Usuario) -> None:
    email = (user.email or "").strip().lower()
    if not (_is_saas_admin_email(email) or _has_saas_admin_scope(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso global no autorizado para este usuario",
        )
    if not _is_saas_admin_role(user.rol):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta no tiene un rol válido para acceso SaaS",
        )


def _mask_email(email: str) -> str:
    value = (email or "").strip()
    if "@" not in value:
        return value
    user, domain = value.split("@", 1)
    if len(user) <= 2:
        return f"{user[0]}***@{domain}" if user else f"***@{domain}"
    return f"{user[:2]}***@{domain}"


def _generate_backup_codes() -> list[str]:
    return [secrets.token_hex(4).upper() for _ in range(8)]


def _hash_backup_codes(raw_codes: list[str]) -> list[str]:
    return [get_password_hash(code) for code in raw_codes]


def _verify_and_consume_backup_code(user: Usuario, backup_code: str) -> bool:
    hashes = user.mfa_backup_codes_hashes or []
    if not isinstance(hashes, list) or not hashes:
        return False
    code = (backup_code or "").strip().replace(" ", "").upper()
    if not code:
        return False
    for idx, code_hash in enumerate(hashes):
        if verify_password(code, code_hash):
            new_hashes = [h for i, h in enumerate(hashes) if i != idx]
            user.mfa_backup_codes_hashes = new_hashes
            return True
    return False


def _send_mfa_alert(email: str, action: str) -> None:
    subject = f"[Seguridad] {action} en tu cuenta SaaS"
    body = (
        "Hola,\n\n"
        f"Se detectó la acción: {action}.\n"
        f"Cuenta: {_mask_email(email)}\n"
        f"Fecha (UTC): {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        "Si no fuiste tú, cambia la contraseña inmediatamente y contacta soporte.\n"
    )
    try:
        send_email(email, subject, body)
    except Exception:
        pass


def _write_mfa_audit(
    db: Session,
    actor: Usuario,
    request: Request | None,
    action: str,
    summary: str,
    payload: dict | None = None,
) -> None:
    db.add(SaasAuditLog(
        actor_user_id=actor.id,
        actor_email=(actor.email or "").strip().lower(),
        action=action,
        entity_type="saas_user",
        entity_id=str(actor.id),
        summary=summary,
        payload=payload or {},
        ip_address=(request.client.host if request and request.client else None),
        user_agent=(request.headers.get("user-agent") if request else None),
    ))


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    user_data: UserRegister,
    db: Session = Depends(get_db),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Registrar un nuevo usuario
    """
    # Verificar si el email ya existe
    existing_user = db.query(Usuario).filter(
        Usuario.email == user_data.email,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email ya está registrado"
        )
    
    # Verificar si la cédula ya existe
    existing_cedula = db.query(Usuario).filter(
        Usuario.cedula == user_data.cedula,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if existing_cedula:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cédula ya está registrada"
        )
    
    # Crear usuario
    new_user = Usuario(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        nombre_completo=user_data.nombre_completo,
        cedula=user_data.cedula,
        telefono=user_data.telefono,
        rol=user_data.rol,
        tenant_id=current_tenant.id,
        is_active=True,
        is_verified=False
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    membership = TenantUser(
        tenant_id=current_tenant.id,
        user_id=new_user.id,
        rol=user_data.rol.value,
        is_active=True,
    )
    db.add(membership)
    db.commit()
    
    return new_user


@router.post("/login", response_model=Token)
def login(
    credentials: UserLogin,
    db: Session = Depends(get_db),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Login de usuario - retorna access token y refresh token
    """
    # Buscar usuario por email
    user = db.query(Usuario).filter(
        Usuario.email == credentials.email,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )
    
    membership = (
        db.query(TenantUser)
        .filter(
            TenantUser.tenant_id == current_tenant.id,
            TenantUser.user_id == user.id,
            TenantUser.is_active.is_(True),
        )
        .first()
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario sin acceso al tenant solicitado",
        )

    # Actualizar last_login
    user.last_login = datetime.utcnow()
    user.rol = RolUsuario(membership.rol)
    db.commit()
    
    # Crear tokens (sub debe ser string)
    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "tid": current_tenant.id,
        "tslug": current_tenant.slug,
        "sv": int(getattr(user, "session_version", 1) or 1),
    }
    access_token = create_access_token(data=token_payload)
    refresh_token = create_refresh_token(data={
        "sub": str(user.id),
        "tid": current_tenant.id,
        "tslug": current_tenant.slug,
        "sv": int(getattr(user, "session_version", 1) or 1),
    })
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/login-global", response_model=Token)
def login_global(
    credentials: UserLogin,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Login global para backoffice SaaS (sin tenant).
    Permite acceso por correo allowlist o por scope saas_admin en permisos_modulos.
    """
    email = credentials.email.strip().lower()
    user = db.query(Usuario).filter(Usuario.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    _check_and_cleanup_lock(user, db)
    if not verify_password(credentials.password, user.password_hash):
        _register_failed_global_attempt(user, db)
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )
    _ensure_global_admin_identity(user)
    if bool(user.mfa_enabled):
        code = (credentials.mfa_code or "").strip().replace(" ", "")
        backup_code = (credentials.backup_code or "").strip().replace(" ", "").upper()
        if not code and not backup_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Código MFA o backup code requerido para acceso global",
                headers={"WWW-Authenticate": "Bearer"},
            )
        secret = (user.mfa_secret or "").strip()
        mfa_ok = bool(secret and code and pyotp.TOTP(secret).verify(code, valid_window=1))
        backup_ok = False
        if not mfa_ok and backup_code:
            backup_ok = _verify_and_consume_backup_code(user, backup_code)
            if backup_ok:
                _write_mfa_audit(
                    db=db,
                    actor=user,
                    request=request,
                    action="mfa.backup_code_used",
                    summary="Ingreso global usando backup code MFA",
                    payload={"remaining_backup_codes": len(user.mfa_backup_codes_hashes or [])},
                )
                db.commit()
        if not (mfa_ok or backup_ok):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Código MFA o backup code inválido",
                headers={"WWW-Authenticate": "Bearer"},
            )

    user.failed_login_attempts = 0
    user.lockout_until = None
    user.last_failed_login_at = None
    user.last_login = datetime.utcnow()
    db.commit()

    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "global": True,
        "sv": int(getattr(user, "session_version", 1) or 1),
    }
    access_token = create_access_token(data=token_payload)
    refresh_token = create_refresh_token(data={
        "sub": str(user.id),
        "global": True,
        "sv": int(getattr(user, "session_version", 1) or 1),
    })
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post("/mfa-global/setup")
def setup_mfa_global(
    request: Request,
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    _ensure_global_admin_identity(current_user)
    secret = pyotp.random_base32()
    current_user.mfa_secret = secret
    current_user.mfa_enabled = False
    current_user.mfa_backup_codes_hashes = []
    _write_mfa_audit(
        db=db,
        actor=current_user,
        request=request,
        action="mfa.setup_generated",
        summary="Generó nueva configuración MFA",
    )
    db.commit()
    issuer = (settings.MFA_TOTP_ISSUER or "SIAEC SaaS").strip()
    otpauth_url = pyotp.TOTP(secret).provisioning_uri(name=current_user.email, issuer_name=issuer)
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=220x220&data={quote_plus(otpauth_url)}"
    return {
        "secret": secret,
        "otpauth_url": otpauth_url,
        "qr_url": qr_url,
        "issuer": issuer,
    }


@router.post("/mfa-global/enable")
def enable_mfa_global(
    payload: GlobalMfaEnableRequest,
    request: Request,
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    _ensure_global_admin_identity(current_user)
    secret = (current_user.mfa_secret or "").strip()
    if not secret:
        raise HTTPException(status_code=400, detail="Primero genera la configuración MFA")
    code = (payload.code or "").strip().replace(" ", "")
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Código MFA inválido")
    raw_backup_codes = _generate_backup_codes()
    current_user.mfa_backup_codes_hashes = _hash_backup_codes(raw_backup_codes)
    current_user.mfa_enabled = True
    _write_mfa_audit(
        db=db,
        actor=current_user,
        request=request,
        action="mfa.enabled",
        summary="Activó MFA en cuenta SaaS",
        payload={"backup_codes_generated": len(raw_backup_codes)},
    )
    db.commit()
    _send_mfa_alert(current_user.email, "MFA ACTIVADO")
    return {
        "backup_codes": raw_backup_codes,
        "message": "MFA activado. Guarda estos backup codes en un lugar seguro.",
    }


@router.post("/mfa-global/disable", status_code=status.HTTP_204_NO_CONTENT)
def disable_mfa_global(
    payload: GlobalMfaDisableRequest,
    request: Request,
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    _ensure_global_admin_identity(current_user)
    if not bool(current_user.mfa_enabled):
        raise HTTPException(status_code=400, detail="MFA ya se encuentra desactivado")
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")
    secret = (current_user.mfa_secret or "").strip()
    code = (payload.code or "").strip().replace(" ", "")
    if not secret or not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Código MFA inválido")
    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    current_user.mfa_backup_codes_hashes = []
    _write_mfa_audit(
        db=db,
        actor=current_user,
        request=request,
        action="mfa.disabled",
        summary="Desactivó MFA en cuenta SaaS",
    )
    db.commit()
    _send_mfa_alert(current_user.email, "MFA DESACTIVADO")
    return None


@router.post("/mfa-global/backup-codes/regenerate")
def regenerate_backup_codes_global(
    payload: GlobalMfaRegenerateBackupCodesRequest,
    request: Request,
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    _ensure_global_admin_identity(current_user)
    if not bool(current_user.mfa_enabled):
        raise HTTPException(status_code=400, detail="MFA debe estar activo para regenerar backup codes")
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")
    secret = (current_user.mfa_secret or "").strip()
    code = (payload.code or "").strip().replace(" ", "")
    if not secret or not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Código MFA inválido")
    raw_backup_codes = _generate_backup_codes()
    current_user.mfa_backup_codes_hashes = _hash_backup_codes(raw_backup_codes)
    _write_mfa_audit(
        db=db,
        actor=current_user,
        request=request,
        action="mfa.backup_codes_regenerated",
        summary="Regeneró backup codes MFA",
        payload={"backup_codes_generated": len(raw_backup_codes)},
    )
    db.commit()
    _send_mfa_alert(current_user.email, "BACKUP CODES REGENERADOS")
    return {
        "backup_codes": raw_backup_codes,
        "message": "Backup codes regenerados correctamente.",
    }


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: Usuario = Depends(get_current_active_user)):
    """
    Obtener información del usuario actual
    """
    return current_user


@router.get("/me-global", response_model=UserResponse)
def get_current_user_info_global(current_user: Usuario = Depends(get_current_active_user_global)):
    """
    Información del usuario autenticado con login global SaaS.
    """
    response = current_user
    hashes = current_user.mfa_backup_codes_hashes if isinstance(current_user.mfa_backup_codes_hashes, list) else []
    setattr(response, "mfa_backup_codes_remaining", len(hashes))
    return response


@router.post("/change-password-global", status_code=status.HTTP_204_NO_CONTENT)
def change_password_global(
    payload: GlobalPasswordChangeRequest,
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    """
    Cambio de contraseña para cuenta autenticada en modo global SaaS.
    """
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual es incorrecta",
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser diferente a la actual",
        )
    current_user.password_hash = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    current_user.password_changed_at = datetime.utcnow()
    _bump_session_version(current_user)
    db.commit()
    return None


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all_sessions(
    current_user: Usuario = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    _bump_session_version(current_user)
    db.commit()
    return None


@router.post("/logout-all-global", status_code=status.HTTP_204_NO_CONTENT)
def logout_all_sessions_global(
    current_user: Usuario = Depends(get_current_active_user_global),
    db: Session = Depends(get_db),
):
    _bump_session_version(current_user)
    db.commit()
    return None


@router.post("/refresh", response_model=Token)
def refresh_token(
    refresh_token_str: str,
    db: Session = Depends(get_db),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Refrescar el access token usando el refresh token
    """
    from app.core.security import decode_token
    
    payload = decode_token(refresh_token_str)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de refresco inválido"
        )
    
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de refresco inválido"
        )
    token_sv = int(payload.get("sv") or 1)
    
    user_id = int(user_id_str)
    user = db.query(Usuario).filter(
        Usuario.id == user_id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado o inactivo"
        )
    if token_sv != int(getattr(user, "session_version", 1) or 1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de refresco inválido o expirado por cierre de sesión",
        )
    
    membership = (
        db.query(TenantUser)
        .filter(
            TenantUser.tenant_id == current_tenant.id,
            TenantUser.user_id == user.id,
            TenantUser.is_active.is_(True),
        )
        .first()
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario sin acceso al tenant solicitado",
        )

    # Crear nuevos tokens
    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "tid": current_tenant.id,
        "tslug": current_tenant.slug,
        "sv": int(getattr(user, "session_version", 1) or 1),
    }
    access_token = create_access_token(data=token_payload)
    new_refresh_token = create_refresh_token(data={
        "sub": str(user.id),
        "tid": current_tenant.id,
        "tslug": current_tenant.slug,
        "sv": int(getattr(user, "session_version", 1) or 1),
    })
    
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer"
    }
