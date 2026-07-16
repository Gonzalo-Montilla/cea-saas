from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
import logging
from io import BytesIO
import base64
import os
import urllib.request
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors

from app.core.database import get_db
from app.core.config import settings
from app.core.email import send_email
from app.api.deps import get_current_active_user, get_admin_or_coordinador_or_cajero, get_required_tenant
from app.models.usuario import Usuario
from app.models.caja import Caja, MovimientoCaja, EstadoCaja, TipoMovimiento, ConceptoMovimientoCaja, DetallePagoMovimientoCaja
from app.models.caja_fuerte import CajaFuerte, MovimientoCajaFuerte
from app.models.pago import Pago, DetallePago, MetodoPago, EstadoPago
from app.models.estudiante import Estudiante
from app.models.tenant import Tenant
from app.schemas.caja import (
    CajaApertura, CajaCierre, CajaResumen, CajaDetalle,
    MovimientoCajaCreate, MovimientoCajaGeneralCreate, MovimientoCajaResponse, DetallePagoResponse,
    PagoCreate, PagoResponse,
    EstudianteFinanciero, DashboardCaja
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ==================== CAJA ENDPOINTS ====================

@router.post("/abrir", response_model=CajaResumen, status_code=status.HTTP_201_CREATED)
def abrir_caja(
    caja_data: CajaApertura,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Abrir una nueva caja.
    Solo se puede tener una caja abierta a la vez por usuario.
    """
    # Verificar si ya hay una caja abierta
    caja_abierta = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).with_for_update().first()
    
    if caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ya existe una caja abierta desde {caja_abierta.fecha_apertura}"
        )
    
    # Crear nueva caja
    nueva_caja = Caja(
        tenant_id=current_tenant.id,
        usuario_apertura_id=current_user.id,
        saldo_inicial=caja_data.saldo_inicial,
        observaciones_apertura=caja_data.observaciones_apertura,
        estado=EstadoCaja.ABIERTA
    )
    
    db.add(nueva_caja)
    db.commit()
    db.refresh(nueva_caja)
    
    return _build_caja_resumen(nueva_caja, db)


@router.get("/actual", response_model=Optional[CajaResumen])
def get_caja_actual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """Obtener la caja actualmente abierta"""
    caja = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).first()
    
    if not caja:
        return None
    
    return _build_caja_resumen(caja, db)


@router.put("/{caja_id}/cerrar", response_model=CajaDetalle)
def cerrar_caja(
    caja_id: int,
    cierre_data: CajaCierre,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Cerrar la caja realizando el arqueo.
    Calcula la diferencia entre efectivo teórico y físico.
    """
    caja = db.query(Caja).filter(
        Caja.id == caja_id,
        Caja.tenant_id == current_tenant.id,
    ).with_for_update().first()
    
    if not caja:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Caja no encontrada"
        )
    
    if caja.estado == EstadoCaja.CERRADA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La caja ya está cerrada"
        )
    
    # Calcular efectivo teórico
    efectivo_teorico = caja.saldo_final_teorico
    
    # Registrar arqueo
    caja.fecha_cierre = datetime.utcnow()
    caja.usuario_cierre_id = current_user.id
    caja.efectivo_teorico = Decimal(str(efectivo_teorico))
    caja.efectivo_fisico = cierre_data.efectivo_fisico
    caja.diferencia = cierre_data.efectivo_fisico - Decimal(str(efectivo_teorico))
    caja.observaciones_cierre = cierre_data.observaciones_cierre
    caja.estado = EstadoCaja.CERRADA
    
    _registrar_ingresos_digitales_caja_fuerte_por_cierre(caja, db, current_user)

    db.commit()
    db.refresh(caja)
    
    return _build_caja_detalle(caja, db)


def _get_or_create_caja_fuerte(db: Session, tenant_id: int) -> CajaFuerte:
    caja_fuerte = db.query(CajaFuerte).filter(CajaFuerte.tenant_id == tenant_id).first()
    if not caja_fuerte:
        caja_fuerte = CajaFuerte(tenant_id=tenant_id)
        db.add(caja_fuerte)
        db.flush()
    return caja_fuerte


def _apply_caja_fuerte_delta(caja_fuerte: CajaFuerte, metodo: MetodoPago, delta: Decimal):
    if metodo == MetodoPago.EFECTIVO:
        caja_fuerte.saldo_efectivo = Decimal(str(caja_fuerte.saldo_efectivo)) + delta
    elif metodo == MetodoPago.NEQUI:
        caja_fuerte.saldo_nequi = Decimal(str(caja_fuerte.saldo_nequi)) + delta
    elif metodo == MetodoPago.DAVIPLATA:
        caja_fuerte.saldo_daviplata = Decimal(str(caja_fuerte.saldo_daviplata)) + delta
    elif metodo == MetodoPago.TRANSFERENCIA_BANCARIA:
        caja_fuerte.saldo_transferencia_bancaria = Decimal(str(caja_fuerte.saldo_transferencia_bancaria)) + delta
    elif metodo == MetodoPago.TARJETA_DEBITO:
        caja_fuerte.saldo_tarjeta_debito = Decimal(str(caja_fuerte.saldo_tarjeta_debito)) + delta
    elif metodo == MetodoPago.TARJETA_CREDITO:
        caja_fuerte.saldo_tarjeta_credito = Decimal(str(caja_fuerte.saldo_tarjeta_credito)) + delta
    elif metodo == MetodoPago.CREDISMART:
        caja_fuerte.saldo_credismart = Decimal(str(caja_fuerte.saldo_credismart)) + delta
    elif metodo == MetodoPago.SISTECREDITO:
        caja_fuerte.saldo_sistecredito = Decimal(str(caja_fuerte.saldo_sistecredito)) + delta


