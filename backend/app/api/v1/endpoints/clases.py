from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_required_tenant
from app.core.clase_notificaciones import (
    enviar_correo_clase_programada,
    enviar_correo_clase_reprogramada,
    procesar_recordatorios_clases,
)
from app.core.database import get_db
from app.core.precios import es_certificado_sin_practica
from app.models.clase import Clase, EstadoClase, EstadoInstructor, TipoClase, Vehiculo, Instructor
from app.models.estudiante import Estudiante, EstadoEstudiante
from app.models.tenant import Tenant
from app.models.usuario import RolUsuario, Usuario
from app.schemas.clase import (
    ClaseCancel,
    ClaseComplete,
    ClaseCreate,
    ClaseReschedule,
    ClaseResponse,
    ClasesListResponse,
)

router = APIRouter()


def _check_role(user: Usuario) -> None:
    if user.rol not in [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.COORDINADOR, RolUsuario.INSTRUCTOR]:
        raise HTTPException(status_code=403, detail="No tiene permisos para gestionar clases")


def _overlap(start_a: datetime, end_a: datetime, start_b: datetime, end_b: datetime) -> bool:
    return start_a < end_b and start_b < end_a


def _to_naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _validate_conflicts(
    db: Session,
    tenant_id: int,
    fecha_programada: datetime,
    duracion_horas: int,
    instructor_id: int,
    vehiculo_id: Optional[int],
    exclude_clase_id: Optional[int] = None,
) -> None:
    start = _to_naive_utc(fecha_programada)
    end = start + timedelta(hours=duracion_horas)

    base_query = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Estudiante.tenant_id == tenant_id,
            Clase.estado == EstadoClase.PROGRAMADA,
        )
    )
    if exclude_clase_id:
        base_query = base_query.filter(Clase.id != exclude_clase_id)

    clases_instructor = base_query.filter(Clase.instructor_id == instructor_id).all()
    for clase in clases_instructor:
        other_start = _to_naive_utc(clase.fecha_programada)
        other_end = other_start + timedelta(hours=int(clase.duracion_horas or 1))
        if _overlap(start, end, other_start, other_end):
            raise HTTPException(
                status_code=400,
                detail="Conflicto de horario: el instructor ya tiene una clase programada en ese rango",
            )

    if vehiculo_id:
        clases_vehiculo = base_query.filter(Clase.vehiculo_id == vehiculo_id).all()
        for clase in clases_vehiculo:
            other_start = _to_naive_utc(clase.fecha_programada)
            other_end = other_start + timedelta(hours=int(clase.duracion_horas or 1))
            if _overlap(start, end, other_start, other_end):
                raise HTTPException(
                    status_code=400,
                    detail="Conflicto de horario: el vehículo ya está reservado en ese rango",
                )


def _build_clase_response(clase: Clase) -> ClaseResponse:
    estudiante_nombre = clase.estudiante.usuario.nombre_completo if clase.estudiante and clase.estudiante.usuario else "N/A"
    instructor_nombre = (
        clase.instructor.usuario.nombre_completo if clase.instructor and clase.instructor.usuario else None
    )
    vehiculo_label = None
    if clase.vehiculo:
        vehiculo_label = f"{clase.vehiculo.placa} - {clase.vehiculo.marca or ''} {clase.vehiculo.modelo or ''}".strip()

    return ClaseResponse(
        id=clase.id,
        estudiante_id=clase.estudiante_id,
        estudiante_nombre=estudiante_nombre,
        instructor_id=clase.instructor_id,
        instructor_nombre=instructor_nombre,
        vehiculo_id=clase.vehiculo_id,
        vehiculo_label=vehiculo_label,
        tipo=clase.tipo,
        estado=clase.estado,
        fecha_programada=clase.fecha_programada,
        fecha_completada=clase.fecha_completada,
        duracion_horas=clase.duracion_horas,
        created_at=clase.created_at,
    )


