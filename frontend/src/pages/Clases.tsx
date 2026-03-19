import { useEffect, useMemo, useState } from 'react';
import { Search, Clock, User, Calendar, Download, CheckCircle2, XCircle, CalendarClock } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { clasesAPI, estudiantesAPI, instructoresAPI, vehiculosAPI, type ClaseItem } from '../services/api';
import '../styles/Clases.css';

interface Estudiante {
  id: number;
  nombre_completo: string;
  cedula: string;
  tipo_documento?: string;
  telefono: string;
  email: string;
  foto_url?: string;
  categoria?: string;
  tipo_servicio?: string;
  estado: string;
  horas_teoricas_completadas: number;
  horas_teoricas_requeridas: number;
  horas_practicas_completadas: number;
  horas_practicas_requeridas: number;
  progreso_teorico: number;
  progreso_practico: number;
  clases_historial?: {
    fecha: string;
    tipo: string;
    horas: number;
    observaciones?: string;
    usuario_id?: number;
    servicio_id?: number | null;
    instructor_id?: number;
    instructor_nombre?: string;
    vehiculo_id?: number;
    vehiculo_label?: string;
  }[];
  servicios?: {
    id: number;
    tipo_servicio?: string;
    estado?: string;
    horas_teoricas_completadas?: number;
    horas_practicas_completadas?: number;
    horas_teoricas_requeridas?: number;
    horas_practicas_requeridas?: number;
  }[];
  servicio_activo_id?: number | null;
}