def _registrar_ingresos_digitales_caja_fuerte_por_cierre(
    caja: Caja,
    db: Session,
    current_user: Usuario
):
    try:
        # Aisla caja_fuerte en SAVEPOINT para no romper el cierre
        # si falta tabla/índice por desalineación de esquema.
        with db.begin_nested():
            caja_fuerte = _get_or_create_caja_fuerte(db, caja.tenant_id)

            def registrar(metodo: MetodoPago, monto: Decimal, concepto: str):
                if monto is None or Decimal(str(monto)) <= 0:
                    return
                mov = MovimientoCajaFuerte(
                    caja_fuerte_id=caja_fuerte.id,
                    caja_id=caja.id,
                    tipo=TipoMovimiento.INGRESO,
                    metodo_pago=metodo,
                    concepto=concepto,
                    categoria="CIERRE_CAJA",
                    monto=Decimal(str(monto)),
                    fecha=datetime.utcnow(),
                    observaciones=f"Ingreso automático por cierre de caja #{caja.id}",
                    usuario_id=current_user.id,
                )
                _apply_caja_fuerte_delta(caja_fuerte, metodo, Decimal(str(monto)))
                db.add(mov)

            # Regla operativa:
            # - El efectivo del cierre NO entra automático a caja fuerte.
            # - Solo se consolidan automáticamente los saldos digitales.
            registrar(MetodoPago.NEQUI, caja.total_nequi or Decimal("0"), f"CIERRE CAJA #{caja.id} - NEQUI")
            registrar(MetodoPago.DAVIPLATA, caja.total_daviplata or Decimal("0"), f"CIERRE CAJA #{caja.id} - DAVIPLATA")
            registrar(
                MetodoPago.TRANSFERENCIA_BANCARIA,
                caja.total_transferencia_bancaria or Decimal("0"),
                f"CIERRE CAJA #{caja.id} - TRANSFERENCIA",
            )
            registrar(
                MetodoPago.TARJETA_DEBITO,
                caja.total_tarjeta_debito or Decimal("0"),
                f"CIERRE CAJA #{caja.id} - TARJETA DÉBITO",
            )
            registrar(
                MetodoPago.TARJETA_CREDITO,
                caja.total_tarjeta_credito or Decimal("0"),
                f"CIERRE CAJA #{caja.id} - TARJETA CRÉDITO",
            )
    except SQLAlchemyError:
        logger.exception(
            "No se pudo registrar saldos digitales en caja_fuerte durante cierre de caja id=%s tenant=%s",
            caja.id,
            caja.tenant_id,
        )


