from fastapi import APIRouter, Depends, HTTPException, status
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


def _get_active_tenant_branches(db: Session, tenant: Tenant) -> dict[int, TenantBranch]:
    rows = db.query(TenantBranch).filter(
        TenantBranch.tenant_id == tenant.id,
        TenantBranch.is_active.is_(True),
    ).all()
    return {int(row.id): row for row in rows}


def _normalize_requested_branch_ids(branch_ids: Optional[list[int]]) -> list[int]:
    if not branch_ids:
        return []
    seen: set[int] = set()
    normalized: list[int] = []
    for raw in branch_ids:
        try:
            bid = int(raw)
        except (TypeError, ValueError):
            continue
        if bid <= 0 or bid in seen:
            continue
        seen.add(bid)
        normalized.append(bid)
    return normalized


def _serialize_usuario_response(db: Session, tenant: Tenant, usuario: Usuario) -> UsuarioResponse:
    branch_ids_rows = db.query(TenantUserBranch.branch_id).filter(
        TenantUserBranch.tenant_id == tenant.id,
        TenantUserBranch.user_id == usuario.id,
        TenantUserBranch.is_active.is_(True),
    ).all()
    branch_ids = [int(row[0]) for row in branch_ids_rows]
    return UsuarioResponse(
        id=usuario.id,
        email=usuario.email,
        nombre_completo=usuario.nombre_completo,
        cedula=usuario.cedula,
        tipo_documento=usuario.tipo_documento,
        telefono=usuario.telefono,
        rol=usuario.rol,
        is_active=bool(usuario.is_active),
        is_verified=bool(usuario.is_verified),
        created_at=usuario.created_at,
        last_login=usuario.last_login,
        permisos_modulos=usuario.permisos_modulos if isinstance(usuario.permisos_modulos, list) else [],
        branch_ids=branch_ids,
    )


def _validate_branch_assignment_for_role(
    rol: RolUsuario,
    branch_ids: list[int],
    is_active: bool,
) -> None:
    if not is_active:
        return
    if not branch_ids:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos una sucursal activa")
    if rol == RolUsuario.CAJERO and len(branch_ids) != 1:
        raise HTTPException(
            status_code=400,
            detail="Los usuarios con rol CAJERO solo pueden estar asignados a una sucursal",
        )


def _upsert_user_branch_access(
    db: Session,
    tenant: Tenant,
    user_id: int,
    branch_ids: list[int],
    active: bool,
) -> None:
    existing_rows = db.query(TenantUserBranch).filter(
        TenantUserBranch.tenant_id == tenant.id,
        TenantUserBranch.user_id == user_id,
    ).all()
    existing_by_branch = {int(row.branch_id): row for row in existing_rows}
    selected = set(int(bid) for bid in branch_ids)

    for row in existing_rows:
        if int(row.branch_id) not in selected:
            row.is_active = False

    for branch_id in selected:
        row = existing_by_branch.get(branch_id)
        if row:
            row.is_active = bool(active)
            continue
        db.add(TenantUserBranch(
            tenant_id=tenant.id,
            user_id=user_id,
            branch_id=branch_id,
            is_active=bool(active),
        ))


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
    usuarios = query.order_by(Usuario.created_at.desc()).all()
    return [_serialize_usuario_response(db, current_tenant, usuario) for usuario in usuarios]


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
    return _serialize_usuario_response(db, current_tenant, usuario)


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

    branch_ids_provided = payload.branch_ids is not None
    requested_branch_ids = _normalize_requested_branch_ids(payload.branch_ids)
    active_branches = _get_active_tenant_branches(db, current_tenant)
    if requested_branch_ids:
        missing = [bid for bid in requested_branch_ids if bid not in active_branches]
        if missing:
            raise HTTPException(status_code=400, detail="Una o más sucursales seleccionadas no están activas")

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
    if not branch_ids_provided:
        primary_branch = _ensure_primary_branch_for_tenant(db, current_tenant)
        requested_branch_ids = [int(primary_branch.id)]
    _validate_branch_assignment_for_role(
        rol=nuevo.rol,
        branch_ids=requested_branch_ids,
        is_active=bool(nuevo.is_active),
    )
    _upsert_user_branch_access(
        db=db,
        tenant=current_tenant,
        user_id=nuevo.id,
        branch_ids=requested_branch_ids,
        active=bool(nuevo.is_active),
    )
    db.commit()
    db.refresh(nuevo)
    return _serialize_usuario_response(db, current_tenant, nuevo)


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
    branch_ids_provided = "branch_ids" in update_data
    requested_branch_ids = _normalize_requested_branch_ids(update_data.pop("branch_ids", None))
    for field, value in update_data.items():
        setattr(usuario, field, value)

    membership = db.query(TenantUser).filter(
        TenantUser.tenant_id == current_tenant.id,
        TenantUser.user_id == usuario.id,
    ).first()
    if membership:
        membership.rol = usuario.rol.value
        membership.is_active = bool(usuario.is_active)
    if branch_ids_provided:
        active_branches = _get_active_tenant_branches(db, current_tenant)
        missing = [bid for bid in requested_branch_ids if bid not in active_branches]
        if missing:
            raise HTTPException(status_code=400, detail="Una o más sucursales seleccionadas no están activas")

    active_branch_rows = db.query(TenantUserBranch.branch_id).filter(
        TenantUserBranch.tenant_id == current_tenant.id,
        TenantUserBranch.user_id == usuario.id,
        TenantUserBranch.is_active.is_(True),
    ).all()
    active_branch_ids = [int(row[0]) for row in active_branch_rows]
    branch_ids_for_validation = requested_branch_ids if branch_ids_provided else active_branch_ids
    _validate_branch_assignment_for_role(
        rol=usuario.rol,
        branch_ids=branch_ids_for_validation,
        is_active=bool(usuario.is_active),
    )

    if branch_ids_provided:
        _upsert_user_branch_access(
            db=db,
            tenant=current_tenant,
            user_id=usuario.id,
            branch_ids=requested_branch_ids,
            active=bool(usuario.is_active),
        )
    elif "is_active" in update_data:
        if not bool(usuario.is_active):
            db.query(TenantUserBranch).filter(
                TenantUserBranch.tenant_id == current_tenant.id,
                TenantUserBranch.user_id == usuario.id,
            ).update({"is_active": False}, synchronize_session=False)
        else:
            existing_rows = db.query(TenantUserBranch).filter(
                TenantUserBranch.tenant_id == current_tenant.id,
                TenantUserBranch.user_id == usuario.id,
            ).all()
            if existing_rows:
                for row in existing_rows:
                    row.is_active = True
            else:
                primary_branch = _ensure_primary_branch_for_tenant(db, current_tenant)
                _upsert_user_branch_access(
                    db=db,
                    tenant=current_tenant,
                    user_id=usuario.id,
                    branch_ids=[int(primary_branch.id)],
                    active=True,
                )

    db.commit()
    db.refresh(usuario)
    return _serialize_usuario_response(db, current_tenant, usuario)


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
