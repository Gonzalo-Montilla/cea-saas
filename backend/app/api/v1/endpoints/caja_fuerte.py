from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime, date, time
from decimal import Decimal
from typing import List, Optional
from io import BytesIO
import base64
import json
import os
import urllib.request
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_admin_or_gerente, get_required_tenant
from app.models.usuario import Usuario
from app.models.tenant import Tenant
from app.models.caja_fuerte import CajaFuerte, MovimientoCajaFuerte, InventarioEfectivo
from app.models.caja import TipoMovimiento
from app.models.pago import MetodoPago
from app.schemas.caja_fuerte import (
    CajaFuerteResumen,
    MovimientoCajaFuerteCreate,
    MovimientoCajaFuerteUpdate,
    MovimientoCajaFuerteResponse,
    InventarioUpdate,
    InventarioResponse,
    InventarioItem,
)


router = APIRouter()


DENOMINACIONES_COL = [
    100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
]


def _get_or_create_caja_fuerte(db: Session, tenant_id: int) -> CajaFuerte:
    caja_fuerte = db.query(CajaFuerte).filter(CajaFuerte.tenant_id == tenant_id).first()
    if not caja_fuerte:
        caja_fuerte = CajaFuerte(tenant_id=tenant_id)
        db.add(caja_fuerte)
        db.commit()
        db.refresh(caja_fuerte)
    return caja_fuerte


def _apply_delta(caja_fuerte: CajaFuerte, metodo, delta: Decimal):
    if metodo.value == "EFECTIVO":
        caja_fuerte.saldo_efectivo = Decimal(str(caja_fuerte.saldo_efectivo)) + delta
    elif metodo.value == "NEQUI":
        caja_fuerte.saldo_nequi = Decimal(str(caja_fuerte.saldo_nequi)) + delta
    elif metodo.value == "DAVIPLATA":
        caja_fuerte.saldo_daviplata = Decimal(str(caja_fuerte.saldo_daviplata)) + delta
    elif metodo.value == "TRANSFERENCIA_BANCARIA":
        caja_fuerte.saldo_transferencia_bancaria = Decimal(str(caja_fuerte.saldo_transferencia_bancaria)) + delta
    elif metodo.value == "TARJETA_DEBITO":
        caja_fuerte.saldo_tarjeta_debito = Decimal(str(caja_fuerte.saldo_tarjeta_debito)) + delta
    elif metodo.value == "TARJETA_CREDITO":
        caja_fuerte.saldo_tarjeta_credito = Decimal(str(caja_fuerte.saldo_tarjeta_credito)) + delta
    elif metodo.value == "CREDISMART":
        caja_fuerte.saldo_credismart = Decimal(str(caja_fuerte.saldo_credismart)) + delta
    elif metodo.value == "SISTECREDITO":
        caja_fuerte.saldo_sistecredito = Decimal(str(caja_fuerte.saldo_sistecredito)) + delta
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Método de pago no soportado en caja fuerte"
        )


def _apply_movimiento_to_saldos(caja_fuerte: CajaFuerte, tipo: TipoMovimiento, metodo, monto: Decimal):
    delta = monto if tipo == TipoMovimiento.INGRESO else -monto
    _apply_delta(caja_fuerte, metodo, delta)


def _reverse_movimiento(caja_fuerte: CajaFuerte, tipo: TipoMovimiento, metodo, monto: Decimal):
    delta = -monto if tipo == TipoMovimiento.INGRESO else monto
    _apply_delta(caja_fuerte, metodo, delta)


def _validate_inventario_items(items: List[InventarioItem]):
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes registrar las denominaciones"
        )
    seen = set()
    for item in items:
        if item.denominacion in seen:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Denominaciones duplicadas"
            )
        if item.denominacion not in DENOMINACIONES_COL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Denominación inválida"
            )
        seen.add(item.denominacion)


def _compute_inventory_total(items: List[InventarioItem]) -> Decimal:
    total = Decimal("0")
    for item in items:
        total += Decimal(str(item.denominacion)) * Decimal(str(item.cantidad))
    return total