@router.get("/dashboard", response_model=DashboardCaja)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Dashboard de caja con resumen y alertas
    """
    # Caja actual
    caja_actual = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).first()
    
    dashboard = DashboardCaja(
        caja_actual=_build_caja_resumen(caja_actual, db) if caja_actual else None,
        hay_caja_abierta=caja_actual is not None
    )
    
    if caja_actual:
        # Resumen del día
        dashboard.total_ingresos_hoy = Decimal(str(caja_actual.total_ingresos))
        dashboard.total_egresos_hoy = Decimal(str(caja_actual.total_egresos))
        dashboard.num_pagos_hoy = db.query(Pago).filter(
            Pago.caja_id == caja_actual.id
        ).count()
        
        # Créditos (NO cuentan en caja)
        dashboard.total_credismart_hoy = Decimal(str(caja_actual.total_credismart))
        dashboard.total_sistecredito_hoy = Decimal(str(caja_actual.total_sistecredito))
        
        # Últimos 5 pagos
        ultimos_pagos = db.query(Pago).filter(
            Pago.caja_id == caja_actual.id
        ).order_by(Pago.fecha_pago.desc()).limit(5).all()
        
        dashboard.ultimos_pagos = [_build_pago_response(p) for p in ultimos_pagos]
        
        # Últimos 5 egresos
        ultimos_egresos = db.query(MovimientoCaja).filter(
            and_(
                MovimientoCaja.caja_id == caja_actual.id,
                MovimientoCaja.tipo == TipoMovimiento.EGRESO
            )
        ).order_by(MovimientoCaja.fecha.desc()).limit(5).all()
        
        dashboard.ultimos_egresos = [_build_movimiento_response(m) for m in ultimos_egresos]
    
    # Alertas: Estudiantes próximos a vencer (90 días)
    hoy = datetime.now()
    fecha_limite = hoy - timedelta(days=83)  # 90 - 7 = 83 (faltan 7 días)
    
    # Contar estudiantes con saldo pendiente y próximos a vencer
    dashboard.estudiantes_proximos_vencer = db.query(Estudiante).join(Pago).filter(
        and_(
            Estudiante.tenant_id == current_tenant.id,
            Pago.tenant_id == current_tenant.id,
            Estudiante.saldo_pendiente > 0,
            Pago.fecha_pago >= fecha_limite,
            Pago.fecha_pago < hoy - timedelta(days=90)
        )
    ).distinct().count()
    
    # Estudiantes vencidos (más de 90 días sin pagar completo)
    fecha_vencida = hoy - timedelta(days=90)
    dashboard.estudiantes_vencidos = db.query(Estudiante).join(Pago).filter(
        and_(
            Estudiante.tenant_id == current_tenant.id,
            Pago.tenant_id == current_tenant.id,
            Estudiante.saldo_pendiente > 0,
            Pago.fecha_pago < fecha_vencida
        )
    ).distinct().count()
    
    return dashboard


@router.get("/historial", response_model=List[CajaResumen])
def get_historial_cajas(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    fecha_inicio: Optional[datetime] = None,
    fecha_fin: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """Obtener historial de cajas cerradas con filtros"""
    # Solo cajas cerradas
    query = db.query(Caja).filter(
        Caja.estado == EstadoCaja.CERRADA,
        Caja.tenant_id == current_tenant.id,
    ).order_by(Caja.fecha_apertura.desc())
    
    if fecha_inicio:
        query = query.filter(Caja.fecha_apertura >= fecha_inicio)
    
    if fecha_fin:
        query = query.filter(Caja.fecha_apertura <= fecha_fin)
    
    cajas = query.offset(skip).limit(limit).all()
    
    return [_build_caja_resumen(c, db) for c in cajas]


@router.get("/pagos/{pago_id}/recibo-pdf")
def get_recibo_pago_pdf(
    pago_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    pago = db.query(Pago).filter(
        Pago.id == pago_id,
        Pago.tenant_id == current_tenant.id,
    ).first()
    if not pago:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pago no encontrado")

    db.refresh(pago, ['detalles_pago', 'estudiante', 'usuario'])
    estudiante = pago.estudiante

    pdf_bytes = _build_pago_pdf_bytes(pago, current_tenant)
    return _pdf_response(BytesIO(pdf_bytes), f"recibo_pago_{pago.id}.pdf")


@router.get("/egresos/{egreso_id}/recibo-pdf")
def get_recibo_egreso_pdf(
    egreso_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    egreso = db.query(MovimientoCaja).filter(
        MovimientoCaja.id == egreso_id,
        MovimientoCaja.tipo == TipoMovimiento.EGRESO,
        MovimientoCaja.caja.has(Caja.tenant_id == current_tenant.id),
    ).first()
    if not egreso:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Egreso no encontrado")

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    _pdf_header(c, "Recibo de egreso", current_tenant)
    y = 580
    c.setLineWidth(0.5)
    c.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(c, "Datos del egreso", y)
    y = _pdf_kv(c, "ID egreso", egreso.id, y)
    y = _pdf_kv(c, "Fecha", egreso.fecha.strftime("%Y-%m-%d %H:%M"), y)
    y = _pdf_kv(c, "Concepto", egreso.concepto, y)
    y = _pdf_kv(c, "Categoria", egreso.categoria.value if egreso.categoria else "OTROS", y)
    y = _pdf_kv(c, "Metodo", str(egreso.metodo_pago), y)
    if egreso.numero_factura:
        y = _pdf_kv(c, "Factura", egreso.numero_factura, y)

    y -= 6
    y = _pdf_section(c, "Monto", y)
    y = _pdf_kv(c, "Total", _fmt_money(egreso.monto), y)

    y -= 6
    y = _pdf_section(c, "Atendido por", y)
    y = _pdf_kv(c, "Usuario", egreso.usuario.nombre_completo if egreso.usuario else "N/A", y)
    c.showPage()
    c.save()
    return _pdf_response(buffer, f"recibo_egreso_{egreso.id}.pdf")


@router.get("/movimientos/{movimiento_id}/recibo-pdf")
def get_recibo_movimiento_pdf(
    movimiento_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    movimiento = db.query(MovimientoCaja).filter(
        MovimientoCaja.id == movimiento_id,
        MovimientoCaja.caja.has(Caja.tenant_id == current_tenant.id),
    ).first()
    if not movimiento:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")

    db.refresh(movimiento, ['detalles_pago', 'usuario'])

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    titulo = "Recibo de ingreso" if movimiento.tipo == TipoMovimiento.INGRESO else "Recibo de egreso"
    _pdf_header(c, titulo, current_tenant)
    y = 580
    c.setLineWidth(0.5)
    c.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(c, "Datos del movimiento", y)
    y = _pdf_kv(c, "ID", movimiento.id, y)
    y = _pdf_kv(c, "Fecha", movimiento.fecha.strftime("%Y-%m-%d %H:%M"), y)
    y = _pdf_kv(c, "Concepto", movimiento.concepto, y)
    y = _pdf_kv(c, "Categoria", movimiento.categoria.value if movimiento.categoria else "OTROS", y)
    if movimiento.tercero_nombre:
        y = _pdf_kv(c, "Pagado por", movimiento.tercero_nombre, y)
    if movimiento.tercero_documento:
        y = _pdf_kv(c, "Documento", movimiento.tercero_documento, y)

    y -= 6
    y = _pdf_section(c, "Monto", y)
    y = _pdf_kv(c, "Total", _fmt_money(movimiento.monto), y)

    y -= 6
    y = _pdf_section(c, "Metodo de pago", y)
    if movimiento.es_pago_mixto:
        for d in movimiento.detalles_pago:
            y = _pdf_kv(c, str(d.metodo_pago), _fmt_money(d.monto), y)
    else:
        y = _pdf_kv(c, "Metodo", str(movimiento.metodo_pago), y)

    y -= 6
    y = _pdf_section(c, "Atendido por", y)
    y = _pdf_kv(c, "Usuario", movimiento.usuario.nombre_completo if movimiento.usuario else "N/A", y)
    c.showPage()
    c.save()
    return _pdf_response(buffer, f"recibo_movimiento_{movimiento.id}.pdf")


@router.get("/{caja_id}/cierre-pdf")
def get_cierre_caja_pdf(
    caja_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja = db.query(Caja).filter(
        Caja.id == caja_id,
        Caja.tenant_id == current_tenant.id,
    ).first()
    if not caja:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caja no encontrada")

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    _pdf_header(c, "Cierre de caja", current_tenant)
    y = 580
    c.setLineWidth(0.5)
    c.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(c, "Datos de caja", y)
    y = _pdf_kv(c, "ID caja", caja.id, y)
    y = _pdf_kv(c, "Apertura", caja.fecha_apertura.strftime("%Y-%m-%d %H:%M"), y)
    if caja.fecha_cierre:
        y = _pdf_kv(c, "Cierre", caja.fecha_cierre.strftime("%Y-%m-%d %H:%M"), y)
    y = _pdf_kv(c, "Usuario apertura", caja.usuario_apertura.nombre_completo, y)
    y = _pdf_kv(c, "Usuario cierre", caja.usuario_cierre.nombre_completo if caja.usuario_cierre else "N/A", y)

    y -= 6
    y = _pdf_section(c, "Totales", y)
    y = _pdf_kv(c, "Saldo inicial", _fmt_money(caja.saldo_inicial), y)
    y = _pdf_kv(c, "Ingresos", _fmt_money(caja.total_ingresos), y)
    y = _pdf_kv(c, "Egresos", _fmt_money(caja.total_egresos), y)
    y = _pdf_kv(c, "Efectivo teorico", _fmt_money(caja.efectivo_teorico or 0), y)
    y = _pdf_kv(c, "Efectivo fisico", _fmt_money(caja.efectivo_fisico or 0), y)
    y = _pdf_kv(c, "Diferencia", _fmt_money(caja.diferencia or 0), y)

    # Detalle de egresos
    egresos = db.query(MovimientoCaja).filter(
        MovimientoCaja.caja_id == caja.id,
        MovimientoCaja.tipo == TipoMovimiento.EGRESO
    ).order_by(MovimientoCaja.fecha.desc()).all()

    y = _ensure_space(c, y, 180, "Cierre de caja (continuacion)", current_tenant)
    y = _pdf_section(c, "Detalle de egresos", y)
    table_headers = ["Fecha", "Concepto", "Categoria", "Metodo", "Monto"]
    table_widths = [80, 170, 90, 70, 42]
    y = _pdf_table_header(c, table_headers, table_widths, y)
    for e in egresos:
        if y < 90:
            c.showPage()
            _pdf_header(c, "Cierre de caja (continuacion)", current_tenant)
            y = 580
            c.setLineWidth(0.5)
            c.line(80, y, 532, y)
            y -= 20
            y = _pdf_section(c, "Detalle de egresos", y)
            y = _pdf_table_header(c, table_headers, table_widths, y)
        concepto = (e.concepto or "")[:24]
        categoria = e.categoria.value if e.categoria else "OTROS"
        metodo = str(e.metodo_pago)
        y = _pdf_table_row(
            c,
            [
                e.fecha.strftime("%Y-%m-%d"),
                concepto,
                categoria,
                metodo,
                _fmt_money(e.monto)
            ],
            table_widths,
            y
        )

    # Resumen por categoria (top 5)
    resumen = db.query(
        MovimientoCaja.categoria,
        func.sum(MovimientoCaja.monto).label("total")
    ).filter(
        MovimientoCaja.caja_id == caja.id,
        MovimientoCaja.tipo == TipoMovimiento.EGRESO
    ).group_by(MovimientoCaja.categoria).order_by(func.sum(MovimientoCaja.monto).desc()).limit(5).all()

    y = _ensure_space(c, y, 140, "Cierre de caja (continuacion)", current_tenant)
    y = _pdf_section(c, "Resumen por categoria", y)
    for r in resumen:
        nombre = r.categoria.value if r.categoria else "OTROS"
        y = _pdf_kv(c, nombre, _fmt_money(r.total or 0), y)
    c.showPage()
    c.save()
    return _pdf_response(buffer, f"cierre_caja_{caja.id}.pdf")


# ==================== PAGOS ENDPOINTS ====================

@router.post("/pagos", response_model=PagoResponse, status_code=status.HTTP_201_CREATED)
def registrar_pago(
    pago_data: PagoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Registrar un pago de estudiante.
    El pago se asocia a la caja abierta y actualiza el saldo del estudiante.
    """
    # Verificar que hay una caja abierta
    caja_abierta = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).with_for_update().first()
    
    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hay una caja abierta. Debe abrir caja primero."
        )
    
    # Verificar que el estudiante existe
    estudiante = db.query(Estudiante).filter(
        Estudiante.id == pago_data.estudiante_id,
        Estudiante.tenant_id == current_tenant.id,
    ).with_for_update().first()
    
    if not estudiante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estudiante no encontrado"
        )
    
    # Verificar que el monto no exceda el saldo pendiente
    if estudiante.saldo_pendiente is not None and pago_data.monto > estudiante.saldo_pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El monto excede el saldo pendiente (${estudiante.saldo_pendiente})"
        )
    if estudiante.saldo_pendiente is not None and estudiante.saldo_pendiente <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El estudiante no tiene saldo pendiente"
        )
    
    try:
        # Crear el pago
        nuevo_pago = Pago(
            tenant_id=current_tenant.id,
            estudiante_id=pago_data.estudiante_id,
            caja_id=caja_abierta.id,
            concepto=pago_data.concepto,
            monto=pago_data.monto,
            metodo_pago=pago_data.metodo_pago,  # None si es mixto
            es_pago_mixto=1 if pago_data.es_pago_mixto else 0,
            estado=EstadoPago.COMPLETADO,
            referencia_pago=pago_data.referencia_pago,
            observaciones=pago_data.observaciones,
            fecha_pago=datetime.utcnow(),
            created_by_user_id=current_user.id
        )
        
        db.add(nuevo_pago)
        db.flush()  # Para obtener el ID del pago
        
        # Si es pago mixto, crear detalles y actualizar caja por cada método
        if pago_data.es_pago_mixto:
            for detalle in pago_data.detalles_pago:
                # Crear detalle
                nuevo_detalle = DetallePago(
                    pago_id=nuevo_pago.id,
                    metodo_pago=detalle.metodo_pago,
                    monto=detalle.monto,
                    referencia=detalle.referencia
                )
                db.add(nuevo_detalle)
                
                # Actualizar totales de caja según método
                _actualizar_caja_por_metodo(caja_abierta, detalle.metodo_pago, detalle.monto)
        else:
            # Pago simple - actualizar caja según método único
            _actualizar_caja_por_metodo(caja_abierta, pago_data.metodo_pago, pago_data.monto)
        
        # Actualizar saldo del estudiante
        if estudiante.saldo_pendiente:
            estudiante.saldo_pendiente -= pago_data.monto
        
        db.commit()
        db.refresh(nuevo_pago)
        
        # Cargar explícitamente las relaciones necesarias
        db.refresh(nuevo_pago, ['detalles_pago', 'estudiante', 'usuario'])

        _enviar_recibo_pago(nuevo_pago, current_tenant)
        
        return _build_pago_response(nuevo_pago)
        
    except Exception as e:
        db.rollback()
        logger.exception("Error al registrar pago")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar pago"
        )


