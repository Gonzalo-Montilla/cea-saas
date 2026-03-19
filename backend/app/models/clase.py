from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum, Date, Text, Numeric
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.core.database import Base


class TipoClase(str, enum.Enum):
    """Tipo de clase"""
    TEORICA = "TEORICA"
    PRACTICA = "PRACTICA"


class EstadoClase(str, enum.Enum):
    """Estado de la clase"""
    PROGRAMADA = "PROGRAMADA"
    COMPLETADA = "COMPLETADA"
    CANCELADA = "CANCELADA"


class Clase(Base):
    """Modelo de Clase"""
    __tablename__ = "clases"
    
    id = Column(Integer, primary_key=True, index=True)
    estudiante_id = Column(Integer, ForeignKey("estudiantes.id"), nullable=False)
    instructor_id = Column(Integer, ForeignKey("instructores.id"))
    vehiculo_id = Column(Integer, ForeignKey("vehiculos.id"))
    
    # Información de la clase
    tipo = Column(SQLEnum(TipoClase), nullable=False)
    estado = Column(SQLEnum(EstadoClase), default=EstadoClase.PROGRAMADA, nullable=False)
    fecha_programada = Column(DateTime, nullable=False)
    fecha_completada = Column(DateTime)
    reminder_24h_sent_at = Column(DateTime)
    reminder_2h_sent_at = Column(DateTime)
    duracion_horas = Column(Integer, default=1, nullable=False)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relaciones
    estudiante = relationship("Estudiante", back_populates="clases")
    instructor = relationship("Instructor", back_populates="clases")
    vehiculo = relationship("Vehiculo", back_populates="clases")
    
    def __repr__(self):
        return f"<Clase {self.tipo} - {self.fecha_programada}>"


class EstadoInstructor(str, enum.Enum):
    """Estado del instructor"""
    ACTIVO = "ACTIVO"
    LICENCIA_MEDICA = "LICENCIA_MEDICA"
    VACACIONES = "VACACIONES"
    INACTIVO = "INACTIVO"


class EstadoDocumentacion(str, enum.Enum):
    """Estado de la documentación del instructor"""
    COMPLETO = "COMPLETO"
    INCOMPLETO = "INCOMPLETO"
    VENCIDO = "VENCIDO"
    PROXIMO_VENCER = "PROXIMO_VENCER"  # 30 días o menos


class Instructor(Base):
    """Modelo de Instructor"""
    __tablename__ = "instructores"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), unique=True, nullable=False)
    
    # Información específica
    licencia_numero = Column(String(50), unique=True)
    categorias_enseña = Column(String(100))  # Ej: "A2,B1,C1"
    foto_url = Column(Text)
    especialidad = Column(String(200))  # Ej: "Experto en motos", "Clases nocturnas"
    estado = Column(SQLEnum(EstadoInstructor), default=EstadoInstructor.ACTIVO, nullable=False)
    fecha_contratacion = Column(Date)
    certificaciones = Column(Text)  # Certificados SENA, etc.
    tipo_contrato = Column(String(50))  # POR_HORAS, FIJO, INDEPENDIENTE
    calificacion_promedio = Column(Numeric(3, 2), default=0.0)  # 0.00 a 5.00
    
    # Vigencias de documentos
    licencia_vigencia_desde = Column(Date)
    licencia_vigencia_hasta = Column(Date)
    certificado_vigencia_desde = Column(Date)
    certificado_vigencia_hasta = Column(Date)
    examen_medico_fecha = Column(Date)  # Último examen médico
    
    # Documentos en PDF
    cedula_pdf_url = Column(Text)
    licencia_pdf_url = Column(Text)
    certificado_pdf_url = Column(Text)
    
    # Información adicional
    numero_runt = Column(String(50))  # RUNT - Registro Único Nacional de Tránsito
    estado_documentacion = Column(SQLEnum(EstadoDocumentacion), default=EstadoDocumentacion.INCOMPLETO)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    usuario = relationship("Usuario", backref="instructor")
    clases = relationship("Clase", back_populates="instructor")
    
    def __repr__(self):
        return f"<Instructor {self.licencia_numero}>"


class Vehiculo(Base):
    """Modelo de Vehículo"""
    __tablename__ = "vehiculos"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    placa = Column(String(10), unique=True, nullable=False)
    tipo = Column(String(50))  # MOTO, AUTO, CAMION
    marca = Column(String(50))
    modelo = Column(String(50))
    año = Column(Integer)
    color = Column(String(30))
    cilindraje = Column(String(30))
    vin = Column(String(50))
    numero_motor = Column(String(50))
    numero_chasis = Column(String(50))
    foto_url = Column(Text)
    kilometraje_actual = Column(Integer)
    is_active = Column(Integer, default=1)
    responsable_instructor_id = Column(Integer, ForeignKey("instructores.id"))
    
    # Documentación (vencimientos)
    soat_vencimiento = Column(Date)
    rtm_vencimiento = Column(Date)
    tecnomecanica_vencimiento = Column(Date)
    seguro_vencimiento = Column(Date)
    soat_url = Column(Text)
    rtm_url = Column(Text)
    seguro_url = Column(Text)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relaciones
    clases = relationship("Clase", back_populates="vehiculo")
    mantenimientos = relationship("MantenimientoVehiculo", back_populates="vehiculo")
    combustibles = relationship("CombustibleVehiculo", back_populates="vehiculo")
    responsable_instructor = relationship("Instructor")
    
    def __repr__(self):
        return f"<Vehiculo {self.placa} - {self.tipo}>"

    @property
    def responsable_nombre(self) -> str:
        if self.responsable_instructor and self.responsable_instructor.usuario:
            return self.responsable_instructor.usuario.nombre_completo
        return ""


