from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
import os
import base64
import logging
import urllib.request
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from app.core.database import get_db
from app.core.security import get_password_hash, verify_password
from app.core.precios import calcular_precio, obtener_categoria_licencia, es_certificado_sin_practica
from app.core.formacion import obtener_horas_requeridas_por_servicio
from app.core.config import settings
from app.core.email import send_email
from app.models.usuario import Usuario, RolUsuario
from app.models.estudiante import Estudiante, EstadoEstudiante, CategoriaLicencia, OrigenCliente, TipoServicio
from app.models.pago import Pago, MetodoPago, EstadoPago
from app.models.clase import Instructor, Vehiculo, EstadoInstructor
from app.models.compromiso_pago import CompromisoPago, CuotaPago, FrecuenciaPago, EstadoCuota
from app.models.tenant import Tenant, TenantUser
from app.schemas.estudiante import (
    EstudianteCreate,
    EstudianteUpdate,
    EstudianteResponse,
    EstudianteListItem,
    EstudiantesListResponse,
    DefinirServicioRequest,
    AmpliarServicioRequest,
    AcreditarHorasRequest,
    CorregirServicioRequest
)
from app.api.deps import get_current_active_user, get_admin_or_coordinador_or_cajero, get_required_tenant, require_role

router = APIRouter()
logger = logging.getLogger(__name__)


def _generate_matricula_numero(db: Session, current_tenant: Tenant) -> str:
    year = datetime.now().year
    brand_prefix = settings.BRAND_SHORT_NAME.strip().upper()[:10] or "SIAEC"
    tenant_prefix = (current_tenant.slug or "TENANT").replace("-", "").upper()[:16]
    tenant_count = db.query(Estudiante).filter(Estudiante.tenant_id == current_tenant.id).count()
    sequence = tenant_count + 1
    while True:
        matricula = f"{brand_prefix}-{tenant_prefix}-{year}-{sequence:05d}"
        exists = db.query(Estudiante.id).filter(Estudiante.matricula_numero == matricula).first()
        if not exists:
            return matricula
        sequence += 1


@router.post("", response_model=EstudianteResponse, status_code=status.HTTP_201_CREATED)
def create_estudiante(
    estudiante_data: EstudianteCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Crear un nuevo estudiante (solo datos personales):
    - Crea usuario
    - Crea estudiante con datos básicos
    - Guarda foto en base64
    - NO asigna servicio (se hace después en "Definir Servicio")
    """
    # Verificar si ya existe un usuario con esa cédula o email
    existing_user = db.query(Usuario).filter(
        or_(Usuario.cedula == estudiante_data.cedula, Usuario.email == estudiante_data.email),
        Usuario.tenant_id == current_tenant.id,
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ya existe un usuario con esa cédula o email"
        )
    
    try:
        # 1. Crear Usuario
        nombre_completo = estudiante_data.nombre_completo
        if not nombre_completo:
            partes = [
                estudiante_data.primer_nombre,
                estudiante_data.segundo_nombre,
                estudiante_data.primer_apellido,
                estudiante_data.segundo_apellido
            ]
            nombre_completo = " ".join([p for p in partes if p and p.strip()])

        nuevo_usuario = Usuario(
            email=estudiante_data.email,
            password_hash=get_password_hash(estudiante_data.password),
            nombre_completo=nombre_completo,
            cedula=estudiante_data.cedula,
            tipo_documento=estudiante_data.tipo_documento,
            telefono=estudiante_data.telefono,
            rol=RolUsuario.ESTUDIANTE,
            tenant_id=current_tenant.id,
            is_active=True,
            is_verified=False
        )
        db.add(nuevo_usuario)
        db.flush()
        db.add(
            TenantUser(
                tenant_id=current_tenant.id,
                user_id=nuevo_usuario.id,
                rol=RolUsuario.ESTUDIANTE.value,
                is_active=True,
            )
        )
        
        # 2. Generar número de matrícula aislado por tenant y globalmente único
        matricula_numero = _generate_matricula_numero(db, current_tenant)
        
        # 3. Crear Estudiante (solo datos personales)
        nuevo_estudiante = Estudiante(
            usuario_id=nuevo_usuario.id,
            tenant_id=current_tenant.id,
            matricula_numero=matricula_numero,
            fecha_nacimiento=estudiante_data.fecha_nacimiento,
            direccion=estudiante_data.direccion,
            ciudad=estudiante_data.ciudad,
            barrio=estudiante_data.barrio,
            tipo_sangre=estudiante_data.tipo_sangre,
            eps=estudiante_data.eps,
            ocupacion=estudiante_data.ocupacion,
            estado_civil=estudiante_data.estado_civil,
            nivel_educativo=estudiante_data.nivel_educativo,
            estrato=estudiante_data.estrato,
            nivel_sisben=estudiante_data.nivel_sisben,
            necesidades_especiales=estudiante_data.necesidades_especiales,
            contacto_emergencia_nombre=estudiante_data.contacto_emergencia_nombre,
            contacto_emergencia_telefono=estudiante_data.contacto_emergencia_telefono,
            foto_url=estudiante_data.foto_base64,  # Guardar base64 temporalmente
            estado=EstadoEstudiante.PROSPECTO  # Prospecto hasta que se defina servicio
        )
        nuevo_estudiante.datos_adicionales = {
            "habeas_data": {
                "aceptado": True,
                "aceptado_en": datetime.utcnow().isoformat(),
                "correo_enviado": False
            },
            "nombres": {
                "primer_nombre": estudiante_data.primer_nombre,
                "segundo_nombre": estudiante_data.segundo_nombre,
                "primer_apellido": estudiante_data.primer_apellido,
                "segundo_apellido": estudiante_data.segundo_apellido
            }
        }
        db.add(nuevo_estudiante)
        db.flush()
        
        db.commit()
        db.refresh(nuevo_estudiante)

        enviado = _enviar_habeas_data(nuevo_estudiante, current_tenant)
        if enviado:
            datos = dict(nuevo_estudiante.datos_adicionales or {})
            habeas = dict(datos.get("habeas_data", {}))
            if habeas:
                habeas["correo_enviado"] = True
                datos["habeas_data"] = habeas
                nuevo_estudiante.datos_adicionales = datos
                db.commit()
        
        return _build_estudiante_response(nuevo_estudiante, db)
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al crear estudiante: {str(e)}"
        )


@router.get("", response_model=EstudiantesListResponse)
def list_estudiantes(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    search: Optional[str] = None,
    categoria: Optional[CategoriaLicencia] = None,
    estado: Optional[EstadoEstudiante] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Listar estudiantes con filtros y búsqueda
    """
    query = db.query(Estudiante).join(Usuario).filter(
        Estudiante.tenant_id == current_tenant.id,
        Usuario.tenant_id == current_tenant.id,
    )
    
    # Filtro de búsqueda (nombre, cédula, email)
    if search:
        query = query.filter(
            or_(
                Usuario.nombre_completo.ilike(f"%{search}%"),
                Usuario.cedula.ilike(f"%{search}%"),
                Usuario.email.ilike(f"%{search}%")
            )
        )
    
    # Filtro por categoría
    if categoria:
        query = query.filter(Estudiante.categoria == categoria)
    
    # Filtro por estado
    if estado:
        query = query.filter(Estudiante.estado == estado)
    
    # Ordenar por fecha de inscripción descendente (más reciente primero)
    query = query.order_by(Estudiante.fecha_inscripcion.desc())
    
    # Obtener total de registros (antes de aplicar paginación)
    total = query.count()
    
    estudiantes = query.offset(skip).limit(limit).all()
    
    # Construir respuesta con datos del usuario
    items = []
    for est in estudiantes:
        items.append(EstudianteListItem(
            id=est.id,
            usuario_id=est.usuario_id,
            nombre_completo=est.usuario.nombre_completo,
            cedula=est.usuario.cedula,
            tipo_documento=est.usuario.tipo_documento,
            email=est.usuario.email,
            telefono=est.usuario.telefono,
            foto_url=est.foto_url,
            matricula_numero=est.matricula_numero,
            tipo_servicio=est.tipo_servicio,
            categoria=est.categoria,
            estado=est.estado,
            fecha_inscripcion=est.fecha_inscripcion,
            progreso_teorico=est.progreso_teorico,
            progreso_practico=est.progreso_practico,
            saldo_pendiente=est.saldo_pendiente
        ))
    
    return EstudiantesListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit
    )