@router.get("/estudiante/{cedula}", response_model=EstudianteFinanciero)
def buscar_estudiante_financiero(
    cedula: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Buscar estudiante por cédula y obtener su información financiera
    """
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
    
    return _build_estudiante_financiero(estudiante, db)


# ==================== EGRESOS ENDPOINTS ====================

@router.post("/egresos", response_model=MovimientoCajaResponse, status_code=status.HTTP_201_CREATED)
def registrar_egreso(
    egreso_data: MovimientoCajaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Registrar un egreso (gasto) en la caja abierta
    """
    # Verificar que hay una caja abierta
    caja_abierta = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).with_for_update().first()
    
    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hay una caja abierta. Debe abrir caja primero."
        )
    
    try:
        # Crear el movimiento
        nuevo_egreso = MovimientoCaja(
            caja_id=caja_abierta.id,
            tipo=TipoMovimiento.EGRESO,
            concepto=egreso_data.concepto,
            categoria=egreso_data.categoria,
            monto=egreso_data.monto,
            metodo_pago=egreso_data.metodo_pago if not egreso_data.es_pago_mixto else None,
            numero_factura=egreso_data.numero_factura,
            observaciones=egreso_data.observaciones,
            tercero_nombre=egreso_data.tercero_nombre,
            tercero_documento=egreso_data.tercero_documento,
            es_pago_mixto=1 if egreso_data.es_pago_mixto else 0,
            usuario_id=current_user.id,
            fecha=datetime.utcnow()
        )
        
        db.add(nuevo_egreso)
        
        if egreso_data.es_pago_mixto:
            for d in (egreso_data.detalles_pago or []):
                db.add(DetallePagoMovimientoCaja(
                    movimiento=nuevo_egreso,
                    metodo_pago=d.metodo_pago,
                    monto=d.monto,
                    referencia=d.referencia
                ))
                _actualizar_egresos_caja_por_metodo(caja_abierta, d.metodo_pago, d.monto)
        else:
            _actualizar_egresos_caja_por_metodo(caja_abierta, egreso_data.metodo_pago, egreso_data.monto)
        
        db.commit()
        db.refresh(nuevo_egreso)
        db.refresh(nuevo_egreso, ['detalles_pago', 'usuario'])
        
        return _build_movimiento_response(nuevo_egreso)
        
    except Exception as e:
        db.rollback()
        logger.exception("Error al registrar egreso")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar egreso"
        )


