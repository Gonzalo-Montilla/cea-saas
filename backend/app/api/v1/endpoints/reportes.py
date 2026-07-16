from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract, cast, Date, or_, String, case
from typing import Optional
from datetime import datetime, timedelta, date
from decimal import Decimal

from app.core.database import get_db
from app.api.deps import get_current_active_user, get_required_tenant
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.caja import Caja, MovimientoCaja, EstadoCaja, ConceptoMovimientoCaja, TipoMovimiento
from app.models.pago import Pago, DetallePago, MetodoPago, EstadoPago
from app.models.compromiso_pago import CompromisoPago, CuotaPago, EstadoCuota
from app.models.estudiante import Estudiante, EstadoEstudiante
from app.models.clase import MantenimientoVehiculo, Vehiculo, Instructor, Clase, EstadoClase
from app.schemas.reportes import (
    DashboardEjecutivo, KPIDashboard, KPIMetrica,
    GraficoEvolucionIngresos, GraficoMetodosPago,
    GraficoEstudiantesCategorias, GraficoEgresos,
    DatoPunto, DatoCategoria,
    EstudianteRegistrado, EstudiantePago, EgresoCajaItem, MovimientoCajaItem, ReferidoRanking,
    AlertasOperativas, AlertasVencimientosResponse,
    AlertaDocumentoVehiculo, AlertaDocumentoInstructor, AlertaPin, AlertaPagoVencido, AlertaCompromiso,
    CierreFinancieroResponse, CierreCajaItem
)

router = APIRouter()


# ==================== DASHBOARD EJECUTIVO ====================

