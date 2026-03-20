from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError
from app.core.database import get_db
from app.core.config import settings
from app.core.security import decode_token
from app.models.usuario import Usuario, RolUsuario
from app.models.tenant import Tenant, TenantUser
from app.schemas.auth import TokenData
from typing import Optional

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


def get_current_tenant(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[Tenant]:
    """
    Obtiene el tenant actual desde request.state.tenant_slug.
    En modo estricto, exige tenant válido en cada request autenticado.
    """
    tenant_slug = getattr(request.state, "tenant_slug", None)
    if not tenant_slug:
        if settings.TENANT_STRICT_MODE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tenant requerido. Envía header {settings.TENANT_HEADER_NAME}",
            )
        return None

    tenant = db.query(Tenant).filter(Tenant.slug == tenant_slug).first()
    if not tenant or not tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant no existe o está inactivo",
        )
    return tenant


def get_required_tenant(
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
) -> Tenant:
    if current_tenant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tenant requerido. Envía header {settings.TENANT_HEADER_NAME}",
        )
    return current_tenant


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
) -> Usuario:
    """
    Obtiene el usuario actual desde el token JWT
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = decode_token(token)
        if payload is None:
            raise credentials_exception
        
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        
        user_id: int = int(user_id_str)
        token_tenant_slug = payload.get("tslug")
        token_tenant_id = payload.get("tid")
        token_data = TokenData(
            user_id=user_id,
            tenant_slug=token_tenant_slug,
            tenant_id=token_tenant_id,
        )
    except (JWTError, ValueError):
        raise credentials_exception
    
    user = db.query(Usuario).filter(Usuario.id == token_data.user_id).first()
    if user is None:
        raise credentials_exception

    if current_tenant:
        if user.tenant_id is not None and user.tenant_id != current_tenant.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Usuario pertenece a otro tenant",
            )
        if token_data.tenant_id and token_data.tenant_id != current_tenant.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token no corresponde al tenant solicitado",
            )
        if token_data.tenant_slug and token_data.tenant_slug != current_tenant.slug:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token no corresponde al tenant solicitado",
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
                detail="Usuario sin acceso a este tenant",
            )
    
    return user


def get_current_user_global(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    """
    Obtiene usuario actual desde JWT sin validación de tenant.
    Útil para backoffice SaaS (owner panel).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload is None:
            raise credentials_exception
        if payload.get("global") is not True:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token no corresponde a acceso global SaaS",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_active_user(
    current_user: Usuario = Depends(get_current_user)
) -> Usuario:
    """
    Verifica que el usuario esté activo
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo"
        )
    return current_user


def get_current_active_user_global(
    current_user: Usuario = Depends(get_current_user_global)
) -> Usuario:
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo",
        )
    return current_user


def get_saas_admin_user(
    current_user: Usuario = Depends(get_current_active_user_global),
) -> Usuario:
    if bool(getattr(current_user, "must_change_password", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Debes cambiar tu contraseña temporal antes de usar el backoffice SaaS",
        )
    raw = (settings.SAAS_ADMIN_EMAILS or "").strip()
    allowed = {e.strip().lower() for e in raw.split(",") if e.strip()}
    current_email = (current_user.email or "").strip().lower()
    user_permisos = current_user.permisos_modulos or []
    has_scope = isinstance(user_permisos, list) and any(
        str(p).strip().lower() == "saas_admin" for p in user_permisos
    )
    is_allowed_email = bool(allowed) and current_email in allowed
    if not (is_allowed_email or has_scope):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes acceso al backoffice SaaS",
        )
    raw_roles = (settings.SAAS_ADMIN_ALLOWED_ROLES or "").strip()
    allowed_roles = {r.strip().upper() for r in raw_roles.split(",") if r.strip()}
    if not allowed_roles:
        allowed_roles = {"ADMIN", "GERENTE"}
    current_role = current_user.rol.value if hasattr(current_user.rol, "value") else str(current_user.rol)
    if str(current_role).upper() not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta no tiene un rol válido para backoffice SaaS",
        )
    return current_user


def require_role(required_roles: list[RolUsuario]):
    """
    Decorator para requerir roles específicos
    """
    def role_checker(current_user: Usuario = Depends(get_current_active_user)) -> Usuario:
        if current_user.rol not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para realizar esta acción"
            )
        return current_user
    return role_checker


# Shortcuts para roles comunes
def get_admin_user(current_user: Usuario = Depends(get_current_active_user)) -> Usuario:
    """Solo admins"""
    if current_user.rol != RolUsuario.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador"
        )
    return current_user


def get_admin_or_coordinador(current_user: Usuario = Depends(get_current_active_user)) -> Usuario:
    """Admins o coordinadores"""
    if current_user.rol not in [RolUsuario.ADMIN, RolUsuario.COORDINADOR, RolUsuario.GERENTE]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador o coordinador"
        )
    return current_user


def get_admin_or_gerente(current_user: Usuario = Depends(get_current_active_user)) -> Usuario:
    """Admins o gerente"""
    if current_user.rol not in [RolUsuario.ADMIN, RolUsuario.GERENTE]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador o gerente"
        )
    return current_user


def get_admin_or_coordinador_or_cajero(current_user: Usuario = Depends(get_current_active_user)) -> Usuario:
    """Admins, coordinadores o cajeros"""
    if current_user.rol not in [RolUsuario.ADMIN, RolUsuario.COORDINADOR, RolUsuario.CAJERO, RolUsuario.GERENTE]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requieren permisos de administrador, coordinador o cajero"
        )
    return current_user
