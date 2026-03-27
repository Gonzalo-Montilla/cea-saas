import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, GraduationCap, RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { tarifasAPI, tenantServiceRulesAPI, type TenantServiceRule } from '../services/api';
import '../styles/Tarifas.css';

interface Tarifa {
  id: number;
  tipo_servicio: string;
  precio_base: number;
  costo_practica: number;
  activo: boolean;
}

const tiposServicio = [
  { value: 'LICENCIA_A2', label: 'Licencia A2 (Moto)' },
  { value: 'LICENCIA_B1', label: 'Licencia B1 (Automóvil)' },
  { value: 'LICENCIA_C1', label: 'Licencia C1 (Camioneta)' },
  { value: 'RECATEGORIZACION_C1', label: 'Recategorización C1' },
  { value: 'COMBO_A2_B1', label: 'Combo A2 + B1' },
  { value: 'COMBO_A2_C1', label: 'Combo A2 + C1' },
  { value: 'CERTIFICADO_MOTO', label: 'Certificado Moto' },
  { value: 'CERTIFICADO_B1', label: 'Certificado B1' },
  { value: 'CERTIFICADO_C1', label: 'Certificado C1' },
  { value: 'CERTIFICADO_B1_SIN_PRACTICA', label: 'Certificado B1 sin práctica' },
  { value: 'CERTIFICADO_C1_SIN_PRACTICA', label: 'Certificado C1 sin práctica' },
  { value: 'CERTIFICADO_A2_B1_SIN_PRACTICA', label: 'Certificado A2 + B1 sin práctica' },
  { value: 'CERTIFICADO_A2_C1_SIN_PRACTICA', label: 'Certificado A2 + C1 sin práctica' },
  { value: 'CERTIFICADO_A2_B1_CON_PRACTICA', label: 'Certificado A2 + B1 con práctica' },
  { value: 'CERTIFICADO_A2_C1_CON_PRACTICA', label: 'Certificado A2 + C1 con práctica' }
];

