import { useEffect, useRef, useState } from 'react';
import { Car, Plus, Search, Pencil, Trash2, Eye } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { instructoresAPI, uploadsAPI, vehiculosAPI } from '../services/api';
import '../styles/Vehiculos.css';
import { useNavigate } from 'react-router-dom';
import { ModalBase } from '../components/ui/ModalBase';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ToastAlert } from '../components/ui/ToastAlert';

interface Vehiculo {
  id: number;
  placa: string;
  tipo?: string;
  marca?: string;
  modelo?: string;
  año?: number;
  color?: string;
  cilindraje?: string;
  vin?: string;
  numero_motor?: string;
  numero_chasis?: string;
  foto_url?: string;
  kilometraje_actual?: number;
  responsable_instructor_id?: number | null;
  responsable_nombre?: string | null;
  is_active: boolean;
}

const tiposVehiculo = ['MOTO', 'AUTO', 'CAMION', 'BUS', 'OTRO'];
type ToastType = 'success' | 'error' | 'info';

export const Vehiculos = () => {
  const navigate = useNavigate();
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [busquedaDebounced, setBusquedaDebounced] = useState('');
  const [filtroActivo, setFiltroActivo] = useState<'todos' | 'activos' | 'inactivos'>('activos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalVehiculos, setTotalVehiculos] = useState(0);
  const vehiculosPorPagina = 12;
  const prevBusquedaRef = useRef('');

  const [mostrarModal, setMostrarModal] = useState(false);
  const [vehiculoEditar, setVehiculoEditar] = useState<Vehiculo | null>(null);
  const [vehiculoEliminar, setVehiculoEliminar] = useState<Vehiculo | null>(null);
  const [guardandoVehiculo, setGuardandoVehiculo] = useState(false);
  const [eliminandoVehiculo, setEliminandoVehiculo] = useState(false);
  const [feedback, setFeedback] = useState<{ type: ToastType; message: string } | null>(null);

  const [placa, setPlaca] = useState('');
  const [tipo, setTipo] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [anio, setAnio] = useState('');
  const [activo, setActivo] = useState(true);
  const [color, setColor] = useState('');
  const [cilindraje, setCilindraje] = useState('');
  const [vin, setVin] = useState('');
  const [numeroMotor, setNumeroMotor] = useState('');
  const [numeroChasis, setNumeroChasis] = useState('');
  const [kilometrajeActual, setKilometrajeActual] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [responsableId, setResponsableId] = useState('');
  const [instructores, setInstructores] = useState<any[]>([]);

  const getErrorMessage = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    if (Array.isArray(detail)) return detail[0]?.msg || fallback;
    if (typeof detail === 'string') return detail;
    return fallback;
  };

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
    cargarVehiculos();
  }, [paginaActual, busquedaDebounced, filtroActivo]);

  useEffect(() => {
    const cargarInstructores = async () => {
      try {
        const data = await instructoresAPI.getAll({ estado: 'ACTIVO', limit: 100 });
        setInstructores(data.items || []);
      } catch (err) {
        console.error('Error al cargar instructores:', err);
      }
    };
    cargarInstructores();
  }, []);

  const cargarVehiculos = async () => {
    try {
      setLoading(true);
      const skip = (paginaActual - 1) * vehiculosPorPagina;
      const response = await vehiculosAPI.getAll({
        skip,
        limit: vehiculosPorPagina,
        search: busquedaDebounced || undefined,
        activo: filtroActivo === 'todos' ? undefined : filtroActivo === 'activos'
      });
      setVehiculos(response.items || []);
      setTotalVehiculos(response.total || 0);
    } catch (err) {
      console.error('Error al cargar vehículos:', err);
      setError('No se pudo cargar la lista de vehículos.');
      setVehiculos([]);
    } finally {
      setLoading(false);
    }
  };

  const abrirModalNuevo = () => {
    setVehiculoEditar(null);
    setPlaca('');
    setTipo('');
    setMarca('');
    setModelo('');
    setAnio('');
    setActivo(true);
    setColor('');
    setCilindraje('');
    setVin('');
    setNumeroMotor('');
    setNumeroChasis('');
    setKilometrajeActual('');
    setFotoUrl('');
    setResponsableId('');
    setError('');
    setMostrarModal(true);
  };

  const abrirModalEditar = (vehiculo: Vehiculo) => {
    setVehiculoEditar(vehiculo);
    setPlaca(vehiculo.placa);
    setTipo(vehiculo.tipo || '');
    setMarca(vehiculo.marca || '');
    setModelo(vehiculo.modelo || '');
    setAnio(vehiculo.año ? String(vehiculo.año) : '');
    setActivo(Boolean(vehiculo.is_active));
    setColor(vehiculo.color || '');
    setCilindraje(vehiculo.cilindraje || '');
    setVin(vehiculo.vin || '');
    setNumeroMotor((vehiculo as any).numero_motor || '');
    setNumeroChasis((vehiculo as any).numero_chasis || '');
    setKilometrajeActual(vehiculo.kilometraje_actual ? String(vehiculo.kilometraje_actual) : '');
    setFotoUrl(vehiculo.foto_url || '');
    setResponsableId(vehiculo.responsable_instructor_id ? String(vehiculo.responsable_instructor_id) : '');
    setError('');
    setMostrarModal(true);
  };

  const handleFotoSelect = async (file: File) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        const res = await uploadsAPI.uploadVehiculoFoto(base64);
        setFotoUrl(res.foto_url);
      } catch (err: any) {
        setFeedback({ type: 'error', message: getErrorMessage(err, 'No se pudo subir la foto.') });
      }
    };
    reader.readAsDataURL(file);
  };

  const guardarVehiculo = async () => {
    if (guardandoVehiculo) return;
    if (!placa.trim()) {
      setFeedback({ type: 'info', message: 'La placa es obligatoria.' });
      return;
    }
    const payload = {
      placa: placa.trim().toUpperCase(),
      tipo: tipo || null,
      marca: marca ? marca.toUpperCase() : null,
      modelo: modelo ? modelo.toUpperCase() : null,
      año: anio ? parseInt(anio) : null,
      is_active: activo,
      color: color ? color.toUpperCase() : null,
      cilindraje: cilindraje || null,
      vin: vin || null,
      numero_motor: numeroMotor || null,
      numero_chasis: numeroChasis || null,
      kilometraje_actual: kilometrajeActual ? parseInt(kilometrajeActual) : null,
      foto_url: fotoUrl || null,
      responsable_instructor_id: responsableId ? parseInt(responsableId, 10) : null
    };
    try {
      setGuardandoVehiculo(true);
      if (vehiculoEditar) {
        await vehiculosAPI.update(vehiculoEditar.id, payload);
        setFeedback({ type: 'success', message: `Vehículo ${payload.placa} actualizado con éxito.` });
      } else {
        await vehiculosAPI.create(payload);
        setFeedback({ type: 'success', message: `Vehículo ${payload.placa} creado con éxito.` });
      }
      setMostrarModal(false);
      await cargarVehiculos();
    } catch (err: any) {
      setFeedback({ type: 'error', message: getErrorMessage(err, 'No se pudo guardar el vehículo.') });
    } finally {
      setGuardandoVehiculo(false);
    }
  };

  const eliminarVehiculo = (vehiculo: Vehiculo) => {
    setVehiculoEliminar(vehiculo);
  };

  const confirmarEliminarVehiculo = async () => {
    if (!vehiculoEliminar || eliminandoVehiculo) return;
    try {
      setEliminandoVehiculo(true);
      await vehiculosAPI.delete(vehiculoEliminar.id);
      setFeedback({ type: 'success', message: `Vehículo ${vehiculoEliminar.placa} desactivado con éxito.` });
      await cargarVehiculos();
      setVehiculoEliminar(null);
    } catch (err: any) {
      setFeedback({ type: 'error', message: getErrorMessage(err, 'No se pudo desactivar el vehículo.') });
    } finally {
      setEliminandoVehiculo(false);
    }
  };

  const totalPaginas = Math.ceil(totalVehiculos / vehiculosPorPagina);

  const cambiarPagina = (nuevaPagina: number) => {
    if (nuevaPagina < 1 || nuevaPagina > totalPaginas) return;
    setPaginaActual(nuevaPagina);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="vehiculos-container">
      <PageHeader
        title="Vehículos"
        subtitle="Gestión del parque automotor"
        icon={<Car size={20} />}
        actions={
          <button className="btn-nuevo" onClick={abrirModalNuevo}>
            <Plus size={18} />
            Nuevo Vehículo
          </button>
        }
      />

      <div className="vehiculos-filtros">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar por placa, marca o modelo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value as any)}>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
        <div className="total-label">
          {totalVehiculos} vehículo{totalVehiculos !== 1 ? 's' : ''}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-container">
          <p>Cargando vehículos...</p>
        </div>
      ) : (
        <div className="vehiculos-table">
          {vehiculos.length === 0 ? (
            <div className="no-vehiculos">
              <Car size={64} />
              <h3>No se encontraron vehículos</h3>
              {busquedaDebounced || filtroActivo !== 'activos' ? (
                <p>Intenta ajustar los filtros de búsqueda</p>
              ) : (
                <p>Comienza agregando tu primer vehículo</p>
              )}
            </div>
          ) : (
            <div className="vehiculos-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Tipo</th>
                    <th>Marca</th>
                    <th>Modelo</th>
                    <th>Año</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {vehiculos.map((vehiculo) => (
                    <tr key={vehiculo.id}>
                      <td>{vehiculo.placa}</td>
                      <td>{vehiculo.tipo || '-'}</td>
                      <td>{vehiculo.marca || '-'}</td>
                      <td>{vehiculo.modelo || '-'}</td>
                      <td>{vehiculo.año || '-'}</td>
                      <td>{vehiculo.responsable_nombre || '-'}</td>
                      <td>
                        <span className={`badge ${vehiculo.is_active ? 'badge-activo' : 'badge-inactivo'}`}>
                          {vehiculo.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="acciones">
                        <button
                          className="btn-icon"
                          onClick={() => navigate(`/vehiculos/${vehiculo.id}`)}
                          title="Ver hoja de vida"
                          aria-label={`Ver hoja de vida de ${vehiculo.placa}`}
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => abrirModalEditar(vehiculo)}
                          title="Editar vehículo"
                          aria-label={`Editar vehículo ${vehiculo.placa}`}
                        >
                          <Pencil size={16} />
                        </button>
                        {vehiculo.is_active && (
                          <button
                            className="btn-icon danger"
                            onClick={() => eliminarVehiculo(vehiculo)}
                            title="Desactivar vehículo"
                            aria-label={`Desactivar vehículo ${vehiculo.placa}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="pagination">
          <button onClick={() => cambiarPagina(paginaActual - 1)} disabled={paginaActual === 1}>
            Anterior
          </button>
          <span>Página {paginaActual} de {totalPaginas}</span>
          <button onClick={() => cambiarPagina(paginaActual + 1)} disabled={paginaActual === totalPaginas}>
            Siguiente
          </button>
        </div>
      )}

      {feedback && (
        <ToastAlert
          type={feedback.type}
          message={feedback.message}
          onClose={() => setFeedback(null)}
        />
      )}

      {mostrarModal && (
        <ModalBase
          isOpen={mostrarModal}
          title={vehiculoEditar ? 'Editar Vehículo' : 'Nuevo Vehículo'}
          onClose={() => setMostrarModal(false)}
          closeDisabled={guardandoVehiculo}
          size="md"
          footer={
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setMostrarModal(false)} disabled={guardandoVehiculo}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={() => void guardarVehiculo()} disabled={guardandoVehiculo}>
                {guardandoVehiculo ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          }
        >
          <div className="modal-body">
              <div className="form-group">
                <label>Placa *</label>
                <input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Foto</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFotoSelect(file);
                    }
                  }}
                />
                {fotoUrl && <small>Foto cargada</small>}
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="">Seleccione</option>
                  {tiposVehiculo.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Color</label>
                <input value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Cilindraje</label>
                <input value={cilindraje} onChange={(e) => setCilindraje(e.target.value)} placeholder="Ej: 1600cc" />
              </div>
              <div className="form-group">
                <label>Marca</label>
                <input value={marca} onChange={(e) => setMarca(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Modelo</label>
                <input value={modelo} onChange={(e) => setModelo(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Responsable</label>
                <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
                  <option value="">Sin responsable</option>
                  {instructores.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.nombre_completo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Año</label>
                <input
                  type="number"
                  min="1980"
                  max={new Date().getFullYear() + 1}
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>VIN</label>
                <input value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Número de Motor</label>
                <input value={numeroMotor} onChange={(e) => setNumeroMotor(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Número de Chasis</label>
                <input value={numeroChasis} onChange={(e) => setNumeroChasis(e.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Kilometraje Actual</label>
                <input
                  type="number"
                  min="0"
                  value={kilometrajeActual}
                  onChange={(e) => setKilometrajeActual(e.target.value)}
                />
              </div>
              {vehiculoEditar && (
                <div className="form-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={activo}
                      onChange={(e) => setActivo(e.target.checked)}
                    />
                    Activo
                  </label>
                </div>
              )}
          </div>
        </ModalBase>
      )}

      <ConfirmDialog
        isOpen={Boolean(vehiculoEliminar)}
        title="Desactivar vehículo"
        message={`¿Deseas desactivar el vehículo ${vehiculoEliminar?.placa || ''}?`}
        confirmText="Sí, desactivar"
        cancelText="Cancelar"
        confirmVariant="danger"
        isLoading={eliminandoVehiculo}
        onCancel={() => setVehiculoEliminar(null)}
        onConfirm={() => void confirmarEliminarVehiculo()}
      />
    </div>
  );
};