@router.get("/dashboard", response_model=DashboardEjecutivo)
def get_dashboard_ejecutivo(
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    comparar_periodo_anterior: bool = False,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Dashboard ejecutivo con KPIs y gráficos principales
    """
    # Si no se especifican fechas, usar mes actual
    if not fecha_fin:
        fecha_fin = datetime.utcnow()
    if not fecha_inicio:
        fecha_inicio = fecha_fin.replace(day=1)
    
    # Convertir a fechas locales (sin hora) para comparar
    fecha_inicio_date = fecha_inicio.date()
    fecha_fin_date = fecha_fin.date()
    
    
    # Calcular KPIs
    kpis = _calcular_kpis(db, fecha_inicio_date, fecha_fin_date, comparar_periodo_anterior, current_tenant.id)
    
    # Gráfico de evolución de ingresos (período seleccionado)
    grafico_ingresos = _grafico_evolucion_ingresos(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    
    # Gráfico de métodos de pago (período actual)
    grafico_metodos = _grafico_metodos_pago(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    
    # Gráfico de estudiantes por categoría
    grafico_estudiantes = _grafico_estudiantes_categorias(db, current_tenant.id)
    
    # Gráfico de egresos por categoría (período actual)
    grafico_egresos = _grafico_egresos_categoria(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    
    # Ranking de referidos
    ranking_referidos = _ranking_referidos(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    
    # Listas de estudiantes
    lista_registrados = _lista_estudiantes_registrados(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    lista_pagos = _lista_estudiantes_pagos(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    lista_egresos = _lista_egresos_caja(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    lista_otros = _lista_otros_movimientos(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
    
    return DashboardEjecutivo(
        kpis=kpis,
        grafico_ingresos=grafico_ingresos,
        grafico_metodos_pago=grafico_metodos,
        grafico_estudiantes=grafico_estudiantes,
        grafico_egresos=grafico_egresos,
        ranking_referidos=ranking_referidos,
        lista_estudiantes_registrados=lista_registrados,
        lista_estudiantes_pagos=lista_pagos,
        lista_egresos_caja=lista_egresos,
        lista_otros_movimientos=lista_otros,
        fecha_generacion=datetime.utcnow(),
        periodo_inicio=fecha_inicio,
        periodo_fin=fecha_fin
    )


@router.get("/alertas-operativas", response_model=AlertasOperativas)
def get_alertas_operativas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    ahora = datetime.utcnow()

    caja = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).order_by(Caja.fecha_apertura.desc()).first()
    caja_abierta = bool(caja)
    caja_abierta_horas = None
    if caja and caja.fecha_apertura:
        caja_abierta_horas = round((ahora - caja.fecha_apertura).total_seconds() / 3600, 1)

    pagos_vencidos_query = db.query(Pago).filter(
        Pago.tenant_id == current_tenant.id,
        Pago.estado == EstadoPago.PENDIENTE,
        Pago.fecha_vencimiento.isnot(None),
        Pago.fecha_vencimiento < ahora
    )
    pagos_vencidos_cantidad = pagos_vencidos_query.count()
    pagos_vencidos_total = pagos_vencidos_query.with_entities(func.sum(Pago.monto)).scalar() or Decimal('0')

    ventana_fin = ahora + timedelta(days=7)
    compromisos_query = db.query(CuotaPago).join(
        CompromisoPago, CuotaPago.compromiso_id == CompromisoPago.id
    ).join(
        Estudiante, CompromisoPago.estudiante_id == Estudiante.id
    ).filter(
        Estudiante.tenant_id == current_tenant.id,
        CuotaPago.estado.in_([EstadoCuota.PENDIENTE, EstadoCuota.PARCIAL]),
        CuotaPago.fecha_vencimiento >= ahora,
        CuotaPago.fecha_vencimiento <= ventana_fin
    )
    compromisos_por_vencer_cantidad = compromisos_query.count()
    compromisos_por_vencer_total = compromisos_query.with_entities(func.sum(CuotaPago.saldo_cuota)).scalar() or Decimal('0')

    pin_por_vencer_cantidad = 0
    pin_limite = ahora + timedelta(days=90)
    estudiantes_pin = db.query(Estudiante).filter(
        Estudiante.tenant_id == current_tenant.id,
        Estudiante.sicov_pin.isnot(None),
    ).all()
    for est in estudiantes_pin:
        fecha_pin = _parse_pin_vencimiento(est)
        if fecha_pin and ahora <= fecha_pin <= pin_limite:
            pin_por_vencer_cantidad += 1

    fallas_abiertas_cantidad = db.query(MantenimientoVehiculo).filter(
        MantenimientoVehiculo.vehiculo.has(
            Vehiculo.responsable_instructor.has(
                Instructor.usuario.has(Usuario.tenant_id == current_tenant.id)
            )
        ),
        MantenimientoVehiculo.tipo == "FALLA",
        MantenimientoVehiculo.estado.in_(["ABIERTO", "EN_PROCESO"])
    ).count()

    estudiantes_listos_examen_cantidad = db.query(Estudiante).filter(
        Estudiante.tenant_id == current_tenant.id,
        Estudiante.estado == EstadoEstudiante.LISTO_EXAMEN
    ).count()

    return AlertasOperativas(
        caja_abierta=caja_abierta,
        caja_id=caja.id if caja else None,
        caja_abierta_horas=caja_abierta_horas,
        pagos_vencidos_cantidad=pagos_vencidos_cantidad,
        pagos_vencidos_total=pagos_vencidos_total,
        compromisos_por_vencer_cantidad=compromisos_por_vencer_cantidad,
        compromisos_por_vencer_total=compromisos_por_vencer_total,
        pin_por_vencer_cantidad=pin_por_vencer_cantidad,
        fallas_abiertas_cantidad=fallas_abiertas_cantidad,
        estudiantes_listos_examen_cantidad=estudiantes_listos_examen_cantidad
    )


@router.get("/alertas-vencimientos", response_model=AlertasVencimientosResponse)
def get_alertas_vencimientos(
    dias: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    ahora = datetime.utcnow()
    fin = ahora + timedelta(days=dias)
    fin_date = fin.date()

    documentos = []
    vehiculos = db.query(Vehiculo).filter(
        Vehiculo.responsable_instructor.has(
            Instructor.usuario.has(Usuario.tenant_id == current_tenant.id)
        )
    ).all()
    for v in vehiculos:
        if v.soat_vencimiento and v.soat_vencimiento <= fin_date:
            documentos.append(AlertaDocumentoVehiculo(
                vehiculo_id=v.id,
                placa=v.placa,
                documento="SOAT",
                fecha_vencimiento=datetime.combine(v.soat_vencimiento, datetime.min.time()),
                dias_restantes=(v.soat_vencimiento - ahora.date()).days
            ))
        if v.rtm_vencimiento and v.rtm_vencimiento <= fin_date:
            documentos.append(AlertaDocumentoVehiculo(
                vehiculo_id=v.id,
                placa=v.placa,
                documento="RTM",
                fecha_vencimiento=datetime.combine(v.rtm_vencimiento, datetime.min.time()),
                dias_restantes=(v.rtm_vencimiento - ahora.date()).days
            ))
        if v.tecnomecanica_vencimiento and v.tecnomecanica_vencimiento <= fin_date:
            documentos.append(AlertaDocumentoVehiculo(
                vehiculo_id=v.id,
                placa=v.placa,
                documento="TECNOMECANICA",
                fecha_vencimiento=datetime.combine(v.tecnomecanica_vencimiento, datetime.min.time()),
                dias_restantes=(v.tecnomecanica_vencimiento - ahora.date()).days
            ))
        if v.seguro_vencimiento and v.seguro_vencimiento <= fin_date:
            documentos.append(AlertaDocumentoVehiculo(
                vehiculo_id=v.id,
                placa=v.placa,
                documento="SEGURO",
                fecha_vencimiento=datetime.combine(v.seguro_vencimiento, datetime.min.time()),
                dias_restantes=(v.seguro_vencimiento - ahora.date()).days
            ))

    pins = []
    estudiantes = db.query(Estudiante).filter(Estudiante.tenant_id == current_tenant.id).all()
    for est in estudiantes:
        fecha_pin = _parse_pin_vencimiento(est)
        if fecha_pin and fecha_pin.date() <= fin_date:
            pins.append(AlertaPin(
                estudiante_id=est.id,
                nombre_completo=est.usuario.nombre_completo,
                cedula=est.usuario.cedula,
                fecha_vencimiento=fecha_pin,
                dias_restantes=(fecha_pin.date() - ahora.date()).days
            ))

    pagos_vencidos = []
    pagos = db.query(Pago).filter(
        Pago.tenant_id == current_tenant.id,
        Pago.estado == EstadoPago.PENDIENTE,
        Pago.fecha_vencimiento.isnot(None),
        Pago.fecha_vencimiento < ahora
    ).all()
    for p in pagos:
        pagos_vencidos.append(AlertaPagoVencido(
            pago_id=p.id,
            estudiante_id=p.estudiante_id,
            nombre_completo=p.estudiante.usuario.nombre_completo if p.estudiante and p.estudiante.usuario else "SIN NOMBRE",
            monto=p.monto,
            fecha_vencimiento=p.fecha_vencimiento,
            dias_mora=(ahora.date() - p.fecha_vencimiento.date()).days
        ))

    compromisos = []
    cuotas = db.query(CuotaPago).join(
        CompromisoPago, CuotaPago.compromiso_id == CompromisoPago.id
    ).join(
        Estudiante, CompromisoPago.estudiante_id == Estudiante.id
    ).filter(
        Estudiante.tenant_id == current_tenant.id,
        CuotaPago.estado.in_([EstadoCuota.PENDIENTE, EstadoCuota.PARCIAL]),
        CuotaPago.fecha_vencimiento >= ahora,
        CuotaPago.fecha_vencimiento <= fin
    ).all()
    for c in cuotas:
        compromisos.append(AlertaCompromiso(
            cuota_id=c.id,
            estudiante_id=c.estudiante_id,
            nombre_completo=c.estudiante.usuario.nombre_completo if c.estudiante and c.estudiante.usuario else "SIN NOMBRE",
            saldo_cuota=c.saldo_cuota,
            fecha_vencimiento=c.fecha_vencimiento,
            dias_restantes=(c.fecha_vencimiento.date() - ahora.date()).days
        ))

    documentos_instructor = []
    instructores = db.query(Instructor).join(Usuario).filter(
        Usuario.tenant_id == current_tenant.id
    ).all()
    for inst in instructores:
        nombre = inst.usuario.nombre_completo if inst.usuario else "SIN NOMBRE"
        if inst.licencia_vigencia_hasta and inst.licencia_vigencia_hasta <= fin_date:
            documentos_instructor.append(AlertaDocumentoInstructor(
                instructor_id=inst.id,
                nombre_completo=nombre,
                documento="LICENCIA",
                fecha_vencimiento=datetime.combine(inst.licencia_vigencia_hasta, datetime.min.time()),
                dias_restantes=(inst.licencia_vigencia_hasta - ahora.date()).days
            ))
        if inst.certificado_vigencia_hasta and inst.certificado_vigencia_hasta <= fin_date:
            documentos_instructor.append(AlertaDocumentoInstructor(
                instructor_id=inst.id,
                nombre_completo=nombre,
                documento="CERTIFICADO",
                fecha_vencimiento=datetime.combine(inst.certificado_vigencia_hasta, datetime.min.time()),
                dias_restantes=(inst.certificado_vigencia_hasta - ahora.date()).days
            ))

    return AlertasVencimientosResponse(
        documentos_vehiculo=sorted(documentos, key=lambda d: d.dias_restantes),
        documentos_instructor=sorted(documentos_instructor, key=lambda d: d.dias_restantes),
        pins_por_vencer=sorted(pins, key=lambda p: p.dias_restantes),
        pagos_vencidos=sorted(pagos_vencidos, key=lambda p: p.dias_mora, reverse=True),
        compromisos_por_vencer=sorted(compromisos, key=lambda c: c.dias_restantes)
    )


@router.get("/cierre-financiero", response_model=CierreFinancieroResponse)
def get_cierre_financiero(
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    if not fecha_fin:
        fecha_fin = datetime.utcnow()
    if not fecha_inicio:
        fecha_inicio = fecha_fin.replace(day=1)
    fecha_inicio_date = fecha_inicio.date()
    fecha_fin_date = fecha_fin.date()

    cajas = db.query(Caja).filter(
        Caja.tenant_id == current_tenant.id,
        cast(Caja.fecha_apertura, Date) >= fecha_inicio_date,
        cast(Caja.fecha_apertura, Date) <= fecha_fin_date
    ).all()

    total_ingresos = sum([_ingresos_caja(c) for c in cajas], Decimal('0'))
    total_egresos = sum([_egresos_caja(c) for c in cajas], Decimal('0'))
    total_efectivo = sum([c.total_ingresos_efectivo or Decimal('0') for c in cajas], Decimal('0'))
    total_transferencias = sum([c.total_ingresos_transferencia or Decimal('0') for c in cajas], Decimal('0'))
    total_tarjetas = sum([c.total_ingresos_tarjeta or Decimal('0') for c in cajas], Decimal('0'))
    total_nequi = sum([c.total_nequi or Decimal('0') for c in cajas], Decimal('0'))
    total_daviplata = sum([c.total_daviplata or Decimal('0') for c in cajas], Decimal('0'))
    total_transferencia_bancaria = sum([c.total_transferencia_bancaria or Decimal('0') for c in cajas], Decimal('0'))
    total_tarjeta_debito = sum([c.total_tarjeta_debito or Decimal('0') for c in cajas], Decimal('0'))
    total_tarjeta_credito = sum([c.total_tarjeta_credito or Decimal('0') for c in cajas], Decimal('0'))
    total_credismart = sum([c.total_credismart or Decimal('0') for c in cajas], Decimal('0'))
    total_sistecredito = sum([c.total_sistecredito or Decimal('0') for c in cajas], Decimal('0'))

    total_egresos_efectivo = sum([c.total_egresos_efectivo or Decimal('0') for c in cajas], Decimal('0'))
    saldo_efectivo_teorico = sum([c.saldo_inicial or Decimal('0') for c in cajas], Decimal('0')) + total_efectivo - total_egresos_efectivo

    cajas_response = [
        CierreCajaItem(
            id=c.id,
            fecha_apertura=c.fecha_apertura,
            fecha_cierre=c.fecha_cierre,
            estado=c.estado.value if hasattr(c.estado, "value") else str(c.estado),
            total_ingresos=_ingresos_caja(c),
            total_egresos=_egresos_caja(c),
            diferencia=c.diferencia
        )
        for c in cajas
    ]

    return CierreFinancieroResponse(
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        total_ingresos=total_ingresos,
        total_egresos=total_egresos,
        saldo_efectivo_teorico=saldo_efectivo_teorico,
        total_efectivo=total_efectivo,
        total_transferencias=total_transferencias,
        total_tarjetas=total_tarjetas,
        total_nequi=total_nequi,
        total_daviplata=total_daviplata,
        total_transferencia_bancaria=total_transferencia_bancaria,
        total_tarjeta_debito=total_tarjeta_debito,
        total_tarjeta_credito=total_tarjeta_credito,
        total_credismart=total_credismart,
        total_sistecredito=total_sistecredito,
        cajas=cajas_response
    )


@router.get("/kpis-clases")
def get_kpis_clases(
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    if not fecha_fin:
        fecha_fin = datetime.utcnow()
    if not fecha_inicio:
        fecha_inicio = fecha_fin.replace(day=1)
    fecha_inicio_date = fecha_inicio.date()
    fecha_fin_date = fecha_fin.date()

    clases = (
        db.query(Clase)
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Estudiante.tenant_id == current_tenant.id,
            cast(Clase.fecha_programada, Date) >= fecha_inicio_date,
            cast(Clase.fecha_programada, Date) <= fecha_fin_date,
        )
        .all()
    )

    manual_historial = _obtener_historial_clases_manual(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)

    total_programadas = len([c for c in clases if c.estado == EstadoClase.PROGRAMADA])
    total_completadas = len([c for c in clases if c.estado == EstadoClase.COMPLETADA])
    total_canceladas = len([c for c in clases if c.estado == EstadoClase.CANCELADA])

    # Fallback operativo: si no hay agenda de clases en tabla Clase,
    # usar historial manual de acreditaciones (hoja de vida).
    usar_historial_manual = len(clases) == 0 and len(manual_historial) > 0
    if usar_historial_manual:
        total_completadas = len(manual_historial)
        total_programadas = total_completadas
        total_canceladas = 0

    base_cumplimiento = total_completadas + total_canceladas
    tasa_cumplimiento = (total_completadas / base_cumplimiento * 100) if base_cumplimiento > 0 else 0.0

    productividad: dict[int, dict] = {}
    if usar_historial_manual:
        for item in manual_historial:
            instructor_id = item.get("instructor_id")
            if not instructor_id:
                continue
            if instructor_id not in productividad:
                productividad[instructor_id] = {
                    "instructor_id": instructor_id,
                    "nombre_completo": item.get("instructor_nombre") or f"Instructor {instructor_id}",
                    "clases_programadas": 0,
                    "clases_completadas": 0,
                    "clases_canceladas": 0,
                    "porcentaje_cumplimiento": 0.0,
                }
            ref = productividad[instructor_id]
            ref["clases_programadas"] += 1
            ref["clases_completadas"] += 1
    else:
        for clase in clases:
            if not clase.instructor_id:
                continue
            if clase.instructor_id not in productividad:
                nombre = (
                    clase.instructor.usuario.nombre_completo
                    if clase.instructor and clase.instructor.usuario
                    else f"Instructor {clase.instructor_id}"
                )
                productividad[clase.instructor_id] = {
                    "instructor_id": clase.instructor_id,
                    "nombre_completo": nombre,
                    "clases_programadas": 0,
                    "clases_completadas": 0,
                    "clases_canceladas": 0,
                    "porcentaje_cumplimiento": 0.0,
                }
            ref = productividad[clase.instructor_id]
            ref["clases_programadas"] += 1
            if clase.estado == EstadoClase.COMPLETADA:
                ref["clases_completadas"] += 1
            elif clase.estado == EstadoClase.CANCELADA:
                ref["clases_canceladas"] += 1

    for _, row in productividad.items():
        base = row["clases_completadas"] + row["clases_canceladas"]
        row["porcentaje_cumplimiento"] = (row["clases_completadas"] / base * 100) if base > 0 else 0.0

    instructores_productividad = sorted(
        productividad.values(),
        key=lambda r: (r["clases_completadas"], r["clases_programadas"]),
        reverse=True,
    )[:10]

    return {
        "periodo_inicio": fecha_inicio,
        "periodo_fin": fecha_fin,
        "total_programadas": total_programadas,
        "total_completadas": total_completadas,
        "total_canceladas": total_canceladas,
        "tasa_cumplimiento": round(tasa_cumplimiento, 2),
        "instructores_productividad": instructores_productividad,
    }


@router.get("/asistencia-clases-diaria")
def get_asistencia_clases_diaria(
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    if not fecha_fin:
        fecha_fin = datetime.utcnow()
    if not fecha_inicio:
        fecha_inicio = fecha_fin.replace(day=1)
    fecha_inicio_date = fecha_inicio.date()
    fecha_fin_date = fecha_fin.date()

    fecha_col = cast(Clase.fecha_programada, Date)
    rows = (
        db.query(
            fecha_col.label("fecha"),
            func.count(Clase.id).label("total"),
            func.sum(case((Clase.estado == EstadoClase.PROGRAMADA, 1), else_=0)).label("programadas"),
            func.sum(case((Clase.estado == EstadoClase.COMPLETADA, 1), else_=0)).label("completadas"),
            func.sum(case((Clase.estado == EstadoClase.CANCELADA, 1), else_=0)).label("canceladas"),
        )
        .join(Estudiante, Clase.estudiante_id == Estudiante.id)
        .filter(
            Estudiante.tenant_id == current_tenant.id,
            fecha_col >= fecha_inicio_date,
            fecha_col <= fecha_fin_date,
        )
        .group_by(fecha_col)
        .order_by(fecha_col.asc())
        .all()
    )

    datos = []
    if rows:
        for r in rows:
            datos.append({
                "fecha": r.fecha.isoformat() if hasattr(r.fecha, "isoformat") else str(r.fecha),
                "total": int(r.total or 0),
                "programadas": int(r.programadas or 0),
                "completadas": int(r.completadas or 0),
                "canceladas": int(r.canceladas or 0),
            })
    else:
        # Fallback operativo cuando se acredita desde hoja de vida
        # sin crear agenda en tabla Clase.
        manual_historial = _obtener_historial_clases_manual(db, fecha_inicio_date, fecha_fin_date, current_tenant.id)
        diarios: dict[str, dict] = {}
        for item in manual_historial:
            fecha = item.get("fecha_date")
            if not fecha:
                continue
            key = fecha.isoformat()
            if key not in diarios:
                diarios[key] = {"total": 0, "programadas": 0, "completadas": 0, "canceladas": 0}
            diarios[key]["total"] += 1
            diarios[key]["programadas"] += 1
            diarios[key]["completadas"] += 1
        for key in sorted(diarios.keys()):
            datos.append({
                "fecha": key,
                "total": diarios[key]["total"],
                "programadas": diarios[key]["programadas"],
                "completadas": diarios[key]["completadas"],
                "canceladas": diarios[key]["canceladas"],
            })

    return {
        "periodo_inicio": fecha_inicio,
        "periodo_fin": fecha_fin,
        "datos": datos,
    }


# ==================== FUNCIONES AUXILIARES ====================

def _ingresos_caja(caja: Caja) -> Decimal:
    """Total de ingresos considerando todos los métodos."""
    return (
        (caja.total_ingresos_efectivo or Decimal('0')) +
        (caja.total_nequi or Decimal('0')) +
        (caja.total_daviplata or Decimal('0')) +
        (caja.total_transferencia_bancaria or Decimal('0')) +
        (caja.total_tarjeta_debito or Decimal('0')) +
        (caja.total_tarjeta_credito or Decimal('0')) +
        (caja.total_credismart or Decimal('0')) +
        (caja.total_sistecredito or Decimal('0'))
    )


def _egresos_caja(caja: Caja) -> Decimal:
    """Total de egresos (todos los métodos)."""
    return (
        (caja.total_egresos_efectivo or Decimal('0')) +
        (caja.total_egresos_transferencia or Decimal('0')) +
        (caja.total_egresos_tarjeta or Decimal('0'))
    )

def _calcular_kpis(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    comparar: bool,
    tenant_id: int,
) -> KPIDashboard:
    """Calcula todos los KPIs del dashboard"""
    
    # Calcular período anterior si se solicita comparación
    if comparar:
        dias_periodo = (fecha_fin - fecha_inicio).days
        fecha_inicio_anterior = fecha_inicio - timedelta(days=dias_periodo)
        fecha_fin_anterior = fecha_inicio
    
    # INGRESOS TOTALES (de cajas por fecha de apertura, incluye abiertas y cerradas)
    # Usar CAST a DATE para comparar solo fechas, ignorando horas
    cajas_periodo = db.query(Caja).filter(
        and_(
            Caja.tenant_id == tenant_id,
            cast(Caja.fecha_apertura, Date) >= fecha_inicio,
            cast(Caja.fecha_apertura, Date) <= fecha_fin
        )
    ).all()
    
    ingresos_cajas_periodo = Decimal('0')
    for caja in cajas_periodo:
        total_caja = _ingresos_caja(caja)
        ingresos_cajas_periodo += total_caja

    ingresos_actual = _sumar_ingresos_periodo(db, fecha_inicio, fecha_fin, tenant_id)
    ingresos_anterior = None
    cambio_ingresos = None
    tendencia_ingresos = "neutral"
    
    if comparar:
        cajas_anterior = db.query(Caja).filter(
            and_(
                Caja.tenant_id == tenant_id,
                cast(Caja.fecha_apertura, Date) >= fecha_inicio_anterior,
                cast(Caja.fecha_apertura, Date) < fecha_fin_anterior
            )
        ).all()

        ingresos_anterior = _sumar_ingresos_periodo(db, fecha_inicio_anterior, fecha_fin_anterior, tenant_id)
        
        if ingresos_anterior > 0:
            cambio_ingresos = float(((ingresos_actual - ingresos_anterior) / ingresos_anterior) * 100)
            tendencia_ingresos = "up" if cambio_ingresos > 0 else "down" if cambio_ingresos < 0 else "neutral"
    
    # EGRESOS TOTALES (de cajas por fecha de apertura)
    egresos_actual = _sumar_egresos_periodo(db, fecha_inicio, fecha_fin, tenant_id)
    
    egresos_anterior = None
    cambio_egresos = None
    tendencia_egresos = "neutral"
    
    if comparar:
        egresos_anterior = _sumar_egresos_periodo(db, fecha_inicio_anterior, fecha_fin_anterior, tenant_id)
        
        if egresos_anterior > 0:
            cambio_egresos = float(((egresos_actual - egresos_anterior) / egresos_anterior) * 100)
            tendencia_egresos = "down" if cambio_egresos > 0 else "up" if cambio_egresos < 0 else "neutral"
    
    # SALDO PENDIENTE TOTAL
    saldo_pendiente = db.query(func.sum(Estudiante.saldo_pendiente)).filter(
        Estudiante.tenant_id == tenant_id,
        Estudiante.saldo_pendiente > 0
    ).scalar() or Decimal('0')

    ingreso_neto = ingresos_actual - egresos_actual
    ingresos_promedio_por_caja = (
        ingresos_cajas_periodo / len(cajas_periodo)
        if len(cajas_periodo) > 0
        else Decimal('0')
    )
    
    # MARGEN OPERATIVO
    margen_operativo = 0.0
    if ingresos_actual > 0:
        margen_operativo = float(((ingresos_actual - egresos_actual) / ingresos_actual) * 100)
    
    # ESTUDIANTES ACTIVOS (en proceso) E INACTIVOS (finalizados o abandonaron)
    # Activos: INSCRITO, EN_FORMACION, LISTO_EXAMEN
    total_activos = db.query(Estudiante).filter(
        Estudiante.tenant_id == tenant_id,
        Estudiante.estado.in_([EstadoEstudiante.INSCRITO, EstadoEstudiante.EN_FORMACION, EstadoEstudiante.LISTO_EXAMEN])
    ).count()
    
    # Inactivos: GRADUADO, DESERTOR, RETIRADO
    total_inactivos = db.query(Estudiante).filter(
        Estudiante.tenant_id == tenant_id,
        Estudiante.estado.in_([EstadoEstudiante.GRADUADO, EstadoEstudiante.DESERTOR, EstadoEstudiante.RETIRADO])
    ).count()
    
    # NUEVAS MATRÍCULAS DEL MES
    nuevas_matriculas = db.query(Estudiante).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).count()

    activos_periodo = db.query(Estudiante).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            Estudiante.estado.in_([EstadoEstudiante.INSCRITO, EstadoEstudiante.EN_FORMACION, EstadoEstudiante.LISTO_EXAMEN]),
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).count()

    inactivos_periodo = db.query(Estudiante).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            Estudiante.estado.in_([EstadoEstudiante.GRADUADO, EstadoEstudiante.DESERTOR, EstadoEstudiante.RETIRADO]),
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).count()
    
    # TASA DE DESERCIÓN (simplificada)
    total_estudiantes = activos_periodo + inactivos_periodo
    tasa_desercion = 0.0
    if total_estudiantes > 0:
        tasa_desercion = (inactivos_periodo / total_estudiantes) * 100
    
    # DÍAS PROMEDIO DE PAGO (simplificado - calcular de pagos)
    pagos_periodo = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.COMPLETADO,
            cast(Pago.fecha_pago, Date) >= fecha_inicio,
            cast(Pago.fecha_pago, Date) <= fecha_fin
        )
    ).all()
    
    total_dias = 0
    count_pagos = 0
    for pago in pagos_periodo:
        estudiante = pago.estudiante
        if estudiante and estudiante.fecha_inscripcion and pago.fecha_pago:
            if pago.fecha_vencimiento:
                dias = (pago.fecha_pago - pago.fecha_vencimiento).days
            else:
                dias = (pago.fecha_pago - estudiante.fecha_inscripcion).days
            if dias < 0:
                dias = 0
            total_dias += dias
            count_pagos += 1
    
    dias_promedio_pago = 0.0
    if count_pagos > 0:
        dias_promedio_pago = total_dias / count_pagos

    # TICKET PROMEDIO (por pago completado en el período)
    ticket_promedio = Decimal('0')
    if count_pagos > 0:
        total_pagado_periodo = sum((p.monto or Decimal('0')) for p in pagos_periodo)
        ticket_promedio = total_pagado_periodo / count_pagos
    
    # TASA DE COBRANZA
    total_valor_cursos = db.query(func.sum(Estudiante.valor_total_curso)).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).scalar() or Decimal('0')
    saldo_pendiente_periodo = db.query(func.sum(Estudiante.saldo_pendiente)).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).scalar() or Decimal('0')
    total_pagado = total_valor_cursos - saldo_pendiente_periodo
    tasa_cobranza = 0.0
    if total_valor_cursos > 0:
        tasa_cobranza = float((total_pagado / total_valor_cursos) * 100)

    ahora = datetime.utcnow()
    pagos_pendientes_periodo = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.PENDIENTE,
            Pago.fecha_vencimiento.isnot(None),
            cast(Pago.fecha_vencimiento, Date) >= fecha_inicio,
            cast(Pago.fecha_vencimiento, Date) <= fecha_fin
        )
    )
    pagos_vencidos_periodo = pagos_pendientes_periodo.filter(Pago.fecha_vencimiento < ahora)
    total_pendientes = pagos_pendientes_periodo.count()
    total_vencidos = pagos_vencidos_periodo.count()
    porcentaje_pagos_vencidos = (total_vencidos / total_pendientes) * 100 if total_pendientes > 0 else 0.0
    
    return KPIDashboard(
        ingresos_totales=KPIMetrica(
            valor_actual=ingresos_actual,
            valor_anterior=ingresos_anterior,
            cambio_porcentual=cambio_ingresos,
            tendencia=tendencia_ingresos
        ),
        egresos_totales=KPIMetrica(
            valor_actual=egresos_actual,
            valor_anterior=egresos_anterior,
            cambio_porcentual=cambio_egresos,
            tendencia=tendencia_egresos
        ),
        ingreso_neto=ingreso_neto,
        ingresos_promedio_por_caja=ingresos_promedio_por_caja,
        saldo_pendiente=saldo_pendiente,
        margen_operativo=margen_operativo,
        total_estudiantes_activos=total_activos,
        total_estudiantes_inactivos=total_inactivos,
        nuevas_matriculas_mes=nuevas_matriculas,
        tasa_desercion=tasa_desercion,
        ticket_promedio=ticket_promedio,
        dias_promedio_pago=dias_promedio_pago,
        tasa_cobranza=tasa_cobranza,
        porcentaje_pagos_vencidos=porcentaje_pagos_vencidos
    )


def _grafico_evolucion_ingresos(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> GraficoEvolucionIngresos:
    """Gráfico de evolución de ingresos del período seleccionado"""
    
    # Determinar la granularidad según el rango de fechas
    dias_diferencia = (fecha_fin - fecha_inicio).days
    
    if dias_diferencia <= 1:
        # Para un día: agrupar por hora
        formato_agrupacion = 'HH24:00'
        label_agrupacion = 'hora'
    elif dias_diferencia <= 31:
        # Para hasta un mes: agrupar por día
        formato_agrupacion = 'YYYY-MM-DD'
        label_agrupacion = 'dia'
    elif dias_diferencia <= 180:
        # Para hasta 6 meses: agrupar por semana
        formato_agrupacion = 'IYYY-IW'
        label_agrupacion = 'semana'
    else:
        # Para más de 6 meses: agrupar por mes
        formato_agrupacion = 'YYYY-MM'
        label_agrupacion = 'mes'
    
    pagos = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.COMPLETADO,
            cast(Pago.fecha_pago, Date) >= fecha_inicio,
            cast(Pago.fecha_pago, Date) <= fecha_fin
        )
    ).all()
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.INGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).all()

    buckets = {}
    for pago in pagos:
        key = _bucket_key(pago.fecha_pago, label_agrupacion)
        buckets[key] = buckets.get(key, Decimal('0')) + (pago.monto or Decimal('0'))
    for mov in movimientos:
        key = _bucket_key(mov.fecha, label_agrupacion)
        buckets[key] = buckets.get(key, Decimal('0')) + (mov.monto or Decimal('0'))

    datos = [
        DatoPunto(fecha=key, valor=buckets[key])
        for key in _ordenar_buckets(list(buckets.keys()), label_agrupacion)
    ]
    
    total_periodo = sum(d.valor for d in datos)
    promedio_por_periodo = total_periodo / len(datos) if datos else Decimal('0')
    
    return GraficoEvolucionIngresos(
        datos=datos,
        total_periodo=total_periodo,
        promedio_mensual=promedio_por_periodo
    )


def _parse_pin_vencimiento(estudiante: Estudiante) -> Optional[datetime]:
    datos_adicionales = estudiante.datos_adicionales or {}
    posibles_keys = [
        "pin_vencimiento",
        "pin_fecha_vencimiento",
        "sicov_pin_vencimiento",
        "sicov_pin_fecha_vencimiento",
        "pin_expiracion",
        "pin_expira",
        "fecha_vencimiento_pin"
    ]
    for key in posibles_keys:
        value = datos_adicionales.get(key)
        fecha = _parse_fecha(value)
        if fecha:
            return fecha
    if estudiante.fecha_inscripcion:
        return estudiante.fecha_inscripcion + timedelta(days=90)
    return None


def _obtener_historial_clases_manual(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    tenant_id: int,
) -> list[dict]:
    estudiantes = db.query(Estudiante).filter(Estudiante.tenant_id == tenant_id).all()
    out: list[dict] = []
    for est in estudiantes:
        datos = dict(est.datos_adicionales or {})
        historial = list(datos.get("clases_historial", []))
        for item in historial:
            fecha_raw = item.get("fecha")
            fecha_dt = _parse_fecha(fecha_raw)
            if not fecha_dt:
                continue
            fecha_d = fecha_dt.date()
            if fecha_d < fecha_inicio or fecha_d > fecha_fin:
                continue
            out.append(
                {
                    "fecha_date": fecha_d,
                    "instructor_id": item.get("instructor_id"),
                    "instructor_nombre": item.get("instructor_nombre"),
                }
            )
    return out


def _parse_fecha(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _grafico_metodos_pago(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> GraficoMetodosPago:
    """Gráfico de ingresos por método de pago (desde Cajas)"""
    totales = _sumar_ingresos_por_metodo_periodo(db, fecha_inicio, fecha_fin, tenant_id)
    total_general = sum(totales.values())
    
    datos = [
        DatoCategoria(
            nombre=nombre,
            valor=valor,
            porcentaje=float((valor / total_general) * 100) if total_general > 0 else 0.0
        )
        for nombre, valor in totales.items()
        if valor > 0
    ]
    
    # Ordenar por valor descendente
    datos.sort(key=lambda x: x.valor, reverse=True)
    
    metodo_preferido = datos[0].nombre if datos else "N/A"
    
    return GraficoMetodosPago(
        datos=datos,
        metodo_preferido=metodo_preferido
    )


def _grafico_estudiantes_categorias(db: Session, tenant_id: int) -> GraficoEstudiantesCategorias:
    """Gráfico de estudiantes por categoría de licencia (solo activos)"""
    certificados_count = db.query(func.count(Estudiante.id)).filter(
        Estudiante.tenant_id == tenant_id,
        Estudiante.estado.in_([EstadoEstudiante.INSCRITO, EstadoEstudiante.EN_FORMACION, EstadoEstudiante.LISTO_EXAMEN]),
        cast(Estudiante.tipo_servicio, String).like("CERTIFICADO%")
    ).scalar() or 0

    resultado = db.query(
        Estudiante.categoria,
        func.count(Estudiante.id).label('total')
    ).filter(
        Estudiante.tenant_id == tenant_id,
        Estudiante.estado.in_([EstadoEstudiante.INSCRITO, EstadoEstudiante.EN_FORMACION, EstadoEstudiante.LISTO_EXAMEN]),
        or_(
            Estudiante.tipo_servicio.is_(None),
            ~cast(Estudiante.tipo_servicio, String).like("CERTIFICADO%")
        )
    ).group_by(Estudiante.categoria).all()
    
    total = sum(r.total for r in resultado) + certificados_count
    
    colores = {
        'A1': '#ef4444',  # rojo
        'A2': '#f87171',  # rojo claro
        'B1': '#f59e0b',  # naranja
        'B2': '#fbbf24',  # amarillo
        'B3': '#fde047',  # amarillo claro
        'C1': '#10b981',  # verde
        'C2': '#34d399',  # verde claro
        'C3': '#6ee7b7',  # verde muy claro
        'CERTIFICADOS': '#6366f1'
    }
    
    datos = [
        DatoCategoria(
            nombre=f"Categoría {r.categoria.value}" if r.categoria else "Sin categoría",
            valor=Decimal(str(r.total)),
            porcentaje=float((r.total / total) * 100) if total > 0 else 0.0,
            color=colores.get(r.categoria.value if r.categoria else None, '#6b7280')
        )
        for r in resultado
    ]

    if certificados_count > 0:
        datos.append(DatoCategoria(
            nombre="Certificados",
            valor=Decimal(str(certificados_count)),
            porcentaje=float((certificados_count / total) * 100) if total > 0 else 0.0,
            color=colores.get('CERTIFICADOS', '#6b7280')
        ))
    
    return GraficoEstudiantesCategorias(
        datos=datos,
        total=total
    )


def _sumar_ingresos_periodo(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> Decimal:
    pagos = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.COMPLETADO,
            cast(Pago.fecha_pago, Date) >= fecha_inicio,
            cast(Pago.fecha_pago, Date) <= fecha_fin
        )
    ).all()
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.INGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).all()
    total_pagos = sum((p.monto or Decimal('0')) for p in pagos)
    total_movs = sum((m.monto or Decimal('0')) for m in movimientos)
    return total_pagos + total_movs


def _sumar_egresos_periodo(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> Decimal:
    egresos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.EGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).all()
    return sum((e.monto or Decimal('0')) for e in egresos)


def _sumar_ingresos_por_metodo_periodo(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> dict:
    totales = {
        'Efectivo': Decimal('0'),
        'Nequi': Decimal('0'),
        'Daviplata': Decimal('0'),
        'Transferencia Bancaria': Decimal('0'),
        'Tarjeta Débito': Decimal('0'),
        'Tarjeta Crédito': Decimal('0'),
        'CrediSmart': Decimal('0'),
        'Sistecredito': Decimal('0')
    }

    pagos = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.COMPLETADO,
            cast(Pago.fecha_pago, Date) >= fecha_inicio,
            cast(Pago.fecha_pago, Date) <= fecha_fin
        )
    ).all()
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.INGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).all()

    def acumular_metodo(metodo, monto: Decimal):
        key = _map_metodo_label(metodo)
        if not key:
            return
        totales[key] += monto

    for pago in pagos:
        if pago.es_pago_mixto:
            for d in pago.detalles_pago:
                acumular_metodo(d.metodo_pago, d.monto)
        else:
            acumular_metodo(pago.metodo_pago, pago.monto)

    for mov in movimientos:
        if mov.es_pago_mixto:
            for d in mov.detalles_pago:
                acumular_metodo(d.metodo_pago, d.monto)
        else:
            acumular_metodo(mov.metodo_pago, mov.monto)

    return totales


def _map_metodo_label(metodo) -> Optional[str]:
    if not metodo:
        return None
    if hasattr(metodo, "value"):
        metodo_val = metodo.value
    else:
        metodo_val = str(metodo)
    etiquetas = {
        MetodoPago.EFECTIVO.value: 'Efectivo',
        MetodoPago.NEQUI.value: 'Nequi',
        MetodoPago.DAVIPLATA.value: 'Daviplata',
        MetodoPago.TRANSFERENCIA_BANCARIA.value: 'Transferencia Bancaria',
        MetodoPago.TARJETA_DEBITO.value: 'Tarjeta Débito',
        MetodoPago.TARJETA_CREDITO.value: 'Tarjeta Crédito',
        MetodoPago.CREDISMART.value: 'CrediSmart',
        MetodoPago.SISTECREDITO.value: 'Sistecredito'
    }
    return etiquetas.get(metodo_val)


def _bucket_key(fecha: datetime, label_agrupacion: str) -> str:
    if label_agrupacion == 'hora':
        return fecha.strftime('%H:00')
    if label_agrupacion == 'dia':
        return fecha.strftime('%Y-%m-%d')
    if label_agrupacion == 'semana':
        year, week, _ = fecha.isocalendar()
        return f"{year}-{week:02d}"
    return fecha.strftime('%Y-%m')


def _ordenar_buckets(keys: list, label_agrupacion: str) -> list:
    if label_agrupacion == 'hora':
        return sorted(keys, key=lambda k: int(k.split(':')[0]))
    if label_agrupacion == 'semana':
        return sorted(keys, key=lambda k: (int(k.split('-')[0]), int(k.split('-')[1])))
    return sorted(keys)


def _grafico_egresos_categoria(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> GraficoEgresos:
    """Gráfico de egresos por categoría"""
    resultado = db.query(
        MovimientoCaja.categoria,
        func.sum(MovimientoCaja.monto).label('total')
    ).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.EGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).group_by(MovimientoCaja.categoria).all()
    
    total = sum((r.total or Decimal('0')) for r in resultado)
    
    datos = [
        DatoCategoria(
            nombre=r.categoria.value if r.categoria else "OTROS",
            valor=r.total or Decimal('0'),
            porcentaje=float((r.total / total) * 100) if total > 0 and r.total else 0.0
        )
        for r in resultado
        if r.total and r.total > 0
    ]
    
    # Ordenar por valor descendente y tomar top 5
    datos.sort(key=lambda x: x.valor, reverse=True)
    datos = datos[:5]
    
    categoria_mayor = datos[0].nombre if datos else "N/A"
    
    return GraficoEgresos(
        datos=datos,
        total=total,
        categoria_mayor=categoria_mayor
    )


def _lista_estudiantes_registrados(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> list:
    """Lista de estudiantes registrados en el período"""
    estudiantes = db.query(Estudiante).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).order_by(Estudiante.fecha_inscripcion.desc()).all()
    
    lista = []
    for est in estudiantes:
        lista.append(EstudianteRegistrado(
            id=est.id,
            nombre_completo=est.usuario.nombre_completo if est.usuario else "N/A",
            documento=est.usuario.cedula if est.usuario else "N/A",
            categoria=est.categoria.value if est.categoria else None,
            fecha_inscripcion=est.fecha_inscripcion,
            origen_cliente=est.origen_cliente.value if est.origen_cliente else None,
            referido_por=est.referido_por,
            valor_total_curso=est.valor_total_curso,
            estado=est.estado.value
        ))
    
    return lista


def _lista_estudiantes_pagos(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> list:
    """Lista de estudiantes que realizaron pagos en el período"""
    pagos = db.query(Pago).filter(
        and_(
            Pago.tenant_id == tenant_id,
            Pago.estado == EstadoPago.COMPLETADO,
            cast(Pago.fecha_pago, Date) >= fecha_inicio,
            cast(Pago.fecha_pago, Date) <= fecha_fin
        )
    ).order_by(Pago.fecha_pago.desc()).all()
    
    lista = []
    for pago in pagos:
        est = pago.estudiante
        if not est or not est.usuario:
            continue
            
        lista.append(EstudiantePago(
            pago_id=pago.id,
            estudiante_id=est.id,
            nombre_completo=est.usuario.nombre_completo,
            documento=est.usuario.cedula,
            categoria=est.categoria.value if est.categoria else None,
            fecha_pago=pago.fecha_pago,
            concepto=pago.concepto,
            monto=pago.monto,
            metodo_pago=pago.metodo_pago.value if pago.metodo_pago else None,
            es_pago_mixto=bool(pago.es_pago_mixto),
            saldo_pendiente=est.saldo_pendiente
        ))
    
    return lista


def _lista_egresos_caja(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> list:
    egresos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.EGRESO,
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).order_by(MovimientoCaja.fecha.desc()).all()

    lista = []
    for eg in egresos:
        if eg.es_pago_mixto:
            metodo_label = "MIXTO"
        else:
            metodo = eg.metodo_pago
            metodo_label = metodo.value if hasattr(metodo, "value") else (metodo or "N/A")
        lista.append(EgresoCajaItem(
            egreso_id=eg.id,
            fecha=eg.fecha,
            concepto=eg.concepto,
            categoria=eg.categoria.value if eg.categoria else None,
            metodo_pago=metodo_label,
            monto=eg.monto,
            usuario=eg.usuario.nombre_completo if eg.usuario else None,
            numero_factura=eg.numero_factura,
            observaciones=eg.observaciones
        ))
    return lista


def _lista_otros_movimientos(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> list:
    categorias = [
        ConceptoMovimientoCaja.ESTUDIANTE_NO_REGISTRADO,
        ConceptoMovimientoCaja.PAGO_PRESTAMO_EMPLEADO,
        ConceptoMovimientoCaja.VENTA_MATERIAL,
        ConceptoMovimientoCaja.INGRESO_ADMINISTRATIVO,
        ConceptoMovimientoCaja.OTROS,
    ]
    movimientos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja.has(Caja.tenant_id == tenant_id),
            MovimientoCaja.tipo == TipoMovimiento.INGRESO,
            MovimientoCaja.categoria.in_(categorias),
            cast(MovimientoCaja.fecha, Date) >= fecha_inicio,
            cast(MovimientoCaja.fecha, Date) <= fecha_fin
        )
    ).order_by(MovimientoCaja.fecha.desc()).all()

    lista = []
    for mov in movimientos:
        metodo = mov.metodo_pago
        metodo_label = metodo.value if hasattr(metodo, "value") else (metodo or "N/A")
        lista.append(MovimientoCajaItem(
            movimiento_id=mov.id,
            tipo=mov.tipo.value if hasattr(mov.tipo, "value") else str(mov.tipo),
            fecha=mov.fecha,
            concepto=mov.concepto,
            categoria=mov.categoria.value if mov.categoria else None,
            metodo_pago=metodo_label,
            monto=mov.monto,
            tercero_nombre=mov.tercero_nombre,
            tercero_documento=mov.tercero_documento,
            usuario=mov.usuario.nombre_completo if mov.usuario else None
        ))
    return lista


def _ranking_referidos(db: Session, fecha_inicio: date, fecha_fin: date, tenant_id: int) -> list:
    """Ranking de referidos que más estudiantes envían"""
    from app.models.estudiante import OrigenCliente
    
    # Obtener todos los estudiantes referidos en el período (o todos si se requiere vista completa)
    estudiantes_referidos = db.query(Estudiante).filter(
        and_(
            Estudiante.tenant_id == tenant_id,
            Estudiante.origen_cliente == OrigenCliente.REFERIDO,
            Estudiante.referido_por.isnot(None),
            cast(Estudiante.fecha_inscripcion, Date) >= fecha_inicio,
            cast(Estudiante.fecha_inscripcion, Date) <= fecha_fin
        )
    ).all()
    
    # Si no hay datos en el período, mostrar ranking histórico
    if not estudiantes_referidos:
        estudiantes_referidos = db.query(Estudiante).filter(
            Estudiante.tenant_id == tenant_id,
            Estudiante.origen_cliente == OrigenCliente.REFERIDO,
            Estudiante.referido_por.isnot(None)
        ).all()
    
    # Agrupar por referido
    referidos_dict = {}
    for est in estudiantes_referidos:
        nombre_ref = est.referido_por.strip().upper()
        if not nombre_ref:
            continue
            
        if nombre_ref not in referidos_dict:
            referidos_dict[nombre_ref] = {
                'nombre': est.referido_por,
                'telefono': est.telefono_referidor,
                'estudiantes': [],
                'total_ingresos': Decimal('0'),
                'activos': 0,
                'graduados': 0,
                'ultima_fecha': None
            }
        
        ref_data = referidos_dict[nombre_ref]
        ref_data['estudiantes'].append(est)
        ref_data['total_ingresos'] += est.valor_total_curso or Decimal('0')
        
        if est.estado in [EstadoEstudiante.INSCRITO, EstadoEstudiante.EN_FORMACION, EstadoEstudiante.LISTO_EXAMEN]:
            ref_data['activos'] += 1
        elif est.estado == EstadoEstudiante.GRADUADO:
            ref_data['graduados'] += 1
            
        if not ref_data['ultima_fecha'] or est.fecha_inscripcion > ref_data['ultima_fecha']:
            ref_data['ultima_fecha'] = est.fecha_inscripcion
    
    # Convertir a lista y ordenar por total de estudiantes
    ranking = [
        ReferidoRanking(
            referido_nombre=data['nombre'],
            telefono=data['telefono'],
            total_estudiantes_referidos=len(data['estudiantes']),
            total_ingresos_generados=data['total_ingresos'],
            estudiantes_activos=data['activos'],
            estudiantes_graduados=data['graduados'],
            ultima_referencia_fecha=data['ultima_fecha']
        )
        for nombre_ref, data in referidos_dict.items()
    ]
    
    # Ordenar por total de estudiantes referidos (descendente) y tomar top 10
    ranking.sort(key=lambda x: x.total_estudiantes_referidos, reverse=True)
    return ranking[:10]
