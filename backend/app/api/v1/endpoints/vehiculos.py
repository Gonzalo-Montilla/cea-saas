from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_, asc, desc
from typing import Optional, List
from datetime import datetime
import base64

from app.core.database import get_db
from app.api.deps import get_admin_or_coordinador, get_required_tenant
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.clase import (
    Vehiculo,
    Instructor,
    EstadoInstructor,
    MantenimientoVehiculo,
    RepuestoMantenimiento,
    CombustibleVehiculo,
    AdjuntoMantenimientoVehiculo,
    AdjuntoCombustibleVehiculo,
    VehiculoConsumoUmbral
)
from app.schemas.vehiculo import (
    VehiculoCreate,
    VehiculoUpdate,
    VehiculoResponse,
    VehiculosListResponse,
    MantenimientoCreate,
    MantenimientoUpdate,
    MantenimientoResponse,
    MantenimientosListResponse,
    RepuestoCreate,
    RepuestoResponse,
    CombustibleCreate,
    CombustibleResponse,
    CombustiblesListResponse,
    AdjuntoResponse,
    ConsumoUmbralCreate,
    ConsumoUmbralUpdate,
    ConsumoUmbralResponse,
    ConsumoResumenResponse,
    ExportHojaVidaResponse
)

router = APIRouter()