@router.post("/movimientos", response_model=MovimientoCajaResponse, status_code=status.HTTP_201_CREATED)
def registrar_movimiento(
    movimiento_data: MovimientoCajaGeneralCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_coordinador_or_cajero),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    """
    Registrar un movimiento general (ingreso/egreso) en la caja abierta
    """
    if movimiento_data.tipo != TipoMovimiento.INGRESO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se permiten ingresos en este módulo"
        )
    caja_abierta = db.query(Caja).filter(
        Caja.estado == EstadoCaja.ABIERTA,
        Caja.tenant_id == current_tenant.id,
    ).with_for_update().first()
    if not caja_abierta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hay una caja abierta. Debe abrir caja primero."
        )

    try:
        nuevo_mov = MovimientoCaja(
            caja_id=caja_abierta.id,
            tipo=movimiento_data.tipo,
            concepto=movimiento_data.concepto,
            categoria=movimiento_data.categoria,
            monto=movimiento_data.monto,
            metodo_pago=movimiento_data.metodo_pago if not movimiento_data.es_pago_mixto else None,
            numero_factura=movimiento_data.numero_factura,
            observaciones=movimiento_data.observaciones,
            tercero_nombre=movimiento_data.tercero_nombre,
            tercero_documento=movimiento_data.tercero_documento,
            es_pago_mixto=1 if movimiento_data.es_pago_mixto else 0,
            usuario_id=current_user.id,
            fecha=datetime.utcnow()
        )
        db.add(nuevo_mov)

        if movimiento_data.es_pago_mixto:
            for d in (movimiento_data.detalles_pago or []):
                db.add(DetallePagoMovimientoCaja(
                    movimiento=nuevo_mov,
                    metodo_pago=d.metodo_pago,
                    monto=d.monto,
                    referencia=d.referencia
                ))
                if movimiento_data.tipo == TipoMovimiento.INGRESO:
                    _actualizar_caja_por_metodo(caja_abierta, d.metodo_pago, d.monto)
                else:
                    _actualizar_egresos_caja_por_metodo(caja_abierta, d.metodo_pago, d.monto)
        else:
            if movimiento_data.tipo == TipoMovimiento.INGRESO:
                _actualizar_caja_por_metodo(caja_abierta, movimiento_data.metodo_pago, movimiento_data.monto)
            else:
                _actualizar_egresos_caja_por_metodo(caja_abierta, movimiento_data.metodo_pago, movimiento_data.monto)

        db.commit()
        db.refresh(nuevo_mov)
        db.refresh(nuevo_mov, ['detalles_pago', 'usuario'])

        return _build_movimiento_response(nuevo_mov)
    except Exception as e:
        db.rollback()
        logger.exception("Error al registrar movimiento")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error al registrar movimiento"
        )


# ==================== HELPER FUNCTIONS ====================

def _actualizar_caja_por_metodo(caja: Caja, metodo: MetodoPago, monto: Decimal) -> None:
    """Actualizar totales de caja según método de pago"""
    if metodo == MetodoPago.EFECTIVO:
        caja.total_ingresos_efectivo += monto
    # Transferencias - cada una por separado
    elif metodo == MetodoPago.NEQUI:
        caja.total_nequi += monto
        caja.total_ingresos_transferencia += monto  # Legacy
    elif metodo == MetodoPago.DAVIPLATA:
        caja.total_daviplata += monto
        caja.total_ingresos_transferencia += monto  # Legacy
    elif metodo == MetodoPago.TRANSFERENCIA_BANCARIA:
        caja.total_transferencia_bancaria += monto
        caja.total_ingresos_transferencia += monto  # Legacy
    # Tarjetas - cada una por separado
    elif metodo == MetodoPago.TARJETA_DEBITO:
        caja.total_tarjeta_debito += monto
        caja.total_ingresos_tarjeta += monto  # Legacy
    elif metodo == MetodoPago.TARJETA_CREDITO:
        caja.total_tarjeta_credito += monto
        caja.total_ingresos_tarjeta += monto  # Legacy
    # Créditos - se trackean pero NO entran a caja (plata diferida de financieras)
    elif metodo == MetodoPago.CREDISMART:
        caja.total_credismart += monto
    elif metodo == MetodoPago.SISTECREDITO:
        caja.total_sistecredito += monto