class MantenimientoVehiculo(Base):
    """Historial de mantenimiento y fallas de vehículo"""
    __tablename__ = "vehiculo_mantenimientos"

    id = Column(Integer, primary_key=True, index=True)
    vehiculo_id = Column(Integer, ForeignKey("vehiculos.id"), nullable=False)
    fecha = Column(DateTime, default=datetime.utcnow, nullable=False)
    tipo = Column(String(30), default="FALLA")  # FALLA, PREVENTIVO
    descripcion_falla = Column(Text)
    diagnostico = Column(Text)
    reparacion_requerida = Column(Text)
    estado = Column(String(30), default="ABIERTO")  # ABIERTO, EN_PROCESO, CERRADO
    km_registro = Column(Integer)
    costo_total = Column(Numeric(12, 2), default=0)
    taller = Column(String(100))
    observaciones = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    vehiculo = relationship("Vehiculo", back_populates="mantenimientos")
    repuestos = relationship("RepuestoMantenimiento", back_populates="mantenimiento")
    adjuntos = relationship("AdjuntoMantenimientoVehiculo", back_populates="mantenimiento")

    def __repr__(self):
        return f"<MantenimientoVehiculo {self.vehiculo_id} - {self.estado}>"


class RepuestoMantenimiento(Base):
    """Repuestos asociados a un mantenimiento"""
    __tablename__ = "vehiculo_repuestos"

    id = Column(Integer, primary_key=True, index=True)
    mantenimiento_id = Column(Integer, ForeignKey("vehiculo_mantenimientos.id"), nullable=False)
    nombre = Column(String(100), nullable=False)
    cantidad = Column(Integer, default=1)
    costo_unitario = Column(Numeric(12, 2), default=0)
    proveedor = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    mantenimiento = relationship("MantenimientoVehiculo", back_populates="repuestos")

    def __repr__(self):
        return f"<RepuestoMantenimiento {self.nombre}>"


class CombustibleVehiculo(Base):
    """Registro de consumo y tanques de combustible"""
    __tablename__ = "vehiculo_combustibles"

    id = Column(Integer, primary_key=True, index=True)
    vehiculo_id = Column(Integer, ForeignKey("vehiculos.id"), nullable=False)
    fecha = Column(DateTime, default=datetime.utcnow, nullable=False)
    km_inicial = Column(Integer, nullable=False)
    km_final = Column(Integer)
    nivel_inicial = Column(String(20))  # 1/4, 1/2, 3/4, lleno
    nivel_final = Column(String(20))
    litros = Column(Numeric(10, 2))
    costo = Column(Numeric(12, 2))
    recibo_url = Column(Text)
    conductor = Column(String(100))
    observaciones = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    vehiculo = relationship("Vehiculo", back_populates="combustibles")
    adjuntos = relationship("AdjuntoCombustibleVehiculo", back_populates="combustible")

    def __repr__(self):
        return f"<CombustibleVehiculo {self.vehiculo_id} - {self.fecha}>"


class AdjuntoMantenimientoVehiculo(Base):
    """Adjuntos (foto/documento) de un mantenimiento"""
    __tablename__ = "vehiculo_mantenimiento_adjuntos"

    id = Column(Integer, primary_key=True, index=True)
    mantenimiento_id = Column(Integer, ForeignKey("vehiculo_mantenimientos.id"), nullable=False)
    archivo_url = Column(Text, nullable=False)
    nombre_archivo = Column(String(200))
    mime = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    mantenimiento = relationship("MantenimientoVehiculo", back_populates="adjuntos")

    def __repr__(self):
        return f"<AdjuntoMantenimientoVehiculo {self.mantenimiento_id}>"


class AdjuntoCombustibleVehiculo(Base):
    """Adjuntos (recibos) de un registro de combustible"""
    __tablename__ = "vehiculo_combustible_adjuntos"

    id = Column(Integer, primary_key=True, index=True)
    combustible_id = Column(Integer, ForeignKey("vehiculo_combustibles.id"), nullable=False)
    archivo_url = Column(Text, nullable=False)
    nombre_archivo = Column(String(200))
    mime = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    combustible = relationship("CombustibleVehiculo", back_populates="adjuntos")

    def __repr__(self):
        return f"<AdjuntoCombustibleVehiculo {self.combustible_id}>"


class VehiculoConsumoUmbral(Base):
    """Umbrales de consumo por tipo de vehículo (km/gal)"""
    __tablename__ = "vehiculo_consumo_umbrales"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), unique=True, nullable=False)
    km_por_galon_min = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<VehiculoConsumoUmbral {self.tipo}={self.km_por_galon_min}>"


class Evaluacion(Base):
    """Modelo de Evaluación"""
    __tablename__ = "evaluaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    estudiante_id = Column(Integer, ForeignKey("estudiantes.id"), nullable=False)
    tipo = Column(String(50))  # TEORICO, PRACTICO
    puntaje = Column(Integer)
    aprobado = Column(Integer, default=0)
    fecha = Column(DateTime, default=datetime.utcnow)
    
    # Relaciones
    estudiante = relationship("Estudiante", back_populates="evaluaciones")
    
    def __repr__(self):
        return f"<Evaluacion {self.tipo} - {self.puntaje}>"