export const Clases = () => {
  const [cedula, setCedula] = useState('');
  const [estudiante, setEstudiante] = useState<Estudiante | null>(null);
  const [tipo, setTipo] = useState<'TEORICA' | 'PRACTICA'>('TEORICA');
  const [horas, setHoras] = useState('1');
  const [observaciones, setObservaciones] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [instructores, setInstructores] = useState<any[]>([]);
  const [vehiculos, setVehiculos] = useState<any[]>([]);
  const [fechaProgramada, setFechaProgramada] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingAgenda, setLoadingAgenda] = useState(false);
  const [agenda, setAgenda] = useState<ClaseItem[]>([]);
  const [estadoFiltro, setEstadoFiltro] = useState<'PROGRAMADA' | 'COMPLETADA' | 'CANCELADA' | ''>('PROGRAMADA');
  const [tipoFiltro, setTipoFiltro] = useState<'TEORICA' | 'PRACTICA' | ''>('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [modalAction, setModalAction] = useState<'REPROGRAMAR' | 'COMPLETAR' | 'CANCELAR' | null>(null);
  const [claseSeleccionada, setClaseSeleccionada] = useState<ClaseItem | null>(null);
  const [modalFecha, setModalFecha] = useState('');
  const [modalDuracion, setModalDuracion] = useState('1');
  const [modalInstructorId, setModalInstructorId] = useState('');
  const [modalVehiculoId, setModalVehiculoId] = useState('');
  const [modalObservaciones, setModalObservaciones] = useState('');
  const [modalAcreditarHoras, setModalAcreditarHoras] = useState(true);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [checkingConflict, setCheckingConflict] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [servicioSeleccionado, setServicioSeleccionado] = useState<number | 'TODOS'>('TODOS');

  const sinPractica = new Set([
    'CERTIFICADO_MOTO',
    'CERTIFICADO_B1',
    'CERTIFICADO_C1',
    'CERTIFICADO_B1_SIN_PRACTICA',
    'CERTIFICADO_C1_SIN_PRACTICA',
    'CERTIFICADO_A2_B1_SIN_PRACTICA',
    'CERTIFICADO_A2_C1_SIN_PRACTICA'
  ]);

  const getServicioSeleccionado = () => {
    if (!estudiante) return null;
    const servicios = estudiante.servicios || [];
    const id = servicioSeleccionado === 'TODOS'
      ? estudiante.servicio_activo_id
      : servicioSeleccionado;
    if (!id) return null;
    return servicios.find((s) => s.id === id) || null;
  };

  const getTipoServicioSeleccionado = () => {
    const servicio = getServicioSeleccionado();
    return servicio?.tipo_servicio || estudiante?.tipo_servicio || null;
  };

  const resolverValor = (valorServicio?: number, fallback?: number) => {
    if (valorServicio === undefined || valorServicio === null) return fallback || 0;
    if (valorServicio === 0 && (fallback || 0) > 0) return fallback || 0;
    return valorServicio;
  };

  const getProgreso = (completadas?: number, requeridas?: number) => {
    if (!requeridas) return 0;
    return Math.min(100, (Number(completadas || 0) / Number(requeridas)) * 100);
  };

  const formatDocumentoBusqueda = (value: string) => {
    return value.toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 20);
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

  const getErrorMessage = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    if (Array.isArray(detail)) return fallback;
    return detail || fallback;
  };

  const toDateTimeLocal = (iso: string) => {
    const date = new Date(iso);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };

  const overlap = (startA: Date, endA: Date, startB: Date, endB: Date) =>
    startA < endB && startB < endA;

  const cargarListas = async () => {
    try {
      const [inst, veh] = await Promise.all([
        instructoresAPI.getAll({ estado: 'ACTIVO', limit: 100 }),
        vehiculosAPI.getAll({ activo: true, limit: 100 })
      ]);
      setInstructores(inst.items || []);
      setVehiculos(veh.items || []);
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudieron cargar instructores o vehículos'));
    }
  };

  const cargarAgenda = async () => {
    try {
      setLoadingAgenda(true);
      const response = await clasesAPI.getAll({
        limit: 100,
        estado: estadoFiltro || undefined,
        tipo: tipoFiltro || undefined,
        fecha_desde: fechaDesde ? new Date(`${fechaDesde}T00:00:00`).toISOString() : undefined,
        fecha_hasta: fechaHasta ? new Date(`${fechaHasta}T23:59:59`).toISOString() : undefined
      });
      setAgenda(response.items || []);
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo cargar la agenda de clases'));
      setAgenda([]);
    } finally {
      setLoadingAgenda(false);
    }
  };

  useEffect(() => {
    void cargarListas();
  }, []);

  useEffect(() => {
    void cargarAgenda();
  }, [estadoFiltro, tipoFiltro, fechaDesde, fechaHasta]);

  const buscar = async () => {
    const documento = formatDocumentoBusqueda(cedula.trim());
    if (!documento) return;
    try {
      setLoading(true);
      setError('');
      const data = await estudiantesAPI.getByCedula(documento);
      setEstudiante(data as Estudiante);
      setServicioSeleccionado((data as Estudiante).servicio_activo_id ?? 'TODOS');
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se encontró el estudiante'));
      setEstudiante(null);
    } finally {
      setLoading(false);
    }
  };

  const programarClase = async () => {
    if (!estudiante) {
      setError('Primero busca y selecciona un estudiante');
      return;
    }
    if (!instructorId) {
      setError('Selecciona instructor');
      return;
    }
    if (!fechaProgramada) {
      setError('Selecciona fecha y hora');
      return;
    }
    const horasInt = parseInt(horas, 10);
    if (!horasInt || horasInt <= 0) {
      setError('La duración debe ser mayor a 0');
      return;
    }
    const tipoServicio = getTipoServicioSeleccionado();
    if (tipo === 'PRACTICA') {
      if (!vehiculoId) {
        setError('Selecciona vehículo para clase práctica');
        return;
      }
      if (tipoServicio && sinPractica.has(tipoServicio)) {
        setError('Este servicio no permite clases prácticas');
        return;
      }
    }

    try {
      setLoading(true);
      setError('');
      await clasesAPI.create({
        estudiante_id: estudiante.id,
        instructor_id: Number(instructorId),
        vehiculo_id: tipo === 'PRACTICA' ? Number(vehiculoId) : undefined,
        tipo,
        fecha_programada: new Date(fechaProgramada).toISOString(),
        duracion_horas: horasInt,
        observaciones: observaciones.trim() || undefined
      });
      setObservaciones('');
      setHoras('1');
      setVehiculoId('');
      setFechaProgramada('');
      await cargarAgenda();
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo programar la clase'));
    } finally {
      setLoading(false);
    }
  };

  const recargarEstudianteActual = async (estudianteId: number) => {
    if (!estudiante || estudiante.id !== estudianteId) return;
    try {
      const actualizado = (await estudiantesAPI.getById(estudianteId)) as unknown as Estudiante;
      setEstudiante(actualizado);
      setServicioSeleccionado(actualizado.servicio_activo_id ?? 'TODOS');
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo refrescar el estado del estudiante'));
    }
  };

  const completarClase = async (clase: ClaseItem, acreditar: boolean, obs?: string) => {
    try {
      setLoadingAgenda(true);
      await clasesAPI.completar(clase.id, { acreditar_horas: acreditar, observaciones: obs });
      await cargarAgenda();
      await recargarEstudianteActual(clase.estudiante_id);
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo completar la clase'));
    } finally {
      setLoadingAgenda(false);
    }
  };

  const cancelarClase = async (clase: ClaseItem, motivo?: string) => {
    try {
      setLoadingAgenda(true);
      await clasesAPI.cancelar(clase.id, { motivo });
      await cargarAgenda();
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo cancelar la clase'));
    } finally {
      setLoadingAgenda(false);
    }
  };

  const reprogramarClase = async (
    clase: ClaseItem,
    nuevaFecha: string,
    nuevaDuracion: number,
    instructorId?: number,
    vehiculoId?: number | null,
    observ?: string
  ) => {
    try {
      setLoadingAgenda(true);
      await clasesAPI.reprogramar(clase.id, {
        fecha_programada: new Date(nuevaFecha).toISOString(),
        duracion_horas: nuevaDuracion,
        instructor_id: instructorId,
        vehiculo_id: vehiculoId,
        observaciones: observ
      });
      await cargarAgenda();
    } catch (err: any) {
      setError(getErrorMessage(err, 'No se pudo reprogramar la clase'));
    } finally {
      setLoadingAgenda(false);
    }
  };

  const openActionModal = (action: 'REPROGRAMAR' | 'COMPLETAR' | 'CANCELAR', clase: ClaseItem) => {
    setClaseSeleccionada(clase);
    setModalAction(action);
    setModalFecha(toDateTimeLocal(clase.fecha_programada));
    setModalDuracion(String(clase.duracion_horas || 1));
    setModalInstructorId(clase.instructor_id ? String(clase.instructor_id) : '');
    setModalVehiculoId(clase.vehiculo_id ? String(clase.vehiculo_id) : '');
    setModalObservaciones('');
    setModalAcreditarHoras(true);
  };

  const closeActionModal = () => {
    setModalAction(null);
    setClaseSeleccionada(null);
    setModalObservaciones('');
    setModalInstructorId('');
    setModalVehiculoId('');
    setConflictWarning(null);
    setSubmittingModal(false);
  };

  const submitActionModal = async () => {
    if (!claseSeleccionada || !modalAction) return;
    try {
      setSubmittingModal(true);
      setError('');
      if (modalAction === 'REPROGRAMAR') {
        if (!modalFecha) {
          setError('Debes seleccionar fecha y hora de reprogramación');
          return;
        }
        const dur = parseInt(modalDuracion, 10);
        if (!dur || dur <= 0) {
          setError('La duración debe ser mayor a 0');
          return;
        }
        const instructorParsed = parseInt(modalInstructorId, 10);
        if (!instructorParsed) {
          setError('Debes seleccionar instructor para reprogramar');
          return;
        }
        const vehiculoParsed = modalVehiculoId ? parseInt(modalVehiculoId, 10) : null;
        if (claseSeleccionada.tipo === 'PRACTICA' && !vehiculoParsed) {
          setError('Debes seleccionar vehículo para clase práctica');
          return;
        }
        await reprogramarClase(
          claseSeleccionada,
          new Date(modalFecha).toISOString(),
          dur,
          instructorParsed,
          vehiculoParsed,
          modalObservaciones.trim() || undefined
        );
      } else if (modalAction === 'COMPLETAR') {
        await completarClase(
          claseSeleccionada,
          modalAcreditarHoras,
          modalObservaciones.trim() || undefined
        );
      } else {
        await cancelarClase(
          claseSeleccionada,
          modalObservaciones.trim() || undefined
        );
      }
      closeActionModal();
    } finally {
      setSubmittingModal(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      if (modalAction !== 'REPROGRAMAR' || !claseSeleccionada || !modalFecha) {
        setConflictWarning(null);
        return;
      }
      const dur = parseInt(modalDuracion, 10);
      const instructorParsed = parseInt(modalInstructorId, 10);
      const vehiculoParsed = modalVehiculoId ? parseInt(modalVehiculoId, 10) : null;
      if (!dur || dur <= 0 || !instructorParsed) {
        setConflictWarning(null);
        return;
      }
      if (claseSeleccionada.tipo === 'PRACTICA' && !vehiculoParsed) {
        setConflictWarning(null);
        return;
      }
      const start = new Date(modalFecha);
      const end = new Date(start.getTime() + dur * 60 * 60 * 1000);
      const queryFrom = new Date(start.getTime() - 8 * 60 * 60 * 1000).toISOString();
      const queryTo = new Date(end.getTime() + 8 * 60 * 60 * 1000).toISOString();
      try {
        setCheckingConflict(true);
        setConflictWarning(null);
        const [instructorAgenda, vehiculoAgenda] = await Promise.all([
          clasesAPI.getAll({
            estado: 'PROGRAMADA',
            instructor_id: instructorParsed,
            fecha_desde: queryFrom,
            fecha_hasta: queryTo,
            limit: 100
          }),
          claseSeleccionada.tipo === 'PRACTICA' && vehiculoParsed
            ? clasesAPI.getAll({
                estado: 'PROGRAMADA',
                vehiculo_id: vehiculoParsed,
                fecha_desde: queryFrom,
                fecha_hasta: queryTo,
                limit: 100
              })
            : Promise.resolve({ items: [], total: 0, skip: 0, limit: 100 })
        ]);
        const overlapInstructor = (instructorAgenda.items || []).some((item) => {
          if (item.id === claseSeleccionada.id) return false;
          const otherStart = new Date(item.fecha_programada);
          const otherEnd = new Date(otherStart.getTime() + (item.duracion_horas || 1) * 60 * 60 * 1000);
          return overlap(start, end, otherStart, otherEnd);
        });
        const overlapVehiculo = (vehiculoAgenda.items || []).some((item) => {
          if (item.id === claseSeleccionada.id) return false;
          const otherStart = new Date(item.fecha_programada);
          const otherEnd = new Date(otherStart.getTime() + (item.duracion_horas || 1) * 60 * 60 * 1000);
          return overlap(start, end, otherStart, otherEnd);
        });
        if (overlapInstructor && overlapVehiculo) {
          setConflictWarning('Posible conflicto detectado: instructor y vehículo ocupados en ese rango.');
        } else if (overlapInstructor) {
          setConflictWarning('Posible conflicto detectado: el instructor ya tiene otra clase en ese rango.');
        } else if (overlapVehiculo) {
          setConflictWarning('Posible conflicto detectado: el vehículo ya está reservado en ese rango.');
        } else {
          setConflictWarning(null);
        }
      } catch {
        setConflictWarning(null);
      } finally {
        setCheckingConflict(false);
      }
    };
    const timer = window.setTimeout(() => {
      void run();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [modalAction, claseSeleccionada, modalFecha, modalDuracion, modalInstructorId, modalVehiculoId]);

  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const escape = (value: string | number) => {
      const str = String(value ?? '');
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportClasesCSV = () => {
    if (!estudiante) return;
    const historial = estudiante.clases_historial || [];
    const filtrado = servicioSeleccionado === 'TODOS'
      ? historial
      : historial.filter((h) => h.servicio_id === servicioSeleccionado);
    const rows: (string | number)[][] = [
      ['Estudiante', estudiante.nombre_completo],
      ['Documento', estudiante.cedula],
      ['Email', estudiante.email],
      ['Teléfono', estudiante.telefono],
      ['Servicio', servicioSeleccionado === 'TODOS' ? 'TODOS' : `Servicio ${servicioSeleccionado}`],
      [],
      ['Fecha', 'Tipo', 'Horas', 'Observaciones']
    ];
    filtrado.forEach((h) => {
      rows.push([
        new Date(h.fecha).toLocaleString('es-CO'),
        h.tipo,
        h.horas,
        h.observaciones || ''
      ]);
    });
    downloadCSV(`clases_${estudiante.cedula}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const agendaCountText = useMemo(
    () => `${agenda.length} clase${agenda.length !== 1 ? 's' : ''} en agenda`,
    [agenda.length]
  );

  const getEstadoClass = (estado: string) => {
    if (estado === 'PROGRAMADA') return 'badge-programada';
    if (estado === 'COMPLETADA') return 'badge-completada';
    return 'badge-cancelada';
  };

  return (
    <div className="clases-container">
      <PageHeader
        title="Clases"
        subtitle="Programación, ejecución y control de clases"
        icon={<Calendar size={20} />}
        actions={
          <button
            className="btn-nuevo"
            onClick={exportClasesCSV}
            disabled={!estudiante || !(estudiante.clases_historial || []).length}
          >
            <Download size={16} /> Exportar CSV
          </button>
        }
      />

      <div className="search-section clases-busqueda">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por documento"
            value={cedula}
            onChange={(e) => setCedula(formatDocumentoBusqueda(e.target.value))}
            className="search-input"
          />
        </div>
        <button className="btn-nuevo btn-search" onClick={buscar} disabled={loading}>
          <Search size={16} /> Buscar
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {estudiante && (
        <div className="clases-card">
          <div className="clases-header">
            <div className="clases-foto">
              {estudiante.foto_url ? (
                <img src={estudiante.foto_url} alt={estudiante.nombre_completo} />
              ) : (
                <div className="clases-foto-placeholder"><User size={28} /></div>
              )}
            </div>
            <div className="clases-info">
              <h3>{estudiante.nombre_completo}</h3>
              <p>{getTipoDocumentoLabel(estudiante.tipo_documento)}: {estudiante.cedula}</p>
              <p>{estudiante.email} • {estudiante.telefono}</p>
              <p>Estado: {estudiante.estado}</p>
              {estudiante.categoria && <p>Categoría: {estudiante.categoria}</p>}
            </div>
          </div>

          <div className="clases-progreso">
            {(() => {
              const servicio = getServicioSeleccionado();
              const teoricasCompletadas = resolverValor(
                servicio?.horas_teoricas_completadas,
                estudiante.horas_teoricas_completadas
              );
              const teoricasRequeridas = resolverValor(
                servicio?.horas_teoricas_requeridas,
                estudiante.horas_teoricas_requeridas
              );
              const practicasCompletadas = resolverValor(
                servicio?.horas_practicas_completadas,
                estudiante.horas_practicas_completadas
              );
              const practicasRequeridas = resolverValor(
                servicio?.horas_practicas_requeridas,
                estudiante.horas_practicas_requeridas
              );
              const progresoTeorico = getProgreso(teoricasCompletadas, teoricasRequeridas);
              const progresoPractico = getProgreso(practicasCompletadas, practicasRequeridas);
              return (
                <>
                  <div>
                    <strong>Teóricas:</strong> {teoricasCompletadas}/{teoricasRequeridas}
                    <div className="progreso-bar">
                      <div className="progreso-fill" style={{ width: `${progresoTeorico}%` }}></div>
                      <span className="progreso-text">{progresoTeorico.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <strong>Prácticas:</strong> {practicasCompletadas}/{practicasRequeridas}
                    <div className="progreso-bar">
                      <div className="progreso-fill progreso-practica" style={{ width: `${progresoPractico}%` }}></div>
                      <span className="progreso-text">{progresoPractico.toFixed(0)}%</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="form-group">
            <label>Servicio</label>
            <select
              value={servicioSeleccionado}
              onChange={(e) => {
                const value = e.target.value;
                setServicioSeleccionado(value === 'TODOS' ? 'TODOS' : Number(value));
              }}
            >
              <option value="TODOS">Todos los servicios</option>
              {estudiante.servicios && estudiante.servicios.length > 0 && estudiante.servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  Servicio {s.id} {s.estado ? `(${s.estado})` : ''}
                </option>
              ))}
              {(!estudiante.servicios || estudiante.servicios.length === 0) && estudiante.servicio_activo_id && (
                <option value={estudiante.servicio_activo_id}>Servicio {estudiante.servicio_activo_id}</option>
              )}
            </select>
          </div>

          <div className="clases-form">
            <h4>Programar nueva clase</h4>
            <div className="form-group">
              <label>Tipo de clase</label>
              <select
                value={tipo}
                onChange={(e) => {
                  const next = e.target.value as 'TEORICA' | 'PRACTICA';
                  setTipo(next);
                  if (next !== 'PRACTICA') setVehiculoId('');
                }}
              >
                <option value="TEORICA">Teórica</option>
                <option value="PRACTICA">Práctica</option>
              </select>
            </div>
            <div className="form-group">
              <label>Instructor</label>
              <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">Selecciona instructor</option>
                {instructores.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            {tipo === 'PRACTICA' && (
              <div className="form-group">
                <label>Vehículo</label>
                <select value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)}>
                  <option value="">Selecciona vehículo</option>
                  {vehiculos.map((veh) => (
                    <option key={veh.id} value={veh.id}>
                      {veh.placa} - {veh.marca} {veh.modelo}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Duración (horas)</label>
              <input type="number" min="1" value={horas} onChange={(e) => setHoras(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Fecha y hora</label>
              <input
                type="datetime-local"
                value={fechaProgramada}
                onChange={(e) => setFechaProgramada(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Observaciones</label>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={programarClase} disabled={loading}>
              <Clock size={16} /> Programar clase
            </button>
          </div>

          <div className="clases-historial">
            <h4>Historial de clases acreditadas</h4>
            {estudiante.clases_historial && estudiante.clases_historial.length > 0 ? (
              <div className="historial-list">
                {(servicioSeleccionado === 'TODOS'
                  ? estudiante.clases_historial
                  : estudiante.clases_historial.filter((h) => h.servicio_id === servicioSeleccionado))
                  .slice()
                  .reverse()
                  .map((h, idx) => (
                    <div key={`${h.fecha}-${idx}`} className="historial-item">
                      <div>
                        <strong>{h.tipo}</strong> • {h.horas}h
                      </div>
                      <div className="historial-fecha">
                        {new Date(h.fecha).toLocaleString('es-CO')}
                      </div>
                      <div className="historial-obs">
                        {h.instructor_nombre && <span>Instructor: {h.instructor_nombre}</span>}
                        {h.vehiculo_label && <span> • Vehículo: {h.vehiculo_label}</span>}
                      </div>
                      {h.observaciones && <div className="historial-obs">Obs: {h.observaciones}</div>}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="historial-empty">Sin registros aún.</div>
            )}
          </div>
        </div>
      )}

      <div className="agenda-card">
        <div className="agenda-header">
          <h3>Agenda de clases</h3>
          <span>{agendaCountText}</span>
        </div>
        <div className="agenda-filters">
          <div className="form-group">
            <label>Estado</label>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value as 'PROGRAMADA' | 'COMPLETADA' | 'CANCELADA' | '')}
            >
              <option value="">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="COMPLETADA">Completada</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as 'TEORICA' | 'PRACTICA' | '')}>
              <option value="">Todos</option>
              <option value="TEORICA">Teórica</option>
              <option value="PRACTICA">Práctica</option>
            </select>
          </div>
          <div className="form-group">
            <label>Desde</label>
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>
        </div>

        {loadingAgenda ? (
          <div className="historial-empty">Cargando agenda...</div>
        ) : agenda.length === 0 ? (
          <div className="historial-empty">No hay clases para los filtros seleccionados.</div>
        ) : (
          <div className="agenda-table-wrapper">
            <table className="agenda-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estudiante</th>
                  <th>Instructor</th>
                  <th>Tipo</th>
                  <th>Vehículo</th>
                  <th>Duración</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((clase) => (
                  <tr key={clase.id}>
                    <td>{new Date(clase.fecha_programada).toLocaleString('es-CO')}</td>
                    <td>{clase.estudiante_nombre}</td>
                    <td>{clase.instructor_nombre || '-'}</td>
                    <td>{clase.tipo}</td>
                    <td>{clase.vehiculo_label || '-'}</td>
                    <td>{clase.duracion_horas}h</td>
                    <td>
                      <span className={`agenda-badge ${getEstadoClass(clase.estado)}`}>{clase.estado}</span>
                    </td>
                    <td>
                      {clase.estado === 'PROGRAMADA' ? (
                        <div className="agenda-actions">
                          <button type="button" className="btn-icon-action info" onClick={() => openActionModal('REPROGRAMAR', clase)}>
                            <CalendarClock size={16} />
                          </button>
                          <button type="button" className="btn-icon-action success" onClick={() => openActionModal('COMPLETAR', clase)}>
                            <CheckCircle2 size={16} />
                          </button>
                          <button type="button" className="btn-icon-action danger" onClick={() => openActionModal('CANCELAR', clase)}>
                            <XCircle size={16} />
                          </button>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalAction && claseSeleccionada && (
        <div className="clases-modal-overlay" onClick={closeActionModal}>
          <div className="clases-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="clases-modal-header">
              <h3>
                {modalAction === 'REPROGRAMAR' && 'Reprogramar clase'}
                {modalAction === 'COMPLETAR' && 'Completar clase'}
                {modalAction === 'CANCELAR' && 'Cancelar clase'}
              </h3>
              <button type="button" className="btn-icon-action" onClick={closeActionModal}>×</button>
            </div>

            <div className="clases-modal-body">
              <p className="clases-modal-meta">
                <strong>{claseSeleccionada.estudiante_nombre}</strong> • {new Date(claseSeleccionada.fecha_programada).toLocaleString('es-CO')}
              </p>

              {modalAction === 'REPROGRAMAR' && (
                <>
                  <div className="form-group">
                    <label>Instructor</label>
                    <select value={modalInstructorId} onChange={(e) => setModalInstructorId(e.target.value)}>
                      <option value="">Selecciona instructor</option>
                      {instructores.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.nombre_completo}
                        </option>
                      ))}
                    </select>
                  </div>
                  {claseSeleccionada.tipo === 'PRACTICA' && (
                    <div className="form-group">
                      <label>Vehículo</label>
                      <select value={modalVehiculoId} onChange={(e) => setModalVehiculoId(e.target.value)}>
                        <option value="">Selecciona vehículo</option>
                        {vehiculos.map((veh) => (
                          <option key={veh.id} value={veh.id}>
                            {veh.placa} - {veh.marca} {veh.modelo}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="form-group">
                    <label>Nueva fecha y hora</label>
                    <input
                      type="datetime-local"
                      value={modalFecha}
                      onChange={(e) => setModalFecha(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Nueva duración (horas)</label>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={modalDuracion}
                      onChange={(e) => setModalDuracion(e.target.value)}
                    />
                  </div>
                  {checkingConflict && (
                    <div className="clases-conflict-info">Validando conflictos de agenda...</div>
                  )}
                  {!checkingConflict && conflictWarning && (
                    <div className="clases-conflict-warning">{conflictWarning}</div>
                  )}
                </>
              )}

              {modalAction === 'COMPLETAR' && (
                <label className="clases-check">
                  <input
                    type="checkbox"
                    checked={modalAcreditarHoras}
                    onChange={(e) => setModalAcreditarHoras(e.target.checked)}
                  />
                  Acreditar horas al estudiante al completar esta clase
                </label>
              )}

              <div className="form-group">
                <label>
                  {modalAction === 'CANCELAR' ? 'Motivo (opcional)' : 'Observaciones (opcional)'}
                </label>
                <textarea
                  value={modalObservaciones}
                  onChange={(e) => setModalObservaciones(e.target.value)}
                  placeholder={
                    modalAction === 'REPROGRAMAR'
                      ? 'Ej: Reprogramada por solicitud del estudiante'
                      : modalAction === 'COMPLETAR'
                        ? 'Ej: Clase finalizada sin novedades'
                        : 'Ej: Ausencia del estudiante'
                  }
                />
              </div>
            </div>

            <div className="clases-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeActionModal} disabled={submittingModal}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => void submitActionModal()} disabled={submittingModal}>
                {submittingModal ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