def _actualizar_egresos_caja_por_metodo(caja: Caja, metodo: MetodoPago, monto: Decimal) -> None:
    if metodo == MetodoPago.EFECTIVO:
        caja.total_egresos_efectivo += monto
    elif metodo in [MetodoPago.NEQUI, MetodoPago.DAVIPLATA, MetodoPago.TRANSFERENCIA_BANCARIA]:
        caja.total_egresos_transferencia += monto
    elif metodo in [MetodoPago.TARJETA_DEBITO, MetodoPago.TARJETA_CREDITO]:
        caja.total_egresos_tarjeta += monto

def _build_caja_resumen(caja: Caja, db: Session) -> CajaResumen:
    """Construir resumen de caja"""
    num_pagos = db.query(Pago).filter(
        Pago.caja_id == caja.id,
        Pago.tenant_id == caja.tenant_id,
    ).count()
    num_egresos = db.query(MovimientoCaja).filter(
        and_(
            MovimientoCaja.caja_id == caja.id,
            MovimientoCaja.tipo == TipoMovimiento.EGRESO
        )
    ).count()
    
    return CajaResumen(
        id=caja.id,
        fecha_apertura=caja.fecha_apertura,
        fecha_cierre=caja.fecha_cierre,
        estado=caja.estado,
        usuario_apertura=caja.usuario_apertura.nombre_completo,
        usuario_cierre=caja.usuario_cierre.nombre_completo if caja.usuario_cierre else None,
        saldo_inicial=caja.saldo_inicial,
        total_ingresos=caja.total_ingresos,
        total_egresos=caja.total_egresos,
        saldo_efectivo_caja=caja.saldo_efectivo_caja,
        saldo_final_teorico=caja.saldo_final_teorico,
        total_ingresos_efectivo=caja.total_ingresos_efectivo,
        total_ingresos_transferencia=caja.total_ingresos_transferencia,
        total_ingresos_tarjeta=caja.total_ingresos_tarjeta,
        total_egresos_efectivo=caja.total_egresos_efectivo,
        total_egresos_transferencia=caja.total_egresos_transferencia,
        total_egresos_tarjeta=caja.total_egresos_tarjeta,
        # Transferencias separadas
        total_nequi=caja.total_nequi or Decimal('0'),
        total_daviplata=caja.total_daviplata or Decimal('0'),
        total_transferencia_bancaria=caja.total_transferencia_bancaria or Decimal('0'),
        # Tarjetas separadas
        total_tarjeta_debito=caja.total_tarjeta_debito or Decimal('0'),
        total_tarjeta_credito=caja.total_tarjeta_credito or Decimal('0'),
        # Créditos
        total_credismart=caja.total_credismart,
        total_sistecredito=caja.total_sistecredito,
        efectivo_teorico=caja.efectivo_teorico,
        efectivo_fisico=caja.efectivo_fisico,
        diferencia=caja.diferencia,
        num_pagos=num_pagos,
        num_egresos=num_egresos
    )


def _build_pago_pdf_bytes(pago: Pago, tenant: Optional[Tenant] = None) -> bytes:
    estudiante = pago.estudiante
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    _pdf_header(c, "Recibo de pago", tenant)
    y = 580
    c.setLineWidth(0.5)
    c.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(c, "Datos del pago", y)
    y = _pdf_kv(c, "ID pago", pago.id, y)
    y = _pdf_kv(c, "Fecha", pago.fecha_pago.strftime("%Y-%m-%d %H:%M"), y)
    y = _pdf_kv(c, "Concepto", pago.concepto, y)
    y = _pdf_kv(c, "Monto", _fmt_money(pago.monto), y)
    metodo = pago.metodo_pago.value if pago.metodo_pago else "MIXTO"
    y = _pdf_kv(c, "Metodo", metodo, y)
    if pago.referencia_pago:
        y = _pdf_kv(c, "Referencia", pago.referencia_pago, y)

    y -= 6
    y = _pdf_section(c, "Estudiante", y)
    y = _pdf_kv(c, "Nombre", estudiante.usuario.nombre_completo if estudiante and estudiante.usuario else "N/A", y)
    y = _pdf_kv(c, "Cedula", estudiante.usuario.cedula if estudiante and estudiante.usuario else "N/A", y)
    y = _pdf_kv(c, "Matricula", estudiante.matricula_numero if estudiante else "N/A", y)
    if estudiante and estudiante.saldo_pendiente and estudiante.saldo_pendiente > 0:
        y = _pdf_kv(c, "Saldo pendiente", _fmt_money(estudiante.saldo_pendiente), y)

    if pago.es_pago_mixto and pago.detalles_pago:
        y -= 6
        y = _pdf_section(c, "Detalle pago mixto", y)
        for d in pago.detalles_pago:
            referencia = f" ({d.referencia})" if d.referencia else ""
            y = _pdf_kv(
                c,
                d.metodo_pago.value,
                f"{_fmt_money(d.monto)}{referencia}",
                y
            )

    y -= 6
    y = _pdf_section(c, "Atendido por", y)
    y = _pdf_kv(c, "Usuario", pago.usuario.nombre_completo if pago.usuario else "N/A", y)
    c.showPage()
    c.save()
    return buffer.getvalue()