@router.get("/", response_model=VehiculosListResponse)
def listar_vehiculos(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    activo: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Listar vehículos con paginación y filtros.
    """
    query = db.query(Vehiculo).filter(Vehiculo.tenant_id == current_tenant.id)

    if activo is not None:
        query = query.filter(Vehiculo.is_active == (1 if activo else 0))

    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Vehiculo.placa.ilike(search_term),
                Vehiculo.marca.ilike(search_term),
                Vehiculo.modelo.ilike(search_term),
                Vehiculo.tipo.ilike(search_term)
            )
        )

    total = query.count()
    items = query.order_by(Vehiculo.placa.asc()).offset(skip).limit(limit).all()

    return VehiculosListResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit
    )


@router.post("/", response_model=VehiculoResponse, status_code=status.HTTP_201_CREATED)
def crear_vehiculo(
    vehiculo_data: VehiculoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Crear un vehículo.
    """
    existente = db.query(Vehiculo).filter(
        Vehiculo.placa == vehiculo_data.placa,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if existente:
        raise HTTPException(status_code=400, detail="Ya existe un vehículo con esa placa")

    responsable_id = vehiculo_data.responsable_instructor_id
    if responsable_id:
        instructor = db.query(Instructor).filter(
            Instructor.id == responsable_id,
            Instructor.estado == EstadoInstructor.ACTIVO,
            Instructor.tenant_id == current_tenant.id,
        ).first()
        if not instructor:
            raise HTTPException(status_code=400, detail="El instructor responsable no es válido o no está activo")

    nuevo = Vehiculo(
        tenant_id=current_tenant.id,
        placa=vehiculo_data.placa,
        tipo=vehiculo_data.tipo,
        marca=vehiculo_data.marca,
        modelo=vehiculo_data.modelo,
        año=vehiculo_data.año,
        color=vehiculo_data.color,
        cilindraje=vehiculo_data.cilindraje,
        vin=vehiculo_data.vin,
        foto_url=vehiculo_data.foto_url,
        kilometraje_actual=vehiculo_data.kilometraje_actual,
        responsable_instructor_id=responsable_id,
        is_active=1
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo


@router.put("/{vehiculo_id}", response_model=VehiculoResponse)
def actualizar_vehiculo(
    vehiculo_id: int,
    vehiculo_data: VehiculoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Actualizar un vehículo.
    """
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    if vehiculo_data.placa and vehiculo_data.placa != vehiculo.placa:
        existente = db.query(Vehiculo).filter(
            Vehiculo.placa == vehiculo_data.placa,
            Vehiculo.tenant_id == current_tenant.id,
        ).first()
        if existente:
            raise HTTPException(status_code=400, detail="Ya existe un vehículo con esa placa")

    update_data = vehiculo_data.model_dump(exclude_unset=True)
    if 'is_active' in update_data:
        update_data['is_active'] = 1 if update_data['is_active'] else 0

    if 'responsable_instructor_id' in update_data:
        responsable_id = update_data.get('responsable_instructor_id')
        if responsable_id:
            instructor = db.query(Instructor).filter(
                Instructor.id == responsable_id,
                Instructor.estado == EstadoInstructor.ACTIVO,
                Instructor.tenant_id == current_tenant.id,
            ).first()
            if not instructor:
                raise HTTPException(status_code=400, detail="El instructor responsable no es válido o no está activo")

    for field, value in update_data.items():
        setattr(vehiculo, field, value)

    db.commit()
    db.refresh(vehiculo)
    return vehiculo


@router.delete("/{vehiculo_id}", status_code=status.HTTP_204_NO_CONTENT)
def desactivar_vehiculo(
    vehiculo_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Desactivar un vehículo (soft delete).
    """
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    vehiculo.is_active = 0
    db.commit()
    return None


@router.get("/{vehiculo_id}", response_model=VehiculoResponse)
def obtener_vehiculo(
    vehiculo_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    return vehiculo


@router.get("/{vehiculo_id}/mantenimientos", response_model=MantenimientosListResponse)
def listar_mantenimientos(
    vehiculo_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    orden: Optional[str] = "desc",
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    query = db.query(MantenimientoVehiculo).filter(
        MantenimientoVehiculo.vehiculo_id == vehiculo_id
    )
    if fecha_inicio:
        query = query.filter(MantenimientoVehiculo.fecha >= fecha_inicio)
    if fecha_fin:
        query = query.filter(MantenimientoVehiculo.fecha <= fecha_fin)
    total = query.count()
    order_fn = asc if (orden or "").lower() == "asc" else desc
    items = query.order_by(order_fn(MantenimientoVehiculo.fecha)).offset(skip).limit(limit).all()
    return MantenimientosListResponse(items=items, total=total, skip=skip, limit=limit)


@router.post("/{vehiculo_id}/mantenimientos", response_model=MantenimientoResponse, status_code=status.HTTP_201_CREATED)
def crear_mantenimiento(
    vehiculo_id: int,
    mantenimiento_data: MantenimientoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    mantenimiento = MantenimientoVehiculo(
        vehiculo_id=vehiculo_id,
        tipo=mantenimiento_data.tipo or "FALLA",
        descripcion_falla=mantenimiento_data.descripcion_falla,
        diagnostico=mantenimiento_data.diagnostico,
        reparacion_requerida=mantenimiento_data.reparacion_requerida,
        estado=mantenimiento_data.estado or "ABIERTO",
        km_registro=mantenimiento_data.km_registro,
        costo_total=mantenimiento_data.costo_total or 0,
        taller=mantenimiento_data.taller,
        observaciones=mantenimiento_data.observaciones
    )
    db.add(mantenimiento)

    # Si es una falla abierta, marcar vehículo como inactivo
    if (mantenimiento.estado or "").upper() in ["ABIERTO", "EN_PROCESO"] and mantenimiento.tipo == "FALLA":
        vehiculo.is_active = 0

    db.commit()
    db.refresh(mantenimiento)
    return mantenimiento


@router.put("/{vehiculo_id}/mantenimientos/{mantenimiento_id}", response_model=MantenimientoResponse)
def actualizar_mantenimiento(
    vehiculo_id: int,
    mantenimiento_id: int,
    mantenimiento_data: MantenimientoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    mantenimiento = db.query(MantenimientoVehiculo).filter(
        MantenimientoVehiculo.id == mantenimiento_id,
        MantenimientoVehiculo.vehiculo_id == vehiculo_id
    ).first()
    if not mantenimiento:
        raise HTTPException(status_code=404, detail="Mantenimiento no encontrado")

    update_data = mantenimiento_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(mantenimiento, field, value)

    # Si se cierra mantenimiento de falla, reactivar vehículo
    if (mantenimiento.estado or "").upper() == "CERRADO" and (mantenimiento.tipo or "").upper() == "FALLA":
        vehiculo.is_active = 1

    db.commit()
    db.refresh(mantenimiento)
    return mantenimiento


@router.post("/{vehiculo_id}/mantenimientos/{mantenimiento_id}/repuestos", response_model=RepuestoResponse, status_code=status.HTTP_201_CREATED)
def agregar_repuesto(
    vehiculo_id: int,
    mantenimiento_id: int,
    repuesto_data: RepuestoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    mantenimiento = db.query(MantenimientoVehiculo).filter(
        MantenimientoVehiculo.id == mantenimiento_id,
        MantenimientoVehiculo.vehiculo_id == vehiculo_id
    ).first()
    if not mantenimiento:
        raise HTTPException(status_code=404, detail="Mantenimiento no encontrado")

    repuesto = RepuestoMantenimiento(
        mantenimiento_id=mantenimiento_id,
        nombre=repuesto_data.nombre,
        cantidad=repuesto_data.cantidad,
        costo_unitario=repuesto_data.costo_unitario,
        proveedor=repuesto_data.proveedor
    )
    db.add(repuesto)
    db.commit()
    db.refresh(repuesto)
    return repuesto


@router.get("/{vehiculo_id}/combustible", response_model=CombustiblesListResponse)
def listar_combustible(
    vehiculo_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    conductor: Optional[str] = None,
    orden: Optional[str] = "desc",
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    query = db.query(CombustibleVehiculo).filter(
        CombustibleVehiculo.vehiculo_id == vehiculo_id
    )
    if fecha_inicio:
        query = query.filter(CombustibleVehiculo.fecha >= fecha_inicio)
    if fecha_fin:
        query = query.filter(CombustibleVehiculo.fecha <= fecha_fin)
    if conductor:
        query = query.filter(CombustibleVehiculo.conductor.ilike(f"%{conductor.strip()}%"))
    total = query.count()
    order_fn = asc if (orden or "").lower() == "asc" else desc
    items = query.order_by(order_fn(CombustibleVehiculo.fecha)).offset(skip).limit(limit).all()
    return CombustiblesListResponse(items=items, total=total, skip=skip, limit=limit)


@router.post("/{vehiculo_id}/mantenimientos/{mantenimiento_id}/adjuntos", response_model=List[AdjuntoResponse], status_code=status.HTTP_201_CREATED)
async def agregar_adjuntos_mantenimiento(
    vehiculo_id: int,
    mantenimiento_id: int,
    archivos: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    mantenimiento = db.query(MantenimientoVehiculo).filter(
        MantenimientoVehiculo.id == mantenimiento_id,
        MantenimientoVehiculo.vehiculo_id == vehiculo_id
    ).first()
    if not mantenimiento:
        raise HTTPException(status_code=404, detail="Mantenimiento no encontrado")

    adjuntos = []
    for archivo in archivos:
        contenido = await archivo.read()
        mime = archivo.content_type or "application/octet-stream"
        data_base64 = base64.b64encode(contenido).decode('utf-8')
        data_uri = f"data:{mime};base64,{data_base64}"
        adjunto = AdjuntoMantenimientoVehiculo(
            mantenimiento_id=mantenimiento_id,
            archivo_url=data_uri,
            nombre_archivo=archivo.filename,
            mime=mime
        )
        db.add(adjunto)
        adjuntos.append(adjunto)

    db.commit()
    for adjunto in adjuntos:
        db.refresh(adjunto)
    return adjuntos


@router.post("/{vehiculo_id}/combustible/{combustible_id}/adjuntos", response_model=List[AdjuntoResponse], status_code=status.HTTP_201_CREATED)
async def agregar_adjuntos_combustible(
    vehiculo_id: int,
    combustible_id: int,
    archivos: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    combustible = db.query(CombustibleVehiculo).filter(
        CombustibleVehiculo.id == combustible_id,
        CombustibleVehiculo.vehiculo_id == vehiculo_id
    ).first()
    if not combustible:
        raise HTTPException(status_code=404, detail="Registro de combustible no encontrado")

    adjuntos = []
    for archivo in archivos:
        contenido = await archivo.read()
        mime = archivo.content_type or "application/octet-stream"
        data_base64 = base64.b64encode(contenido).decode('utf-8')
        data_uri = f"data:{mime};base64,{data_base64}"
        adjunto = AdjuntoCombustibleVehiculo(
            combustible_id=combustible_id,
            archivo_url=data_uri,
            nombre_archivo=archivo.filename,
            mime=mime
        )
        db.add(adjunto)
        adjuntos.append(adjunto)

    db.commit()
    for adjunto in adjuntos:
        db.refresh(adjunto)
    return adjuntos


@router.get("/consumo-umbrales", response_model=List[ConsumoUmbralResponse])
def listar_consumo_umbrales(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador)
):
    return db.query(VehiculoConsumoUmbral).order_by(VehiculoConsumoUmbral.tipo.asc()).all()


@router.get("/consumo-umbrales/{tipo}", response_model=Optional[ConsumoUmbralResponse])
def obtener_consumo_umbral(
    tipo: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador)
):
    umbral = db.query(VehiculoConsumoUmbral).filter(VehiculoConsumoUmbral.tipo == tipo).first()
    return umbral


@router.put("/consumo-umbrales/{tipo}", response_model=ConsumoUmbralResponse)
def upsert_consumo_umbral(
    tipo: str,
    payload: ConsumoUmbralUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador)
):
    umbral = db.query(VehiculoConsumoUmbral).filter(VehiculoConsumoUmbral.tipo == tipo).first()
    if umbral:
        umbral.km_por_galon_min = payload.km_por_galon_min
    else:
        umbral = VehiculoConsumoUmbral(tipo=tipo, km_por_galon_min=payload.km_por_galon_min)
        db.add(umbral)
    db.commit()
    db.refresh(umbral)
    return umbral


@router.get("/{vehiculo_id}/combustible/resumen", response_model=ConsumoResumenResponse)
def resumen_combustible(
    vehiculo_id: int,
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    conductor: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    query = db.query(CombustibleVehiculo).filter(CombustibleVehiculo.vehiculo_id == vehiculo_id)
    if fecha_inicio:
        query = query.filter(CombustibleVehiculo.fecha >= fecha_inicio)
    if fecha_fin:
        query = query.filter(CombustibleVehiculo.fecha <= fecha_fin)
    if conductor:
        query = query.filter(CombustibleVehiculo.conductor.ilike(f"%{conductor.strip()}%"))

    registros = query.all()
    total_km = 0.0
    total_galones = 0.0
    costo_total = 0.0
    faltan_km_final = 0
    for r in registros:
        if r.km_final is None:
            faltan_km_final += 1
            continue
        if r.litros is None or r.litros == 0:
            continue
        total_km += float(r.km_final - r.km_inicial)
        total_galones += float(r.litros)
        costo_total += float(r.costo or 0)

    consumo_promedio = (total_km / total_galones) if total_galones > 0 else 0.0
    costo_por_km = (costo_total / total_km) if total_km > 0 else 0.0

    umbral = None
    alerta_bajo_consumo = False
    if vehiculo.tipo:
        umbral = db.query(VehiculoConsumoUmbral).filter(VehiculoConsumoUmbral.tipo == vehiculo.tipo).first()
        if umbral and consumo_promedio > 0 and consumo_promedio < float(umbral.km_por_galon_min):
            alerta_bajo_consumo = True

    return ConsumoResumenResponse(
        vehiculo_id=vehiculo_id,
        registros=len(registros),
        total_km=total_km,
        total_galones=total_galones,
        consumo_promedio=consumo_promedio,
        costo_total=costo_total,
        costo_por_km=costo_por_km,
        faltan_km_final=faltan_km_final,
        umbral_km_por_galon_min=float(umbral.km_por_galon_min) if umbral else None,
        alerta_bajo_consumo=alerta_bajo_consumo
    )


@router.get("/{vehiculo_id}/export-data", response_model=ExportHojaVidaResponse)
def exportar_hoja_vida(
    vehiculo_id: int,
    mant_fecha_inicio: Optional[datetime] = None,
    mant_fecha_fin: Optional[datetime] = None,
    comb_fecha_inicio: Optional[datetime] = None,
    comb_fecha_fin: Optional[datetime] = None,
    comb_conductor: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    mant_query = db.query(MantenimientoVehiculo).filter(MantenimientoVehiculo.vehiculo_id == vehiculo_id)
    if mant_fecha_inicio:
        mant_query = mant_query.filter(MantenimientoVehiculo.fecha >= mant_fecha_inicio)
    if mant_fecha_fin:
        mant_query = mant_query.filter(MantenimientoVehiculo.fecha <= mant_fecha_fin)
    mantenimientos = mant_query.order_by(MantenimientoVehiculo.fecha.desc()).all()

    comb_query = db.query(CombustibleVehiculo).filter(CombustibleVehiculo.vehiculo_id == vehiculo_id)
    if comb_fecha_inicio:
        comb_query = comb_query.filter(CombustibleVehiculo.fecha >= comb_fecha_inicio)
    if comb_fecha_fin:
        comb_query = comb_query.filter(CombustibleVehiculo.fecha <= comb_fecha_fin)
    if comb_conductor:
        comb_query = comb_query.filter(CombustibleVehiculo.conductor.ilike(f"%{comb_conductor.strip()}%"))
    combustibles = comb_query.order_by(CombustibleVehiculo.fecha.desc()).all()

    total_km = 0.0
    total_galones = 0.0
    costo_total = 0.0
    faltan_km_final = 0
    for r in combustibles:
        if r.km_final is None:
            faltan_km_final += 1
            continue
        if r.litros is None or r.litros == 0:
            continue
        total_km += float(r.km_final - r.km_inicial)
        total_galones += float(r.litros)
        costo_total += float(r.costo or 0)

    consumo_promedio = (total_km / total_galones) if total_galones > 0 else 0.0
    costo_por_km = (costo_total / total_km) if total_km > 0 else 0.0

    umbral = None
    alerta_bajo_consumo = False
    if vehiculo.tipo:
        umbral = db.query(VehiculoConsumoUmbral).filter(VehiculoConsumoUmbral.tipo == vehiculo.tipo).first()
        if umbral and consumo_promedio > 0 and consumo_promedio < float(umbral.km_por_galon_min):
            alerta_bajo_consumo = True

    resumen = ConsumoResumenResponse(
        vehiculo_id=vehiculo_id,
        registros=len(combustibles),
        total_km=total_km,
        total_galones=total_galones,
        consumo_promedio=consumo_promedio,
        costo_total=costo_total,
        costo_por_km=costo_por_km,
        faltan_km_final=faltan_km_final,
        umbral_km_por_galon_min=float(umbral.km_por_galon_min) if umbral else None,
        alerta_bajo_consumo=alerta_bajo_consumo
    )

    return ExportHojaVidaResponse(
        vehiculo=vehiculo,
        mantenimientos=mantenimientos,
        combustibles=combustibles,
        resumen=resumen
    )


@router.post("/{vehiculo_id}/combustible", response_model=CombustibleResponse, status_code=status.HTTP_201_CREATED)
def registrar_combustible(
    vehiculo_id: int,
    combustible_data: CombustibleCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.tenant_id == current_tenant.id,
    ).first()
    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    registro = CombustibleVehiculo(
        vehiculo_id=vehiculo_id,
        fecha=combustible_data.fecha or datetime.utcnow(),
        km_inicial=combustible_data.km_inicial,
        km_final=combustible_data.km_final,
        nivel_inicial=combustible_data.nivel_inicial,
        nivel_final=combustible_data.nivel_final,
        litros=combustible_data.litros,
        costo=combustible_data.costo,
        recibo_url=combustible_data.recibo_url,
        conductor=combustible_data.conductor,
        observaciones=combustible_data.observaciones
    )
    db.add(registro)

    # Actualizar kilometraje actual si aporta km_final
    if combustible_data.km_final and (vehiculo.kilometraje_actual is None or combustible_data.km_final > vehiculo.kilometraje_actual):
        vehiculo.kilometraje_actual = combustible_data.km_final

    db.commit()
    db.refresh(registro)
    return registro