@router.get("/{estudiante_id}", response_model=EstudianteResponse)
def get_estudiante(
    estudiante_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Obtener detalles de un estudiante por ID
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    return _build_estudiante_response(estudiante, db)


@router.get("/cedula/{cedula}", response_model=EstudianteResponse)
def get_estudiante_por_cedula(
    cedula: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    estudiante = db.query(Estudiante).join(Usuario).filter(
        Usuario.cedula == cedula,
        Estudiante.tenant_id == current_tenant.id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    return _build_estudiante_response(estudiante, db)


@router.put("/{estudiante_id}", response_model=EstudianteResponse)
def update_estudiante(
    estudiante_id: int,
    estudiante_data: EstudianteUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Actualizar información de un estudiante
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    # Actualizar solo los campos proporcionados
    update_data = estudiante_data.model_dump(exclude_unset=True)
    user_fields = {}

    nombre_parts = {}
    for field in ["primer_nombre", "segundo_nombre", "primer_apellido", "segundo_apellido"]:
        if field in update_data:
            nombre_parts[field] = update_data.pop(field)

    for field in ["nombre_completo", "email", "telefono", "cedula", "tipo_documento"]:
        if field in update_data:
            user_fields[field] = update_data.pop(field)

    # Validaciones de unicidad en usuario (correo y cédula son globales en BD)
    if "email" in user_fields and user_fields["email"]:
        email_normalized = str(user_fields["email"]).strip().lower()
        duplicate_email = db.query(Usuario.id).filter(
            Usuario.email == email_normalized,
            Usuario.id != estudiante.usuario_id,
        ).first()
        if duplicate_email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El correo ya está registrado por otro usuario",
            )
        user_fields["email"] = email_normalized

    if "cedula" in user_fields and user_fields["cedula"]:
        cedula_normalized = str(user_fields["cedula"]).strip()
        duplicate_cedula = db.query(Usuario.id).filter(
            Usuario.cedula == cedula_normalized,
            Usuario.id != estudiante.usuario_id,
        ).first()
        if duplicate_cedula:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="La cédula ya está registrada por otro usuario",
            )
        user_fields["cedula"] = cedula_normalized

    if nombre_parts:
        datos = dict(estudiante.datos_adicionales or {})
        nombres_actuales = dict(datos.get("nombres", {}))
        merged = {
            "primer_nombre": nombres_actuales.get("primer_nombre"),
            "segundo_nombre": nombres_actuales.get("segundo_nombre"),
            "primer_apellido": nombres_actuales.get("primer_apellido"),
            "segundo_apellido": nombres_actuales.get("segundo_apellido")
        }
        merged.update(nombre_parts)

        nombre_completo = " ".join([
            p for p in [
                merged.get("primer_nombre"),
                merged.get("segundo_nombre"),
                merged.get("primer_apellido"),
                merged.get("segundo_apellido")
            ] if p
        ])
        if nombre_completo:
            user_fields["nombre_completo"] = nombre_completo
            datos["nombres"] = merged
            estudiante.datos_adicionales = datos
    foto_base64 = update_data.pop("foto_base64", None)

    for field, value in update_data.items():
        setattr(estudiante, field, value)

    if foto_base64:
        estudiante.foto_url = foto_base64

    if user_fields:
        for field, value in user_fields.items():
            setattr(estudiante.usuario, field, value)
    
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo actualizar: el correo o la cédula ya existen",
        )
    db.refresh(estudiante)
    
    return _build_estudiante_response(estudiante, db)


@router.delete("/{estudiante_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_estudiante(
    estudiante_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Eliminar un estudiante (soft delete - marca como inactivo)
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    # Soft delete: marcar usuario como inactivo
    estudiante.usuario.is_active = False
    estudiante.estado = EstadoEstudiante.RETIRADO
    
    db.commit()
    
    return None


@router.put("/{estudiante_id}/definir-servicio", response_model=EstudianteResponse)
def definir_servicio(
    estudiante_id: int,
    servicio_data: DefinirServicioRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Definir el servicio para un estudiante PROSPECTO:
    - Asigna tipo de servicio y categoría
    - Define origen del cliente (directo o referido)
    - Calcula o asigna el valor total del curso
    - Asigna horas teóricas y prácticas requeridas
    - Cambia estado de PROSPECTO a ACTIVO
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    # Validar que sea un prospecto si NO es recategorización
    if not servicio_data.es_recategorizacion and estudiante.estado != EstadoEstudiante.PROSPECTO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede definir servicio a estudiantes en estado PROSPECTO"
        )
    
    try:
        # 0. Recategorización: validar categorías y ajustar tipo de servicio
        if servicio_data.es_recategorizacion:
            if not servicio_data.categoria_actual or not servicio_data.categoria_nueva:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Debe seleccionar la categoría actual y la nueva categoría"
                )
            if servicio_data.categoria_actual == servicio_data.categoria_nueva:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La nueva categoría debe ser diferente a la actual"
                )

            categoria_to_tipo = {
                CategoriaLicencia.A2: TipoServicio.LICENCIA_A2,
                CategoriaLicencia.B1: TipoServicio.LICENCIA_B1,
                CategoriaLicencia.C1: TipoServicio.LICENCIA_C1
            }
            if servicio_data.categoria_nueva not in categoria_to_tipo:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La recategorización solo está disponible para A2, B1 o C1"
                )

            servicio_data.tipo_servicio = categoria_to_tipo[servicio_data.categoria_nueva]

        # 1. Asignar tipo de servicio
        categoria_anterior = estudiante.categoria
        estudiante.tipo_servicio = servicio_data.tipo_servicio
        
        # 2. Determinar la categoría basada en el tipo de servicio
        if servicio_data.es_recategorizacion:
            estudiante.categoria = servicio_data.categoria_nueva
        else:
            estudiante.categoria = obtener_categoria_licencia(servicio_data.tipo_servicio)
        
        # 3. Asignar origen del cliente
        estudiante.origen_cliente = servicio_data.origen_cliente
        
        # 3.1 Si es referido, guardar datos del referidor
        if servicio_data.origen_cliente == OrigenCliente.REFERIDO:
            estudiante.referido_por = servicio_data.referido_por
            estudiante.telefono_referidor = servicio_data.telefono_referidor
        
        # 4. Calcular o asignar valor total
        precio_minimo = calcular_precio(servicio_data.tipo_servicio, db=db)
        if servicio_data.origen_cliente == OrigenCliente.DIRECTO:
            # Cliente directo: precio fijo, con descuento opcional (solo Admin/Gerente)
            valor_solicitado = servicio_data.valor_total_curso
            valor_final = precio_minimo

            if valor_solicitado is None:
                if estudiante.datos_adicionales and "descuento_directo" in estudiante.datos_adicionales:
                    datos = dict(estudiante.datos_adicionales)
                    datos.pop("descuento_directo", None)
                    estudiante.datos_adicionales = datos
            else:
                if valor_solicitado > precio_minimo:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"El valor total no puede ser mayor a {precio_minimo}"
                    )
                if valor_solicitado < precio_minimo:
                    if current_user.rol not in [RolUsuario.ADMIN, RolUsuario.GERENTE]:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="No tiene permisos para aplicar descuento"
                        )
                    valor_final = valor_solicitado

                    datos = estudiante.datos_adicionales or {}
                    datos["descuento_directo"] = {
                        "valor_base": float(precio_minimo),
                        "valor_final": float(valor_final),
                        "aplicado_por_id": current_user.id,
                        "aplicado_por": current_user.nombre_completo,
                        "fecha": datetime.utcnow().isoformat()
                    }
                    estudiante.datos_adicionales = datos
                else:
                    if estudiante.datos_adicionales and "descuento_directo" in estudiante.datos_adicionales:
                        datos = dict(estudiante.datos_adicionales)
                        datos.pop("descuento_directo", None)
                        estudiante.datos_adicionales = datos

            estudiante.valor_total_curso = valor_final
        else:
            # Cliente referido: valor manual, pero no menor al mínimo
            if servicio_data.valor_total_curso is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El valor total es obligatorio para clientes referidos"
                )
            if servicio_data.valor_total_curso < precio_minimo:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El valor total no puede ser menor a {precio_minimo}"
                )
            estudiante.valor_total_curso = servicio_data.valor_total_curso
        
        # 5. Asignar horas teóricas y prácticas con reglas del tenant (fallback legado)
        horas_teoria, horas_practica = obtener_horas_requeridas_por_servicio(
            db=db,
            tenant_id=current_tenant.id,
            tipo_servicio=servicio_data.tipo_servicio,
        )
        estudiante.horas_teoricas_requeridas = horas_teoria
        estudiante.horas_practicas_requeridas = horas_practica

        if servicio_data.es_recategorizacion:
            datos = dict(estudiante.datos_adicionales or {})
            recats = list(datos.get("recategorizaciones", []))
            recats.append({
                "categoria_anterior": str(categoria_anterior) if categoria_anterior else None,
                "categoria_nueva": str(servicio_data.categoria_nueva),
                "fecha": datetime.utcnow().isoformat(),
                "tipo_servicio": str(servicio_data.tipo_servicio),
                "origen_cliente": str(servicio_data.origen_cliente)
            })
            datos["recategorizaciones"] = recats
            datos["recategorizacion_actual"] = {
                "categoria_actual": str(servicio_data.categoria_actual),
                "categoria_nueva": str(servicio_data.categoria_nueva)
            }
            estudiante.datos_adicionales = datos
        
        # 6. Inicializar saldo pendiente (igual al valor total)
        estudiante.saldo_pendiente = estudiante.valor_total_curso

        # 6.1 Registrar/actualizar servicio activo para historial por ciclos
        datos = dict(estudiante.datos_adicionales or {})
        servicios = list(datos.get("servicios", []))
        servicio_activo_id = datos.get("servicio_activo_id")

        servicio_entry = None
        if servicio_activo_id is not None:
            for s in servicios:
                if s.get("id") == servicio_activo_id:
                    servicio_entry = s
                    break

        if servicio_entry is None:
            next_id = max([s.get("id", 0) for s in servicios] or [0]) + 1
            servicio_activo_id = next_id
            servicio_entry = {"id": servicio_activo_id}
            servicios.append(servicio_entry)

        servicio_entry.update({
            "fecha_inicio": servicio_entry.get("fecha_inicio") or (
                estudiante.fecha_inscripcion.isoformat() if estudiante.fecha_inscripcion else datetime.utcnow().isoformat()
            ),
            "fecha_fin": None,
            "tipo_servicio": str(estudiante.tipo_servicio) if estudiante.tipo_servicio else None,
            "categoria": str(estudiante.categoria) if estudiante.categoria else None,
            "origen_cliente": str(estudiante.origen_cliente) if estudiante.origen_cliente else None,
            "valor_total_curso": float(estudiante.valor_total_curso) if estudiante.valor_total_curso else None,
            "saldo_pendiente": float(estudiante.saldo_pendiente) if estudiante.saldo_pendiente else None,
            "horas_teoricas_completadas": estudiante.horas_teoricas_completadas,
            "horas_practicas_completadas": estudiante.horas_practicas_completadas,
            "horas_teoricas_requeridas": estudiante.horas_teoricas_requeridas,
            "horas_practicas_requeridas": estudiante.horas_practicas_requeridas,
            "estado": "ACTIVO"
        })

        datos["servicios"] = servicios
        datos["servicio_activo_id"] = servicio_activo_id
        estudiante.datos_adicionales = datos
        
        # 7. Guardar observaciones si las hay
        if servicio_data.observaciones:
            if not estudiante.datos_adicionales:
                estudiante.datos_adicionales = {}
            estudiante.datos_adicionales["observaciones"] = servicio_data.observaciones
        
        # 8. Cambiar estado a EN_FORMACION
        estudiante.estado = EstadoEstudiante.EN_FORMACION
        estudiante.contrato_pdf_url = f"/api/v1/estudiantes/{estudiante.id}/contrato-pdf"
        
        db.commit()
        db.refresh(estudiante)

        _enviar_contrato_definir_servicio(estudiante, current_tenant)
        
        return _build_estudiante_response(estudiante, db)
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al definir servicio: {str(e)}"
        )