def _enviar_recibo_pago(pago: Pago, tenant: Optional[Tenant] = None) -> None:
    if not pago or not pago.estudiante or not pago.estudiante.usuario:
        return

    estudiante = pago.estudiante
    saldo = estudiante.saldo_pendiente or Decimal("0")
    saldo_linea = f"Saldo pendiente: {_fmt_money(saldo)}" if saldo > 0 else "Saldo pendiente: $0"
    referencia = pago.referencia_pago if pago.referencia_pago else "N/A"
    metodo = pago.metodo_pago.value if pago.metodo_pago else "MIXTO"
    tenant_name = (tenant.display_name or tenant.nombre) if tenant else settings.BRAND_SHORT_NAME
    contact_phone = tenant.contacto_telefono if tenant and tenant.contacto_telefono else settings.HABEAS_CONTACTO
    contact_email = tenant.contacto_email if tenant and tenant.contacto_email else settings.HABEAS_CORREO
    razon_social = tenant.nombre if tenant and tenant.nombre else settings.HABEAS_RAZON_SOCIAL
    nit = tenant.nit if tenant and tenant.nit else settings.HABEAS_NIT

    subject = f"Tu recibo de pago ya esta disponible - {tenant_name}"
    body = (
        f"Hola {estudiante.usuario.nombre_completo},\n\n"
        f"En {tenant_name} registramos tu pago exitosamente y aqui esta tu recibo:\n\n"
        f"Matricula: {estudiante.matricula_numero or 'N/A'}\n"
        f"Cedula: {estudiante.usuario.cedula}\n\n"
        "Adjuntamos tu recibo en PDF para que lo tengas a la mano.\n\n"
        "Resumen del pago:\n"
        f"- Fecha: {pago.fecha_pago.strftime('%Y-%m-%d %H:%M')}\n"
        f"- Monto: {_fmt_money(pago.monto)}\n"
        f"- Concepto: {pago.concepto}\n"
        f"- Metodo: {metodo}\n"
        f"- Referencia: {referencia}\n\n"
        f"{saldo_linea}\n\n"
        "Si tienes dudas o necesitas apoyo, puedes escribirnos a:\n"
        f"{contact_phone} | {contact_email}\n\n"
        "Gracias por seguir avanzando con nosotros.\n\n"
        f"{tenant_name}\n"
        f"{razon_social}\n"
        f"NIT {nit}\n"
    )

    pdf_bytes = _build_pago_pdf_bytes(pago, tenant)
    filename = f"recibo_pago_{pago.id}.pdf"
    enviado = send_email(
        estudiante.usuario.email,
        subject,
        body,
        attachment=(filename, pdf_bytes, "application/pdf")
    )
    if not enviado:
        logger.warning("No se pudo enviar recibo de pago a %s", estudiante.usuario.email)


def _build_caja_detalle(caja: Caja, db: Session) -> CajaDetalle:
    """Construir detalle completo de caja"""
    resumen = _build_caja_resumen(caja, db)
    return CajaDetalle(
        **resumen.model_dump(),
        observaciones_apertura=caja.observaciones_apertura,
        observaciones_cierre=caja.observaciones_cierre,
        created_at=caja.created_at,
        updated_at=caja.updated_at
    )


def _build_pago_response(pago: Pago) -> PagoResponse:
    """Construir respuesta de pago"""
    # Importar dentro de la función para evitar imports circulares
    from app.schemas.caja import DetallePagoResponse
    
    # Construir detalles si es pago mixto
    detalles = []
    if pago.es_pago_mixto:
        detalles = [
            DetallePagoResponse(
                id=d.id,
                metodo_pago=d.metodo_pago,
                monto=d.monto,
                referencia=d.referencia
            )
            for d in pago.detalles_pago
        ]
    
    return PagoResponse(
        id=pago.id,
        estudiante_id=pago.estudiante_id,
        caja_id=pago.caja_id,
        concepto=pago.concepto,
        monto=pago.monto,
        metodo_pago=pago.metodo_pago if pago.metodo_pago else None,
        estado=pago.estado.value,
        referencia_pago=pago.referencia_pago,
        fecha_pago=pago.fecha_pago,
        observaciones=pago.observaciones,
        es_pago_mixto=bool(pago.es_pago_mixto),
        detalles_pago=detalles,
        estudiante_nombre=pago.estudiante.usuario.nombre_completo,
        estudiante_matricula=pago.estudiante.matricula_numero,
        usuario_nombre=pago.usuario.nombre_completo if pago.usuario else None
    )


def _build_movimiento_response(movimiento: MovimientoCaja) -> MovimientoCajaResponse:
    """Construir respuesta de movimiento"""
    detalles = []
    if movimiento.es_pago_mixto:
        detalles = [
            DetallePagoResponse(
                id=d.id,
                metodo_pago=d.metodo_pago,
                monto=d.monto,
                referencia=d.referencia
            )
            for d in movimiento.detalles_pago
        ]
    return MovimientoCajaResponse(
        id=movimiento.id,
        caja_id=movimiento.caja_id,
        tipo=movimiento.tipo,
        concepto=movimiento.concepto,
        categoria=movimiento.categoria,
        monto=movimiento.monto,
        metodo_pago=movimiento.metodo_pago,
        numero_factura=movimiento.numero_factura,
        comprobante_url=movimiento.comprobante_url,
        fecha=movimiento.fecha,
        observaciones=movimiento.observaciones,
        tercero_nombre=movimiento.tercero_nombre,
        tercero_documento=movimiento.tercero_documento,
        es_pago_mixto=bool(movimiento.es_pago_mixto),
        detalles_pago=detalles,
        usuario_nombre=movimiento.usuario.nombre_completo,
        created_at=movimiento.created_at
    )


def _pdf_header(c: canvas.Canvas, titulo: str, tenant: Optional[Tenant] = None) -> None:
    _draw_logo(c, tenant)
    title_text, subtitle_text = _tenant_brand_texts(tenant)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(306, 652, title_text)
    c.setFont("Helvetica", 11)
    c.drawCentredString(306, 636, subtitle_text)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(306, 620, titulo)


