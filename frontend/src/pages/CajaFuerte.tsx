import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Wallet, Download } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { cajaFuerteAPI } from '../services/api';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ToastAlert } from '../components/ui/ToastAlert';
import { parseApiError } from '../utils/errors';
import '../styles/CajaFuerte.css';

const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
const METODOS = [
  'EFECTIVO',
  'NEQUI',
  'DAVIPLATA',
  'TRANSFERENCIA_BANCARIA',
  'TARJETA_DEBITO',
  'TARJETA_CREDITO',
  'CREDISMART',
  'SISTECREDITO',
];
const METODO_LABELS: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  TRANSFERENCIA_BANCARIA: 'Transferencia bancaria',
  TARJETA_DEBITO: 'Tarjeta débito',
  TARJETA_CREDITO: 'Tarjeta crédito',
  CREDISMART: 'CrediSmart',
  SISTECREDITO: 'Sistecrédito',
};
const CATEGORIAS_EGRESO = [
  'ARRENDAMIENTO',
  'NOMINA',
  'SERVICIOS_PUBLICOS',
  'PAPELERIA',
  'MANTENIMIENTO',
  'COMBUSTIBLE',
  'IMPUESTOS',
  'PUBLICIDAD',
  'OTROS',
];
const CATEGORIAS_INGRESO = [
  'TRASLADO_CAJA',
  'AJUSTE',
  'INGRESO_EXTRAORDINARIO',
  'OTROS',
];