@router.put("/{estudiante_id}/reactivar", response_model=EstudianteResponse)
def reactivar_estudiante(
    estudiante_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Reactivar estudiante para iniciar un nuevo servicio.
    - Guarda un snapshot del servicio anterior en datos_adicionales
    - Reinicia estados/horas/saldos
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    try:
        now_iso = datetime.utcnow().isoformat()
        datos = dict(estudiante.datos_adicionales or {})
        historial = list(datos.get("historial_servicios", []))
        servicios = list(datos.get("servicios", []))
        servicio_activo_id = datos.get("servicio_activo_id")

        snapshot = {
            "fecha": now_iso,
            "fecha_inicio": estudiante.fecha_inscripcion.isoformat() if estudiante.fecha_inscripcion else None,
            "fecha_fin": now_iso,
            "tipo_servicio": str(estudiante.tipo_servicio) if estudiante.tipo_servicio else None,
            "categoria": str(estudiante.categoria) if estudiante.categoria else None,
            "origen_cliente": str(estudiante.origen_cliente) if estudiante.origen_cliente else None,
            "valor_total_curso": float(estudiante.valor_total_curso) if estudiante.valor_total_curso else None,
            "saldo_pendiente": float(estudiante.saldo_pendiente) if estudiante.saldo_pendiente else None,
            "horas_teoricas_completadas": estudiante.horas_teoricas_completadas,
            "horas_practicas_completadas": estudiante.horas_practicas_completadas,
            "horas_teoricas_requeridas": estudiante.horas_teoricas_requeridas,
            "horas_practicas_requeridas": estudiante.horas_practicas_requeridas,
            "estado": str(estudiante.estado)
        }
        historial.append(snapshot)
        datos["historial_servicios"] = historial

        servicio_entry = None
        if servicio_activo_id is not None:
            for s in servicios:
                if s.get("id") == servicio_activo_id:
                    servicio_entry = s
                    break
        if servicio_entry is None and estudiante.tipo_servicio:
            next_id = max([s.get("id", 0) for s in servicios] or [0]) + 1
            servicio_entry = {"id": servicio_activo_id or next_id}
            servicios.append(servicio_entry)

        if servicio_entry is not None:
            servicio_entry.update({
                "fecha_inicio": servicio_entry.get("fecha_inicio") or snapshot["fecha_inicio"],
                "fecha_fin": now_iso,
                "tipo_servicio": snapshot["tipo_servicio"],
                "categoria": snapshot["categoria"],
                "origen_cliente": snapshot["origen_cliente"],
                "valor_total_curso": snapshot["valor_total_curso"],
                "saldo_pendiente": snapshot["saldo_pendiente"],
                "horas_teoricas_completadas": snapshot["horas_teoricas_completadas"],
                "horas_practicas_completadas": snapshot["horas_practicas_completadas"],
                "horas_teoricas_requeridas": snapshot["horas_teoricas_requeridas"],
                "horas_practicas_requeridas": snapshot["horas_practicas_requeridas"],
                "estado": "FINALIZADO"
            })

        datos["servicios"] = servicios
        datos["servicio_activo_id"] = None
        estudiante.datos_adicionales = datos
        
        # Reactivar y resetear datos clave para nuevo servicio
        estudiante.usuario.is_active = True
        estudiante.estado = EstadoEstudiante.PROSPECTO
        estudiante.tipo_servicio = None
        estudiante.categoria = None
        estudiante.origen_cliente = None
        estudiante.referido_por = None
        estudiante.telefono_referidor = None
        estudiante.valor_total_curso = None
        estudiante.saldo_pendiente = None
        estudiante.horas_teoricas_completadas = 0
        estudiante.horas_practicas_completadas = 0
        estudiante.horas_teoricas_requeridas = 0
        estudiante.horas_practicas_requeridas = 0
        estudiante.fecha_inscripcion = datetime.utcnow()
        estudiante.contrato_pdf_url = None
        
        db.commit()
        db.refresh(estudiante)
        
        return _build_estudiante_response(estudiante)
    except Exception as e:
        db.rollback()
        logger.exception("Error al reactivar estudiante")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al reactivar estudiante"
        )

@router.get("/{estudiante_id}/contrato-pdf")
def contrato_estudiante_pdf(
    estudiante_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    if not estudiante:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estudiante no encontrado")
    return _build_contrato_pdf(estudiante, current_tenant)


@router.post("/{estudiante_id}/acreditar-horas", response_model=EstudianteResponse)
def acreditar_horas(
    estudiante_id: int,
    payload: AcreditarHorasRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role([RolUsuario.INSTRUCTOR, RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.COORDINADOR])),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )

    if estudiante.estado in [EstadoEstudiante.GRADUADO, EstadoEstudiante.RETIRADO, EstadoEstudiante.DESERTOR]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pueden acreditar horas a estudiantes inactivos"
        )

    if estudiante.tipo_servicio and es_certificado_sin_practica(estudiante.tipo_servicio):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este servicio no requiere horas de clase"
        )

    if payload.tipo == "TEORICA":
        nuevo = estudiante.horas_teoricas_completadas + payload.horas
        if estudiante.horas_teoricas_requeridas:
            nuevo = min(nuevo, estudiante.horas_teoricas_requeridas)
        estudiante.horas_teoricas_completadas = nuevo
    else:
        nuevo = estudiante.horas_practicas_completadas + payload.horas
        if estudiante.horas_practicas_requeridas:
            nuevo = min(nuevo, estudiante.horas_practicas_requeridas)
        estudiante.horas_practicas_completadas = nuevo

    datos = dict(estudiante.datos_adicionales or {})
    historial = list(datos.get("clases_historial", []))
    servicio_activo_id = datos.get("servicio_activo_id")
    fecha_iso = datetime.utcnow().isoformat()
    instructor_nombre = None
    vehiculo_label = None
    if payload.instructor_id:
        instructor = db.query(Instructor).filter(Instructor.id == payload.instructor_id).first()
        if instructor and instructor.estado == EstadoInstructor.ACTIVO:
            instructor_nombre = instructor.usuario.nombre_completo if instructor.usuario else None
        else:
            raise HTTPException(status_code=400, detail="Instructor no activo o no encontrado")

    if payload.vehiculo_id:
        vehiculo = db.query(Vehiculo).filter(Vehiculo.id == payload.vehiculo_id).first()
        if vehiculo and vehiculo.is_active == 1:
            vehiculo_label = f"{vehiculo.placa} - {vehiculo.marca} {vehiculo.modelo}"
        else:
            raise HTTPException(status_code=400, detail="Vehículo no activo o no encontrado")

    historial.append({
        "fecha": fecha_iso,
        "tipo": payload.tipo,
        "horas": payload.horas,
        "observaciones": payload.observaciones,
        "usuario_id": current_user.id,
        "servicio_id": servicio_activo_id,
        "instructor_id": payload.instructor_id,
        "instructor_nombre": instructor_nombre,
        "vehiculo_id": payload.vehiculo_id,
        "vehiculo_label": vehiculo_label
    })
    datos["clases_historial"] = historial

    # Actualizar resumen del servicio activo para progreso por ciclo
    if servicio_activo_id is not None:
        servicios = list(datos.get("servicios", []))
        for s in servicios:
            if s.get("id") == servicio_activo_id:
                s["horas_teoricas_completadas"] = estudiante.horas_teoricas_completadas
                s["horas_practicas_completadas"] = estudiante.horas_practicas_completadas
                s["horas_teoricas_requeridas"] = estudiante.horas_teoricas_requeridas
                s["horas_practicas_requeridas"] = estudiante.horas_practicas_requeridas
                s["saldo_pendiente"] = float(estudiante.saldo_pendiente) if estudiante.saldo_pendiente is not None else None
                s["valor_total_curso"] = float(estudiante.valor_total_curso) if estudiante.valor_total_curso is not None else None
                s["estado"] = "ACTIVO"
                break
        datos["servicios"] = servicios

    estudiante.datos_adicionales = datos

    if estudiante.esta_listo_para_examen:
        estudiante.estado = EstadoEstudiante.LISTO_EXAMEN

    db.commit()
    db.refresh(estudiante)

    _enviar_acreditacion_horas(estudiante, payload.tipo, payload.horas, fecha_iso, current_tenant)
    return _build_estudiante_response(estudiante, db)


