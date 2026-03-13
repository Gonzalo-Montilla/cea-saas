from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.core.database import Base


class MetodoPago(str, enum.Enum):
    """Métodos de pago disponibles"""
    EFECTIVO = "EFECTIVO"
    NEQUI = "NEQUI"
    DAVIPLATA = "DAVIPLATA"
    TRANSFERENCIA_BANCARIA = "TRANSFERENCIA_BANCARIA"
    TARJETA_DEBITO = "TARJETA_DEBITO"
    TARJETA_CREDITO = "TARJETA_CREDITO"
    CREDISMART = "CREDISMART"  # Crédito - NO entra a caja
    SISTECREDITO = "SISTECREDITO"  # Crédito - NO entra a caja


class EstadoPago(str, enum.Enum):
    """Estado del pago"""
    PENDIENTE = "PENDIENTE"
    COMPLETADO = "COMPLETADO"
    CANCELADO = "CANCELADO"
    RECHAZADO = "RECHAZADO"


class Pago(Base):
    """Modelo de Pago"""
    __tablename__ = "pagos"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    estudiante_id = Column(Integer, ForeignKey("estudiantes.id"), nullable=False)
    caja_id = Column(Integer, ForeignKey("cajas.id"), nullable=True)  # Caja donde se registró
    
    # Información del pago
    concepto = Column(String(255), nullable=False)  # "Matrícula", "Cuota 1/3", etc.
    monto = Column(Numeric(10, 2), nullable=False)
    metodo_pago = Column(SQLEnum(MetodoPago), nullable=True)  # NULL para pagos mixtos, valor para pagos simples
    es_pago_mixto = Column(Integer, default=0, nullable=False)  # 1=Mixto, 0=Simple
    estado = Column(SQLEnum(EstadoPago), default=EstadoPago.COMPLETADO, nullable=False)
    
    # Referencia
    referencia_pago = Column(String(100), unique=True, index=True)  # Número de transacción
    comprobante_url = Column(String(500))  # URL del comprobante escaneado
    
    # Facturación electrónica
    factura_numero = Column(String(50))
    factura_url = Column(String(500))
    
    # Fechas
    fecha_pago = Column(DateTime, nullable=False, default=datetime.utcnow)
    fecha_vencimiento = Column(DateTime)  # Para pagos pendientes
    
    # Observaciones
    observaciones = Column(Text)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("usuarios.id"))  # Cajero que registró
    
    # Relaciones
    estudiante = relationship("Estudiante", back_populates="pagos")
    caja = relationship("Caja", back_populates="pagos")
    usuario = relationship("Usuario", foreign_keys=[created_by_user_id])
    detalles_pago = relationship("DetallePago", back_populates="pago", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Pago {self.concepto} - ${self.monto} - {self.metodo_pago}>"


class DetallePago(Base):
    """Modelo para detalles de pagos mixtos (varios métodos en un pago)"""
    __tablename__ = "detalles_pago"
    
    id = Column(Integer, primary_key=True, index=True)
    pago_id = Column(Integer, ForeignKey("pagos.id"), nullable=False)
    
    # Detalle por método
    metodo_pago = Column(SQLEnum(MetodoPago), nullable=False)
    monto = Column(Numeric(10, 2), nullable=False)
    referencia = Column(String(100))  # Número de transacción específico de este método
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relaciones
    pago = relationship("Pago", back_populates="detalles_pago")
    
    def __repr__(self):
        return f"<DetallePago {self.metodo_pago} - ${self.monto}>"
