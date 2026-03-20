from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
from app.models.usuario import Usuario, RolUsuario
from app.models.tenant import Tenant, TenantUser
from app.schemas.auth import GlobalPasswordChangeRequest, UserLogin, UserRegister, Token, UserResponse
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
    return any(str(p).strip().lower() == "saas_admin" for p in permisos)


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
    }
    access_token = create_access_token(data=token_payload)
    refresh_token = create_refresh_token(data={"sub": str(user.id), "tid": current_tenant.id, "tslug": current_tenant.slug})
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/login-global", response_model=Token)
def login_global(
    credentials: UserLogin,
    db: Session = Depends(get_db),
):
    """
    Login global para backoffice SaaS (sin tenant).
    Permite acceso por correo allowlist o por scope saas_admin en permisos_modulos.
    """
    email = credentials.email.strip().lower()
    user = db.query(Usuario).filter(Usuario.email == email).first()
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
    if not _is_saas_admin_role(user.rol):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta no tiene un rol válido para acceso SaaS",
        )
    if not (_is_saas_admin_email(email) or _has_saas_admin_scope(user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso global no autorizado para este usuario",
        )

    user.last_login = datetime.utcnow()
    db.commit()

    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "global": True,
    }
    access_token = create_access_token(data=token_payload)
    refresh_token = create_refresh_token(data={"sub": str(user.id), "global": True})
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
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
    return current_user


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
    }
    access_token = create_access_token(data=token_payload)
    new_refresh_token = create_refresh_token(data={"sub": str(user.id), "tid": current_tenant.id, "tslug": current_tenant.slug})
    
    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer"
    }
