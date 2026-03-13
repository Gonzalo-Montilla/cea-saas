from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
from decimal import Decimal
import enum
from app.core.database import Base
from app.models.pago import MetodoPago


class EstadoCaja(str, enum.Enum):
    """Estados de la caja"""
    ABIERTA = "ABIERTA"
    CERRADA = "CERRADA"


class TipoMovimiento(str, enum.Enum):
    """Tipos de movimiento en caja"""
    INGRESO = "INGRESO"
    EGRESO = "EGRESO"


class Caja(Base):
    """Modelo de Caja diaria"""
    __tablename__ = "cajas"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    
    # Control de apertura/cierre
    fecha_apertura = Column(DateTime, default=datetime.utcnow, nullable=False)
    fecha_cierre = Column(DateTime)
    usuario_apertura_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    usuario_cierre_id = Column(Integer, ForeignKey("usuarios.id"))
    
    # Montos
    saldo_inicial = Column(Numeric(12, 2), default=0, nullable=False)  # Base en efectivo
    total_ingresos_efectivo = Column(Numeric(12, 2), default=0, nullable=False)
    
    # Transferencias (separadas)
    total_nequi = Column(Numeric(12, 2), default=0, nullable=False)
    total_daviplata = Column(Numeric(12, 2), default=0, nullable=False)
    total_transferencia_bancaria = Column(Numeric(12, 2), default=0, nullable=False)
    
    # Tarjetas (separadas)
    total_tarjeta_debito = Column(Numeric(12, 2), default=0, nullable=False)
    total_tarjeta_credito = Column(Numeric(12, 2), default=0, nullable=False)
    
    # Legacy (para compatibilidad - calculados)
    total_ingresos_transferencia = Column(Numeric(12, 2), default=0, nullable=False)
    total_ingresos_tarjeta = Column(Numeric(12, 2), default=0, nullable=False)
    total_egresos_efectivo = Column(Numeric(12, 2), default=0, nullable=False)
    total_egresos_transferencia = Column(Numeric(12, 2), default=0, nullable=False)
    total_egresos_tarjeta = Column(Numeric(12, 2), default=0, nullable=False)
    
    # Créditos - NO cuentan como efectivo en caja
    total_credismart = Column(Numeric(12, 2), default=0, nullable=False)
    total_sistecredito = Column(Numeric(12, 2), default=0, nullable=False)
    
    # Arqueo (cierre de caja)
    efectivo_teorico = Column(Numeric(12, 2))  # Lo que debería haber según sistema
    efectivo_fisico = Column(Numeric(12, 2))  # Lo que realmente hay al contar
    diferencia = Column(Numeric(12, 2))  # efectivo_fisico - efectivo_teorico
    
    # Estado y observaciones
    estado = Column(SQLEnum(EstadoCaja), default=EstadoCaja.ABIERTA, nullable=False)
    observaciones_apertura = Column(Text)
    observaciones_cierre = Column(Text)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    usuario_apertura = relationship("Usuario", foreign_keys=[usuario_apertura_id])
    usuario_cierre = relationship("Usuario", foreign_keys=[usuario_cierre_id])
    movimientos = relationship("MovimientoCaja", back_populates="caja")
    pagos = relationship("Pago", back_populates="caja")
    
    @property
    def total_ingresos(self) -> Decimal:
        """Total de ingresos (todos los métodos)"""
        return (
            (self.total_ingresos_efectivo or Decimal('0')) +
            (self.total_ingresos_transferencia or Decimal('0')) +
            (self.total_ingresos_tarjeta or Decimal('0'))
        )
    
    @property
    def total_egresos(self) -> Decimal:
        """Total de egresos (todos los métodos)"""
        return (
            (self.total_egresos_efectivo or Decimal('0')) +
            (self.total_egresos_transferencia or Decimal('0')) +
            (self.total_egresos_tarjeta or Decimal('0'))
        )
    
    @property
    def saldo_final_teorico(self) -> Decimal:
        """Saldo final teórico en efectivo"""
        return (
            (self.saldo_inicial or Decimal('0')) +
            (self.total_ingresos_efectivo or Decimal('0')) -
            (self.total_egresos_efectivo or Decimal('0'))
        )
    
    @property
    def saldo_efectivo_caja(self) -> Decimal:
        """Saldo de efectivo en caja (lo que realmente hay físicamente)"""
        return (
            (self.saldo_inicial or Decimal('0')) +
            (self.total_ingresos_efectivo or Decimal('0')) -
            (self.total_egresos_efectivo or Decimal('0'))
        )
    
    def __repr__(self):
        return f"<Caja {self.fecha_apertura.strftime('%Y-%m-%d')} - {self.estado}>"