def _get_inventory_map(db: Session, caja_fuerte: CajaFuerte):
    items = db.query(InventarioEfectivo).filter(
        InventarioEfectivo.caja_fuerte_id == caja_fuerte.id
    ).all()
    return {i.denominacion: i.cantidad for i in items}


def _apply_inventario_movimiento(
    caja_fuerte: CajaFuerte,
    items: List[InventarioItem],
    tipo: TipoMovimiento,
    db: Session
) -> Decimal:
    current = _get_inventory_map(db, caja_fuerte)
    sign = 1 if tipo == TipoMovimiento.INGRESO else -1

    for item in items:
        prev_qty = current.get(item.denominacion, 0)
        new_qty = prev_qty + (item.cantidad * sign)
        if new_qty < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Inventario insuficiente para el egreso en efectivo"
            )
        current[item.denominacion] = new_qty

    total_efectivo = Decimal("0")
    for denom in DENOMINACIONES_COL:
        qty = current.get(denom, 0)
        total = Decimal(str(denom)) * Decimal(str(qty))
        total_efectivo += total
        inv = db.query(InventarioEfectivo).filter(
            InventarioEfectivo.caja_fuerte_id == caja_fuerte.id,
            InventarioEfectivo.denominacion == denom
        ).first()
        if not inv:
            inv = InventarioEfectivo(
                caja_fuerte_id=caja_fuerte.id,
                denominacion=denom
            )
            db.add(inv)
        inv.cantidad = qty
        inv.total = total

    caja_fuerte.saldo_efectivo = total_efectivo
    return total_efectivo


def _reverse_inventario_movimiento(
    caja_fuerte: CajaFuerte,
    items: List[InventarioItem],
    tipo: TipoMovimiento,
    db: Session
) -> Decimal:
    # Reversa de ingreso/egreso: invierte el signo
    reverse_tipo = TipoMovimiento.EGRESO if tipo == TipoMovimiento.INGRESO else TipoMovimiento.INGRESO
    return _apply_inventario_movimiento(caja_fuerte, items, reverse_tipo, db)


def _parse_inventario_detalle(raw: Optional[str]) -> List[InventarioItem]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [InventarioItem(**item) for item in data]
    except Exception:
        return []


def _build_movimiento_response(mov: MovimientoCajaFuerte) -> MovimientoCajaFuerteResponse:
    inventario_detalle = _parse_inventario_detalle(mov.inventario_detalle)
    return MovimientoCajaFuerteResponse(
        id=mov.id,
        caja_fuerte_id=mov.caja_fuerte_id,
        caja_id=mov.caja_id,
        tipo=mov.tipo,
        metodo_pago=mov.metodo_pago,
        concepto=mov.concepto,
        categoria=mov.categoria,
        monto=mov.monto,
        fecha=mov.fecha,
        observaciones=mov.observaciones,
        inventario_detalle=inventario_detalle if inventario_detalle else None,
        usuario_nombre=mov.usuario.nombre_completo if mov.usuario else "N/A",
        created_at=mov.created_at,
    )


