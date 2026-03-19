from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract, or_
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal

from app.core.database import get_db
from app.api.deps import get_current_active_user, get_required_tenant
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.clase import Instructor, EstadoInstructor, EstadoDocumentacion, Clase, TipoClase, EstadoClase
from app.models.estudiante import Estudiante
from app.schemas.instructor import (
    InstructorCreate, InstructorUpdate, InstructorResponse,
    InstructorList, InstructorDetalle, InstructorEstadisticas,
    InstructoresListResponse
)

router = APIRouter()


# ==================== ENDPOINTS CRUD ====================

@router.get("/", response_model=InstructoresListResponse)
def listar_instructores(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    estado: Optional[str] = None,
    busqueda: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Lista todos los instructores con paginación y filtros
    """
    query = db.query(Instructor).join(Usuario, Instructor.usuario_id == Usuario.id).filter(
        Instructor.tenant_id == current_tenant.id,
        Usuario.tenant_id == current_tenant.id,
    )
    
    # Filtrar por estado
    if estado:
        try:
            estado_enum = EstadoInstructor[estado.upper()]
            query = query.filter(Instructor.estado == estado_enum)
        except KeyError:
            raise HTTPException(status_code=400, detail=f"Estado inválido: {estado}")
    
    # Búsqueda por nombre, cédula o licencia
    if busqueda:
        search_term = f"%{busqueda}%"
        query = query.filter(
            or_(
                Usuario.nombre_completo.ilike(search_term),
                Usuario.cedula.ilike(search_term),
                Instructor.licencia_numero.ilike(search_term)
            )
        )
    
    # Total de registros
    total = query.count()
    
    # Aplicar paginación y ordenar por nombre
    instructores = query.order_by(Usuario.nombre_completo).offset(skip).limit(limit).all()
    
    # Construir respuesta con datos del usuario
    items = []
    for instructor in instructores:
        usuario = instructor.usuario
        items.append(InstructorList(
            id=instructor.id,
            usuario_id=instructor.usuario_id,
            nombre_completo=usuario.nombre_completo,
            cedula=usuario.cedula,
            telefono=usuario.telefono,
            foto_url=instructor.foto_url,
            licencia_numero=instructor.licencia_numero,
            categorias_enseña=instructor.categorias_enseña,
            especialidad=instructor.especialidad,
            estado=instructor.estado.value,
            calificacion_promedio=instructor.calificacion_promedio or Decimal('0.0'),
            estado_documentacion=instructor.estado_documentacion.value if instructor.estado_documentacion else None,
            licencia_vigencia_hasta=instructor.licencia_vigencia_hasta,
            certificado_vigencia_hasta=instructor.certificado_vigencia_hasta
        ))
    
    return InstructoresListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit
    )


@router.get("/{instructor_id}", response_model=InstructorDetalle)
def obtener_instructor(
    instructor_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Obtiene el detalle completo de un instructor con estadísticas
    """
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id,
        Instructor.tenant_id == current_tenant.id,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado")
    
    usuario = instructor.usuario
    
    # Calcular estadísticas
    estadisticas = _calcular_estadisticas_instructor(db, instructor_id, current_tenant.id)
    
    return InstructorDetalle(
        id=instructor.id,
        usuario_id=instructor.usuario_id,
        nombre_completo=usuario.nombre_completo,
        cedula=usuario.cedula,
        email=usuario.email,
        telefono=usuario.telefono,
        licencia_numero=instructor.licencia_numero,
        categorias_enseña=instructor.categorias_enseña,
        foto_url=instructor.foto_url,
        especialidad=instructor.especialidad,
        estado=instructor.estado.value,
        fecha_contratacion=instructor.fecha_contratacion,
        certificaciones=instructor.certificaciones,
        tipo_contrato=instructor.tipo_contrato,
        calificacion_promedio=instructor.calificacion_promedio or Decimal('0.0'),
        # Vigencias de documentos
        licencia_vigencia_desde=instructor.licencia_vigencia_desde,
        licencia_vigencia_hasta=instructor.licencia_vigencia_hasta,
        certificado_vigencia_desde=instructor.certificado_vigencia_desde,
        certificado_vigencia_hasta=instructor.certificado_vigencia_hasta,
        examen_medico_fecha=instructor.examen_medico_fecha,
        # URLs de documentos PDF
        cedula_pdf_url=instructor.cedula_pdf_url,
        licencia_pdf_url=instructor.licencia_pdf_url,
        certificado_pdf_url=instructor.certificado_pdf_url,
        # Información adicional
        numero_runt=instructor.numero_runt,
        estado_documentacion=instructor.estado_documentacion.value if instructor.estado_documentacion else None,
        created_at=instructor.created_at,
        updated_at=instructor.updated_at,
        estadisticas=estadisticas
    )


@router.post("/", response_model=InstructorResponse)
def crear_instructor(
    instructor_data: InstructorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Crea un nuevo instructor
    """
    # Verificar que el usuario existe
    usuario = db.query(Usuario).filter(
        Usuario.id == instructor_data.usuario_id,
        Usuario.tenant_id == current_tenant.id,
    ).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    # Verificar que el usuario no sea ya un instructor
    instructor_existente = db.query(Instructor).filter(
        Instructor.usuario_id == instructor_data.usuario_id,
        Instructor.tenant_id == current_tenant.id,
    ).first()
    if instructor_existente:
        raise HTTPException(status_code=400, detail="Este usuario ya es un instructor")
    
    # Verificar que la licencia no esté duplicada
    if instructor_data.licencia_numero:
        lic_existente = db.query(Instructor).filter(
            Instructor.licencia_numero == instructor_data.licencia_numero,
            Instructor.tenant_id == current_tenant.id,
        ).first()
        if lic_existente:
            raise HTTPException(status_code=400, detail="Ya existe un instructor con esta licencia")
    
    # Crear instructor
    nuevo_instructor = Instructor(
        tenant_id=current_tenant.id,
        usuario_id=instructor_data.usuario_id,
        licencia_numero=instructor_data.licencia_numero,
        categorias_enseña=instructor_data.categorias_enseña,
        foto_url=instructor_data.foto_url,
        especialidad=instructor_data.especialidad,
        estado=EstadoInstructor[instructor_data.estado],
        fecha_contratacion=instructor_data.fecha_contratacion,
        certificaciones=instructor_data.certificaciones,
        tipo_contrato=instructor_data.tipo_contrato,
        calificacion_promedio=Decimal('0.0'),
        # Nuevos campos de documentación
        licencia_vigencia_desde=instructor_data.licencia_vigencia_desde,
        licencia_vigencia_hasta=instructor_data.licencia_vigencia_hasta,
        certificado_vigencia_desde=instructor_data.certificado_vigencia_desde,
        certificado_vigencia_hasta=instructor_data.certificado_vigencia_hasta,
        examen_medico_fecha=instructor_data.examen_medico_fecha,
        cedula_pdf_url=instructor_data.cedula_pdf_url,
        licencia_pdf_url=instructor_data.licencia_pdf_url,
        certificado_pdf_url=instructor_data.certificado_pdf_url,
        numero_runt=instructor_data.numero_runt
    )
    
    # Validar y establecer estado de documentación
    estado_docs = _validar_y_actualizar_estado_documentacion(nuevo_instructor)
    nuevo_instructor.estado_documentacion = EstadoDocumentacion[estado_docs]
    
    db.add(nuevo_instructor)
    db.commit()
    db.refresh(nuevo_instructor)
    
    # Retornar con datos del usuario
    return InstructorResponse(
        id=nuevo_instructor.id,
        usuario_id=nuevo_instructor.usuario_id,
        nombre_completo=usuario.nombre_completo,
        cedula=usuario.cedula,
        email=usuario.email,
        telefono=usuario.telefono,
        licencia_numero=nuevo_instructor.licencia_numero,
        categorias_enseña=nuevo_instructor.categorias_enseña,
        foto_url=nuevo_instructor.foto_url,
        especialidad=nuevo_instructor.especialidad,
        estado=nuevo_instructor.estado.value,
        fecha_contratacion=nuevo_instructor.fecha_contratacion,
        certificaciones=nuevo_instructor.certificaciones,
        tipo_contrato=nuevo_instructor.tipo_contrato,
        calificacion_promedio=nuevo_instructor.calificacion_promedio,
        created_at=nuevo_instructor.created_at,
        updated_at=nuevo_instructor.updated_at
    )


@router.put("/{instructor_id}", response_model=InstructorResponse)
def actualizar_instructor(
    instructor_id: int,
    instructor_data: InstructorUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Actualiza un instructor existente
    """
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id,
        Instructor.tenant_id == current_tenant.id,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado")
    
    # Verificar licencia duplicada (si se está actualizando)
    if instructor_data.licencia_numero and instructor_data.licencia_numero != instructor.licencia_numero:
        lic_existente = db.query(Instructor).filter(
            Instructor.licencia_numero == instructor_data.licencia_numero,
            Instructor.id != instructor_id,
            Instructor.tenant_id == current_tenant.id,
        ).first()
        if lic_existente:
            raise HTTPException(status_code=400, detail="Ya existe un instructor con esta licencia")
    
    # Actualizar campos
    update_data = instructor_data.dict(exclude_unset=True)
    
    for field, value in update_data.items():
        if field == 'estado' and value:
            setattr(instructor, field, EstadoInstructor[value])
        elif field == 'estado_documentacion' and value:
            setattr(instructor, field, EstadoDocumentacion[value])
        else:
            setattr(instructor, field, value)
    
    # Validar y actualizar estado de documentación automáticamente
    estado_docs = _validar_y_actualizar_estado_documentacion(instructor)
    instructor.estado_documentacion = EstadoDocumentacion[estado_docs]
    
    db.commit()
    db.refresh(instructor)
    
    usuario = instructor.usuario
    
    return InstructorResponse(
        id=instructor.id,
        usuario_id=instructor.usuario_id,
        nombre_completo=usuario.nombre_completo,
        cedula=usuario.cedula,
        email=usuario.email,
        telefono=usuario.telefono,
        licencia_numero=instructor.licencia_numero,
        categorias_enseña=instructor.categorias_enseña,
        foto_url=instructor.foto_url,
        especialidad=instructor.especialidad,
        estado=instructor.estado.value,
        fecha_contratacion=instructor.fecha_contratacion,
        certificaciones=instructor.certificaciones,
        tipo_contrato=instructor.tipo_contrato,
        calificacion_promedio=instructor.calificacion_promedio or Decimal('0.0'),
        created_at=instructor.created_at,
        updated_at=instructor.updated_at
    )


@router.delete("/{instructor_id}")
def eliminar_instructor(
    instructor_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Desactiva un instructor (soft delete)
    """
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id,
        Instructor.tenant_id == current_tenant.id,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado")
    
    # Cambiar estado a INACTIVO
    instructor.estado = EstadoInstructor.INACTIVO
    db.commit()
    
    return {"mensaje": "Instructor desactivado exitosamente"}


@router.get("/{instructor_id}/estadisticas", response_model=InstructorEstadisticas)
def obtener_estadisticas_instructor(
    instructor_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Obtiene las estadísticas de un instructor
    """
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id,
        Instructor.tenant_id == current_tenant.id,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado")
    
    return _calcular_estadisticas_instructor(db, instructor_id, current_tenant.id)


# ==================== FUNCIONES AUXILIARES ====================

def _validar_y_actualizar_estado_documentacion(instructor: Instructor) -> str:
    """
    Valida las vigencias de documentos y actualiza el estado de documentación
    Retorna el estado calculado: COMPLETO, INCOMPLETO, VENCIDO, PROXIMO_VENCER
    """
    from datetime import timedelta
    
    hoy = date.today()
    treinta_dias = hoy + timedelta(days=30)
    
    # Verificar que todos los documentos estén presentes
    documentos_completos = all([
        instructor.cedula_pdf_url,
        instructor.licencia_pdf_url,
        instructor.certificado_pdf_url,
        instructor.licencia_vigencia_hasta,
        instructor.certificado_vigencia_hasta
    ])
    
    if not documentos_completos:
        return EstadoDocumentacion.INCOMPLETO.value
    
    # Verificar si alguno está vencido
    if (instructor.licencia_vigencia_hasta and instructor.licencia_vigencia_hasta < hoy) or \
       (instructor.certificado_vigencia_hasta and instructor.certificado_vigencia_hasta < hoy):
        return EstadoDocumentacion.VENCIDO.value
    
    # Verificar si alguno está próximo a vencer (30 días o menos)
    if (instructor.licencia_vigencia_hasta and instructor.licencia_vigencia_hasta <= treinta_dias) or \
       (instructor.certificado_vigencia_hasta and instructor.certificado_vigencia_hasta <= treinta_dias):
        return EstadoDocumentacion.PROXIMO_VENCER.value
    
    return EstadoDocumentacion.COMPLETO.value


def _calcular_estadisticas_instructor(db: Session, instructor_id: int, tenant_id: int) -> InstructorEstadisticas:
    """Calcula las estadísticas de un instructor"""
    
    # TODO: Implementar cuando el módulo de clases esté completo
    # Por ahora retornamos estadísticas vacías para evitar errores de schema
    
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id,
        Instructor.tenant_id == tenant_id,
    ).first()
    promedio_calificacion = instructor.calificacion_promedio or Decimal('0.0') if instructor else Decimal('0.0')
    
    return InstructorEstadisticas(
        total_clases=0,
        clases_teoricas=0,
        clases_practicas=0,
        horas_impartidas=0,
        estudiantes_atendidos=0,
        clases_mes_actual=0,
        promedio_calificacion=promedio_calificacion
    )
