from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, Text, JSON, Enum as SQLEnum, Numeric
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from app.core.database import Base


class CategoriaLicencia(str, enum.Enum):
    """Categorías de licencia de conducción"""
    A1 = "A1"  # Motocicletas hasta 125cc
    A2 = "A2"  # Motocicletas mayores a 125cc
    B1 = "B1"  # Automóviles, motocarros y cuatrimotos
    B2 = "B2"  # Camionetas y camperos
    B3 = "B3"  # Vehículos de servicio público de pasajeros
    C1 = "C1"  # Camiones rígidos
    C2 = "C2"  # Vehículos articulados
    C3 = "C3"  # Vehículos de servicio público de carga


class EstadoEstudiante(str, enum.Enum):
    """Estados del estudiante en el proceso de formación"""
    PROSPECTO = "PROSPECTO"  # Interesado, no inscrito
    INSCRITO = "INSCRITO"  # Matriculado, iniciando proceso
    EN_FORMACION = "EN_FORMACION"  # Cursando clases
    LISTO_EXAMEN = "LISTO_EXAMEN"  # Completó horas, listo para examen
    GRADUADO = "GRADUADO"  # Aprobó y certificado
    DESERTOR = "DESERTOR"  # Abandonó el proceso
    RETIRADO = "RETIRADO"  # Retirado por incumplimiento


class OrigenCliente(str, enum.Enum):
    """Origen del cliente/estudiante"""
    DIRECTO = "DIRECTO"  # Cliente llegó directamente a la escuela
    REFERIDO = "REFERIDO"  # Cliente referido por tramitador o guarda de tránsito


class TipoServicio(str, enum.Enum):
    """Tipo de servicio contratado"""
    LICENCIA_A2 = "LICENCIA_A2"
    LICENCIA_B1 = "LICENCIA_B1"
    LICENCIA_C1 = "LICENCIA_C1"
    RECATEGORIZACION_C1 = "RECATEGORIZACION_C1"
    COMBO_A2_B1 = "COMBO_A2_B1"
    COMBO_A2_C1 = "COMBO_A2_C1"
    CERTIFICADO_MOTO = "CERTIFICADO_MOTO"
    CERTIFICADO_B1 = "CERTIFICADO_B1"
    CERTIFICADO_C1 = "CERTIFICADO_C1"
    CERTIFICADO_B1_SIN_PRACTICA = "CERTIFICADO_B1_SIN_PRACTICA"
    CERTIFICADO_C1_SIN_PRACTICA = "CERTIFICADO_C1_SIN_PRACTICA"
    CERTIFICADO_A2_B1_SIN_PRACTICA = "CERTIFICADO_A2_B1_SIN_PRACTICA"
    CERTIFICADO_A2_C1_SIN_PRACTICA = "CERTIFICADO_A2_C1_SIN_PRACTICA"
    CERTIFICADO_A2_B1_CON_PRACTICA = "CERTIFICADO_A2_B1_CON_PRACTICA"
    CERTIFICADO_A2_C1_CON_PRACTICA = "CERTIFICADO_A2_C1_CON_PRACTICA"


class Estudiante(Base):
    """Modelo de Estudiante con expediente completo"""
    __tablename__ = "estudiantes"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), unique=True, nullable=False)
    
    # Datos personales adicionales
    fecha_nacimiento = Column(Date, nullable=False)
    direccion = Column(Text)
    ciudad = Column(String(100))
    barrio = Column(String(100))
    tipo_sangre = Column(String(5))
    eps = Column(String(100))
    ocupacion = Column(String(100))
    estado_civil = Column(String(20))  # SOLTERO, CASADO, UNION_LIBRE, DIVORCIADO, VIUDO
    nivel_educativo = Column(String(30))  # SIN_ESTUDIO, BASICA_PRIMARIA, BASICA_SECUNDARIA, TECNICA, PREGRADO, POSTGRADO
    estrato = Column(Integer)  # 1-6
    nivel_sisben = Column(String(10))  # A1, B2, C3, etc
    necesidades_especiales = Column(Text)  # Idioma, Discapacidad, Otra
    contacto_emergencia_nombre = Column(String(255))
    contacto_emergencia_telefono = Column(String(20))
    
    # Documentación
    foto_url = Column(Text)  # URL de la foto o base64
    cedula_frontal_url = Column(Text)
    cedula_posterior_url = Column(Text)
    examen_medico_url = Column(Text)
    
    # Origen y referencia del cliente
    origen_cliente = Column(SQLEnum(OrigenCliente), nullable=True)  # Se define al asignar servicio
    referido_por = Column(String(255))  # Nombre del tramitador o guarda que lo refirió
    telefono_referidor = Column(String(20))  # Teléfono del referidor
    
    # Tipo de servicio y modalidad
    tipo_servicio = Column(SQLEnum(TipoServicio), nullable=True)  # Se define al asignar servicio
    incluye_practica = Column(Integer, default=1, nullable=False)  # 1=Sí, 0=No (para certificados)
    contrato_pdf_url = Column(Text)  # URL del contrato generado
    
    # Matrícula
    matricula_numero = Column(String(50), unique=True, index=True)  # Número interno autogenerado
    
    # Información académica
    categoria = Column(SQLEnum(CategoriaLicencia))  # Se define al asignar servicio
    estado = Column(SQLEnum(EstadoEstudiante), default=EstadoEstudiante.PROSPECTO, nullable=False)
    fecha_inscripcion = Column(DateTime, default=datetime.utcnow)
    fecha_graduacion = Column(DateTime)
    no_certificado = Column(String(50))  # Número del RUNT al graduarse
    
    # Control de horas
    horas_teoricas_completadas = Column(Integer, default=0, nullable=False)
    horas_practicas_completadas = Column(Integer, default=0, nullable=False)
    horas_teoricas_requeridas = Column(Integer, default=20, nullable=False)
    horas_practicas_requeridas = Column(Integer, default=20, nullable=False)
    
    # Información financiera
    valor_total_curso = Column(Numeric(10, 2), nullable=True)  # Se define al asignar servicio
    saldo_pendiente = Column(Numeric(10, 2), default=0, nullable=True)
    
    # Integración SICOV
    sicov_pin = Column(String(50), unique=True, index=True)
    sicov_expediente_id = Column(String(100))
    
    # Información adicional (JSON flexible)
    datos_adicionales = Column(JSON, default=dict)
    
    # Auditoría
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones
    usuario = relationship("Usuario", back_populates="estudiante")
    clases = relationship("Clase", back_populates="estudiante")
    pagos = relationship("Pago", back_populates="estudiante")
    evaluaciones = relationship("Evaluacion", back_populates="estudiante")
    
    def __repr__(self):
        return f"<Estudiante {self.usuario.nombre_completo if self.usuario else 'N/A'} - {self.categoria} - {self.estado}>"
    
    @property
    def progreso_teorico(self) -> float:
        """Calcula el porcentaje de progreso teórico"""
        if self.horas_teoricas_requeridas == 0:
            return 100.0
        return (self.horas_teoricas_completadas / self.horas_teoricas_requeridas) * 100
    
    @property
    def progreso_practico(self) -> float:
        """Calcula el porcentaje de progreso práctico"""
        if self.horas_practicas_requeridas == 0:
            return 100.0
        return (self.horas_practicas_completadas / self.horas_practicas_requeridas) * 100
    
    @property
    def esta_listo_para_examen(self) -> bool:
        """Verifica si el estudiante cumplió las horas requeridas"""
        return (
            self.horas_teoricas_completadas >= self.horas_teoricas_requeridas and
            self.horas_practicas_completadas >= self.horas_practicas_requeridas
        )