export const Tarifas = () => {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [reglasHoras, setReglasHoras] = useState<TenantServiceRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingReglas, setLoadingReglas] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Tarifa | null>(null);
  const [tipoServicio, setTipoServicio] = useState('');
  const [precioBase, setPrecioBase] = useState('');
  const [costoPractica, setCostoPractica] = useState('');
  const [activo, setActivo] = useState(true);
  const [showHorasModal, setShowHorasModal] = useState(false);
  const [editandoHoras, setEditandoHoras] = useState<TenantServiceRule | null>(null);
  const [horasTeoricas, setHorasTeoricas] = useState('');
  const [horasPracticas, setHorasPracticas] = useState('');

  const tipoServicioLabelMap = useMemo(
    () => tiposServicio.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {} as Record<string, string>),
    []
  );
  const serviciosSinPractica = useMemo(
    () =>
      new Set([
        'CERTIFICADO_MOTO',
        'CERTIFICADO_B1',
        'CERTIFICADO_C1',
        'CERTIFICADO_B1_SIN_PRACTICA',
        'CERTIFICADO_C1_SIN_PRACTICA',
        'CERTIFICADO_A2_B1_SIN_PRACTICA',
        'CERTIFICADO_A2_C1_SIN_PRACTICA'
      ]),
    []
  );

  const cargarTarifas = async () => {
    try {
      setLoading(true);
      const data = await tarifasAPI.getAll();
      setTarifas(data || []);
    } catch (err) {
      console.error('Error al cargar tarifas:', err);
      setError('No se pudieron cargar las tarifas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarTarifas();
    cargarReglasHoras();
  }, []);

  const abrirNueva = () => {
    setEditando(null);
    setTipoServicio('');
    setPrecioBase('');
    setCostoPractica('');
    setActivo(true);
    setShowModal(true);
  };

  const abrirEditar = (t: Tarifa) => {
    setEditando(t);
    setTipoServicio(t.tipo_servicio);
    setPrecioBase(String(t.precio_base));
    setCostoPractica(String(t.costo_practica || 0));
    setActivo(t.activo);
    setShowModal(true);
  };

  const guardar = async () => {
    if (!tipoServicio || !precioBase) {
      setError('Tipo de servicio y precio base son obligatorios');
      return;
    }
    try {
      const payload = {
        tipo_servicio: tipoServicio,
        precio_base: parseFloat(precioBase),
        costo_practica: costoPractica ? parseFloat(costoPractica) : 0,
        activo
      };
      if (editando) {
        await tarifasAPI.update(editando.id, payload);
      } else {
        await tarifasAPI.create(payload);
      }
      setShowModal(false);
      await cargarTarifas();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al guardar la tarifa');
    }
  };

  const desactivar = async (t: Tarifa) => {
    const ok = window.confirm(`¿Desactivar tarifa ${t.tipo_servicio}?`);
    if (!ok) return;
    try {
      await tarifasAPI.delete(t.id);
      await cargarTarifas();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al desactivar la tarifa');
    }
  };

  const cargarReglasHoras = async () => {
    try {
      setLoadingReglas(true);
      const data = await tenantServiceRulesAPI.getAll();
      setReglasHoras(data || []);
    } catch (err) {
      console.error('Error al cargar reglas de horas:', err);
      setError('No se pudieron cargar las reglas de horas');
    } finally {
      setLoadingReglas(false);
    }
  };

  const abrirEditarHoras = (rule: TenantServiceRule) => {
    setEditandoHoras(rule);
    setHorasTeoricas(String(rule.horas_teoricas_requeridas ?? 0));
    setHorasPracticas(String(rule.horas_practicas_requeridas ?? 0));
    setShowHorasModal(true);
  };

  const guardarHoras = async () => {
    if (!editandoHoras) return;
    const teoria = Number(horasTeoricas);
    const practica = Number(horasPracticas);
    if (!Number.isFinite(teoria) || teoria < 0 || !Number.isFinite(practica) || practica < 0) {
      setError('Las horas deben ser números válidos y no negativos');
      return;
    }
    try {
      const sinPractica = serviciosSinPractica.has(editandoHoras.tipo_servicio);
      await tenantServiceRulesAPI.upsert(editandoHoras.tipo_servicio, {
        horas_teoricas_requeridas: sinPractica ? 0 : Math.floor(teoria),
        horas_practicas_requeridas: sinPractica ? 0 : Math.floor(practica),
        activo: true
      });
      setShowHorasModal(false);
      setEditandoHoras(null);
      await cargarReglasHoras();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudieron guardar las horas');
    }
  };

  const resetHoras = async (rule: TenantServiceRule) => {
    const ok = window.confirm(`¿Reiniciar horas de ${rule.tipo_servicio} al valor por defecto?`);
    if (!ok) return;
    try {
      await tenantServiceRulesAPI.reset(rule.tipo_servicio);
      await cargarReglasHoras();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo reiniciar la configuración de horas');
    }
  };

  const formatearMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(valor);
  };

  return (
    <div className="tarifas-container">
      <PageHeader
        title="Tarifas"
        subtitle="Administración de precios por servicio"
        icon={<GraduationCap size={20} />}
        actions={
          <button className="btn-nuevo" onClick={abrirNueva}>
            <Plus size={16} /> Nueva Tarifa
          </button>
        }
      />

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-container">Cargando tarifas...</div>
      ) : (
        <div className="tarifas-table mobile-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Precio base</th>
                <th>Costo práctica</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tarifas.map((t) => (
                <tr key={t.id}>
                  <td>{t.tipo_servicio}</td>
                  <td>{formatearMoneda(Number(t.precio_base))}</td>
                  <td>{formatearMoneda(Number(t.costo_practica || 0))}</td>
                  <td>{t.activo ? 'Activa' : 'Inactiva'}</td>
                  <td>
                    <button className="btn-icon" onClick={() => abrirEditar(t)}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn-icon danger" onClick={() => desactivar(t)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {tarifas.length === 0 && (
                <tr>
                  <td colSpan={5}>No hay tarifas registradas</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PageHeader
        title="Intensidad horaria por servicio"
        subtitle="Configuración académica por escuela (tenant)"
        icon={<GraduationCap size={20} />}
      />

      <div className="tarifas-table mobile-table-wrap">
        {loadingReglas ? (
          <div className="loading-container">Cargando configuración de horas...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Horas teoría</th>
                <th>Horas práctica</th>
                <th>Origen</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reglasHoras.map((r) => (
                <tr key={r.tipo_servicio}>
                  <td>{tipoServicioLabelMap[r.tipo_servicio] || r.tipo_servicio}</td>
                  <td>{r.horas_teoricas_requeridas}</td>
                  <td>{r.horas_practicas_requeridas}</td>
                  <td>{r.es_personalizado ? 'Personalizado' : 'Por defecto'}</td>
                  <td>
                    <button className="btn-icon" onClick={() => abrirEditarHoras(r)} title="Editar horas">
                      <Pencil size={14} />
                    </button>
                    {r.es_personalizado && (
                      <button className="btn-icon" onClick={() => resetHoras(r)} title="Reiniciar por defecto">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {reglasHoras.length === 0 && (
                <tr>
                  <td colSpan={5}>No hay servicios configurados</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
      <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editando ? 'Editar Tarifa' : 'Nueva Tarifa'}</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Tipo de servicio</label>
                <select value={tipoServicio} onChange={(e) => setTipoServicio(e.target.value)} disabled={!!editando}>
                  <option value="">Seleccione</option>
                  {tiposServicio.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Precio base</label>
                <input type="number" value={precioBase} onChange={(e) => setPrecioBase(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Costo práctica</label>
                <input type="number" value={costoPractica} onChange={(e) => setCostoPractica(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={activo ? '1' : '0'} onChange={(e) => setActivo(e.target.value === '1')}>
                  <option value="1">Activa</option>
                  <option value="0">Inactiva</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showHorasModal && editandoHoras && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configurar horas por servicio</h3>
              <button className="btn-icon" onClick={() => setShowHorasModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Servicio</label>
                <input value={tipoServicioLabelMap[editandoHoras.tipo_servicio] || editandoHoras.tipo_servicio} disabled />
              </div>
              <div className="form-group">
                <label>Horas teóricas requeridas</label>
                <input
                  type="number"
                  min={0}
                  value={horasTeoricas}
                  onChange={(e) => setHorasTeoricas(e.target.value)}
                  disabled={serviciosSinPractica.has(editandoHoras.tipo_servicio)}
                />
              </div>
              <div className="form-group">
                <label>Horas prácticas requeridas</label>
                <input
                  type="number"
                  min={0}
                  value={horasPracticas}
                  onChange={(e) => setHorasPracticas(e.target.value)}
                  disabled={serviciosSinPractica.has(editandoHoras.tipo_servicio)}
                />
              </div>
              {serviciosSinPractica.has(editandoHoras.tipo_servicio) && (
                <div className="info-message">
                  Este servicio está definido como “sin práctica”, por lo tanto siempre usa 0 horas.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowHorasModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarHoras}>Guardar horas</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
