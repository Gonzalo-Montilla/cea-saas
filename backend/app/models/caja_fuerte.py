from sqlalchemy import Column, Integer, DateTime, ForeignKey, Numeric, String, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
from decimal import Decimal
from app.core.database import Base
from app.models.caja import TipoMovimiento
from app.models.pago import MetodoPago


class CajaFuerte(Base):
    __tablename__ = "caja_fuerte"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)

    saldo_efectivo = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_nequi = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_daviplata = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_transferencia_bancaria = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_tarjeta_debito = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_tarjeta_credito = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_credismart = Column(Numeric(12, 2), default=0, nullable=False)
    saldo_sistecredito = Column(Numeric(12, 2), default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    movimientos = relationship("MovimientoCajaFuerte", back_populates="caja_fuerte")
    inventario = relationship("InventarioEfectivo", back_populates="caja_fuerte")

    @property
    def saldo_total(self) -> Decimal:
        return (
            (self.saldo_efectivo or Decimal("0")) +
            (self.saldo_nequi or Decimal("0")) +
            (self.saldo_daviplata or Decimal("0")) +
            (self.saldo_transferencia_bancaria or Decimal("0")) +
            (self.saldo_tarjeta_debito or Decimal("0")) +
            (self.saldo_tarjeta_credito or Decimal("0")) +
            (self.saldo_credismart or Decimal("0")) +
            (self.saldo_sistecredito or Decimal("0"))
        )


class MovimientoCajaFuerte(Base):
    __tablename__ = "movimientos_caja_fuerte"

    id = Column(Integer, primary_key=True, index=True)
    caja_fuerte_id = Column(Integer, ForeignKey("caja_fuerte.id"), nullable=False)
    caja_id = Column(Integer, ForeignKey("cajas.id"))

    tipo = Column(SQLEnum(TipoMovimiento), nullable=False)
    metodo_pago = Column(SQLEnum(MetodoPago), nullable=False)
    concepto = Column(String(255), nullable=False)
    categoria = Column(String(80))
    monto = Column(Numeric(12, 2), nullable=False)
    fecha = Column(DateTime, default=datetime.utcnow, nullable=False)
    observaciones = Column(Text)
    inventario_detalle = Column(Text)

    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    caja_fuerte = relationship("CajaFuerte", back_populates="movimientos")
    usuario = relationship("Usuario")


class InventarioEfectivo(Base):
    __tablename__ = "inventario_efectivo"

    id = Column(Integer, primary_key=True, index=True)
    caja_fuerte_id = Column(Integer, ForeignKey("caja_fuerte.id"), nullable=False)
    denominacion = Column(Integer, nullable=False)
    cantidad = Column(Integer, default=0, nullable=False)
    total = Column(Numeric(12, 2), default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    caja_fuerte = relationship("CajaFuerte", back_populates="inventario")