@router.put("/{estudiante_id}/ampliar-servicio", response_model=EstudianteResponse)
def ampliar_servicio(
    estudiante_id: int,
    servicio_data: AmpliarServicioRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Ampliar servicio del estudiante a combo (ej. A2 -> A2+B1)
    - Recalcula valor total y saldo pendiente con base en abonos previos
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()

    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )

    if not estudiante.tipo_servicio or estudiante.valor_total_curso is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El estudiante no tiene un servicio definido"
        )

    if estudiante.tipo_servicio in [TipoServicio.COMBO_A2_B1, TipoServicio.COMBO_A2_C1]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El estudiante ya tiene un combo asignado"
        )

    allowed = []
    if estudiante.tipo_servicio == TipoServicio.LICENCIA_A2:
        allowed = [TipoServicio.COMBO_A2_B1, TipoServicio.COMBO_A2_C1]
    elif estudiante.tipo_servicio == TipoServicio.LICENCIA_B1:
        allowed = [TipoServicio.COMBO_A2_B1]
    elif estudiante.tipo_servicio == TipoServicio.LICENCIA_C1:
        allowed = [TipoServicio.COMBO_A2_C1]

    if servicio_data.tipo_servicio_nuevo not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La ampliacion solicitada no es valida para el servicio actual"
        )

    precio_minimo = calcular_precio(servicio_data.tipo_servicio_nuevo, db=db)
    if estudiante.origen_cliente == OrigenCliente.DIRECTO:
        nuevo_valor_total = precio_minimo
    else:
        if servicio_data.valor_total_curso is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El valor_total_curso es obligatorio para clientes referidos"
            )
        if servicio_data.valor_total_curso < precio_minimo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El valor total no puede ser menor a {precio_minimo}"
            )
        nuevo_valor_total = servicio_data.valor_total_curso

    valor_anterior = Decimal(str(estudiante.valor_total_curso or 0))
    saldo_anterior = Decimal(str(estudiante.saldo_pendiente or 0))
    total_abonado = valor_anterior - saldo_anterior
    if total_abonado < 0:
        total_abonado = Decimal("0")

    nuevo_saldo = nuevo_valor_total - total_abonado
    if nuevo_saldo < 0:
        nuevo_saldo = Decimal("0")

    tipo_anterior = estudiante.tipo_servicio
    estudiante.tipo_servicio = servicio_data.tipo_servicio_nuevo
    estudiante.categoria = obtener_categoria_licencia(servicio_data.tipo_servicio_nuevo)
    estudiante.valor_total_curso = nuevo_valor_total
    estudiante.saldo_pendiente = nuevo_saldo

    horas_teoria, horas_practica = obtener_horas_requeridas_por_servicio(
        db=db,
        tenant_id=current_tenant.id,
        tipo_servicio=servicio_data.tipo_servicio_nuevo,
    )
    estudiante.horas_teoricas_requeridas = horas_teoria
    estudiante.horas_practicas_requeridas = horas_practica

    datos = dict(estudiante.datos_adicionales or {})
    ampliaciones = list(datos.get("ampliaciones_servicio", []))
    ampliaciones.append({
        "tipo_anterior": str(tipo_anterior),
        "tipo_nuevo": str(servicio_data.tipo_servicio_nuevo),
        "valor_anterior": str(valor_anterior),
        "valor_nuevo": str(nuevo_valor_total),
        "saldo_anterior": str(saldo_anterior),
        "saldo_nuevo": str(nuevo_saldo),
        "total_abonado": str(total_abonado),
        "fecha": datetime.utcnow().isoformat(),
        "observaciones": servicio_data.observaciones
    })
    datos["ampliaciones_servicio"] = ampliaciones
    servicios = list(datos.get("servicios", []))
    servicio_activo_id = datos.get("servicio_activo_id")
    servicio_entry = None
    if servicio_activo_id is not None:
        for s in servicios:
            if s.get("id") == servicio_activo_id:
                servicio_entry = s
                break
    if servicio_entry is None and estudiante.tipo_servicio:
        next_id = max([s.get("id", 0) for s in servicios] or [0]) + 1
        servicio_entry = {"id": servicio_activo_id or next_id}
        servicio_activo_id = servicio_entry["id"]
        servicios.append(servicio_entry)
    if servicio_entry is not None:
        servicio_entry.update({
            "tipo_servicio": str(estudiante.tipo_servicio) if estudiante.tipo_servicio else None,
            "categoria": str(estudiante.categoria) if estudiante.categoria else None,
            "valor_total_curso": float(estudiante.valor_total_curso) if estudiante.valor_total_curso else None,
            "saldo_pendiente": float(estudiante.saldo_pendiente) if estudiante.saldo_pendiente else None,
            "horas_teoricas_requeridas": estudiante.horas_teoricas_requeridas,
            "horas_practicas_requeridas": estudiante.horas_practicas_requeridas,
            "estado": "ACTIVO"
        })
    datos["servicios"] = servicios
    datos["servicio_activo_id"] = servicio_activo_id
    estudiante.datos_adicionales = datos

    db.commit()
    db.refresh(estudiante)

    return _build_estudiante_response(estudiante, db)


@router.put("/{estudiante_id}/corregir-servicio", response_model=EstudianteResponse)
def corregir_servicio(
    estudiante_id: int,
    payload: CorregirServicioRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_role([RolUsuario.ADMIN, RolUsuario.GERENTE])),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Corregir servicio mal definido:
    - Solo permitido si no hay pagos ni horas acreditadas
    - Requiere contraseña del admin/gerente
    - Registra historial de correcciones en datos_adicionales
    """
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    if not estudiante:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")

    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=403, detail="Contraseña incorrecta")

    if estudiante.tipo_servicio == payload.tipo_servicio_nuevo:
        raise HTTPException(status_code=400, detail="El servicio nuevo debe ser diferente al actual")

    if estudiante.horas_teoricas_completadas > 0 or estudiante.horas_practicas_completadas > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede corregir el servicio con horas acreditadas"
        )

    pago_existente = db.query(Pago).filter(
        Pago.estudiante_id == estudiante.id,
        Pago.estado == EstadoPago.COMPLETADO,
        Pago.tenant_id == current_tenant.id,
    ).first()
    if pago_existente:
        raise HTTPException(
            status_code=400,
            detail="No se puede corregir el servicio con pagos registrados"
        )

    total_pagado = Decimal("0")
    if estudiante.valor_total_curso is not None and estudiante.saldo_pendiente is not None:
        total_pagado = Decimal(str(estudiante.valor_total_curso)) - Decimal(str(estudiante.saldo_pendiente))
    if total_pagado > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede corregir el servicio con pagos registrados"
        )

    precio_minimo = calcular_precio(payload.tipo_servicio_nuevo, db=db)
    if estudiante.origen_cliente == OrigenCliente.DIRECTO:
        nuevo_valor_total = precio_minimo
    else:
        if payload.valor_total_curso is None:
            raise HTTPException(status_code=400, detail="El valor total es obligatorio para clientes referidos")
        if payload.valor_total_curso < precio_minimo:
            raise HTTPException(status_code=400, detail=f"El valor total no puede ser menor a {precio_minimo}")
        nuevo_valor_total = payload.valor_total_curso

    tipo_anterior = estudiante.tipo_servicio
    categoria_anterior = estudiante.categoria
    valor_anterior = Decimal(str(estudiante.valor_total_curso or 0))

    estudiante.tipo_servicio = payload.tipo_servicio_nuevo
    estudiante.categoria = obtener_categoria_licencia(payload.tipo_servicio_nuevo)
    estudiante.valor_total_curso = nuevo_valor_total
    estudiante.saldo_pendiente = nuevo_valor_total

    horas_teoria, horas_practica = obtener_horas_requeridas_por_servicio(
        db=db,
        tenant_id=current_tenant.id,
        tipo_servicio=payload.tipo_servicio_nuevo,
    )
    estudiante.horas_teoricas_requeridas = horas_teoria
    estudiante.horas_practicas_requeridas = horas_practica

    datos = dict(estudiante.datos_adicionales or {})
    correcciones = list(datos.get("correcciones_servicio", []))
    correcciones.append({
        "fecha": datetime.utcnow().isoformat(),
        "usuario_id": current_user.id,
        "usuario_nombre": current_user.nombre_completo,
        "motivo": payload.motivo,
        "tipo_anterior": str(tipo_anterior) if tipo_anterior else None,
        "tipo_nuevo": str(payload.tipo_servicio_nuevo),
        "categoria_anterior": str(categoria_anterior) if categoria_anterior else None,
        "categoria_nueva": str(estudiante.categoria) if estudiante.categoria else None,
        "valor_anterior": str(valor_anterior),
        "valor_nuevo": str(nuevo_valor_total)
    })
    datos["correcciones_servicio"] = correcciones
    datos.pop("descuento_directo", None)

    servicios = list(datos.get("servicios", []))
    servicio_activo_id = datos.get("servicio_activo_id")
    servicio_entry = None
    if servicio_activo_id is not None:
        for s in servicios:
            if s.get("id") == servicio_activo_id:
                servicio_entry = s
                break
    if servicio_entry is None and estudiante.tipo_servicio:
        next_id = max([s.get("id", 0) for s in servicios] or [0]) + 1
        servicio_entry = {"id": servicio_activo_id or next_id}
        servicios.append(servicio_entry)
    if servicio_entry is not None:
        servicio_entry.update({
            "tipo_servicio": str(estudiante.tipo_servicio) if estudiante.tipo_servicio else None,
            "categoria": str(estudiante.categoria) if estudiante.categoria else None,
            "valor_total_curso": float(estudiante.valor_total_curso) if estudiante.valor_total_curso else None,
            "saldo_pendiente": float(estudiante.saldo_pendiente) if estudiante.saldo_pendiente else None,
            "horas_teoricas_requeridas": estudiante.horas_teoricas_requeridas,
            "horas_practicas_requeridas": estudiante.horas_practicas_requeridas,
            "estado": "ACTIVO"
        })
    datos["servicios"] = servicios
    datos["servicio_activo_id"] = servicio_activo_id
    estudiante.datos_adicionales = datos

    db.commit()
    db.refresh(estudiante)
    return _build_estudiante_response(estudiante, db)


def _build_contrato_pdf(estudiante: Estudiante, tenant: Optional[Tenant] = None) -> Response:
    pdf_bytes = _build_contrato_pdf_bytes(estudiante, tenant)
    return _pdf_response(BytesIO(pdf_bytes), f"contrato_{estudiante.matricula_numero or estudiante.id}.pdf")


def _build_contrato_pdf_bytes(estudiante: Estudiante, tenant: Optional[Tenant] = None) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    _draw_contrato_header(c, tenant)
    y = 680

    # Fecha de inscripcion
    y = _draw_box_row(
        c,
        y,
        [
            ("Fecha de Inscripcion", ""),
            ("Dia", f"{estudiante.fecha_inscripcion.day:02d}"),
            ("Mes", f"{estudiante.fecha_inscripcion.month:02d}"),
            ("Ano", f"{estudiante.fecha_inscripcion.year}")
        ],
        [150, 80, 80, 120]
    )

    # Registro fotografico
    y -= 10
    y = _draw_section_bar(c, "REGISTRO FOTOGRAFICO", y)
    photo_y = y - 120
    _draw_photo_box(c, 50, photo_y, 120, 120, estudiante.foto_url)
    _draw_rect(c, 50, photo_y, 520, 120)
    y = photo_y - 10

    # Datos de matricula y RUNT
    y = _draw_box_row(
        c,
        y,
        [
            ("Matricula Numero", estudiante.matricula_numero or ""),
            ("No Solicitud en el RUNT", estudiante.sicov_expediente_id or ""),
            ("No Certificado", estudiante.no_certificado or ""),
            ("Fecha de Salida", "")
        ],
        [140, 140, 120, 120]
    )

    # Datos personales
    y -= 6
    y = _draw_box_row(
        c,
        y,
        [
            ("Nombre del Alumno", estudiante.usuario.nombre_completo if estudiante.usuario else ""),
            ("Tipo de Documento", _tipo_documento_label(estudiante.usuario.tipo_documento if estudiante.usuario else None)),
            ("Numero", estudiante.usuario.cedula if estudiante.usuario else "")
        ],
        [250, 120, 150]
    )

    nacimiento = estudiante.fecha_nacimiento
    y = _draw_box_row(
        c,
        y,
        [
            ("Fecha de Nacimiento", _fmt_date(nacimiento)),
            ("Dia", f"{nacimiento.day:02d}"),
            ("Mes", f"{nacimiento.month:02d}"),
            ("Ano", f"{nacimiento.year}"),
            ("Estrato", str(estudiante.estrato or "")),
            ("Nivel SISBEN", estudiante.nivel_sisben or "")
        ],
        [150, 60, 60, 60, 60, 110]
    )

    y = _draw_box_row(
        c,
        y,
        [
            ("Nombre de su EPS", estudiante.eps or ""),
            ("Nombre de su ARL", _extra(estudiante, "arl"))
        ],
        [250, 260]
    )

    y = _draw_box_row(
        c,
        y,
        [
            ("Estado Civil", estudiante.estado_civil or ""),
            ("Ocupacion", estudiante.ocupacion or "")
        ],
        [180, 330]
    )

    y = _draw_box_row(
        c,
        y,
        [
            ("Direccion", estudiante.direccion or ""),
        ],
        [510]
    )
    y = _draw_box_row(
        c,
        y,
        [
            ("Telefono", estudiante.usuario.telefono if estudiante.usuario else ""),
            ("Correo Electronico", estudiante.usuario.email if estudiante.usuario else "")
        ],
        [180, 330]
    )

    # Nivel educativo / necesidades especiales
    y -= 6
    y = _draw_section_bar(c, "NIVEL EDUCATIVO", y)
    y = _draw_checkbox_row(
        c,
        y,
        ["Basica Primaria", "Basica Secundaria", "Tecnica", "Pregrado", "Postgrado", "Sin Estudio"],
        estudiante.nivel_educativo
    )
    y = _draw_section_bar(c, "NECESIDADES ESPECIALES", y)
    y = _draw_checkbox_row(
        c,
        y,
        ["Idioma", "Discapacidad", "Otra"],
        estudiante.necesidades_especiales
    )

    # Certificacion y categoria
    y = _draw_section_bar(c, "MIN-TRANSPORTE", y)
    datos = dict(estudiante.datos_adicionales or {})
    is_recategorizacion = bool(datos.get("recategorizacion_actual"))
    seleccion_cert = "Recategorizar" if is_recategorizacion else "Obtener por primera vez"
    y = _draw_certificacion_row(c, y, seleccion_cert)
    y = _draw_boxed_checkbox_row(
        c,
        y,
        ["A2", "B1", "C1"],
        _categorias_contrato(estudiante),
        prefix="CATEGORIA"
    )
    y -= 20

    # Texto del contrato
    y = _ensure_space_contrato(c, y, 120, tenant)
    y = _draw_paragraphs(c, CONTRATO_PARRAFOS, 50, y, 520, 12, tenant)

    # Firmas
    y = _ensure_space_contrato(c, y, 140, tenant)
    y -= 30
    y = _draw_signature_lines(c, y)

    c.showPage()
    c.save()
    return buffer.getvalue()


def _tenant_mail_context(tenant: Optional[Tenant]) -> tuple[str, str, str, str, str]:
    brand_name = (tenant.display_name or tenant.nombre) if tenant else settings.BRAND_SHORT_NAME
    contact_phone = tenant.contacto_telefono if tenant and tenant.contacto_telefono else settings.HABEAS_CONTACTO
    contact_email = tenant.contacto_email if tenant and tenant.contacto_email else settings.HABEAS_CORREO
    razon_social = tenant.nombre if tenant and tenant.nombre else settings.HABEAS_RAZON_SOCIAL
    nit = tenant.nit if tenant and tenant.nit else settings.HABEAS_NIT
    return brand_name, contact_phone, contact_email, razon_social, nit


def _enviar_habeas_data(estudiante: Estudiante, tenant: Optional[Tenant] = None) -> bool:
    if not estudiante or not estudiante.usuario:
        return False
    nombre = estudiante.usuario.nombre_completo
    email = estudiante.usuario.email
    brand_name, contact_phone, contact_email, razon_social, nit = _tenant_mail_context(tenant)
    subject = f"Confirmacion de autorizacion de datos - {brand_name}"
    politica = f"Politica: {settings.HABEAS_POLITICA_URL}" if settings.HABEAS_POLITICA_URL else ""
    body = (
        f"Hola {nombre},\n\n"
        f"Gracias por confiar en {brand_name}. Confirmamos la autorizacion previa, expresa e informada "
        "para el tratamiento de tus datos personales conforme a la Ley 1581 de 2012.\n\n"
        f"Matricula: {estudiante.matricula_numero or 'N/A'}\n"
        f"Cedula: {estudiante.usuario.cedula}\n\n"
        "Responsable: {razon}\n"
        "NIT: {nit}\n"
        "Contacto: {contacto}\n"
        "Correo: {correo}\n"
        "{politica}\n\n"
        "Finalidades:\n"
        "- Gestion del proceso de matricula y formacion.\n"
        "- Administracion academica y financiera.\n"
        "- Contacto y notificaciones.\n"
        "- Cumplimiento de obligaciones legales y contractuales.\n\n"
        "Derechos del titular: conocer, actualizar, rectificar, suprimir y revocar la autorizacion.\n"
        "Puedes ejercerlos a traves del correo indicado. Estamos para ayudarte.\n\n"
        f"{brand_name}\n"
    ).format(
        razon=razon_social,
        nit=nit,
        contacto=contact_phone,
        correo=contact_email,
        politica=politica
    )

    enviado = send_email(email, subject, body)
    if not enviado:
        logger.warning("No se pudo enviar correo de habeas data a %s", email)
    return enviado


def _enviar_contrato_definir_servicio(estudiante: Estudiante, tenant: Optional[Tenant] = None) -> None:
    if not estudiante or not estudiante.usuario:
        return

    brand_name, contact_phone, contact_email, razon_social, nit = _tenant_mail_context(tenant)
    subject = f"Tu contrato de aprendizaje ya esta listo - {brand_name}"
    body = (
        f"Hola {estudiante.usuario.nombre_completo},\n\n"
        f"Nos alegra contarte que tu servicio fue definido exitosamente en {brand_name}.\n"
        "Adjunto encontraras el Contrato de Aprendizaje correspondiente a tu proceso.\n\n"
        f"Matricula: {estudiante.matricula_numero or 'N/A'}\n"
        f"Cedula: {estudiante.usuario.cedula}\n"
        f"Categoria: {estudiante.categoria.value if estudiante.categoria else 'N/A'}\n"
        f"Tipo de servicio: {estudiante.tipo_servicio.value if estudiante.tipo_servicio else 'N/A'}\n"
        f"Fecha de inscripcion: {estudiante.fecha_inscripcion.strftime('%Y-%m-%d') if estudiante.fecha_inscripcion else 'N/A'}\n\n"
        "Si tienes dudas o quieres apoyo en cualquier paso, puedes escribirnos a:\n"
        f"{contact_phone} | {contact_email}\n\n"
        "Seguimos contigo en este proceso,\n"
        f"{brand_name}\n"
        f"{razon_social}\n"
        f"NIT {nit}\n"
    )

    pdf_bytes = _build_contrato_pdf_bytes(estudiante, tenant)
    filename = f"contrato_{estudiante.matricula_numero or estudiante.id}.pdf"
    enviado = send_email(
        estudiante.usuario.email,
        subject,
        body,
        attachment=(filename, pdf_bytes, "application/pdf")
    )
    if not enviado:
        logger.warning("No se pudo enviar contrato a %s", estudiante.usuario.email)


def _enviar_acreditacion_horas(
    estudiante: Estudiante,
    tipo: str,
    horas: int,
    fecha_iso: str,
    tenant: Optional[Tenant] = None,
) -> None:
    if not estudiante or not estudiante.usuario:
        return
    tipo_label = "Teoria" if tipo == "TEORICA" else "Practica"
    if tipo == "TEORICA":
        pendientes = max((estudiante.horas_teoricas_requeridas or 0) - (estudiante.horas_teoricas_completadas or 0), 0)
        progreso = f"{estudiante.horas_teoricas_completadas}/{estudiante.horas_teoricas_requeridas}"
    else:
        pendientes = max((estudiante.horas_practicas_requeridas or 0) - (estudiante.horas_practicas_completadas or 0), 0)
        progreso = f"{estudiante.horas_practicas_completadas}/{estudiante.horas_practicas_requeridas}"

    brand_name, contact_phone, contact_email, razon_social, nit = _tenant_mail_context(tenant)
    subject = f"Actualizacion de tu progreso - {brand_name}"
    body = (
        f"Hola {estudiante.usuario.nombre_completo},\n\n"
        f"Te compartimos una actualizacion de tu proceso en {brand_name}:\n\n"
        "Detalle de la acreditacion\n"
        f"- Tipo: {tipo_label}\n"
        f"- Horas acreditadas: {horas}\n"
        f"- Fecha y hora: {fecha_iso}\n\n"
        "Estado actual\n"
        f"- Matricula: {estudiante.matricula_numero or 'N/A'}\n"
        f"- Cedula: {estudiante.usuario.cedula}\n"
        f"- Progreso {tipo_label}: {progreso}\n"
        f"- Horas pendientes de {tipo_label}: {pendientes}\n\n"
        "Si necesitas ayuda, estamos disponibles en:\n"
        f"{contact_phone} | {contact_email}\n\n"
        "Gracias por tu compromiso y constancia.\n\n"
        f"{brand_name}\n"
        f"{razon_social}\n"
        f"NIT {nit}\n"
    )
    enviado = send_email(estudiante.usuario.email, subject, body)
    if not enviado:
        logger.warning("No se pudo enviar notificacion de horas a %s", estudiante.usuario.email)


def _draw_contrato_header(c: canvas.Canvas, tenant: Optional[Tenant] = None) -> None:
    _draw_logo_contrato(c, tenant)
    tenant_title = (tenant.display_name or tenant.nombre) if tenant else settings.BRAND_SHORT_NAME
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(330, 770, tenant_title[:70])
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(330, 752, "CONTRATO DE APRENDIZAJE")
    _draw_header_cells(c, 720)


def _resolve_logo_image(tenant: Optional[Tenant], fallback_settings_path: Optional[str] = None):
    """Resuelve logo del tenant o fallback. Retorna (path_local_str o BytesIO) o None."""
    raw = None
    if tenant and getattr(tenant, "logo_url", None):
        raw = (tenant.logo_url or "").strip()
    if not raw:
        raw = fallback_settings_path or settings.BRAND_LOGO_PATH or os.getenv("BRAND_LOGO_PATH") or ""
    if not raw:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
        default_logo = os.path.join(repo_root, "frontend", "public", "logo-siaec-sin-fondo.png")
        if os.path.exists(default_logo):
            return default_logo
        return None
    if raw.startswith("data:image"):
        try:
            _header, encoded = raw.split(",", 1)
            return BytesIO(base64.b64decode(encoded))
        except Exception:
            return None
    if raw.startswith("http://") or raw.startswith("https://"):
        try:
            req = urllib.request.Request(raw, headers={"User-Agent": "SIAEC-PDF/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return BytesIO(resp.read())
        except Exception:
            return None
    if raw.startswith("/"):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
        path = os.path.join(repo_root, "frontend", "public", raw.lstrip("/"))
        if os.path.exists(path):
            return path
    if os.path.exists(raw):
        return raw
    return None


def _draw_logo_contrato(c: canvas.Canvas, tenant: Optional[Tenant] = None) -> None:
    src = _resolve_logo_image(tenant)
    if not src:
        return
    try:
        logo = ImageReader(src)
        c.drawImage(logo, 30, 700, width=240, height=90, preserveAspectRatio=True, mask='auto')
    except Exception:
        return


def _draw_header_cells(c: canvas.Canvas, y: int) -> None:
    x = 200
    w = 320
    h = 14
    col = w / 3
    _draw_rect(c, x, y, w, h)
    _draw_rect(c, x, y, col, h)
    _draw_rect(c, x + col, y, col, h)
    _draw_rect(c, x + 2 * col, y, col, h)
    c.setFont("Helvetica", 7)
    c.drawCentredString(x + col / 2, y + 4, "Vigente desde: 01/07/2022")
    c.drawCentredString(x + col + col / 2, y + 4, "Codigo: SGC - FR 01")
    c.drawCentredString(x + 2 * col + col / 2, y + 4, "Version: 01")


def _draw_photo_box(c: canvas.Canvas, x: int, y: int, w: int, h: int, foto_url: Optional[str]) -> None:
    if foto_url and foto_url.startswith("data:image"):
        try:
            header, data = foto_url.split(",", 1)
            image_data = BytesIO(base64.b64decode(data))
            c.drawImage(ImageReader(image_data), x + 5, y + 5, width=w - 10, height=h - 10, preserveAspectRatio=True, mask='auto')
            return
        except Exception:
            pass
    c.setFont("Helvetica", 8)
    c.drawCentredString(x + w / 2, y + h / 2, "FOTO")


def _draw_rect(c: canvas.Canvas, x: int, y: int, w: int, h: int) -> None:
    c.setLineWidth(0.6)
    c.rect(x, y, w, h)


def _draw_section_bar(c: canvas.Canvas, title: str, y: int) -> int:
    c.setFillColor(colors.Color(0.95, 0.96, 0.98))
    c.rect(50, y - 16, 520, 16, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(310, y - 12, title)
    return y - 22


def _tipo_documento_label(tipo: Optional[str]) -> str:
    if not tipo:
        return "CC"
    value = tipo.upper()
    if value == "TARJETA_IDENTIDAD":
        return "TI"
    if value == "PASAPORTE":
        return "PAS"
    if value == "CEDULA_EXTRANJERIA":
        return "CE"
    return "CC"


def _categorias_contrato(estudiante: Estudiante) -> list[str]:
    if estudiante.tipo_servicio == TipoServicio.COMBO_A2_B1:
        return ["A2", "B1"]
    if estudiante.tipo_servicio == TipoServicio.COMBO_A2_C1:
        return ["A2", "C1"]
    if estudiante.tipo_servicio in [
        TipoServicio.CERTIFICADO_A2_B1_SIN_PRACTICA,
        TipoServicio.CERTIFICADO_A2_B1_CON_PRACTICA
    ]:
        return ["A2", "B1"]
    if estudiante.tipo_servicio in [
        TipoServicio.CERTIFICADO_A2_C1_SIN_PRACTICA,
        TipoServicio.CERTIFICADO_A2_C1_CON_PRACTICA
    ]:
        return ["A2", "C1"]
    if estudiante.categoria:
        return [estudiante.categoria.value]
    return []


def _draw_box_row(c: canvas.Canvas, y: int, items: list, widths: list, total_width: int = 520) -> int:
    x = 50
    h = 22
    c.setFont("Helvetica", 8)
    used = sum(widths)
    if widths and used < total_width:
        widths = list(widths)
        widths[-1] += (total_width - used)
    for (label, value), w in zip(items, widths):
        _draw_rect(c, x, y - h, w, h)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(x + 4, y - 10, label)
        c.setFont("Helvetica", 8)
        c.drawString(x + 4, y - 18, str(value))
        x += w
    return y - h


def _draw_checkbox_row(c: canvas.Canvas, y: int, options: list, selected, prefix: Optional[str] = None) -> int:
    x = 50
    h = 18
    total_width = 520
    prefix_width = 70 if prefix else 0
    available = max(0, total_width - prefix_width)
    count = max(1, len(options))
    step = min(110, max(70, available / count))
    if isinstance(selected, (list, tuple, set)):
        selected_norms = {str(item).lower() for item in selected}
    else:
        selected_norms = {str(selected).lower()} if selected else set()
    if prefix:
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x, y - 12, prefix)
        x += 70
    for opt in options:
        opt_norm = opt.lower().replace(" ", "_")
        _draw_rect(c, x, y - h, 12, 12)
        if selected_norms and (opt_norm in selected_norms or opt.lower() in selected_norms):
            c.setFont("Helvetica-Bold", 9)
            c.drawString(x + 3, y - 12, "X")
        c.setFont("Helvetica", 8)
        c.drawString(x + 16, y - 12, opt)
        x += step
    return y - h


def _draw_boxed_checkbox_row(
    c: canvas.Canvas,
    y: int,
    options: list,
    selected: Optional[str],
    prefix: Optional[str] = None
) -> int:
    box_h = 22
    _draw_rect(c, 50, y - box_h, 520, box_h)
    y = _draw_checkbox_row(c, y, options, selected, prefix=prefix)
    return y


def _draw_certificacion_row(c: canvas.Canvas, y: int, selected: str) -> int:
    x = 50
    h = 40
    _draw_rect(c, x, y - h, 520, h)

    c.setFont("Helvetica-Bold", 7)
    c.drawString(x + 4, y - 12, "Certificacion de la aptitud en")
    c.drawString(x + 4, y - 24, "conduccion a solicitar")

    selected_norm = (selected or "").lower()
    options = ["Obtener por primera vez", "Recategorizar"]
    option_x = x + 240
    for index, opt in enumerate(options):
        box_y = y - 12 - (index * 14)
        _draw_rect(c, option_x, box_y - 8, 12, 12)
        if opt.lower() in selected_norm:
            c.setFont("Helvetica-Bold", 9)
            c.drawString(option_x + 3, box_y - 7, "X")
        c.setFont("Helvetica", 8)
        c.drawString(option_x + 16, box_y - 7, opt)

    return y - h


def _draw_paragraphs(c: canvas.Canvas, paragraphs: list, x: int, y: int, width: int, leading: int, tenant: Optional[Tenant] = None) -> int:
    font_name = "Helvetica"
    font_size = 9
    c.setFont(font_name, font_size)
    for entry in paragraphs:
        if isinstance(entry, tuple):
            title, body = entry
            c.setFont("Helvetica-Bold", font_size)
            if y < 80:
                c.showPage()
                _draw_contrato_header(c, tenant)
                y = 680
            c.drawString(x, y, title)
            y -= leading
            c.setFont(font_name, font_size)
            if not body:
                y -= 4
                continue
            text = body
        else:
            text = entry
        lines = _wrap_text(c, text, width, font_name, font_size)
        for i, line in enumerate(lines):
            if y < 80:
                c.showPage()
                _draw_contrato_header(c, tenant)
                y = 680
                c.setFont(font_name, font_size)
            is_last = (i == len(lines) - 1)
            _draw_justified_line(c, line, x, y, width, font_name, font_size, is_last)
            y -= leading
        y -= 6
    return y


def _wrap_text(c: canvas.Canvas, text: str, max_width: int, font_name: str, font_size: int) -> list:
    words = text.split()
    lines = []
    current = []
    for word in words:
        test = " ".join(current + [word])
        if c.stringWidth(test, font_name, font_size) <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def _draw_justified_line(
    c: canvas.Canvas,
    line: str,
    x: int,
    y: int,
    width: int,
    font_name: str,
    font_size: int,
    is_last: bool
) -> None:
    words = line.split()
    if is_last or len(words) <= 1:
        c.drawString(x, y, line)
        return
    words_width = sum(c.stringWidth(w, font_name, font_size) for w in words)
    spaces = len(words) - 1
    if spaces <= 0:
        c.drawString(x, y, line)
        return
    space_width = (width - words_width) / spaces
    cursor = x
    for i, word in enumerate(words):
        c.drawString(cursor, y, word)
        cursor += c.stringWidth(word, font_name, font_size)
        if i < spaces:
            cursor += space_width


def _draw_signature_lines(c: canvas.Canvas, y: int) -> int:
    c.setLineWidth(0.6)
    c.line(60, y, 260, y)
    c.line(320, y, 520, y)
    c.line(60, y - 50, 260, y - 50)
    c.setFont("Helvetica", 8)
    c.drawString(60, y - 12, "FIRMA ALUMNO: ACEPTO LAS CONDICIONES DEL CEAP")
    c.drawString(320, y - 12, "FIRMA REPRESENTANTE LEGAL CEA")
    c.drawString(60, y - 62, "FIRMA DE ACUDIENTE O PADRE DE FAMILIA")
    _draw_rect(c, 480, y - 80, 50, 50)
    _draw_rep_signature(c, 330, y + 4, 150, 30)
    return y - 90


def _draw_rep_signature(c: canvas.Canvas, x: int, y: int, w: int, h: int) -> None:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
    assets_dir = os.path.join(repo_root, "frontend", "src", "assets")
    signature_path = os.path.join(assets_dir, "firma jerson.png")
    if signature_path and os.path.exists(signature_path):
        try:
            c.drawImage(ImageReader(signature_path), x, y, width=w, height=h, preserveAspectRatio=True, mask="auto")
        except Exception:
            return


def _ensure_space_contrato(c: canvas.Canvas, y: int, min_y: int, tenant: Optional[Tenant] = None) -> int:
    if y < min_y:
        c.showPage()
        _draw_contrato_header(c, tenant)
        return 680
    return y


def _fmt_date(value: datetime) -> str:
    if not value:
        return ""
    return value.strftime("%Y-%m-%d")


def _extra(estudiante: Estudiante, key: str) -> str:
    datos = estudiante.datos_adicionales or {}
    return datos.get(key, "")


def _pdf_response(buffer: BytesIO, filename: str) -> Response:
    pdf_bytes = buffer.getvalue()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )


CONTRATO_PARRAFOS = [
    ("1. PRIMERA. Objetivo:", "Formar personas con aptitudes, habilidades, destrezas y fundamentar los conocimientos requeridos para la conduccion de un vehiculo automotor, sin poner en riesgo su vida y la de los demas segun la reglamentacion expedida por el Ministerio de Transporte, Decreto 1500 de 2009, Resolucion 3245 del 21 de Julio de 2009 y demas requisitos legales aplicables y reglamentarios."),
    ("2. SEGUNDA. Naturaleza de la capacitacion.", "El alumno aspira a obtener la certificacion de aptitud en conduccion para la categoria A2___, B1___, C1___, de acuerdo con la formacion que imparte el Centro de Ensenanza Automovilistica y la aplicabilidad que el mismo tiene para la obtencion de la licencia de conduccion en la categoria seleccionada anteriormente por el alumno."),
    ("3. TERCERA. Duracion y Periodos de la formacion.", "La formacion tiene una duracion maxima de 3 meses, comprendidos entre la fecha de iniciacion de los modulos de la formacion y la fecha de terminacion de los mismos. La capacitacion se encuentra distribuida en 3 modulos: Modulo de formacion teorica, Modulo de formacion basica aplicada y el Modulo de formacion especifica."),
    ("PARAGRAFO. 1°", "Este contrato puede ser modificado en su duracion parcial y total, cuando por el rendimiento en la formacion del alumno y previo analisis de las evaluaciones que el Centro de Ensenanza le aplique al terminar cada bloque modular se identifique alguna necesidad de recapacitar al alumno en algun(os) tema(s) especifico(s)."),
    ("PARAGRAFO. 2º", "La certificacion de la aptitud en conduccion del alumno esta sujeta al cumplimiento y aprobacion de los rangos establecidos por el Ministerio de Transporte al momento de realizar la evaluacion teorico-Practica."),
    ("4. CUARTO: Contenido y desarrollo del curso:", "La formacion de conductores se llevara a cabo en (3) tres modulos con temas relacionados con:"),
    ("MODULO I FORMACION TEORICA:", "ADAPTACION AL MEDIO: Ubicacion del vehiculo en la via y sus componentes, senales de transito, accidentalidad en Colombia, Normas de transito, Autoridades de transito, elementos, personas, definicion de terminos y factores que intervienen en el transito, la via, el vehiculo. ETICA, PREVENCION DE CONFLICTOS Y COMUNICACION: Valores del conductor, el peaton: deberes y responsabilidades, el conductor: deberes y responsabilidades, conductas apropiadas e inapropiadas de los usuarios de la via, los derechos humanos, compromiso con el medio ambiente, la movilidad y el transito, accesibilidad y sus barreras, respeto por el espacio publico, el alcohol y otras sustancias, cultura ciudadana, la agresividad y la velocidad, la responsabilidad social, autocontrol y autodiagnostico del conductor, respeto a la vida, sensibilizacion ante la incapacidad."),
    ("MODULO II FORMACION BASICA APLICADA:", "MECANICA BASICA: Descripcion del vehiculo, partes esenciales y localizacion, accesorios del motor, cambio de aceite y llantas, funcionamiento de averias mas frecuentes. MARCO LEGAL: Aspectos legales de transito, documentos obligatorios, licencias, clasificacion y requisitos, Codigo Nacional de transito y sus reglamentaciones, procedimientos juridicos, normas de salud ocupacional, normas ambientales, normas de convivencia y restricciones por ciudades. TECNICAS EN CONDUCCION: Componentes del vehiculo, elementos de seguridad, inspeccion al vehiculo, adaptacion al vehiculo, familiarizacion con los distintos controles, conceptos de velocidad, operacion del control de velocidades o seleccion de velocidades, conduccion del vehiculo, manejo de las distancias en la conduccion, primeros auxilios en salud o mecanicos, adaptacion viso-espacial al vehiculo, parqueo y estacionamientos."),
    ("MODULO III FORMACION ESPECIFICA:", "UNIDAD PRACTICA: Taller inspeccion pre operacional, ajuste de asiento, adaptacion Visio-espacial, utilizacion de elementos de seguridad, puesta en marcha del motor, regulacion de velocidades, puesta en marcha del vehiculo, coordinacion, aceleracion-freno-embrague, aceleracion y desaceleracion, control de cambios, conduccion del vehiculo en via urbana, carretera, terreno plano, terreno inclinado, maniobra de cruces y adelantamientos, utilizacion de senales luminicas, corporales y acusticas, utilizacion de calzadas, carriles, afrontar y utilizacion de glorietas, afrontar intersecciones, respeto a las marcas viales y senales de transito, distancias de reaccion, frenado, maniobras de adelantamiento, reversa, entrada y salida de curvas, parqueo, estacionamiento frontal y en reversa, utilizacion del equipo de seguridad, nomenclatura urbana y nacional, normas de seguridad en el aseguramiento de la carga, uso de salidas de emergencia."),
    ("5. HORARIOS.", "Los horarios para las clases practicas se programaran con antelacion para que se puedan adecuar a la disponibilidad de tiempo de cada uno de los alumnos, en cuanto a las clases teoricas, se le entregara al alumno al inicio de sus clases el cronograma con sus respectivos horarios debido a que estos modulos se desarrollan en grupo, por lo cual tienen un horario fijo."),
    ("6. METODOLOGIA.", "Clases presenciales, talleres con ejercicios, conferencias y practicas de campo orientadas a trabajar para el desarrollo de las habilidades teorico-practicas como conductor en cada modulo y al finalizar cada modulo se realizara una evaluacion."),
    ("7. INTENSIDAD HORARIA.", "Al alumno se le impartira la formacion teorico-practica de acuerdo a la intensidad horaria reglamentada en el Anexo I de la Resolucion 3245 de 2009 emitida por el Ministerio de Transporte."),
    ("8. CONDICIONES PARA LA PRESTACION DEL SERVICIO:", ""),
    ("8.1", "Para acceder al proceso de capacitacion y de formacion como conductor, el aspirante debera como minimo, saber leer y escribir, tener 16 anos cumplidos para el servicio diferente al publico, y tener 18 anos para vehiculos de servicio publico. (Art. 15 Decreto 1500 de 2009)."),
    ("8.2", "Cuando se este impartiendo ensenanza practica solo podran ir en el vehiculo el instructor debidamente acreditado y el aprendiz, excepto en los vehiculos tipo B2, C2, B3 y C3, de acuerdo a lo establecido por el Ministerio de Transporte. (Art. 7 Decreto 1500 de 2009)."),
    ("8.3", "Quien padezca una limitacion fisica, podra obtener la licencia de conduccion, si ademas de cumplir con todos los requisitos, demuestra en el examen de aptitud fisica, mental y de coordinacion motriz, que se encuentra habilitado y adiestrado para conducir con dicha limitacion. (Art. 21 Ley 769 de 2002)."),
    ("8.4", "Los horarios son programados por el Centro de Ensenanza, por lo tanto, no se responsabiliza por la ensenanza impartida por fuera de dicha programacion."),
    ("8.5", "En caso de que el alumno suspenda su clase practica previamente programada, debe informar con 2 horas de anticipacion para realizar la reprogramacion de la misma."),
    ("8.5", "Para el desarrollo de las clases el alumno debera presentarse en el Centro de Ensenanza Automovilistica en el horario programado."),
    ("8.6", "Una vez iniciado el curso, no se admite interferencia de terceras personas."),
    ("8.7", "No es posible cambiar horas teoricas por horas practicas, ya que la estructura curricular esta basada en modulos que son necesarios aprobar en todos los aspectos tanto teoricos como practicos."),
    ("8.8", "Es deber del alumno manifestar al centro de ensenanza el grado de conformidad con el sistema de aprendizaje empleado por los instructores, para retroalimentar el Sistema de mejoramiento continuo de nuestra empresa.")
]


def _build_estudiante_response(estudiante: Estudiante, db: Session = None) -> EstudianteResponse:
    """Helper para construir la respuesta con datos del usuario"""
    # Obtener historial de pagos si hay DB session
    historial_pagos = []
    if db:
        from app.models.pago import Pago, EstadoPago
        from app.api.v1.endpoints.caja import _build_pago_response
        from sqlalchemy import and_
        
        pagos = db.query(Pago).filter(
            and_(
                Pago.estudiante_id == estudiante.id,
                Pago.estado == EstadoPago.COMPLETADO,
                Pago.tenant_id == estudiante.tenant_id,
            )
        ).order_by(Pago.fecha_pago.desc()).all()
        
        historial_pagos = [_build_pago_response(p) for p in pagos]
    
    clases_historial = []
    servicios = []
    servicio_activo_id = None
    if estudiante.datos_adicionales:
        clases_historial = estudiante.datos_adicionales.get("clases_historial", [])
        servicios = estudiante.datos_adicionales.get("servicios", [])
        servicio_activo_id = estudiante.datos_adicionales.get("servicio_activo_id")

    return EstudianteResponse(
        id=estudiante.id,
        usuario_id=estudiante.usuario_id,
        matricula_numero=estudiante.matricula_numero,
        fecha_nacimiento=estudiante.fecha_nacimiento,
        direccion=estudiante.direccion,
        ciudad=estudiante.ciudad,
        barrio=estudiante.barrio,
        tipo_sangre=estudiante.tipo_sangre,
        eps=estudiante.eps,
        ocupacion=estudiante.ocupacion,
        estado_civil=estudiante.estado_civil,
        nivel_educativo=estudiante.nivel_educativo,
        estrato=estudiante.estrato,
        nivel_sisben=estudiante.nivel_sisben,
        necesidades_especiales=estudiante.necesidades_especiales,
        contacto_emergencia_nombre=estudiante.contacto_emergencia_nombre,
        contacto_emergencia_telefono=estudiante.contacto_emergencia_telefono,
        foto_url=estudiante.foto_url,
        tipo_servicio=estudiante.tipo_servicio,
        categoria=estudiante.categoria,
        origen_cliente=estudiante.origen_cliente,
        referido_por=estudiante.referido_por,
        telefono_referidor=estudiante.telefono_referidor,
        estado=estudiante.estado,
        fecha_inscripcion=estudiante.fecha_inscripcion,
        fecha_graduacion=estudiante.fecha_graduacion,
        no_certificado=estudiante.no_certificado,
        horas_teoricas_completadas=estudiante.horas_teoricas_completadas or 0,
        horas_practicas_completadas=estudiante.horas_practicas_completadas or 0,
        horas_teoricas_requeridas=estudiante.horas_teoricas_requeridas or 0,
        horas_practicas_requeridas=estudiante.horas_practicas_requeridas or 0,
        valor_total_curso=estudiante.valor_total_curso,
        saldo_pendiente=estudiante.saldo_pendiente,
        created_at=estudiante.created_at,
        updated_at=estudiante.updated_at,
        nombre_completo=estudiante.usuario.nombre_completo,
        cedula=estudiante.usuario.cedula,
        tipo_documento=estudiante.usuario.tipo_documento,
        email=estudiante.usuario.email,
        telefono=estudiante.usuario.telefono,
        progreso_teorico=estudiante.progreso_teorico,
        progreso_practico=estudiante.progreso_practico,
        esta_listo_para_examen=estudiante.esta_listo_para_examen,
        historial_pagos=historial_pagos,
        clases_historial=clases_historial,
        servicios=servicios,
        servicio_activo_id=servicio_activo_id
    )
