import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { estudiantesAPI } from '../services/api';
import { Search, UserPlus, Eye, Settings, ChevronDown, Users } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DefinirServicioModal } from '../components/DefinirServicioModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import '../styles/Estudiantes.css';

interface Estudiante {
  id: number;
  usuario_id: number;
  nombre_completo: string;
  cedula: string;
  tipo_documento?: string;
  email: string;
  telefono: string;
  foto_url?: string;
  matricula_numero?: string;
  categoria?: string;
  tipo_servicio?: string;
  estado: string;
  fecha_inscripcion: string;
  saldo_pendiente?: number;
}

export const Estudiantes = () => {
  const navigate = useNavigate();
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDebounced, setBusquedaDebounced] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [estudianteSeleccionado, setEstudianteSeleccionado] = useState<Estudiante | null>(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [estudianteReactivar, setEstudianteReactivar] = useState<Estudiante | null>(null);
  const [reactivandoEstudiante, setReactivandoEstudiante] = useState(false);
  
  // Paginación
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalEstudiantes, setTotalEstudiantes] = useState(0);
  const estudiantesPorPagina = 12;
  
  // Control de tarjetas expandidas
  const [tarjetasExpandidas, setTarjetasExpandidas] = useState<Set<number>>(new Set());
  const prevBusquedaRef = useRef('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setBusquedaDebounced(busqueda.trim());
    }, 400);
    return () => clearTimeout(handler);
  }, [busqueda]);

  useEffect(() => {
    if (prevBusquedaRef.current !== busquedaDebounced) {
      prevBusquedaRef.current = busquedaDebounced;
      if (paginaActual !== 1) {
        setPaginaActual(1);
        return;
      }
    }
    cargarEstudiantes();
  }, [paginaActual, busquedaDebounced]);

  const cargarEstudiantes = async () => {
    try {
      setIsLoading(true);
      const skip = (paginaActual - 1) * estudiantesPorPagina;
      const response = await estudiantesAPI.getAll({
        skip,
        limit: estudiantesPorPagina,
        search: busquedaDebounced || undefined
      });
      
      // La API ahora devuelve {items, total, skip, limit}
      setEstudiantes(response.items || []);
      setTotalEstudiantes(response.total || 0);
    } catch (err) {
      console.error('Error al cargar estudiantes:', err);
      setError('No se pudo cargar la lista de estudiantes.');
      setEstudiantes([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getServicioLabel = (tipoServicio?: string, categoria?: string) => {
    const map: Record<string, string> = {
      LICENCIA_A2: 'Licencia A2',
      LICENCIA_B1: 'Licencia B1',
      LICENCIA_C1: 'Licencia C1',
      COMBO_A2_B1: 'Combo A2 + B1',
      COMBO_A2_C1: 'Combo A2 + C1',
      CERTIFICADO_MOTO: 'Certificado Moto',
      CERTIFICADO_B1: 'Certificado B1',
      CERTIFICADO_C1: 'Certificado C1',
      CERTIFICADO_B1_SIN_PRACTICA: 'Certificado B1 sin práctica',
      CERTIFICADO_C1_SIN_PRACTICA: 'Certificado C1 sin práctica',
      CERTIFICADO_A2_B1_SIN_PRACTICA: 'Certificado A2 + B1 sin práctica',
      CERTIFICADO_A2_C1_SIN_PRACTICA: 'Certificado A2 + C1 sin práctica',
      CERTIFICADO_A2_B1_CON_PRACTICA: 'Certificado A2 + B1 con práctica',
      CERTIFICADO_A2_C1_CON_PRACTICA: 'Certificado A2 + C1 con práctica'
    };
    return map[tipoServicio || ''] || (categoria ? `Licencia ${categoria}` : 'N/A');
  };

  const getTipoDocumentoLabel = (tipo?: string) => {
    switch (tipo) {
      case 'TARJETA_IDENTIDAD':
        return 'TI';
      case 'PASAPORTE':
        return 'PAS';
      case 'CEDULA_EXTRANJERIA':
        return 'CE';
      default:
        return 'CC';
    }
  };

  const formatearFecha = (fecha: string) => {
    return new Date(fecha).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatearMoneda = (valor?: number) => {
    if (!valor) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(valor);
  };

  const getEstadoBadgeClass = (estado: string) => {
    const estados: { [key: string]: string } = {
      'PROSPECTO': 'badge-warning',
      'INSCRITO': 'badge-info',
      'EN_FORMACION': 'badge-primary',
      'LISTO_EXAMEN': 'badge-success',
      'GRADUADO': 'badge-success',
      'DESERTOR': 'badge-danger',
      'RETIRADO': 'badge-danger'
    };
    return estados[estado] || 'badge-secondary';
  };

  const handleDefinirServicio = (estudiante: Estudiante) => {
    setEstudianteSeleccionado(estudiante);
    setMostrarModal(true);
  };

  const handleReactivar = (estudiante: Estudiante) => {
    setEstudianteReactivar(estudiante);
  };

  const confirmarReactivar = async () => {
    if (!estudianteReactivar || reactivandoEstudiante) return;
    try {
      setReactivandoEstudiante(true);
      const actualizado = await estudiantesAPI.reactivar(estudianteReactivar.id);
      setEstudiantes((prev) =>
        prev.map((item) => (item.id === estudianteReactivar.id ? actualizado : item))
      );
      setError('');
      setEstudianteSeleccionado(actualizado);
      setMostrarModal(true);
    } catch (err) {
      console.error('Error al reactivar estudiante:', err);
      setError('No se pudo reactivar el estudiante.');
    } finally {
      setReactivandoEstudiante(false);
      setEstudianteReactivar(null);
    }
  };

  const handleModalClose = () => {
    setMostrarModal(false);
    setEstudianteSeleccionado(null);
  };

  const handleModalSuccess = () => {
    cargarEstudiantes(); // Recargar la lista
  };

  const totalPaginas = Math.ceil(totalEstudiantes / estudiantesPorPagina);

  const cambiarPagina = (nuevaPagina: number) => {
    if (nuevaPagina >= 1 && nuevaPagina <= totalPaginas) {
      setPaginaActual(nuevaPagina);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  
  const toggleTarjeta = (estudianteId: number) => {
    setTarjetasExpandidas(prev => {
      const newSet = new Set(prev);
      if (newSet.has(estudianteId)) {
        newSet.delete(estudianteId);
      } else {
        newSet.add(estudianteId);
      }
      return newSet;
    });
  };

  return (
    <div className="estudiantes-container">
      <PageHeader
        title="Estudiantes"
        subtitle="Gestión de estudiantes y matrículas"
        icon={<Users size={20} />}
        actions={
          <button className="btn-nuevo" onClick={() => navigate('/nuevo-estudiante')}>
            <UserPlus size={20} />
            Nuevo Estudiante
          </button>
        }
      />

      <div className="search-section">
        <div className="search-box">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por tipo de documento, correo o matrícula..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="search-results">
          {busquedaDebounced && (
            <span className="results-count">
              {totalEstudiantes} resultado(s) encontrado(s)
            </span>
          )}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {isLoading ? (
        <div className="loading-container">
          <p>Cargando estudiantes...</p>
        </div>
      ) : (
        <div className="estudiantes-grid">
          {estudiantes.length === 0 ? (
            <div className="empty-state">
              <p>No se encontraron estudiantes</p>
              {busquedaDebounced && (
                <button 
                  className="btn-clear"
                  onClick={() => setBusqueda('')}
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>
          ) : (
            estudiantes.map((estudiante) => {
              const isExpanded = tarjetasExpandidas.has(estudiante.id);
              
              const panelId = `estudiante-card-body-${estudiante.id}`;

              return (
              <div key={estudiante.id} className={`estudiante-card ${isExpanded ? 'expanded' : 'collapsed'}`}>
                {/* Header clickeable */}
                <button
                  type="button"
                  className="card-header clickeable" 
                  onClick={() => toggleTarjeta(estudiante.id)}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                >
                  <div className="estudiante-foto">
                    {estudiante.foto_url ? (
                      <img src={estudiante.foto_url} alt={estudiante.nombre_completo} />
                    ) : (
                      <div className="foto-placeholder">
                        <span>{estudiante.nombre_completo.charAt(0)}</span>
                      </div>
                    )}
                  </div>
                  <div className="estudiante-info">
                    <h3>{estudiante.nombre_completo}</h3>
                    <p className="cedula">
                      {getTipoDocumentoLabel(estudiante.tipo_documento)}: {estudiante.cedula}
                    </p>
                    {estudiante.matricula_numero && (
                      <p className="matricula">Mat: {estudiante.matricula_numero}</p>
                    )}
                  </div>
                  <ChevronDown 
                    size={24} 
                    className={`chevron-toggle ${isExpanded ? '' : 'rotated'}`}
                  />
                </button>

                {/* Contenido colapsable */}
                {isExpanded && (
                <div id={panelId}>
                <div className="card-body">
                  <div className="info-row">
                    <span className="label">Email:</span>
                    <span className="value">{estudiante.email}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Teléfono:</span>
                    <span className="value">{estudiante.telefono}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Inscripción:</span>
                    <span className="value">{formatearFecha(estudiante.fecha_inscripcion)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Servicio:</span>
                    <span className="value">{getServicioLabel(estudiante.tipo_servicio, estudiante.categoria)}</span>
                  </div>
                  {estudiante.saldo_pendiente !== undefined && (
                    <div className="info-row">
                      <span className="label">Saldo:</span>
                      <span className="value saldo">{formatearMoneda(estudiante.saldo_pendiente)}</span>
                    </div>
                  )}
                </div>

                <div className="card-footer">
                  <span className={`badge ${getEstadoBadgeClass(estudiante.estado)}`}>
                    {estudiante.estado.replace('_', ' ')}
                  </span>
                  <div className="card-actions">
                    {estudiante.estado === 'PROSPECTO' && (
                      <button 
                        className="btn-definir"
                        onClick={() => handleDefinirServicio(estudiante)}
                        title="Definir Servicio"
                      >
                        <Settings size={18} />
                        Definir Servicio
                      </button>
                    )}
                    {['LISTO_EXAMEN', 'GRADUADO', 'RETIRADO'].includes(estudiante.estado) && (
                      <button
                        className="btn-definir"
                        onClick={() => handleReactivar(estudiante)}
                        title="Reactivar para nuevo servicio"
                      >
                        <Settings size={18} />
                        Reactivar
                      </button>
                    )}
                    <button 
                      className="btn-ver"
                      onClick={() => navigate(`/estudiantes/${estudiante.id}`)}
                    >
                      <Eye size={18} />
                      Ver Detalle
                    </button>
                  </div>
                </div>
                </div>
                )}
              </div>
              );
            })
          )}
        </div>
      )}

      {/* Paginación */}
      {!isLoading && totalPaginas > 1 && (
        <div className="pagination">
          <button 
            onClick={() => cambiarPagina(paginaActual - 1)}
            disabled={paginaActual === 1}
            className="pagination-btn"
          >
            « Anterior
          </button>
          
          <div className="pagination-info">
            <span>Página {paginaActual} de {totalPaginas}</span>
            <span className="total-registros">({totalEstudiantes} estudiantes)</span>
          </div>
          
          <button 
            onClick={() => cambiarPagina(paginaActual + 1)}
            disabled={paginaActual === totalPaginas}
            className="pagination-btn"
          >
            Siguiente »
          </button>
        </div>
      )}

      {/* Modal Definir Servicio */}
      {mostrarModal && estudianteSeleccionado && (
        <DefinirServicioModal
          estudiante={estudianteSeleccionado}
          onClose={handleModalClose}
          onSuccess={handleModalSuccess}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(estudianteReactivar)}
        title="Reactivar estudiante"
        message="¿Deseas reactivar este estudiante para asignarle un nuevo servicio?"
        confirmText="Sí, reactivar"
        cancelText="Cancelar"
        isLoading={reactivandoEstudiante}
        onCancel={() => setEstudianteReactivar(null)}
        onConfirm={() => void confirmarReactivar()}
      />
    </div>
  );
};
