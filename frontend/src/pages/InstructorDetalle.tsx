import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { instructoresAPI } from '../services/api';
import {
  ArrowLeft, UserCheck, Mail, Phone, Award, Calendar, Edit, Star, BookOpen, 
  Car, Users, TrendingUp, AlertCircle, FileText, Download, AlertTriangle, 
  CheckCircle, Clock, XCircle, Eye
} from 'lucide-react';
import { ModalBase } from '../components/ui/ModalBase';
import '../styles/InstructorDetalle.css';

interface Estadisticas {
  total_clases: number;
  clases_teoricas: number;
  clases_practicas: number;
  horas_impartidas: number;
  estudiantes_atendidos: number;
  clases_mes_actual: number;
  promedio_calificacion: number;
}

interface Instructor {
  id: number;
  usuario_id: number;
  nombre_completo: string;
  cedula: string;
  email: string;
  telefono: string;
  foto_url?: string;
  licencia_numero: string;
  categorias_enseña: string;
  especialidad?: string;
  estado: string;
  fecha_contratacion?: string;
  certificaciones?: string;
  tipo_contrato?: string;
  calificacion_promedio: number;
  numero_runt?: string;
  licencia_vigencia_desde?: string;
  licencia_vigencia_hasta?: string;
  certificado_vigencia_desde?: string;
  certificado_vigencia_hasta?: string;
  examen_medico_fecha?: string;
  cedula_pdf_url?: string;
  licencia_pdf_url?: string;
  certificado_pdf_url?: string;
  estado_documentacion?: string;
  created_at: string;
  estadisticas: Estadisticas;
}

export const InstructorDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfPreview, setPdfPreview] = useState<{ url: string; nombre: string } | null>(null);

  useEffect(() => {
    cargarInstructor();
  }, [id]);

  const cargarInstructor = async () => {
    try {
      setIsLoading(true);
      const data = await instructoresAPI.getById(Number(id));
      setInstructor(data);
    } catch (err) {
      console.error('Error al cargar instructor:', err);
      setError('No se pudieron cargar los datos del instructor.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatearFecha = (fecha: string) => {
    return new Date(fecha).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const calcularDiasParaVencimiento = (fechaVencimiento: string): number => {
    const hoy = new Date();
    const vencimiento = new Date(fechaVencimiento);
    const diferencia = vencimiento.getTime() - hoy.getTime();
    return Math.ceil(diferencia / (1000 * 60 * 60 * 24));
  };

  const getAlertaVigencia = (fechaVencimiento?: string) => {
    if (!fechaVencimiento) return null;
    
    const dias = calcularDiasParaVencimiento(fechaVencimiento);
    
    if (dias < 0) {
      return { tipo: 'vencido', mensaje: 'VENCIDO', color: '#dc2626', icon: XCircle };
    } else if (dias <= 30) {
      return { tipo: 'proximo', mensaje: `Vence en ${dias} días`, color: '#f59e0b', icon: AlertTriangle };
    } else {
      return { tipo: 'vigente', mensaje: 'Vigente', color: '#16a34a', icon: CheckCircle };
    }
  };

  const getEstadoBadgeClass = (estado: string) => {
    const estados: { [key: string]: string } = {
      'ACTIVO': 'badge-activo',
      'LICENCIA_MEDICA': 'badge-licencia',
      'VACACIONES': 'badge-vacaciones',
      'INACTIVO': 'badge-inactivo'
    };
    return estados[estado] || 'badge-secondary';
  };

  const getEstadoTexto = (estado: string) => {
    const textos: { [key: string]: string } = {
      'ACTIVO': 'Activo',
      'LICENCIA_MEDICA': 'Licencia Médica',
      'VACACIONES': 'Vacaciones',
      'INACTIVO': 'Inactivo'
    };
    return textos[estado] || estado;
  };

  const renderEstrellas = (calificacion: number) => {
    const estrellas = [];
    for (let i = 1; i <= 5; i++) {
      estrellas.push(
        <Star 
          key={i} 
          size={20} 
          fill={i <= calificacion ? "#f59e0b" : "none"} 
          color={i <= calificacion ? "#f59e0b" : "#d1d5db"} 
        />
      );
    }
    return estrellas;
  };

  const abrirVistaPrevia = (url: string, nombre: string) => {
    setPdfPreview({ url, nombre });
  };

  const cerrarVistaPrevia = () => {
    setPdfPreview(null);
  };

  const descargarDocumento = (url: string, nombre: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = nombre;
    link.click();
  };

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Cargando información del instructor...</p>
      </div>
    );
  }

  if (error || !instructor) {
    return (
      <div className="error-container">
        <AlertCircle size={48} color="#ef4444" />
        <p>{error || 'Instructor no encontrado'}</p>
        <button className="btn-primary" onClick={() => navigate('/instructores')}>
          Volver a Instructores
        </button>
      </div>
    );
  }

  const alertaLicencia = getAlertaVigencia(instructor.licencia_vigencia_hasta);
  const alertaCertificado = getAlertaVigencia(instructor.certificado_vigencia_hasta);

  return (
    <div className="instructor-detalle-container">
      {/* Header */}
      <div className="detalle-header">
        <button className="btn-back" onClick={() => navigate('/instructores')}>
          <ArrowLeft size={20} /> Volver
        </button>
        <div className="header-actions">
          <button className="btn-action">
            <Edit size={18} /> Editar
          </button>
        </div>
      </div>

      {/* Alertas de Vencimiento */}
      {(alertaLicencia?.tipo === 'vencido' || alertaCertificado?.tipo === 'vencido' || 
        alertaLicencia?.tipo === 'proximo' || alertaCertificado?.tipo === 'proximo') && (
        <div className="alertas-vencimiento">
          {alertaLicencia?.tipo !== 'vigente' && (
            <div className={`alerta-item alerta-${alertaLicencia?.tipo}`}>
              {alertaLicencia?.icon && <alertaLicencia.icon size={20} />}
              <div>
                <strong>Licencia de Conducción:</strong> {alertaLicencia?.mensaje}
                {instructor.licencia_vigencia_hasta && (
                  <span> - Vence: {formatearFecha(instructor.licencia_vigencia_hasta)}</span>
                )}
              </div>
            </div>
          )}
          {alertaCertificado?.tipo !== 'vigente' && (
            <div className={`alerta-item alerta-${alertaCertificado?.tipo}`}>
              {alertaCertificado?.icon && <alertaCertificado.icon size={20} />}
              <div>
                <strong>Certificado de Instructor:</strong> {alertaCertificado?.mensaje}
                {instructor.certificado_vigencia_hasta && (
                  <span> - Vence: {formatearFecha(instructor.certificado_vigencia_hasta)}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Información Principal */}
      <div className="info-principal">
        <div className="foto-grande">
          {instructor.foto_url ? (
            <img src={instructor.foto_url} alt={instructor.nombre_completo} />
          ) : (
            <div className="foto-placeholder-grande">
              <UserCheck size={80} />
            </div>
          )}
        </div>
        
        <div className="info-basica">
          <h1>{instructor.nombre_completo}</h1>
          <p className="cedula">CC: {instructor.cedula}</p>
          <p className="licencia">Licencia: {instructor.licencia_numero}</p>
          {instructor.numero_runt && (
            <p className="licencia">RUNT: {instructor.numero_runt}</p>
          )}
          
          {/* Badge de estado */}
          <div className="estado-badge-container">
            <span className={`badge-estado-grande ${getEstadoBadgeClass(instructor.estado)}`}>
              {getEstadoTexto(instructor.estado)}
            </span>
            
            {/* Badge de documentación */}
            {instructor.estado_documentacion && (
              <span className={`badge-docs badge-docs-${instructor.estado_documentacion.toLowerCase()}`}>
                {instructor.estado_documentacion === 'COMPLETO' && <CheckCircle size={16} />}
                {instructor.estado_documentacion === 'INCOMPLETO' && <Clock size={16} />}
                {instructor.estado_documentacion === 'VENCIDO' && <XCircle size={16} />}
                {instructor.estado_documentacion === 'PROXIMO_VENCER' && <AlertTriangle size={16} />}
                {instructor.estado_documentacion.replace('_', ' ')}
              </span>
            )}
          </div>

          {/* Calificación */}
          <div className="rating-principal">
            <div className="estrellas-grande">
              {renderEstrellas(Math.round(instructor.calificacion_promedio))}
            </div>
            <span className="rating-texto">
              {instructor.calificacion_promedio?.toFixed(1)} / 5.0
            </span>
          </div>

          {/* Especialidad */}
          {instructor.especialidad && (
            <p className="especialidad-texto">
              <Award size={18} /> {instructor.especialidad}
            </p>
          )}
        </div>
      </div>

      {/* Estadísticas en Tarjetas */}
      <div className="estadisticas-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dbeafe' }}>
            <BookOpen size={24} color="#2563eb" />
          </div>
          <div className="stat-content">
            <h3>{instructor.estadisticas.total_clases}</h3>
            <p>Clases Completadas</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dcfce7' }}>
            <TrendingUp size={24} color="#16a34a" />
          </div>
          <div className="stat-content">
            <h3>{instructor.estadisticas.horas_impartidas}</h3>
            <p>Horas Impartidas</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef3c7' }}>
            <Users size={24} color="#ca8a04" />
          </div>
          <div className="stat-content">
            <h3>{instructor.estadisticas.estudiantes_atendidos}</h3>
            <p>Estudiantes Atendidos</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#e0e7ff' }}>
            <Calendar size={24} color="#6366f1" />
          </div>
          <div className="stat-content">
            <h3>{instructor.estadisticas.clases_mes_actual}</h3>
            <p>Clases Este Mes</p>
          </div>
        </div>
      </div>

      {/* Detalles */}
      <div className="detalles-grid">
        {/* Información Personal */}
        <div className="detalle-card">
          <h2><UserCheck size={20} /> Información Personal</h2>
          <div className="info-rows">
            <div className="info-row">
              <span className="label"><Mail size={16} /> Email:</span>
              <span className="value">{instructor.email}</span>
            </div>
            <div className="info-row">
              <span className="label"><Phone size={16} /> Teléfono:</span>
              <span className="value">{instructor.telefono}</span>
            </div>
            <div className="info-row">
              <span className="label"><Award size={16} /> Licencia:</span>
              <span className="value">{instructor.licencia_numero}</span>
            </div>
            {instructor.numero_runt && (
              <div className="info-row">
                <span className="label">RUNT:</span>
                <span className="value">{instructor.numero_runt}</span>
              </div>
            )}
            {instructor.fecha_contratacion && (
              <div className="info-row">
                <span className="label"><Calendar size={16} /> Fecha Contratación:</span>
                <span className="value">{formatearFecha(instructor.fecha_contratacion)}</span>
              </div>
            )}
            {instructor.tipo_contrato && (
              <div className="info-row">
                <span className="label">Tipo de Contrato:</span>
                <span className="value">{instructor.tipo_contrato}</span>
              </div>
            )}
          </div>
        </div>

        {/* Información Académica */}
        <div className="detalle-card">
          <h2><BookOpen size={20} /> Información Académica</h2>
          <div className="info-rows">
            <div className="info-row">
              <span className="label">Categorías que Enseña:</span>
              <div className="categorias-lista">
                {instructor.categorias_enseña?.split(',').map((cat, idx) => (
                  <span key={idx} className="badge-categoria-detalle">{cat.trim()}</span>
                ))}
              </div>
            </div>
            {instructor.certificaciones && (
              <div className="info-row">
                <span className="label">Certificaciones:</span>
                <span className="value">{instructor.certificaciones}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Vigencias de Documentos */}
      <div className="detalle-card-full">
        <h2><Calendar size={20} /> Vigencias de Documentos</h2>
        <div className="vigencias-grid">
          {/* Licencia */}
          <div className="vigencia-card">
            <div className="vigencia-header">
              <Award size={20} />
              <h3>Licencia de Conducción</h3>
            </div>
            <div className="vigencia-fechas">
              {instructor.licencia_vigencia_desde && (
                <div className="vigencia-fecha">
                  <span className="fecha-label">Desde:</span>
                  <span className="fecha-valor">{formatearFecha(instructor.licencia_vigencia_desde)}</span>
                </div>
              )}
              {instructor.licencia_vigencia_hasta && (
                <div className="vigencia-fecha">
                  <span className="fecha-label">Hasta:</span>
                  <span className="fecha-valor">{formatearFecha(instructor.licencia_vigencia_hasta)}</span>
                </div>
              )}
            </div>
            {alertaLicencia && (
              <div className={`vigencia-status status-${alertaLicencia.tipo}`}>
                {alertaLicencia.icon && <alertaLicencia.icon size={18} />}
                <span>{alertaLicencia.mensaje}</span>
              </div>
            )}
          </div>

          {/* Certificado */}
          <div className="vigencia-card">
            <div className="vigencia-header">
              <FileText size={20} />
              <h3>Certificado de Instructor</h3>
            </div>
            <div className="vigencia-fechas">
              {instructor.certificado_vigencia_desde && (
                <div className="vigencia-fecha">
                  <span className="fecha-label">Desde:</span>
                  <span className="fecha-valor">{formatearFecha(instructor.certificado_vigencia_desde)}</span>
                </div>
              )}
              {instructor.certificado_vigencia_hasta && (
                <div className="vigencia-fecha">
                  <span className="fecha-label">Hasta:</span>
                  <span className="fecha-valor">{formatearFecha(instructor.certificado_vigencia_hasta)}</span>
                </div>
              )}
            </div>
            {alertaCertificado && (
              <div className={`vigencia-status status-${alertaCertificado.tipo}`}>
                {alertaCertificado.icon && <alertaCertificado.icon size={18} />}
                <span>{alertaCertificado.mensaje}</span>
              </div>
            )}
          </div>

          {/* Examen Médico */}
          {instructor.examen_medico_fecha && (
            <div className="vigencia-card">
              <div className="vigencia-header">
                <FileText size={20} />
                <h3>Examen Médico</h3>
              </div>
              <div className="vigencia-fechas">
                <div className="vigencia-fecha">
                  <span className="fecha-label">Último examen:</span>
                  <span className="fecha-valor">{formatearFecha(instructor.examen_medico_fecha)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Documentos */}
      <div className="detalle-card-full">
        <h2><FileText size={20} /> Documentos Adjuntos</h2>
        <div className="documentos-grid">
          {/* Cédula */}
          <div className="documento-item">
            <div className="documento-info">
              <FileText size={24} color="#667eea" />
              <div>
                <h4>Cédula de Ciudadanía</h4>
                {instructor.cedula_pdf_url ? (
                  <p className="documento-estado">
                    <CheckCircle size={16} color="#16a34a" />
                    Documento cargado
                  </p>
                ) : (
                  <p className="documento-estado-faltante">
                    <AlertCircle size={16} color="#f59e0b" />
                    Pendiente
                  </p>
                )}
              </div>
            </div>
            {instructor.cedula_pdf_url && (
              <div className="documento-acciones">
                <button 
                  className="btn-preview"
                  onClick={() => abrirVistaPrevia(instructor.cedula_pdf_url!, 'Cédula de Ciudadanía')}
                >
                  <Eye size={16} /> Ver
                </button>
                <button 
                  className="btn-descargar"
                  onClick={() => descargarDocumento(instructor.cedula_pdf_url!, 'cedula.pdf')}
                >
                  <Download size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Licencia */}
          <div className="documento-item">
            <div className="documento-info">
              <FileText size={24} color="#667eea" />
              <div>
                <h4>Licencia de Conducción</h4>
                {instructor.licencia_pdf_url ? (
                  <p className="documento-estado">
                    <CheckCircle size={16} color="#16a34a" />
                    Documento cargado
                  </p>
                ) : (
                  <p className="documento-estado-faltante">
                    <AlertCircle size={16} color="#f59e0b" />
                    Pendiente
                  </p>
                )}
              </div>
            </div>
            {instructor.licencia_pdf_url && (
              <div className="documento-acciones">
                <button 
                  className="btn-preview"
                  onClick={() => abrirVistaPrevia(instructor.licencia_pdf_url!, 'Licencia de Conducción')}
                >
                  <Eye size={16} /> Ver
                </button>
                <button 
                  className="btn-descargar"
                  onClick={() => descargarDocumento(instructor.licencia_pdf_url!, 'licencia.pdf')}
                >
                  <Download size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Certificado */}
          <div className="documento-item">
            <div className="documento-info">
              <FileText size={24} color="#667eea" />
              <div>
                <h4>Certificado de Instructor</h4>
                {instructor.certificado_pdf_url ? (
                  <p className="documento-estado">
                    <CheckCircle size={16} color="#16a34a" />
                    Documento cargado
                  </p>
                ) : (
                  <p className="documento-estado-faltante">
                    <AlertCircle size={16} color="#f59e0b" />
                    Pendiente
                  </p>
                )}
              </div>
            </div>
            {instructor.certificado_pdf_url && (
              <div className="documento-acciones">
                <button 
                  className="btn-preview"
                  onClick={() => abrirVistaPrevia(instructor.certificado_pdf_url!, 'Certificado de Instructor')}
                >
                  <Eye size={16} /> Ver
                </button>
                <button 
                  className="btn-descargar"
                  onClick={() => descargarDocumento(instructor.certificado_pdf_url!, 'certificado.pdf')}
                >
                  <Download size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Distribución de Clases */}
      <div className="detalle-card-full">
        <h2><BookOpen size={20} /> Distribución de Clases</h2>
        <div className="clases-distribucion">
          <div className="clase-tipo">
            <div className="tipo-header">
              <BookOpen size={20} />
              <span>Teóricas</span>
            </div>
            <div className="tipo-valor">{instructor.estadisticas.clases_teoricas}</div>
            <div className="tipo-porcentaje">
              {instructor.estadisticas.total_clases > 0 
                ? Math.round((instructor.estadisticas.clases_teoricas / instructor.estadisticas.total_clases) * 100)
                : 0}%
            </div>
          </div>

          <div className="clase-tipo">
            <div className="tipo-header">
              <Car size={20} />
              <span>Prácticas</span>
            </div>
            <div className="tipo-valor">{instructor.estadisticas.clases_practicas}</div>
            <div className="tipo-porcentaje">
              {instructor.estadisticas.total_clases > 0 
                ? Math.round((instructor.estadisticas.clases_practicas / instructor.estadisticas.total_clases) * 100)
                : 0}%
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Vista Previa PDF */}
      {pdfPreview && (
        <ModalBase
          isOpen={Boolean(pdfPreview)}
          title={pdfPreview.nombre}
          onClose={cerrarVistaPrevia}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={cerrarVistaPrevia}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => descargarDocumento(pdfPreview.url, `${pdfPreview.nombre}.pdf`)}
              >
                <Download size={16} /> Descargar
              </button>
            </>
          }
        >
          <div className="pdf-preview-body">
            <iframe 
              src={pdfPreview.url} 
              title={pdfPreview.nombre}
              width="100%"
              height="100%"
            />
          </div>
        </ModalBase>
      )}
    </div>
  );
};