export default function CajaFuerte() {
  const [resumen, setResumen] = useState<any>(null);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [inventario, setInventario] = useState<any[]>([]);
  const [inventarioTotal, setInventarioTotal] = useState(0);
  const [movDenoms, setMovDenoms] = useState(
    DENOMINACIONES.map((denominacion) => ({ denominacion, cantidad: 0 }))
  );
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState({
    tipo: '',
    metodo_pago: '',
    fecha_inicio: '',
    fecha_fin: '',
  });

  const [form, setForm] = useState({
    tipo: 'INGRESO',
    metodo_pago: 'EFECTIVO',
    concepto: '',
    monto: '',
    observaciones: '',
  });
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState('OTROS');
  const [categoriaCustom, setCategoriaCustom] = useState('');
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [eliminarMovimientoId, setEliminarMovimientoId] = useState<number | null>(null);
  const [eliminandoMovimiento, setEliminandoMovimiento] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const getErrorMessage = (error: any, fallback: string) => {
    return parseApiError(error, fallback);
  };

  const totalMovimiento = useMemo(
    () => movDenoms.reduce((acc, item) => acc + item.denominacion * item.cantidad, 0),
    [movDenoms]
  );
  const inventarioMap = useMemo(
    () => new Map(inventario.map((i) => [Number(i.denominacion), Number(i.cantidad || 0)])),
    [inventario]
  );
  const inventarioBilletes = useMemo(() => DENOMINACIONES.filter((d) => d >= 2000), []);
  const inventarioMonedas = useMemo(() => DENOMINACIONES.filter((d) => d < 2000), []);

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

  const exportMovimientosCSV = () => {
    if (!movimientos.length) return;
    const rows = [
      ['ID', 'Fecha', 'Tipo', 'Método', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Usuario', 'Observaciones', 'Motivo anulación'],
      ...movimientos.map((m) => [
        m.id,
        new Date(m.fecha).toLocaleString('es-CO'),
        m.tipo,
        m.metodo_pago,
        m.concepto,
        m.categoria || '',
        m.monto,
        m.estado || 'ACTIVO',
        m.usuario_nombre || '',
        m.observaciones || '',
        m.motivo_anulacion || '',
      ])
    ];
    downloadCSV(`caja_fuerte_movimientos_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const cargarTodo = async () => {
    setCargando(true);
    try {
      const [res, inv, movs] = await Promise.all([
        cajaFuerteAPI.getResumen(),
        cajaFuerteAPI.getInventario(),
        cajaFuerteAPI.getMovimientos(),
      ]);
      setResumen(res);
      setInventario(inv.items || []);
      setInventarioTotal(Number(inv.total_efectivo || 0));
      setMovimientos(movs || []);
      setFeedback(null);
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: getErrorMessage(error, 'No se pudieron cargar los datos de caja fuerte.'),
      });
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarTodo();
  }, []);

  const handleBuscar = async () => {
    setCargando(true);
    try {
      const movs = await cajaFuerteAPI.getMovimientos({
        tipo: filtros.tipo || undefined,
        metodo_pago: filtros.metodo_pago || undefined,
        fecha_inicio: filtros.fecha_inicio || undefined,
        fecha_fin: filtros.fecha_fin || undefined,
      });
      setMovimientos(movs || []);
      if ((movs || []).length === 0) {
        setFeedback({ type: 'info', message: 'No se encontraron movimientos para los filtros seleccionados.' });
      } else {
        setFeedback(null);
      }
    } catch (error: any) {
      setFeedback({
        type: 'error',
        message: getErrorMessage(error, 'No se pudieron consultar los movimientos.'),
      });
    } finally {
      setCargando(false);
    }
  };

  const handleGuardarMovimiento = async () => {
    if (!form.concepto.trim()) {
      setFeedback({ type: 'info', message: 'Debes ingresar el concepto del movimiento.' });
      return;
    }
    if (!form.monto || Number(form.monto) <= 0) {
      setFeedback({ type: 'info', message: 'Debes ingresar un monto válido mayor a cero.' });
      return;
    }
    if (categoriaSeleccionada === 'OTROS' && !categoriaCustom.trim()) {
      setFeedback({ type: 'info', message: 'Debes especificar la categoría cuando seleccionas OTROS.' });
      return;
    }
    try {
      if (editandoId) {
        const categoriaFinal = categoriaSeleccionada === 'OTROS' ? categoriaCustom : categoriaSeleccionada;
        const payloadUpdate: any = {
          tipo: form.tipo,
          metodo_pago: form.metodo_pago,
          concepto: form.concepto,
          categoria: categoriaFinal || undefined,
          monto: Number(form.monto),
          observaciones: form.observaciones || undefined,
        };
        if (form.metodo_pago === 'EFECTIVO') {
          if (totalMovimiento !== Number(form.monto)) {
            setFeedback({ type: 'info', message: 'Las denominaciones no cuadran con el monto del movimiento.' });
            return;
          }
          payloadUpdate.inventario_items = movDenoms.map((i) => ({
            denominacion: i.denominacion,
            cantidad: Number(i.cantidad),
          }));
        }
        await cajaFuerteAPI.actualizarMovimiento(editandoId, payloadUpdate);
        setEditandoId(null);
      } else {
        const categoriaFinal = categoriaSeleccionada === 'OTROS' ? categoriaCustom : categoriaSeleccionada;
        const payload: any = {
          ...form,
          monto: Number(form.monto),
          categoria: categoriaFinal || undefined,
          observaciones: form.observaciones || undefined,
        };
        if (form.metodo_pago === 'EFECTIVO') {
          if (totalMovimiento !== Number(form.monto)) {
            setFeedback({ type: 'info', message: 'Las denominaciones no cuadran con el monto del movimiento.' });
            return;
          }
          payload.inventario_items = movDenoms.map((i) => ({
            denominacion: i.denominacion,
            cantidad: Number(i.cantidad),
          }));
        }
        await cajaFuerteAPI.crearMovimiento(payload);
      }
      setFeedback({
        type: 'success',
        message: editandoId ? 'Movimiento actualizado con éxito.' : 'Movimiento registrado con éxito.',
      });
    } catch (error: any) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'No se pudo registrar el movimiento.') });
      return;
    }
    resetFormularioMovimiento();
    await cargarTodo();
  };

  const resetFormularioMovimiento = () => {
    setEditandoId(null);
    setForm({
      tipo: 'INGRESO',
      metodo_pago: 'EFECTIVO',
      concepto: '',
      monto: '',
      observaciones: '',
    });
    setCategoriaSeleccionada('OTROS');
    setCategoriaCustom('');
    setMovDenoms(DENOMINACIONES.map((denominacion) => ({ denominacion, cantidad: 0 })));
  };

  const handleEditar = (mov: any) => {
    setEditandoId(mov.id);
    setForm({
      tipo: mov.tipo,
      metodo_pago: mov.metodo_pago,
      concepto: mov.concepto,
      monto: mov.monto,
      observaciones: mov.observaciones || '',
    });
    if (mov.categoria) {
      const categorias = mov.tipo === 'EGRESO' ? CATEGORIAS_EGRESO : CATEGORIAS_INGRESO;
      if (categorias.includes(mov.categoria)) {
        setCategoriaSeleccionada(mov.categoria);
        setCategoriaCustom('');
      } else {
        setCategoriaSeleccionada('OTROS');
        setCategoriaCustom(mov.categoria);
      }
    } else {
      setCategoriaSeleccionada('OTROS');
      setCategoriaCustom('');
    }
    if (mov.metodo_pago === 'EFECTIVO' && Array.isArray(mov.inventario_detalle)) {
      const map = new Map(mov.inventario_detalle.map((i: any) => [i.denominacion, i.cantidad]));
      setMovDenoms(DENOMINACIONES.map((denominacion) => ({
        denominacion,
        cantidad: Number(map.get(denominacion) || 0),
      })));
    } else {
      setMovDenoms(DENOMINACIONES.map((denominacion) => ({ denominacion, cantidad: 0 })));
    }
  };

  const handleEliminar = (id: number) => {
    setEliminarMovimientoId(id);
    setMotivoAnulacion('');
  };

  const confirmarEliminar = async () => {
    if (!eliminarMovimientoId || eliminandoMovimiento) return;
    if (motivoAnulacion.trim().length < 5) {
      setFeedback({ type: 'info', message: 'Debes indicar un motivo de anulación (mínimo 5 caracteres).' });
      return;
    }
    try {
      setEliminandoMovimiento(true);
      await cajaFuerteAPI.eliminarMovimiento(eliminarMovimientoId, { motivo_anulacion: motivoAnulacion.trim() });
      setFeedback({ type: 'success', message: 'Movimiento anulado con éxito.' });
      await cargarTodo();
    } catch (error: any) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'No se pudo anular el movimiento.') });
    } finally {
      setEliminandoMovimiento(false);
      setEliminarMovimientoId(null);
      setMotivoAnulacion('');
    }
  };

  const handleMovDenomChange = (denom: number, cantidad: number) => {
    setMovDenoms((prev) =>
      prev.map((item) => (item.denominacion === denom ? { ...item, cantidad } : item))
    );
  };

  const handleRecibo = async (id: number) => {
    try {
      const blob = await cajaFuerteAPI.getMovimientoReciboPdf(id);
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `recibo_egreso_caja_fuerte_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      setFeedback({ type: 'error', message: getErrorMessage(error, 'No se pudo generar el recibo.') });
    }
  };

  return (
    <div className="caja-fuerte-container">
      {feedback && (
        <ToastAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
      )}

      <PageHeader
        title="Caja Fuerte"
        subtitle="Control de fondos y movimientos"
        icon={<Wallet size={20} />}
        actions={
          <>
            <button className="btn-nuevo" onClick={cargarTodo} disabled={cargando}>
              {cargando ? 'Actualizando...' : 'Actualizar'}
            </button>
            <button className="btn-nuevo" onClick={exportMovimientosCSV} disabled={!movimientos.length}>
              <Download size={16} /> Exportar CSV
            </button>
          </>
        }
      />

      <div className="caja-fuerte-resumen">
        <div className="resumen-card">
          <div className="resumen-header">
            <div className="resumen-icon success"><Banknote size={18} /></div>
            <h3>Saldo Efectivo</h3>
          </div>
          <div className="resumen-valor">${Number(resumen?.saldo_efectivo || 0).toLocaleString()}</div>
        </div>
        <div className="resumen-card">
          <div className="resumen-header">
            <div className="resumen-icon primary"><CreditCard size={18} /></div>
            <h3>Saldo Digital</h3>
          </div>
          <div className="resumen-valor">${Number((resumen?.saldo_total || 0) - (resumen?.saldo_efectivo || 0)).toLocaleString()}</div>
          <div className="resumen-subdetalle">
            <div className="detalle-row">
              <span>Nequi</span>
              <strong>${Number(resumen?.saldo_nequi || 0).toLocaleString()}</strong>
            </div>
            <div className="detalle-row">
              <span>Daviplata</span>
              <strong>${Number(resumen?.saldo_daviplata || 0).toLocaleString()}</strong>
            </div>
            <div className="detalle-row">
              <span>Transferencia Bancolombia</span>
              <strong>${Number(resumen?.saldo_transferencia_bancaria || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>
        <div className="resumen-card">
          <div className="resumen-header">
            <div className="resumen-icon warning"><Wallet size={18} /></div>
            <h3>Saldo Total</h3>
          </div>
          <div className="resumen-valor">${Number(resumen?.saldo_total || 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="caja-fuerte-grid">
        <div className="caja-fuerte-section caja-fuerte-main">
          <h2>Registrar Movimiento</h2>
          <p className="caja-fuerte-note">
            El efectivo del cierre de caja se registra manualmente aquí. Los saldos digitales se consolidan automáticamente al cierre.
          </p>
          <div className="mov-form-grid">
            <label className="mov-field">
              <span>Tipo de movimiento</span>
              <select
                value={form.tipo}
                onChange={(e) => {
                  const nextTipo = e.target.value;
                  setForm({ ...form, tipo: nextTipo });
                  setCategoriaSeleccionada('OTROS');
                  setCategoriaCustom('');
                }}
              >
                <option value="INGRESO">Ingreso</option>
                <option value="EGRESO">Egreso</option>
              </select>
            </label>

            <label className="mov-field">
              <span>Método de pago</span>
              <select
                value={form.metodo_pago}
                onChange={(e) => {
                  const metodo = e.target.value;
                  setForm({ ...form, metodo_pago: metodo });
                }}
              >
                {METODOS.map((m) => (
                  <option key={m} value={m}>{METODO_LABELS[m] || m}</option>
                ))}
              </select>
            </label>

            <label className="mov-field mov-field-wide">
              <span>Concepto</span>
              <input
                type="text"
                placeholder="Ej: Traslado administración, ajuste caja, compra insumos"
                value={form.concepto}
                onChange={(e) => setForm({ ...form, concepto: e.target.value.toUpperCase() })}
              />
            </label>

            <label className="mov-field">
              <span>Categoría</span>
              <select
                value={categoriaSeleccionada}
                onChange={(e) => setCategoriaSeleccionada(e.target.value)}
              >
                {(form.tipo === 'EGRESO' ? CATEGORIAS_EGRESO : CATEGORIAS_INGRESO).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            {categoriaSeleccionada === 'OTROS' && (
              <label className="mov-field">
                <span>Detalle categoría</span>
                <input
                  type="text"
                  placeholder="Especifica la categoría"
                  value={categoriaCustom}
                  onChange={(e) => setCategoriaCustom(e.target.value)}
                />
              </label>
            )}

            <label className="mov-field">
              <span>Monto</span>
              <input
                type="number"
                placeholder="0"
                value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })}
              />
            </label>

            <label className="mov-field mov-field-wide">
              <span>Observaciones (opcional)</span>
              <input
                type="text"
                placeholder="Nota interna para trazabilidad"
                value={form.observaciones}
                onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              />
            </label>
          </div>

          <div className="mov-preview">
            <span><strong>Resumen:</strong> {form.tipo} · {METODO_LABELS[form.metodo_pago] || form.metodo_pago}</span>
            <span><strong>Monto:</strong> ${Number(form.monto || 0).toLocaleString()}</span>
          </div>

          {form.metodo_pago === 'EFECTIVO' && (
            <div className="mov-denoms">
              <h3>Denominaciones en efectivo</h3>
              <div className="inventario-grid">
                {DENOMINACIONES.map((denom) => {
                  const item = movDenoms.find((i) => i.denominacion === denom) || { cantidad: 0 };
                  return (
                    <div className="inventario-item" key={denom}>
                      <span className="denom">${denom.toLocaleString()}</span>
                      <div className="denom-control">
                        <input
                          type="number"
                          min={0}
                          value={item.cantidad === 0 ? '' : item.cantidad}
                          placeholder="0"
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const parsed = raw === '' ? 0 : Number(raw);
                            handleMovDenomChange(denom, Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="inventario-total">
                Total por denominaciones: ${Number(totalMovimiento).toLocaleString()}
              </div>
            </div>
          )}
          <div className="section-actions">
            {editandoId && (
              <button
                className="btn-secondary"
                onClick={resetFormularioMovimiento}
              >
                Cancelar edición
              </button>
            )}
            <button className="btn-primary" onClick={handleGuardarMovimiento}>
              {editandoId ? 'Guardar Cambios' : 'Registrar'}
            </button>
          </div>
        </div>
        <aside className="caja-fuerte-section caja-fuerte-side">
          <div className="inventario-side-header">
            <h2>Inventario actual (efectivo)</h2>
            <span className="inventario-side-total">Total efectivo: ${Number(inventarioTotal).toLocaleString()}</span>
          </div>

          <div className="inventario-side-group">
            <div className="inventario-side-group-header">
              <h3>Billetes</h3>
              <strong>
                ${inventarioBilletes.reduce((acc, denom) => acc + (denom * Number(inventarioMap.get(denom) || 0)), 0).toLocaleString()}
              </strong>
            </div>
            <div className="inventario-grid inventario-grid-side">
              {inventarioBilletes.map((denom) => (
                <div className="inventario-item readonly" key={`bill-${denom}`}>
                  <span className="denom">${denom.toLocaleString()}</span>
                  <span className="cantidad">x {Number(inventarioMap.get(denom) || 0)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="inventario-side-group">
            <div className="inventario-side-group-header">
              <h3>Monedas</h3>
              <strong>
                ${inventarioMonedas.reduce((acc, denom) => acc + (denom * Number(inventarioMap.get(denom) || 0)), 0).toLocaleString()}
              </strong>
            </div>
            <div className="inventario-grid inventario-grid-side">
              {inventarioMonedas.map((denom) => (
                <div className="inventario-item readonly" key={`coin-${denom}`}>
                  <span className="denom">${denom.toLocaleString()}</span>
                  <span className="cantidad">x {Number(inventarioMap.get(denom) || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

      </div>

      <div className="caja-fuerte-section">
        <h2>Movimientos</h2>
        <div className="filtros">
          <select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
            <option value="">Todos</option>
            <option value="INGRESO">Ingresos</option>
            <option value="EGRESO">Egresos</option>
          </select>
          <select value={filtros.metodo_pago} onChange={(e) => setFiltros({ ...filtros, metodo_pago: e.target.value })}>
            <option value="">Todos los métodos</option>
            {METODOS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input type="date" value={filtros.fecha_inicio} onChange={(e) => setFiltros({ ...filtros, fecha_inicio: e.target.value })} />
          <input type="date" value={filtros.fecha_fin} onChange={(e) => setFiltros({ ...filtros, fecha_fin: e.target.value })} />
          <button className="btn-secondary" onClick={handleBuscar} disabled={cargando}>Filtrar</button>
          <button
            className="btn-secondary"
            onClick={() => {
              setFiltros({
                tipo: '',
                metodo_pago: '',
                fecha_inicio: '',
                fecha_fin: '',
              });
              void cargarTodo();
            }}
            disabled={cargando}
          >
            Limpiar
          </button>
        </div>

        <div className="tabla-movimientos">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Método</th>
                <th>Concepto</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((mov) => (
                <tr key={mov.id}>
                  <td>{new Date(mov.fecha).toLocaleString()}</td>
                  <td>{mov.tipo}</td>
                  <td>{mov.metodo_pago}</td>
                  <td>{mov.concepto}</td>
                  <td>${Number(mov.monto).toLocaleString()}</td>
                  <td>{mov.estado === 'ANULADO' ? 'Anulado' : 'Activo'}</td>
                  <td>{mov.usuario_nombre}</td>
                  <td className="acciones">
                    {mov.tipo === 'EGRESO' && mov.estado !== 'ANULADO' && (
                      <button className="btn-secondary" onClick={() => handleRecibo(mov.id)}>
                        Recibo
                      </button>
                    )}
                    {!mov.caja_id && mov.estado !== 'ANULADO' && (
                      <>
                        <button className="btn-secondary" onClick={() => handleEditar(mov)}>Editar</button>
                        <button className="btn-danger" onClick={() => handleEliminar(mov.id)}>Anular</button>
                      </>
                    )}
                    {mov.estado === 'ANULADO' && <span>Anulado</span>}
                  </td>
                </tr>
              ))}
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={8} className="no-data">Sin movimientos</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(eliminarMovimientoId)}
        title="Anular movimiento"
        message="Esta acción anula el movimiento y revierte su impacto en saldos. Debes registrar el motivo."
        confirmText="Sí, anular"
        cancelText="Cancelar"
        confirmVariant="danger"
        isLoading={eliminandoMovimiento}
        onCancel={() => {
          setEliminarMovimientoId(null);
          setMotivoAnulacion('');
        }}
        onConfirm={() => void confirmarEliminar()}
      >
        <div className="form-grid" style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="Motivo de anulación"
            value={motivoAnulacion}
            onChange={(e) => setMotivoAnulacion(e.target.value)}
            maxLength={240}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