@router.get("/resumen", response_model=CajaFuerteResumen)
def get_resumen(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja_fuerte = _get_or_create_caja_fuerte(db, current_tenant.id)
    return CajaFuerteResumen(
        id=caja_fuerte.id,
        saldo_efectivo=caja_fuerte.saldo_efectivo,
        saldo_nequi=caja_fuerte.saldo_nequi,
        saldo_daviplata=caja_fuerte.saldo_daviplata,
        saldo_transferencia_bancaria=caja_fuerte.saldo_transferencia_bancaria,
        saldo_tarjeta_debito=caja_fuerte.saldo_tarjeta_debito,
        saldo_tarjeta_credito=caja_fuerte.saldo_tarjeta_credito,
        saldo_credismart=caja_fuerte.saldo_credismart,
        saldo_sistecredito=caja_fuerte.saldo_sistecredito,
        saldo_total=caja_fuerte.saldo_total,
    )


@router.get("/movimientos", response_model=List[MovimientoCajaFuerteResponse])
def list_movimientos(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    tipo: Optional[TipoMovimiento] = None,
    metodo_pago: Optional[MetodoPago] = None,
    fecha_inicio: Optional[date] = None,
    fecha_fin: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja_fuerte = _get_or_create_caja_fuerte(db, current_tenant.id)
    query = db.query(MovimientoCajaFuerte).filter(
        MovimientoCajaFuerte.caja_fuerte_id == caja_fuerte.id
    )

    if tipo:
        query = query.filter(MovimientoCajaFuerte.tipo == tipo)
    if metodo_pago:
        query = query.filter(MovimientoCajaFuerte.metodo_pago == metodo_pago)
    if fecha_inicio:
        inicio_dt = datetime.combine(fecha_inicio, time.min)
        query = query.filter(MovimientoCajaFuerte.fecha >= inicio_dt)
    if fecha_fin:
        fin_dt = datetime.combine(fecha_fin, time.max)
        query = query.filter(MovimientoCajaFuerte.fecha <= fin_dt)

    movimientos = query.order_by(MovimientoCajaFuerte.fecha.desc()).offset(skip).limit(limit).all()
    return [_build_movimiento_response(m) for m in movimientos]


@router.post("/movimientos", response_model=MovimientoCajaFuerteResponse, status_code=status.HTTP_201_CREATED)
def crear_movimiento(
    movimiento: MovimientoCajaFuerteCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja_fuerte = _get_or_create_caja_fuerte(db, current_tenant.id)

    inventario_detalle = None
    if movimiento.metodo_pago == MetodoPago.EFECTIVO:
        if not movimiento.inventario_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Para movimientos en efectivo debes declarar denominaciones"
            )
        _validate_inventario_items(movimiento.inventario_items)
        total_mov = _compute_inventory_total(movimiento.inventario_items)
        if total_mov != Decimal(str(movimiento.monto)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Las denominaciones no cuadran con el monto del movimiento"
            )
        _apply_inventario_movimiento(caja_fuerte, movimiento.inventario_items, movimiento.tipo, db)
        inventario_detalle = json.dumps([item.model_dump() for item in movimiento.inventario_items])
    else:
        _apply_movimiento_to_saldos(caja_fuerte, movimiento.tipo, movimiento.metodo_pago, movimiento.monto)

    mov = MovimientoCajaFuerte(
        caja_fuerte_id=caja_fuerte.id,
        tipo=movimiento.tipo,
        metodo_pago=movimiento.metodo_pago,
        concepto=movimiento.concepto,
        categoria=movimiento.categoria,
        monto=movimiento.monto,
        fecha=movimiento.fecha or datetime.utcnow(),
        observaciones=movimiento.observaciones,
        inventario_detalle=inventario_detalle,
        usuario_id=current_user.id,
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)
    return _build_movimiento_response(mov)


@router.put("/movimientos/{movimiento_id}", response_model=MovimientoCajaFuerteResponse)
def actualizar_movimiento(
    movimiento_id: int,
    data: MovimientoCajaFuerteUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    mov = db.query(MovimientoCajaFuerte).filter(
        MovimientoCajaFuerte.id == movimiento_id,
        MovimientoCajaFuerte.caja_fuerte.has(CajaFuerte.tenant_id == current_tenant.id),
    ).first()
    if not mov:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")

    caja_fuerte = db.query(CajaFuerte).filter(
        CajaFuerte.id == mov.caja_fuerte_id,
        CajaFuerte.tenant_id == current_tenant.id,
    ).first()
    if not caja_fuerte:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caja fuerte no encontrada")

    old_metodo = mov.metodo_pago
    old_monto = Decimal(str(mov.monto))
    old_detalle = _parse_inventario_detalle(mov.inventario_detalle)

    # Actualizar campos
    if data.metodo_pago is not None:
        mov.metodo_pago = data.metodo_pago
    if data.concepto is not None:
        mov.concepto = data.concepto.strip().upper()
    if data.categoria is not None:
        mov.categoria = data.categoria
    if data.monto is not None:
        mov.monto = data.monto
    if data.fecha is not None:
        mov.fecha = data.fecha
    if data.observaciones is not None:
        mov.observaciones = data.observaciones

    new_monto = Decimal(str(mov.monto))

    if old_metodo == MetodoPago.EFECTIVO:
        if not old_detalle:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El movimiento anterior no tiene detalle de denominaciones"
            )
        _reverse_inventario_movimiento(caja_fuerte, old_detalle, mov.tipo, db)
        mov.inventario_detalle = None
    else:
        _reverse_movimiento(caja_fuerte, mov.tipo, old_metodo, old_monto)

    if mov.metodo_pago == MetodoPago.EFECTIVO:
        if not data.inventario_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Para movimientos en efectivo debes declarar denominaciones"
            )
        _validate_inventario_items(data.inventario_items)
        total_mov = _compute_inventory_total(data.inventario_items)
        if total_mov != Decimal(str(new_monto)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Las denominaciones no cuadran con el monto del movimiento"
            )
        _apply_inventario_movimiento(caja_fuerte, data.inventario_items, mov.tipo, db)
        mov.inventario_detalle = json.dumps([item.model_dump() for item in data.inventario_items])
    else:
        _apply_movimiento_to_saldos(caja_fuerte, mov.tipo, mov.metodo_pago, new_monto)

    db.commit()
    db.refresh(mov)
    return _build_movimiento_response(mov)


@router.delete("/movimientos/{movimiento_id}", status_code=status.HTTP_200_OK)
def eliminar_movimiento(
    movimiento_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    mov = db.query(MovimientoCajaFuerte).filter(
        MovimientoCajaFuerte.id == movimiento_id,
        MovimientoCajaFuerte.caja_fuerte.has(CajaFuerte.tenant_id == current_tenant.id),
    ).first()
    if not mov:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")

    caja_fuerte = db.query(CajaFuerte).filter(
        CajaFuerte.id == mov.caja_fuerte_id,
        CajaFuerte.tenant_id == current_tenant.id,
    ).first()
    if not caja_fuerte:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caja fuerte no encontrada")

    if mov.metodo_pago == MetodoPago.EFECTIVO:
        detalle = _parse_inventario_detalle(mov.inventario_detalle)
        if not detalle:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Para eliminar un movimiento en efectivo usa /movimientos/{id}/eliminar con inventario"
            )
        _reverse_inventario_movimiento(caja_fuerte, detalle, mov.tipo, db)
    else:
        _reverse_movimiento(caja_fuerte, mov.tipo, mov.metodo_pago, Decimal(str(mov.monto)))

    db.delete(mov)
    db.commit()
    return {"detail": "Movimiento eliminado"}


@router.post("/movimientos/{movimiento_id}/eliminar", status_code=status.HTTP_200_OK)
def eliminar_movimiento_con_inventario(
    movimiento_id: int,
    inventario: InventarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    mov = db.query(MovimientoCajaFuerte).filter(
        MovimientoCajaFuerte.id == movimiento_id,
        MovimientoCajaFuerte.caja_fuerte.has(CajaFuerte.tenant_id == current_tenant.id),
    ).first()
    if not mov:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")
    if mov.metodo_pago != MetodoPago.EFECTIVO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este endpoint solo aplica para movimientos en efectivo"
        )

    caja_fuerte = db.query(CajaFuerte).filter(
        CajaFuerte.id == mov.caja_fuerte_id,
        CajaFuerte.tenant_id == current_tenant.id,
    ).first()
    if not caja_fuerte:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caja fuerte no encontrada")

    _validate_inventario_items(inventario.items)
    total_mov = _compute_inventory_total(inventario.items)
    if total_mov != Decimal(str(mov.monto)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Las denominaciones no cuadran con el monto del movimiento"
        )
    _reverse_inventario_movimiento(caja_fuerte, inventario.items, mov.tipo, db)

    db.delete(mov)
    db.commit()
    return {"detail": "Movimiento eliminado"}


@router.get("/movimientos/{movimiento_id}/recibo-pdf")
def get_recibo_movimiento_pdf(
    movimiento_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    mov = db.query(MovimientoCajaFuerte).filter(
        MovimientoCajaFuerte.id == movimiento_id,
        MovimientoCajaFuerte.caja_fuerte.has(CajaFuerte.tenant_id == current_tenant.id),
    ).first()
    if not mov:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")
    if mov.tipo != TipoMovimiento.EGRESO:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Solo se generan recibos para egresos")

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    _pdf_header(c, "Recibo de egreso", current_tenant)
    y = 580
    c.setLineWidth(0.5)
    c.line(80, y, 532, y)
    y -= 20

    y = _pdf_section(c, "Datos del egreso", y)
    y = _pdf_kv(c, "ID egreso", mov.id, y)
    y = _pdf_kv(c, "Fecha", mov.fecha.strftime("%Y-%m-%d %H:%M"), y)
    y = _pdf_kv(c, "Concepto", mov.concepto, y)
    y = _pdf_kv(c, "Categoria", mov.categoria or "OTROS", y)
    y = _pdf_kv(c, "Metodo", str(mov.metodo_pago), y)

    y -= 6
    y = _pdf_section(c, "Monto", y)
    y = _pdf_kv(c, "Total", _fmt_money(mov.monto), y)

    y -= 6
    y = _pdf_section(c, "Atendido por", y)
    y = _pdf_kv(c, "Usuario", mov.usuario.nombre_completo if mov.usuario else "N/A", y)
    y -= 8
    y = _pdf_section(c, "Beneficiario", y)
    c.setFont("Helvetica", 10)
    c.drawString(120, y, "Nombre y firma:")
    c.line(250, y - 2, 520, y - 2)
    c.showPage()
    c.save()
    return _pdf_response(buffer, f"recibo_egreso_caja_fuerte_{mov.id}.pdf")


@router.get("/inventario", response_model=InventarioResponse)
def get_inventario(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja_fuerte = _get_or_create_caja_fuerte(db, current_tenant.id)
    items = db.query(InventarioEfectivo).filter(
        InventarioEfectivo.caja_fuerte_id == caja_fuerte.id
    ).all()

    items_map = {i.denominacion: i for i in items}
    response_items = []
    total_efectivo = Decimal("0")
    for denom in DENOMINACIONES_COL:
        item = items_map.get(denom)
        cantidad = item.cantidad if item else 0
        total = Decimal(str(denom)) * Decimal(str(cantidad))
        response_items.append(InventarioItem(denominacion=denom, cantidad=cantidad, total=total))
        total_efectivo += total

    return InventarioResponse(items=response_items, total_efectivo=total_efectivo)


@router.put("/inventario", response_model=InventarioResponse)
def update_inventario(
    data: InventarioUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_admin_or_gerente),
    current_tenant: Tenant = Depends(get_required_tenant),
):
    caja_fuerte = _get_or_create_caja_fuerte(db, current_tenant.id)

    total_efectivo = Decimal("0")
    for item in data.items:
        total = Decimal(str(item.denominacion)) * Decimal(str(item.cantidad))
        total_efectivo += total

        inv = db.query(InventarioEfectivo).filter(
            InventarioEfectivo.caja_fuerte_id == caja_fuerte.id,
            InventarioEfectivo.denominacion == item.denominacion
        ).first()
        if not inv:
            inv = InventarioEfectivo(
                caja_fuerte_id=caja_fuerte.id,
                denominacion=item.denominacion
            )
            db.add(inv)

        inv.cantidad = item.cantidad
        inv.total = total

    caja_fuerte.saldo_efectivo = total_efectivo
    db.commit()
    response_items = []
    for item in data.items:
        total = Decimal(str(item.denominacion)) * Decimal(str(item.cantidad))
        response_items.append(InventarioItem(denominacion=item.denominacion, cantidad=item.cantidad, total=total))

    return InventarioResponse(items=response_items, total_efectivo=total_efectivo)


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


def _pdf_response(buffer: BytesIO, filename: str) -> Response:
    pdf_bytes = buffer.getvalue()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )
