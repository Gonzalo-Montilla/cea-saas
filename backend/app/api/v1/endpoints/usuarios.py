from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional

from app.core.database import get_db
from app.core.security import get_password_hash
from app.api.deps import get_admin_or_gerente, get_required_tenant
from app.models.tenant_branch import TenantBranch, TenantUserBranch
from app.models.usuario import Usuario, RolUsuario
from app.models.tenant import Tenant, TenantUser
from app.schemas.usuario import UsuarioCreate, UsuarioUpdate, UsuarioPasswordUpdate, UsuarioResponse


router = APIRouter()


def _bump_session_version(user: Usuario) -> None:
    current = int(getattr(user, "session_version", 1) or 1)
    user.session_version = current + 1


def _ensure_primary_branch_for_tenant(db: Session, tenant: Tenant) -> TenantBranch:
    branch = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
        TenantBranch.is_primary.is_(True),
    ).first()
    if branch:
        return branch
    branch = TenantBranch(
        tenant_id=tenant.id,
        nombre=(tenant.display_name or tenant.nombre or "Sede Principal").strip(),
        codigo="PRINCIPAL",
        is_active=True,
        is_primary=True,
        contacto_email=tenant.contacto_email,
        contacto_telefono=tenant.contacto_telefono,
    )
    db.add(branch)
    db.flush()
    return branch


@router.get("/", response_model=List[UsuarioResponse])
def listar_usuarios(
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    query = db.query(Usuario).filter(
        Usuario.rol != RolUsuario.ESTUDIANTE,
        Usuario.tenant_id == current_tenant.id,
    )
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Usuario.nombre_completo.ilike(term),
                Usuario.email.ilike(term),
                Usuario.cedula.ilike(term)
            )
        )
    return query.order_by(Usuario.created_at.desc()).all()


@router.get("/{usuario_id}", response_model=UsuarioResponse)
def obtener_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return usuario


@router.post("/", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def crear_usuario(
    payload: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    existing_user = db.query(Usuario).filter(
        or_(Usuario.email == payload.email, Usuario.cedula == payload.cedula),
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="El email o cédula ya existe")

    nuevo = Usuario(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        nombre_completo=payload.nombre_completo,
        cedula=payload.cedula,
        tipo_documento=payload.tipo_documento or "CEDULA",
        telefono=payload.telefono,
        rol=payload.rol,
        tenant_id=current_tenant.id,
        is_active=payload.is_active if payload.is_active is not None else True,
        is_verified=False,
        permisos_modulos=payload.permisos_modulos
    )
    db.add(nuevo)
    db.flush()
    db.add(
        TenantUser(
            tenant_id=current_tenant.id,
            user_id=nuevo.id,
            rol=payload.rol.value,
            is_active=bool(nuevo.is_active),
        )
    )
    primary_branch = _ensure_primary_branch_for_tenant(db, current_tenant)
    db.add(TenantUserBranch(
        tenant_id=current_tenant.id,
        user_id=nuevo.id,
        branch_id=primary_branch.id,
        is_active=bool(nuevo.is_active),
    ))
    db.commit()
    db.refresh(nuevo)
    return nuevo


@router.put("/{usuario_id}", response_model=UsuarioResponse)
def actualizar_usuario(
    usuario_id: int,
    payload: UsuarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if payload.email and payload.email != usuario.email:
        existe = db.query(Usuario).filter(
            Usuario.email == payload.email,
            Usuario.tenant_id == current_tenant.id,
        ).first()
        if existe:
            raise HTTPException(status_code=400, detail="El email ya está registrado")

    if payload.cedula and payload.cedula != usuario.cedula:
        existe = db.query(Usuario).filter(
            Usuario.cedula == payload.cedula,
            Usuario.tenant_id == current_tenant.id,
        ).first()
        if existe:
            raise HTTPException(status_code=400, detail="La cédula ya está registrada")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(usuario, field, value)

    membership = db.query(TenantUser).filter(
        TenantUser.tenant_id == current_tenant.id,
        TenantUser.user_id == usuario.id,
    ).first()
    if membership:
        membership.rol = usuario.rol.value
        membership.is_active = bool(usuario.is_active)
    if "is_active" in update_data:
        if not bool(usuario.is_active):
            db.query(TenantUserBranch).filter(
                TenantUserBranch.tenant_id == current_tenant.id,
                TenantUserBranch.user_id == usuario.id,
            ).update({"is_active": False}, synchronize_session=False)
        else:
            primary_branch = _ensure_primary_branch_for_tenant(db, current_tenant)
            existing_branch = db.query(TenantUserBranch).filter(
                TenantUserBranch.tenant_id == current_tenant.id,
                TenantUserBranch.user_id == usuario.id,
                TenantUserBranch.branch_id == primary_branch.id,
            ).first()
            if existing_branch:
                existing_branch.is_active = True
            else:
                db.add(TenantUserBranch(
                    tenant_id=current_tenant.id,
                    user_id=usuario.id,
                    branch_id=primary_branch.id,
                    is_active=True,
                ))

    db.commit()
    db.refresh(usuario)
    return usuario


@router.put("/{usuario_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    usuario_id: int,
    payload: UsuarioPasswordUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    usuario = db.query(Usuario).filter(
        Usuario.id == usuario_id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    usuario.password_hash = get_password_hash(payload.new_password)
    _bump_session_version(usuario)
    db.commit()
    return None