def _tenant_brand_texts(tenant: Optional[Tenant]) -> tuple[str, str]:
    if tenant:
        title = tenant.display_name or tenant.nombre or settings.BRAND_SHORT_NAME
        subtitle = tenant.nombre if tenant.display_name and tenant.nombre and tenant.display_name != tenant.nombre else settings.BRAND_FULL_NAME
        return title, subtitle
    return settings.BRAND_SHORT_NAME, settings.BRAND_FULL_NAME


def _resolve_logo_for_pdf(tenant: Optional[Tenant]):
    """Retorna path (str) o BytesIO del logo del tenant o fallback."""
    raw = (tenant.logo_url or "").strip() if tenant and getattr(tenant, "logo_url", None) else None
    if not raw:
        raw = settings.BRAND_LOGO_PATH or os.getenv("BRAND_LOGO_PATH") or ""
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


def _draw_logo(c: canvas.Canvas, tenant: Optional[Tenant] = None) -> None:
    src = _resolve_logo_for_pdf(tenant)
    if not src:
        return
    try:
        logo = ImageReader(src)
        c.drawImage(logo, 186, 675, width=240, height=120, preserveAspectRatio=True, mask='auto')
    except Exception:
        return


def _pdf_kv(c: canvas.Canvas, label: str, value, y: int) -> int:
    c.setFont("Helvetica-Bold", 10)
    c.drawString(120, y, f"{label}:")
    c.setFont("Helvetica", 10)
    c.drawString(300, y, str(value))
    return y - 18


def _pdf_section(c: canvas.Canvas, titulo: str, y: int) -> int:
    titulo = titulo.upper()
    x = 80
    width = 452
    height = 18
    rect_y = y - 12
    c.setFillColor(colors.Color(0.95, 0.96, 0.98))
    c.setStrokeColor(colors.Color(0.88, 0.90, 0.94))
    c.rect(x, rect_y, width, height, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 11)
    text_width = c.stringWidth(titulo, "Helvetica-Bold", 11)
    c.drawString(x + (width - text_width) / 2, y - 8, titulo)
    return y - 24


def _fmt_money(value: Decimal) -> str:
    try:
        return f"${value:,.0f}"
    except Exception:
        return f"${value}"


def _ensure_space(c: canvas.Canvas, y: int, min_y: int, titulo: str, tenant: Optional[Tenant] = None) -> int:
    if y < min_y:
        c.showPage()
        _pdf_header(c, titulo, tenant)
        y = 580
        c.setLineWidth(0.5)
        c.line(80, y, 532, y)
        y -= 20
    return y


def _pdf_table_header(c: canvas.Canvas, headers: list, widths: list, y: int) -> int:
    x = 80
    c.setFont("Helvetica-Bold", 9)
    for h, w in zip(headers, widths):
        c.drawString(x, y, h)
        x += w
    return y - 14


def _pdf_table_row(c: canvas.Canvas, values: list, widths: list, y: int) -> int:
    x = 80
    c.setFont("Helvetica", 9)
    for v, w in zip(values, widths):
        c.drawString(x, y, str(v))
        x += w
    return y - 14


def _pdf_response(buffer: BytesIO, filename: str) -> Response:
    pdf_bytes = buffer.getvalue()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )


def _build_estudiante_financiero(estudiante: Estudiante, db: Session) -> EstudianteFinanciero:
    """Construir información financiera del estudiante"""
    # Obtener historial de pagos
    pagos = db.query(Pago).filter(
        and_(
            Pago.estudiante_id == estudiante.id,
            Pago.estado == EstadoPago.COMPLETADO,
            Pago.tenant_id == estudiante.tenant_id,
        )
    ).order_by(Pago.fecha_pago.desc()).all()
    
    total_pagado = sum([p.monto for p in pagos], Decimal('0'))
    num_pagos = len(pagos)
    
    # Primer pago y fecha límite
    primer_pago = pagos[-1] if pagos else None
    fecha_primer_pago = primer_pago.fecha_pago if primer_pago else None
    fecha_limite_pago = fecha_primer_pago + timedelta(days=90) if fecha_primer_pago else None
    
    # Calcular días restantes
    dias_restantes = None
    estado_financiero = "SIN_SERVICIO"
    
    if fecha_limite_pago:
        dias_restantes = (fecha_limite_pago - datetime.now()).days
        
        if estudiante.saldo_pendiente and estudiante.saldo_pendiente > 0:
            if dias_restantes < 0:
                estado_financiero = "VENCIDO"
            elif dias_restantes <= 7:
                estado_financiero = "PROXIMO_VENCER"
            else:
                estado_financiero = "AL_DIA"
        else:
            estado_financiero = "PAGADO_COMPLETO"
    
    # Último pago
    ultimo_pago = pagos[0] if pagos else None
    
    # Construir historial de pagos con detalles
    historial_pagos = [_build_pago_response(p) for p in pagos]
    
    return EstudianteFinanciero(
        id=estudiante.id,
        nombre_completo=estudiante.usuario.nombre_completo,
        cedula=estudiante.usuario.cedula,
        tipo_documento=estudiante.usuario.tipo_documento,
        matricula_numero=estudiante.matricula_numero,
        foto_url=estudiante.foto_url,
        tipo_servicio=estudiante.tipo_servicio.value if estudiante.tipo_servicio else None,
        categoria=estudiante.categoria.value if estudiante.categoria else None,
        estado=estudiante.estado.value,
        valor_total_curso=estudiante.valor_total_curso,
        saldo_pendiente=estudiante.saldo_pendiente,
        total_pagado=total_pagado,
        fecha_inscripcion=estudiante.fecha_inscripcion,
        fecha_primer_pago=fecha_primer_pago,
        fecha_limite_pago=fecha_limite_pago,
        dias_restantes=dias_restantes,
        estado_financiero=estado_financiero,
        num_pagos=num_pagos,
        ultimo_pago_fecha=ultimo_pago.fecha_pago if ultimo_pago else None,
        ultimo_pago_monto=ultimo_pago.monto if ultimo_pago else None,
        historial_pagos=historial_pagos
    )
