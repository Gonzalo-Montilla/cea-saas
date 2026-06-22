import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { instructoresAPI } from '../services/api';
import { 
  UserCheck, Search, Plus, Eye, Star, Phone, Award, 
  AlertCircle, Filter, X, AlertTriangle, Clock, ChevronDown
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { InstructorForm } from '../components/InstructorForm';
import '../styles/Instructores.css';
import '../styles/InstructorForm.css';

interface Instructor {
  id: number;
  usuario_id: number;
  nombre_completo: string;
  cedula: string;
  telefono: string;
  foto_url?: string;
  licencia_numero: string;
  categorias_enseña: string;
  especialidad?: string;
  estado: string;
  calificacion_promedio: number;
  estado_documentacion?: string;
  licencia_vigencia_hasta?: string;
  certificado_vigencia_hasta?: string;
}

export const Instructores = () => {
  const navigate = useNavigate();
  const [instructores, setInstructores] = useState<Instructor[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDebounced, setBusquedaDebounced] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [instructorEditar, setInstructorEditar] = useState<Instructor | null>(null);
  const prevBusquedaRef = useRef('');
  const [tarjetasExpandidas, setTarjetasExpandidas] = useState<Set<number>>(new Set());
  
  // Paginación
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalInstructores, setTotalInstructores] = useState(0);
  const instructoresPorPagina = 12;

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
    cargarInstructores();
  }, [paginaActual, estadoFiltro, busquedaDebounced]);

  const cargarInstructores = async () => {
    try {
      setIsLoading(true);
      const skip = (paginaActual - 1) * instructoresPorPagina;
      const response = await instructoresAPI.getAll({ 
        skip, 
        limit: instructoresPorPagina,
        estado: estadoFiltro || undefined,
        busqueda: busquedaDebounced || undefined
      });
      
      setInstructores(response.items || []);
      setTotalInstructores(response.total || 0);
    } catch (err) {
      console.error('Error al cargar instructores:', err);
      setError('No se pudo cargar la lista de instructores.');
      setInstructores([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLimpiarFiltros = () => {
    setBusqueda('');
    setEstadoFiltro('');
    setPaginaActual(1);
  };

  const handleNuevoInstructor = () => {
    setInstructorEditar(null);
    setMostrarFormulario(true);
  };

  const handleFormularioClose = () => {
    setMostrarFormulario(false);
    setInstructorEditar(null);
  };

  const handleFormularioSuccess = () => {
    cargarInstructores();
    handleFormularioClose();
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
    const cal = Math.round(calificacion * 2) / 2; // Redondear a 0.5
    
    for (let i = 1; i <= 5; i++) {
      if (i <= cal) {
        estrellas.push(<Star key={i} size={14} fill="#f59e0b" color="#f59e0b" />);
      } else if (i - 0.5 === cal) {
        estrellas.push(<Star key={i} size={14} fill="#f59e0b" color="#f59e0b" style={{ clipPath: 'inset(0 50% 0 0)' }} />);
      } else {
        estrellas.push(<Star key={i} size={14} color="#d1d5db" />);
      }
    }
    
    return estrellas;
  };

  const totalPaginas = Math.ceil(totalInstructores / instructoresPorPagina);

  const cambiarPagina = (nuevaPagina: number) => {
    if (nuevaPagina >= 1 && nuevaPagina <= totalPaginas) {
      setPaginaActual(nuevaPagina);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const toggleTarjeta = (instructorId: number) => {
    setTarjetasExpandidas(prev => {
      const newSet = new Set(prev);
      if (newSet.has(instructorId)) {
        newSet.delete(instructorId);
      } else {
        newSet.add(instructorId);
      }
      return newSet;
    });
  };

  return (
    <div className="instructores-container">
      <PageHeader
        title="Instructores"
        subtitle="Gestión de instructores y estados"
        icon={<UserCheck size={20} />}
        actions={
          <button className="btn-nuevo" onClick={handleNuevoInstructor}>
            <Plus size={20} />
            Nuevo Instructor
          </button>
        }
      />

      {/* Búsqueda y Filtros */}
      <div className="instructores-filtros">
        <div className="filtros-row">
          <div className="form-group">
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Nombre, cédula o licencia..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setBusquedaDebounced(busqueda.trim())}
            />
          </div>

          <div className="form-group">
            <label>Estado</label>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="ACTIVO">Activos</option>
              <option value="LICENCIA_MEDICA">Licencia Médica</option>
              <option value="VACACIONES">Vacaciones</option>
              <option value="INACTIVO">Inactivos</option>
            </select>
          </div>

          <div className="form-group">
            <label>&nbsp;</label>
            <button onClick={() => setBusquedaDebounced(busqueda.trim())} className="btn-primary" style={{width: '100%'}}>
              <Search size={16} />
              Buscar
            </button>
          </div>

          {(busqueda || estadoFiltro) && (
            <div className="form-group">
              <label>&nbsp;</label>
              <button onClick={handleLimpiarFiltros} className="btn-limpiar">
                <X size={16} />
                Limpiar
              </button>
            </div>
          )}

          <div className="form-group">
            <label>&nbsp;</label>
            <div style={{ padding: '0.625rem 0', color: '#666', fontSize: '0.9rem' }}>
              {totalInstructores} instructor{totalInstructores !== 1 ? 'es' : ''}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-alert">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* Grid de Instructores */}
      {isLoading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Cargando instructores...</p>
        </div>
      ) : (
        <>
          {instructores.length === 0 ? (
            <div className="no-instructores">
              <UserCheck size={64} />
              <h3>No se encontraron instructores</h3>
              {busqueda || estadoFiltro ? (
                <p>Intenta ajustar los filtros de búsqueda</p>
              ) : (
                <p>Comienza agregando tu primer instructor</p>
              )}
            </div>
          ) : (
            <>
              <div className="instructores-grid">
                {instructores.map((instructor) => {
                  const isExpanded = tarjetasExpandidas.has(instructor.id);
                  return (
                    <div key={instructor.id} className={`instructor-card ${isExpanded ? 'expanded' : 'collapsed'}`}>
                      <div
                        className="card-header clickeable"
                        onClick={() => toggleTarjeta(instructor.id)}
                      >
                        <div className="instructor-foto">
                          {instructor.foto_url ? (
                            <img src={instructor.foto_url} alt={instructor.nombre_completo} />
                          ) : (
                            <div className="foto-placeholder">
                              <span>{instructor.nombre_completo.charAt(0)}</span>
                            </div>
                          )}
                        </div>
                        <div className="instructor-info">
                          <h3>{instructor.nombre_completo}</h3>
                          <p className="cedula">CC: {instructor.cedula}</p>
                          <p className="matricula">Lic: {instructor.licencia_numero}</p>
                        </div>
                        <ChevronDown
                          size={24}
                          className={`chevron-toggle ${isExpanded ? '' : 'rotated'}`}
                        />
                      </div>

                      {isExpanded && (
                        <>
                          <div className="card-body">
                            <div className="info-row">
                              <span className="label">Teléfono:</span>
                              <span className="value">{instructor.telefono}</span>
                            </div>
                            <div className="info-row">
                              <span className="label">Categorías:</span>
                              <span className="value">{instructor.categorias_enseña || 'N/A'}</span>
                            </div>
                            {instructor.especialidad && (
                              <div className="info-row">
                                <span className="label">Especialidad:</span>
                                <span className="value">{instructor.especialidad}</span>
                              </div>
                            )}
                            <div className="info-row">
                              <span className="label">Calificación:</span>
                              <span className="value">
                                <span className="rating-inline">
                                  {renderEstrellas(Number(instructor.calificacion_promedio) || 0)}
                                </span>
                                {Number(instructor.calificacion_promedio || 0).toFixed(1)}
                              </span>
                            </div>
                            {instructor.estado_documentacion && (
                              <div className="info-row">
                                <span className="label">Documentación:</span>
                                <span className="value">{instructor.estado_documentacion}</span>
                              </div>
                            )}
                            {instructor.licencia_vigencia_hasta && (
                              <div className="info-row">
                                <span className="label">Vigencia Licencia:</span>
                                <span className="value">{instructor.licencia_vigencia_hasta}</span>
                              </div>
                            )}
                            {instructor.certificado_vigencia_hasta && (
                              <div className="info-row">
                                <span className="label">Vigencia Certificado:</span>
                                <span className="value">{instructor.certificado_vigencia_hasta}</span>
                              </div>
                            )}
                          </div>

                          <div className="card-footer">
                            <span className={`badge ${getEstadoBadgeClass(instructor.estado)}`}>
                              {getEstadoTexto(instructor.estado)}
                            </span>
                            <div className="card-actions">
                              <button
                                className="btn-ver"
                                onClick={() => navigate(`/instructores/${instructor.id}`)}
                              >
                                <Eye size={18} />
                                Ver Detalle
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Paginación */}
              {totalPaginas > 1 && (
                <div className="pagination">
                  <button
                    onClick={() => cambiarPagina(paginaActual - 1)}
                    disabled={paginaActual === 1}
                    className="pagination-btn"
                  >
                    Anterior
                  </button>
                  <span className="pagination-info">
                    Página {paginaActual} de {totalPaginas}
                  </span>
                  <button
                    onClick={() => cambiarPagina(paginaActual + 1)}
                    disabled={paginaActual === totalPaginas}
                    className="pagination-btn"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal de Formulario */}
      {mostrarFormulario && (
        <InstructorForm
          instructor={instructorEditar}
          onClose={handleFormularioClose}
          onSuccess={handleFormularioSuccess}
        />
      )}
    </div>
  );
};