class ConceptoMovimientoCaja(str, enum.Enum):
    """Conceptos comunes de movimientos en caja"""
    COMBUSTIBLE = "COMBUSTIBLE"
    MANTENIMIENTO_VEHICULO = "MANTENIMIENTO_VEHICULO"
    SERVICIOS_PUBLICOS = "SERVICIOS_PUBLICOS"
    NOMINA = "NOMINA"
    PAPELERIA = "PAPELERIA"
    ASEO = "ASEO"
    ALQUILER = "ALQUILER"
    SEGUROS = "SEGUROS"
    IMPUESTOS = "IMPUESTOS"
    PUBLICIDAD = "PUBLICIDAD"
    OTROS = "OTROS"
    ESTUDIANTE_NO_REGISTRADO = "ESTUDIANTE_NO_REGISTRADO"
    PAGO_PRESTAMO_EMPLEADO = "PAGO_PRESTAMO_EMPLEADO"
    VENTA_MATERIAL = "VENTA_MATERIAL"
    INGRESO_ADMINISTRATIVO = "INGRESO_ADMINISTRATIVO"
    EGRESO_ADMINISTRATIVO = "EGRESO_ADMINISTRATIVO"


class MovimientoCaja(Base):
    """Modelo de Movimientos de Caja (principalmente egresos)"""
    __tablename__ = "movimientos_caja"
    
    id = Column(Integer, primary_key=True, index=True)
    caja_id = Column(Integer, ForeignKey("cajas.id"), nullable=False)
    
    # Tipo y concepto
    tipo = Column(SQLEnum(TipoMovimiento), nullable=False)
    concepto = Column(String(255), nullable=False)  # Descripción libre
    categoria = Column(SQLEnum(ConceptoMovimientoCaja))  # Categoría fija
    
    # Monto y método
    monto = Column(Numeric(10, 2), nullable=False)
    metodo_pago = Column(String(50), nullable=True)  # NULL para pagos mixtos
    
    # Documentación
    comprobante_url = Column(Text)  # Foto/escaneo del comprobante
    numero_factura = Column(String(100))
    
    # Control
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    fecha = Column(DateTime, default=datetime.utcnow, nullable=False)
    observaciones = Column(Text)
    tercero_nombre = Column(String(255))
    tercero_documento = Column(String(50))
    es_pago_mixto = Column(Integer, default=0, nullable=False)
    detalles_pago = relationship("DetallePagoMovimientoCaja", back_populates="movimiento", cascade="all, delete-orphan")
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relaciones
    caja = relationship("Caja", back_populates="movimientos")
    usuario = relationship("Usuario")
    
    def __repr__(self):
        return f"<MovimientoCaja {self.tipo} - {self.concepto} - ${self.monto}>"


class DetallePagoMovimientoCaja(Base):
    """Detalle de métodos para movimientos mixtos en caja"""
    __tablename__ = "detalles_pago_movimiento_caja"

    id = Column(Integer, primary_key=True, index=True)
    movimiento_id = Column(Integer, ForeignKey("movimientos_caja.id"), nullable=False)
    metodo_pago = Column(SQLEnum(MetodoPago), nullable=False)
    monto = Column(Numeric(10, 2), nullable=False)
    referencia = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    movimiento = relationship("MovimientoCaja", back_populates="detalles_pago")