@router.get("/", response_model=ClasesListResponse)
def listar_clases(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    estado: Optional[EstadoClase] = None,
    tipo: Optional[TipoClase] = None,
    fecha_desde: Optional[datetime] = None,
    fecha_hasta: Optional[datetime] = None,
    instructor_id: Optional[int] = None,
    estudiante_id: Optional[int] = None,
    vehiculo_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    _check_role(current_user)
    fecha_desde_naive = _to_naive_utc(fecha_desde) if fecha_desde else None
    fecha_hasta_naive = _to_naive_utc(fecha_hasta) if fecha_hasta else None

    query = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(Estudiante.tenant_id == current_tenant.id)
    )
    if estado:
        query = query.filter(Clase.estado == estado)
    if tipo:
        query = query.filter(Clase.tipo == tipo)
    if fecha_desde_naive:
        query = query.filter(Clase.fecha_programada >= fecha_desde_naive)
    if fecha_hasta_naive:
        query = query.filter(Clase.fecha_programada <= fecha_hasta_naive)
    if instructor_id:
        query = query.filter(Clase.instructor_id == instructor_id)
    if estudiante_id:
        query = query.filter(Clase.estudiante_id == estudiante_id)
    if vehiculo_id:
        query = query.filter(Clase.vehiculo_id == vehiculo_id)

    total = query.count()
    items = query.order_by(Clase.fecha_programada.asc()).offset(skip).limit(limit).all()
    return ClasesListResponse(
        items=[_build_clase_response(c) for c in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/", response_model=ClaseResponse, status_code=status.HTTP_201_CREATED)
def programar_clase(
    payload: ClaseCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    _check_role(current_user)
    fecha_programada = _to_naive_utc(payload.fecha_programada)

    estudiante = db.query(Estudiante).filter(
        Estudiante.id == payload.estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).first()
    if not estudiante:
        raise HTTPException(status_code=404, detail="Estudiante no encontrado")

    if estudiante.estado in [EstadoEstudiante.RETIRADO, EstadoEstudiante.DESERTOR]:
        raise HTTPException(status_code=400, detail="No se puede programar clase para estudiantes inactivos")

    instructor = db.query(Instructor).filter(
        Instructor.id == payload.instructor_id,
        Instructor.tenant_id == current_tenant.id,
        Instructor.estado == EstadoInstructor.ACTIVO,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado o inactivo")

    vehiculo = None
    if payload.tipo == TipoClase.PRACTICA:
        if not payload.vehiculo_id:
            raise HTTPException(status_code=400, detail="Debe seleccionar vehículo para clase práctica")
        if estudiante.tipo_servicio and es_certificado_sin_practica(estudiante.tipo_servicio):
            raise HTTPException(status_code=400, detail="Este servicio no admite horas prácticas")
        vehiculo = db.query(Vehiculo).filter(
            Vehiculo.id == payload.vehiculo_id,
            Vehiculo.tenant_id == current_tenant.id,
            Vehiculo.is_active == 1,
        ).first()
        if not vehiculo:
            raise HTTPException(status_code=404, detail="Vehículo no encontrado o inactivo")
    elif payload.vehiculo_id:
        vehiculo = db.query(Vehiculo).filter(
            Vehiculo.id == payload.vehiculo_id,
            Vehiculo.tenant_id == current_tenant.id,
        ).first()
        if not vehiculo:
            raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    _validate_conflicts(
        db=db,
        tenant_id=current_tenant.id,
        fecha_programada=fecha_programada,
        duracion_horas=payload.duracion_horas,
        instructor_id=payload.instructor_id,
        vehiculo_id=payload.vehiculo_id,
    )

    clase = Clase(
        estudiante_id=payload.estudiante_id,
        instructor_id=payload.instructor_id,
        vehiculo_id=payload.vehiculo_id,
        tipo=payload.tipo,
        estado=EstadoClase.PROGRAMADA,
        fecha_programada=fecha_programada,
        duracion_horas=payload.duracion_horas,
    )
    db.add(clase)

    if payload.observaciones:
        datos = dict(estudiante.datos_adicionales or {})
        agendadas = list(datos.get("clases_agendadas", []))
        agendadas.append(
            {
                "fecha": payload.fecha_programada.isoformat(),
                "tipo": payload.tipo.value,
                "horas": payload.duracion_horas,
                "observaciones": payload.observaciones,
                "instructor_id": payload.instructor_id,
                "vehiculo_id": payload.vehiculo_id,
            }
        )
        datos["clases_agendadas"] = agendadas
        estudiante.datos_adicionales = datos

    db.commit()
    db.refresh(clase)
    enviar_correo_clase_programada(clase=clase, tenant=current_tenant)
    return _build_clase_response(clase)


@router.put("/{clase_id}/completar", response_model=ClaseResponse)
def completar_clase(
    clase_id: int,
    payload: ClaseComplete,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    _check_role(current_user)

    clase = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Clase.id == clase_id,
            Estudiante.tenant_id == current_tenant.id,
        )
        .first()
    )
    if not clase:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    if clase.estado == EstadoClase.CANCELADA:
        raise HTTPException(status_code=400, detail="No se puede completar una clase cancelada")
    if clase.estado == EstadoClase.COMPLETADA:
        raise HTTPException(status_code=400, detail="La clase ya estaba completada")

    clase.estado = EstadoClase.COMPLETADA
    clase.fecha_completada = datetime.utcnow()

    estudiante = clase.estudiante
    if payload.acreditar_horas and estudiante:
        if clase.tipo == TipoClase.TEORICA:
            nuevo = int(estudiante.horas_teoricas_completadas or 0) + int(clase.duracion_horas or 0)
            if estudiante.horas_teoricas_requeridas:
                nuevo = min(nuevo, estudiante.horas_teoricas_requeridas)
            estudiante.horas_teoricas_completadas = nuevo
        else:
            nuevo = int(estudiante.horas_practicas_completadas or 0) + int(clase.duracion_horas or 0)
            if estudiante.horas_practicas_requeridas:
                nuevo = min(nuevo, estudiante.horas_practicas_requeridas)
            estudiante.horas_practicas_completadas = nuevo

        datos = dict(estudiante.datos_adicionales or {})
        historial = list(datos.get("clases_historial", []))
        servicio_activo_id = datos.get("servicio_activo_id")
        historial.append(
            {
                "fecha": (clase.fecha_completada or datetime.utcnow()).isoformat(),
                "tipo": clase.tipo.value,
                "horas": clase.duracion_horas,
                "observaciones": payload.observaciones,
                "usuario_id": current_user.id,
                "servicio_id": servicio_activo_id,
                "instructor_id": clase.instructor_id,
                "instructor_nombre": (
                    clase.instructor.usuario.nombre_completo
                    if clase.instructor and clase.instructor.usuario
                    else None
                ),
                "vehiculo_id": clase.vehiculo_id,
                "vehiculo_label": (
                    f"{clase.vehiculo.placa} - {clase.vehiculo.marca} {clase.vehiculo.modelo}"
                    if clase.vehiculo
                    else None
                ),
            }
        )
        datos["clases_historial"] = historial

        if servicio_activo_id is not None:
            servicios = list(datos.get("servicios", []))
            for s in servicios:
                if s.get("id") == servicio_activo_id:
                    s["horas_teoricas_completadas"] = estudiante.horas_teoricas_completadas
                    s["horas_practicas_completadas"] = estudiante.horas_practicas_completadas
                    s["horas_teoricas_requeridas"] = estudiante.horas_teoricas_requeridas
                    s["horas_practicas_requeridas"] = estudiante.horas_practicas_requeridas
                    s["estado"] = "ACTIVO"
                    break
            datos["servicios"] = servicios

        estudiante.datos_adicionales = datos

        if estudiante.esta_listo_para_examen:
            estudiante.estado = EstadoEstudiante.LISTO_EXAMEN

    db.commit()
    db.refresh(clase)
    return _build_clase_response(clase)


@router.put("/{clase_id}/cancelar", response_model=ClaseResponse)
def cancelar_clase(
    clase_id: int,
    payload: ClaseCancel,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    _check_role(current_user)

    clase = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Clase.id == clase_id,
            Estudiante.tenant_id == current_tenant.id,
        )
        .first()
    )
    if not clase:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    if clase.estado == EstadoClase.COMPLETADA:
        raise HTTPException(status_code=400, detail="No se puede cancelar una clase completada")

    clase.estado = EstadoClase.CANCELADA

    if payload.motivo and clase.estudiante:
        datos = dict(clase.estudiante.datos_adicionales or {})
        canceladas = list(datos.get("clases_canceladas", []))
        canceladas.append(
            {
                "clase_id": clase.id,
                "fecha_programada": clase.fecha_programada.isoformat() if clase.fecha_programada else None,
                "motivo": payload.motivo,
                "cancelado_por_id": current_user.id,
                "cancelado_por": current_user.nombre_completo,
                "fecha_cancelacion": datetime.utcnow().isoformat(),
            }
        )
        datos["clases_canceladas"] = canceladas
        clase.estudiante.datos_adicionales = datos

    db.commit()
    db.refresh(clase)
    return _build_clase_response(clase)


@router.put("/{clase_id}/reprogramar", response_model=ClaseResponse)
def reprogramar_clase(
    clase_id: int,
    payload: ClaseReschedule,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    _check_role(current_user)
    fecha_reprogramada = _to_naive_utc(payload.fecha_programada)

    clase = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Clase.id == clase_id,
            Estudiante.tenant_id == current_tenant.id,
        )
        .first()
    )
    if not clase:
        raise HTTPException(status_code=404, detail="Clase no encontrada")
    if clase.estado != EstadoClase.PROGRAMADA:
        raise HTTPException(status_code=400, detail="Solo se pueden reprogramar clases en estado PROGRAMADA")
    instructor_id_final = payload.instructor_id or clase.instructor_id
    if not instructor_id_final:
        raise HTTPException(status_code=400, detail="La clase debe tener instructor asignado")
    instructor = db.query(Instructor).filter(
        Instructor.id == instructor_id_final,
        Instructor.tenant_id == current_tenant.id,
        Instructor.estado == EstadoInstructor.ACTIVO,
    ).first()
    if not instructor:
        raise HTTPException(status_code=404, detail="Instructor no encontrado o inactivo")

    vehiculo_id_final = payload.vehiculo_id if payload.vehiculo_id is not None else clase.vehiculo_id
    if clase.tipo == TipoClase.PRACTICA:
        if not vehiculo_id_final:
            raise HTTPException(status_code=400, detail="Debe seleccionar vehículo para clase práctica")
        vehiculo = db.query(Vehiculo).filter(
            Vehiculo.id == vehiculo_id_final,
            Vehiculo.tenant_id == current_tenant.id,
            Vehiculo.is_active == 1,
        ).first()
        if not vehiculo:
            raise HTTPException(status_code=404, detail="Vehículo no encontrado o inactivo")
    elif vehiculo_id_final is not None:
        vehiculo = db.query(Vehiculo).filter(
            Vehiculo.id == vehiculo_id_final,
            Vehiculo.tenant_id == current_tenant.id,
        ).first()
        if not vehiculo:
            raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    nueva_duracion = int(payload.duracion_horas or clase.duracion_horas or 1)
    _validate_conflicts(
        db=db,
        tenant_id=current_tenant.id,
        fecha_programada=fecha_reprogramada,
        duracion_horas=nueva_duracion,
        instructor_id=int(instructor_id_final),
        vehiculo_id=vehiculo_id_final,
        exclude_clase_id=clase.id,
    )

    fecha_anterior = clase.fecha_programada
    instructor_anterior_id = clase.instructor_id
    vehiculo_anterior_id = clase.vehiculo_id
    clase.fecha_programada = fecha_reprogramada
    clase.duracion_horas = nueva_duracion
    clase.instructor_id = instructor_id_final
    clase.vehiculo_id = vehiculo_id_final
    clase.reminder_24h_sent_at = None
    clase.reminder_2h_sent_at = None

    if payload.observaciones and clase.estudiante:
        datos = dict(clase.estudiante.datos_adicionales or {})
        reprogramadas = list(datos.get("clases_reprogramadas", []))
        reprogramadas.append(
            {
                "clase_id": clase.id,
                "fecha_anterior": fecha_anterior.isoformat() if fecha_anterior else None,
                "fecha_nueva": fecha_reprogramada.isoformat(),
                "duracion_horas": nueva_duracion,
                "instructor_anterior_id": instructor_anterior_id,
                "instructor_nuevo_id": instructor_id_final,
                "vehiculo_anterior_id": vehiculo_anterior_id,
                "vehiculo_nuevo_id": vehiculo_id_final,
                "observaciones": payload.observaciones,
                "reprogramado_por_id": current_user.id,
                "reprogramado_por": current_user.nombre_completo,
                "fecha_reprogramacion": datetime.utcnow().isoformat(),
            }
        )
        datos["clases_reprogramadas"] = reprogramadas
        clase.estudiante.datos_adicionales = datos

    db.commit()
    db.refresh(clase)
    enviar_correo_clase_reprogramada(clase=clase, tenant=current_tenant, fecha_anterior=fecha_anterior)
    return _build_clase_response(clase)


@router.post("/recordatorios/ejecutar")
def ejecutar_recordatorios_clases(
    window_minutes: int = Query(10, ge=1, le=120),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    if current_user.rol not in [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.COORDINADOR]:
        raise HTTPException(status_code=403, detail="No tiene permisos para ejecutar recordatorios")
    return procesar_recordatorios_clases(db=db, window_minutes=window_minutes)

