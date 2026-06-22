import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, GraduationCap, RotateCcw, ChevronDown } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ModalBase } from '../components/ui/ModalBase';
import {
  conceptosIngresoAPI,
  tarifasAPI,
  tenantServiceRulesAPI,
  type ConceptoIngresoTenant,
  type TenantServiceRule
} from '../services/api';
import '../styles/Tarifas.css';

interface Tarifa {
  id: number;
  tipo_servicio: string;
  precio_base: number;
  costo_practica: number;
  activo: boolean;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => Promise<void>;
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

const categoriasIngreso = [
  { value: 'ESTUDIANTE_NO_REGISTRADO', label: 'Estudiante no registrado' },
  { value: 'PAGO_PRESTAMO_EMPLEADO', label: 'Pago préstamo empleado' },
  { value: 'VENTA_MATERIAL', label: 'Venta material / trámites' },
  { value: 'INGRESO_ADMINISTRATIVO', label: 'Ingreso administrativo' },
  { value: 'OTROS', label: 'Otros' }
];

export const Tarifas = () => {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [reglasHoras, setReglasHoras] = useState<TenantServiceRule[]>([]);
  const [conceptosIngreso, setConceptosIngreso] = useState<ConceptoIngresoTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingReglas, setLoadingReglas] = useState(false);
  const [loadingConceptos, setLoadingConceptos] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Tarifa | null>(null);
  const [guardandoTarifa, setGuardandoTarifa] = useState(false);
  const [tipoServicio, setTipoServicio] = useState('');
  const [precioBase, setPrecioBase] = useState('');
  const [costoPractica, setCostoPractica] = useState('');
  const [activo, setActivo] = useState(true);
  const [showHorasModal, setShowHorasModal] = useState(false);
  const [guardandoHoras, setGuardandoHoras] = useState(false);
  const [editandoHoras, setEditandoHoras] = useState<TenantServiceRule | null>(null);
  const [horasTeoricas, setHorasTeoricas] = useState('');
  const [horasPracticas, setHorasPracticas] = useState('');
  const [showConceptoModal, setShowConceptoModal] = useState(false);
  const [guardandoConcepto, setGuardandoConcepto] = useState(false);
  const [editandoConcepto, setEditandoConcepto] = useState<ConceptoIngresoTenant | null>(null);
  const [conceptoNombre, setConceptoNombre] = useState('');
  const [conceptoCategoria, setConceptoCategoria] = useState('OTROS');
  const [conceptoValorDefault, setConceptoValorDefault] = useState('');
  const [conceptoActivo, setConceptoActivo] = useState(true);
  const [mostrarBloqueTarifas, setMostrarBloqueTarifas] = useState(true);
  const [mostrarBloqueConceptos, setMostrarBloqueConceptos] = useState(false);
  const [mostrarBloqueHoras, setMostrarBloqueHoras] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);

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
      setError('');
    } catch (err) {
      console.error('Error al cargar tarifas:', err);
      setError('No se pudieron cargar las tarifas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarTarifas();
    cargarConceptosIngreso();
    cargarReglasHoras();
  }, []);

  const abrirNueva = () => {
    setError('');
    setEditando(null);
    setTipoServicio('');
    setPrecioBase('');
    setCostoPractica('');
    setActivo(true);
    setShowModal(true);
  };

  const abrirEditar = (t: Tarifa) => {
    setError('');
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
      setGuardandoTarifa(true);
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
      setError('');
      setShowModal(false);
      await cargarTarifas();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo guardar la tarifa.');
    } finally {
      setGuardandoTarifa(false);
    }
  };

  const desactivar = async (t: Tarifa) => {
    const nombreServicio = tipoServicioLabelMap[t.tipo_servicio] || t.tipo_servicio;
    setConfirmState({
      title: 'Desactivar tarifa',
      message: `¿Deseas desactivar la tarifa de ${nombreServicio}?`,
      confirmText: 'Sí, desactivar',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await tarifasAPI.delete(t.id);
          setError('');
          await cargarTarifas();
        } catch (err: any) {
          setError(err.response?.data?.detail || 'No se pudo desactivar la tarifa.');
        }
      }
    });
  };

  const cargarReglasHoras = async () => {
    try {
      setLoadingReglas(true);
      const data = await tenantServiceRulesAPI.getAll();
      setReglasHoras(data || []);
      setError('');
    } catch (err) {
      console.error('Error al cargar reglas de horas:', err);
      setError('No se pudieron cargar las reglas de horas');
    } finally {
      setLoadingReglas(false);
    }
  };

  const cargarConceptosIngreso = async () => {
    try {
      setLoadingConceptos(true);
      const data = await conceptosIngresoAPI.getAll({ include_inactivos: true });
      setConceptosIngreso(data || []);
      setError('');
    } catch (err) {
      console.error('Error al cargar conceptos de ingreso:', err);
      setError('No se pudieron cargar los conceptos configurables');
    } finally {
      setLoadingConceptos(false);
    }
  };

  const abrirNuevoConcepto = () => {
    setError('');
    setEditandoConcepto(null);
    setConceptoNombre('');
    setConceptoCategoria('OTROS');
    setConceptoValorDefault('');
    setConceptoActivo(true);
    setShowConceptoModal(true);
  };

  const abrirEditarConcepto = (concepto: ConceptoIngresoTenant) => {
    setError('');
    setEditandoConcepto(concepto);
    setConceptoNombre(concepto.nombre);
    setConceptoCategoria(concepto.categoria);
    setConceptoValorDefault(String(concepto.valor_default ?? 0));
    setConceptoActivo(concepto.activo);
    setShowConceptoModal(true);
  };

  const guardarConcepto = async () => {
    if (!conceptoNombre.trim()) {
      setError('El nombre del concepto es obligatorio');
      return;
    }
    if (conceptoValorDefault === '' || Number(conceptoValorDefault) < 0) {
      setError('El valor por defecto debe ser mayor o igual a cero');
      return;
    }

    try {
      setGuardandoConcepto(true);
      const payload = {
        nombre: conceptoNombre.trim().toUpperCase(),
        categoria: conceptoCategoria,
        valor_default: Number(conceptoValorDefault),
        activo: conceptoActivo
      };
      if (editandoConcepto) {
        await conceptosIngresoAPI.update(editandoConcepto.id, payload);
      } else {
        await conceptosIngresoAPI.create(payload);
      }
      setError('');
      setShowConceptoModal(false);
      await cargarConceptosIngreso();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo guardar el concepto.');
    } finally {
      setGuardandoConcepto(false);
    }
  };

  const desactivarConcepto = async (concepto: ConceptoIngresoTenant) => {
    setConfirmState({
      title: 'Desactivar concepto',
      message: `¿Deseas desactivar el concepto ${concepto.nombre}?`,
      confirmText: 'Sí, desactivar',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await conceptosIngresoAPI.delete(concepto.id);
          setError('');
          await cargarConceptosIngreso();
        } catch (err: any) {
          setError(err.response?.data?.detail || 'No se pudo desactivar el concepto.');
        }
      }
    });
  };

  const abrirEditarHoras = (rule: TenantServiceRule) => {
    setError('');
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
      setGuardandoHoras(true);
      const sinPractica = serviciosSinPractica.has(editandoHoras.tipo_servicio);
      await tenantServiceRulesAPI.upsert(editandoHoras.tipo_servicio, {
        horas_teoricas_requeridas: sinPractica ? 0 : Math.floor(teoria),
        horas_practicas_requeridas: sinPractica ? 0 : Math.floor(practica),
        activo: true
      });
      setError('');
      setShowHorasModal(false);
      setEditandoHoras(null);
      await cargarReglasHoras();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudieron guardar las horas');
    } finally {
      setGuardandoHoras(false);
    }
  };

  const resetHoras = async (rule: TenantServiceRule) => {
    const nombreServicio = tipoServicioLabelMap[rule.tipo_servicio] || rule.tipo_servicio;
    setConfirmState({
      title: 'Reiniciar horas',
      message: `¿Deseas reiniciar las horas de ${nombreServicio} al valor por defecto?`,
      confirmText: 'Sí, reiniciar',
      onConfirm: async () => {
        try {
          await tenantServiceRulesAPI.reset(rule.tipo_servicio);
          setError('');
          await cargarReglasHoras();
        } catch (err: any) {
          setError(err.response?.data?.detail || 'No se pudo reiniciar la configuración de horas.');
        }
      }
    });
  };

  const formatearMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(valor);
  };

  const categoriaLabelMap = useMemo(
    () => categoriasIngreso.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {} as Record<string, string>),
    []
  );
  const puedeGuardarTarifa =
    tipoServicio.trim().length > 0 &&
    precioBase !== '' &&
    Number(precioBase) >= 0 &&
    !guardandoTarifa;
  const puedeGuardarConcepto =
    conceptoNombre.trim().length > 0 &&
    conceptoValorDefault !== '' &&
    Number(conceptoValorDefault) >= 0 &&
    !guardandoConcepto;
  const puedeGuardarHoras =
    horasTeoricas !== '' &&
    horasPracticas !== '' &&
    Number(horasTeoricas) >= 0 &&
    Number(horasPracticas) >= 0 &&
    !guardandoHoras;

  return (
    <div className="tarifas-container">
      <PageHeader
        title="Tarifas"
        subtitle="Administración de tarifas, conceptos y horas por servicio"
        icon={<GraduationCap size={20} />}
      />

      {error && <div className="error-message">{error}</div>}

      <section className="tarifas-bloque">
        <button
          type="button"
          className="tarifas-bloque-header"
          onClick={() => setMostrarBloqueTarifas((prev) => !prev)}
          aria-expanded={mostrarBloqueTarifas}
          aria-controls="bloque-tarifas"
        >
          <div className="tarifas-bloque-header-text">
            <h3>Tarifas</h3>
            <p>Administración de precios por servicio</p>
          </div>
          <ChevronDown size={20} className={`tarifas-bloque-chevron ${mostrarBloqueTarifas ? '' : 'collapsed'}`} />
        </button>
        {mostrarBloqueTarifas && (
          <div className="tarifas-bloque-content" id="bloque-tarifas">
            <div className="tarifas-bloque-actions">
              <button className="btn-nuevo" onClick={abrirNueva}>
                <Plus size={16} /> Nueva Tarifa
              </button>
            </div>
            <div className="tarifas-meta">
              <span>{loading ? 'Actualizando tarifas...' : `${tarifas.length} tarifa(s) registradas`}</span>
            </div>
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
                        <td>{tipoServicioLabelMap[t.tipo_servicio] || t.tipo_servicio}</td>
                        <td>{formatearMoneda(Number(t.precio_base))}</td>
                        <td>{formatearMoneda(Number(t.costo_practica || 0))}</td>
                        <td>{t.activo ? 'Activa' : 'Inactiva'}</td>
                        <td>
                          <button
                            className="btn-icon"
                            onClick={() => abrirEditar(t)}
                            title="Editar tarifa"
                            aria-label={`Editar tarifa ${tipoServicioLabelMap[t.tipo_servicio] || t.tipo_servicio}`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => desactivar(t)}
                            title="Desactivar tarifa"
                            aria-label={`Desactivar tarifa ${tipoServicioLabelMap[t.tipo_servicio] || t.tipo_servicio}`}
                          >
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
          </div>
        )}
      </section>

      <section className="tarifas-bloque">
        <button
          type="button"
          className="tarifas-bloque-header"
          onClick={() => setMostrarBloqueConceptos((prev) => !prev)}
          aria-expanded={mostrarBloqueConceptos}
          aria-controls="bloque-conceptos-caja"
        >
          <div className="tarifas-bloque-header-text">
            <h3>Conceptos configurables para Caja</h3>
            <p>Define conceptos de ingresos con categoría y valor por defecto</p>
          </div>
          <ChevronDown size={20} className={`tarifas-bloque-chevron ${mostrarBloqueConceptos ? '' : 'collapsed'}`} />
        </button>
        {mostrarBloqueConceptos && (
          <div className="tarifas-bloque-content" id="bloque-conceptos-caja">
            <div className="tarifas-bloque-actions">
              <button className="btn-nuevo" onClick={abrirNuevoConcepto}>
                <Plus size={16} /> Nuevo Concepto
              </button>
            </div>
            <div className="tarifas-meta">
              <span>{loadingConceptos ? 'Actualizando conceptos...' : `${conceptosIngreso.length} concepto(s) configurados`}</span>
            </div>
            <div className="tarifas-table mobile-table-wrap">
              {loadingConceptos ? (
                <div className="loading-container">Cargando conceptos...</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Categoría</th>
                      <th>Valor por defecto</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conceptosIngreso.map((c) => (
                      <tr key={c.id}>
                        <td>{c.nombre}</td>
                        <td>{categoriaLabelMap[c.categoria] || c.categoria}</td>
                        <td>{formatearMoneda(Number(c.valor_default || 0))}</td>
                        <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
                        <td>
                          <button className="btn-icon" onClick={() => abrirEditarConcepto(c)} title="Editar concepto" aria-label={`Editar concepto ${c.nombre}`}>
                            <Pencil size={14} />
                          </button>
                          {c.activo && (
                            <button className="btn-icon danger" onClick={() => desactivarConcepto(c)} title="Desactivar concepto" aria-label={`Desactivar concepto ${c.nombre}`}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {conceptosIngreso.length === 0 && (
                      <tr>
                        <td colSpan={5}>No hay conceptos configurados</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="tarifas-bloque">
        <button
          type="button"
          className="tarifas-bloque-header"
          onClick={() => setMostrarBloqueHoras((prev) => !prev)}
          aria-expanded={mostrarBloqueHoras}
          aria-controls="bloque-horas-servicio"
        >
          <div className="tarifas-bloque-header-text">
            <h3>Intensidad horaria por servicio</h3>
            <p>Configuración académica por escuela (tenant)</p>
          </div>
          <ChevronDown size={20} className={`tarifas-bloque-chevron ${mostrarBloqueHoras ? '' : 'collapsed'}`} />
        </button>
        {mostrarBloqueHoras && (
          <div className="tarifas-bloque-content" id="bloque-horas-servicio">
            <div className="tarifas-meta">
              <span>{loadingReglas ? 'Actualizando reglas...' : `${reglasHoras.length} servicio(s) con intensidad horaria`}</span>
            </div>
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
                          <button className="btn-icon" onClick={() => abrirEditarHoras(r)} title="Editar horas" aria-label={`Editar horas de ${tipoServicioLabelMap[r.tipo_servicio] || r.tipo_servicio}`}>
                            <Pencil size={14} />
                          </button>
                          {r.es_personalizado && (
                            <button className="btn-icon" onClick={() => resetHoras(r)} title="Reiniciar por defecto" aria-label={`Reiniciar horas de ${tipoServicioLabelMap[r.tipo_servicio] || r.tipo_servicio}`}>
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
          </div>
        )}
      </section>

      <ModalBase
        isOpen={showModal}
        title={editando ? 'Editar Tarifa' : 'Nueva Tarifa'}
        onClose={() => setShowModal(false)}
        closeDisabled={guardandoTarifa}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowModal(false)} disabled={guardandoTarifa}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={guardar} disabled={!puedeGuardarTarifa}>
              {guardandoTarifa ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Tipo de servicio</label>
          <select value={tipoServicio} onChange={(e) => setTipoServicio(e.target.value)} disabled={!!editando || guardandoTarifa}>
            <option value="">Seleccione</option>
            {tiposServicio.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Precio base</label>
          <input type="number" value={precioBase} onChange={(e) => setPrecioBase(e.target.value)} disabled={guardandoTarifa} />
        </div>
        <div className="form-group">
          <label>Costo práctica</label>
          <input type="number" value={costoPractica} onChange={(e) => setCostoPractica(e.target.value)} disabled={guardandoTarifa} />
        </div>
        <div className="form-group">
          <label>Estado</label>
          <select value={activo ? '1' : '0'} onChange={(e) => setActivo(e.target.value === '1')} disabled={guardandoTarifa}>
            <option value="1">Activa</option>
            <option value="0">Inactiva</option>
          </select>
        </div>
      </ModalBase>

      <ModalBase
        isOpen={showHorasModal && Boolean(editandoHoras)}
        title="Configurar horas por servicio"
        onClose={() => setShowHorasModal(false)}
        closeDisabled={guardandoHoras}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowHorasModal(false)} disabled={guardandoHoras}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={guardarHoras} disabled={!puedeGuardarHoras}>
              {guardandoHoras ? 'Guardando...' : 'Guardar horas'}
            </button>
          </>
        }
      >
        {editandoHoras && (
          <>
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
                disabled={serviciosSinPractica.has(editandoHoras.tipo_servicio) || guardandoHoras}
              />
            </div>
            <div className="form-group">
              <label>Horas prácticas requeridas</label>
              <input
                type="number"
                min={0}
                value={horasPracticas}
                onChange={(e) => setHorasPracticas(e.target.value)}
                disabled={serviciosSinPractica.has(editandoHoras.tipo_servicio) || guardandoHoras}
              />
            </div>
            {serviciosSinPractica.has(editandoHoras.tipo_servicio) && (
              <div className="info-message">
                Este servicio está definido como “sin práctica”, por lo tanto siempre usa 0 horas.
              </div>
            )}
          </>
        )}
      </ModalBase>

      <ModalBase
        isOpen={showConceptoModal}
        title={editandoConcepto ? 'Editar concepto configurable' : 'Nuevo concepto configurable'}
        onClose={() => setShowConceptoModal(false)}
        closeDisabled={guardandoConcepto}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowConceptoModal(false)} disabled={guardandoConcepto}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={guardarConcepto} disabled={!puedeGuardarConcepto}>
              {guardandoConcepto ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Nombre del concepto</label>
          <input
            type="text"
            value={conceptoNombre}
            onChange={(e) => setConceptoNombre(e.target.value)}
            placeholder="Ej: IMPRONTAS"
            disabled={guardandoConcepto}
          />
        </div>
        <div className="form-group">
          <label>Categoría</label>
          <select value={conceptoCategoria} onChange={(e) => setConceptoCategoria(e.target.value)} disabled={guardandoConcepto}>
            {categoriasIngreso.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Valor por defecto</label>
          <input
            type="number"
            min={0}
            step={100}
            value={conceptoValorDefault}
            onChange={(e) => setConceptoValorDefault(e.target.value)}
            placeholder="0"
            disabled={guardandoConcepto}
          />
        </div>
        <div className="form-group">
          <label>Estado</label>
          <select value={conceptoActivo ? '1' : '0'} onChange={(e) => setConceptoActivo(e.target.value === '1')} disabled={guardandoConcepto}>
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </div>
      </ModalBase>

      <ConfirmDialog
        isOpen={Boolean(confirmState)}
        title={confirmState?.title || 'Confirmar acción'}
        message={confirmState?.message || ''}
        confirmText={confirmState?.confirmText || 'Confirmar'}
        confirmVariant={confirmState?.confirmVariant || 'primary'}
        isLoading={confirmingAction}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState || confirmingAction) return;
          void (async () => {
            setConfirmingAction(true);
            await confirmState.onConfirm();
            setConfirmingAction(false);
            setConfirmState(null);
          })();
        }}
      />
    </div>
  );
};
