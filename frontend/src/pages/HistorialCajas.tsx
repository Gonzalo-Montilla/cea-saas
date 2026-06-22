import { useState, useEffect } from 'react';
import { History, Search, X, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { cajaAPI } from '../services/api';
import { ModalBase } from '../components/ui/ModalBase';
import { ToastAlert } from '../components/ui/ToastAlert';
import '../styles/HistorialCajas.css';

interface CajaHistorial {
  id: number;
  fecha_apertura: string;
  fecha_cierre: string | null;
  usuario_apertura: string;
  usuario_cierre: string | null;
  saldo_inicial: number;
  saldo_final_teorico: number;
  efectivo_teorico: number;
  efectivo_fisico: number | null;
  diferencia: number | null;
  estado: string;
  total_ingresos: number;
  total_egresos: number;
  saldo_efectivo_caja: number;
  total_ingresos_efectivo: number;
  total_nequi: number;
  total_daviplata: number;
  total_transferencia_bancaria: number;
  total_tarjeta_debito: number;
  total_tarjeta_credito: number;
  total_credismart: number;
  total_sistecredito: number;
  num_pagos: number;
  num_egresos: number;
  observaciones_apertura: string | null;
  observaciones_cierre: string | null;
}

export const HistorialCajas = () => {
  const [cajas, setCajas] = useState<CajaHistorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [cajaSeleccionada, setCajaSeleccionada] = useState<CajaHistorial | null>(null);
  const [showDetalleModal, setShowDetalleModal] = useState(false);
  const [expandirResumen, setExpandirResumen] = useState(false);
  const [paginaActual, setPaginaActual] = useState(1);
  const [notificacion, setNotificacion] = useState<string | null>(null);
  const cajasPorPagina = 15;

  useEffect(() => {
    cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarHistorial = async (inicio?: string, fin?: string, pagina = 1) => {
    try {
      setLoading(true);
      const params: { fecha_inicio?: string; fecha_fin?: string; skip?: number; limit?: number } = {};
      
      // Convertir fechas a formato ISO con hora
      if (inicio) {
        const fechaInicioISO = new Date(inicio + 'T00:00:00').toISOString();
        params.fecha_inicio = fechaInicioISO;
      }
      if (fin) {
        const fechaFinISO = new Date(fin + 'T23:59:59').toISOString();
        params.fecha_fin = fechaFinISO;
      }
      params.skip = (pagina - 1) * cajasPorPagina;
      params.limit = cajasPorPagina;

      const response = await cajaAPI.getHistorial(params);
      
      // Asegurar que response.data es un array
      const data = Array.isArray(response) ? response : [];
      console.log('Historial cargado:', data);
      setCajas(data);
    } catch (error) {
      console.error('Error al cargar historial:', error);
      setCajas([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltrar = () => {
    if (fechaInicio && fechaFin && new Date(fechaInicio) > new Date(fechaFin)) {
      setNotificacion('La fecha de inicio no puede ser mayor a la fecha fin.');
      return;
    }
    setPaginaActual(1);
    cargarHistorial(fechaInicio, fechaFin, 1);
  };

  const handleLimpiarFiltros = () => {
    setFechaInicio('');
    setFechaFin('');
    setPaginaActual(1);
    cargarHistorial(undefined, undefined, 1);
  };

  const handleVerDetalle = (caja: CajaHistorial) => {
    setCajaSeleccionada(caja);
    setShowDetalleModal(true);
    setExpandirResumen(false);
  };

  const cambiarPagina = (nuevaPagina: number) => {
    if (nuevaPagina < 1) return;
    setPaginaActual(nuevaPagina);
    cargarHistorial(fechaInicio, fechaFin, nuevaPagina);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatearFecha = (fecha: string | null) => {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatearMoneda = (valor: number | null) => {
    if (valor === null) return '-';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(valor);
  };

  const getEstadoBadge = (estado: string) => {
    return estado === 'CERRADA' ? 'badge-cerrada' : 'badge-abierta';
  };

  const getDiferenciaTipo = (diferencia: number | null) => {
    if (diferencia === null) return '';
    if (diferencia === 0) return 'exacta';
    if (diferencia > 0) return 'sobrante';
    return 'faltante';
  };

  const getDiferenciaTexto = (diferencia: number | null) => {
    if (diferencia === null) return '-';
    if (diferencia === 0) return 'Caja Cuadrada';
    if (diferencia > 0) return `Sobrante: ${formatearMoneda(diferencia)}`;
    return `Faltante: ${formatearMoneda(Math.abs(diferencia))}`;
  };

  return (
    <div className="historial-cajas-container">
      <PageHeader
        title="Historial de Cajas"
        subtitle="Consulta todas las cajas cerradas"
        icon={<History size={20} />}
      />

      {notificacion && (
        <ToastAlert
          type="info"
          message={notificacion}
          onClose={() => setNotificacion(null)}
        />
      )}

      {/* Filtros */}
      <div className="filtros-section">
        <div className="filtro-grupo">
          <label>Desde:</label>
          <input
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className="input-fecha"
          />
        </div>
        <div className="filtro-grupo">
          <label>Hasta:</label>
          <input
            type="date"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            className="input-fecha"
          />
        </div>
        <button onClick={handleFiltrar} className="btn-filtrar">
          <Search size={18} />
          Filtrar
        </button>
        <button onClick={handleLimpiarFiltros} className="btn-limpiar">
          <X size={18} />
          Limpiar
        </button>
      </div>

      {/* Tabla de cajas */}
      {loading ? (
        <div className="loading-container">
          <p>Cargando historial...</p>
        </div>
      ) : !cajas || cajas.length === 0 ? (
        <div className="empty-state">
          <History size={48} />
          <p>No se encontraron cajas cerradas</p>
        </div>
      ) : (
        <div className="tabla-container">
          <table className="tabla-historial">
            <thead>
              <tr>
                <th>ID</th>
                <th>Fecha Apertura</th>
                <th>Fecha Cierre</th>
                <th>Usuario Apertura</th>
                <th>Saldo Inicial</th>
                <th>Total Recaudado</th>
                <th>Efectivo en Caja</th>
                <th>Diferencia Arqueo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(cajas) && cajas.map((caja) => (
                <tr key={caja.id}>
                  <td>{caja.id}</td>
                  <td>{formatearFecha(caja.fecha_apertura)}</td>
                  <td>{formatearFecha(caja.fecha_cierre)}</td>
                  <td>{caja.usuario_apertura}</td>
                  <td>{formatearMoneda(caja.saldo_inicial)}</td>
                  <td className="monto-positivo">
                    {formatearMoneda(caja.total_ingresos)}
                  </td>
                  <td className="monto-efectivo">
                    {formatearMoneda(caja.saldo_efectivo_caja)}
                  </td>
                  <td className={`diferencia ${getDiferenciaTipo(caja.diferencia)}`}>
                    {getDiferenciaTexto(caja.diferencia)}
                  </td>
                  <td>
                    <span className={`badge ${getEstadoBadge(caja.estado)}`}>
                      {caja.estado}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleVerDetalle(caja)}
                      className="btn-ver-detalle"
                      title="Ver detalle completo"
                    >
                      <FileText size={18} />
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button
              onClick={() => cambiarPagina(paginaActual - 1)}
              disabled={paginaActual === 1}
              className="pagination-btn"
            >
              « Anterior
            </button>
            <div className="pagination-info">
              <span>Página {paginaActual}</span>
            </div>
            <button
              onClick={() => cambiarPagina(paginaActual + 1)}
              disabled={cajas.length < cajasPorPagina}
              className="pagination-btn"
            >
              Siguiente »
            </button>
          </div>
        </div>
      )}

      {/* Modal de detalle */}
      {showDetalleModal && cajaSeleccionada && (
        <ModalBase
          isOpen={showDetalleModal}
          title={`Detalle de Caja #${cajaSeleccionada.id}`}
          onClose={() => setShowDetalleModal(false)}
          size="lg"
        >
          <div className="modal-body-historial">
              {/* Información general */}
              <div className="seccion-detalle">
                <h3>Información General</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Usuario Apertura:</span>
                    <span className="info-value">{cajaSeleccionada.usuario_apertura}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Usuario Cierre:</span>
                    <span className="info-value">{cajaSeleccionada.usuario_cierre || '-'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Fecha Apertura:</span>
                    <span className="info-value">{formatearFecha(cajaSeleccionada.fecha_apertura)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Fecha Cierre:</span>
                    <span className="info-value">{formatearFecha(cajaSeleccionada.fecha_cierre)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Saldo Inicial:</span>
                    <span className="info-value destacado">{formatearMoneda(cajaSeleccionada.saldo_inicial)}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Estado:</span>
                    <span className={`badge ${getEstadoBadge(cajaSeleccionada.estado)}`}>
                      {cajaSeleccionada.estado}
                    </span>
                  </div>
                </div>
              </div>

              {/* Resumen de transacciones */}
              <div className="seccion-detalle seccion-colapsable">
                <button
                  type="button"
                  onClick={() => setExpandirResumen(!expandirResumen)}
                  className="titulo-colapsable"
                  aria-expanded={expandirResumen}
                  aria-controls="historial-resumen-transacciones"
                >
                  Resumen de Transacciones
                  {expandirResumen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                
                {expandirResumen && (
                  <div className="transacciones-grid" id="historial-resumen-transacciones">
                    <div className="metodo-grupo">
                      <h4>Efectivo</h4>
                      <div className="metodo-item">
                        <span>Efectivo Recibido</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_ingresos_efectivo)}</span>
                      </div>
                    </div>

                    <div className="metodo-grupo">
                      <h4>Transferencias</h4>
                      <div className="metodo-item">
                        <span>Nequi</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_nequi)}</span>
                      </div>
                      <div className="metodo-item">
                        <span>Daviplata</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_daviplata)}</span>
                      </div>
                      <div className="metodo-item">
                        <span>Transferencia Bancaria</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_transferencia_bancaria)}</span>
                      </div>
                    </div>

                    <div className="metodo-grupo">
                      <h4>Tarjetas</h4>
                      <div className="metodo-item">
                        <span>Débito</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_tarjeta_debito)}</span>
                      </div>
                      <div className="metodo-item">
                        <span>Crédito</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_tarjeta_credito)}</span>
                      </div>
                    </div>

                    <div className="metodo-grupo">
                      <h4>Créditos Financieras</h4>
                      <div className="metodo-item">
                        <span>CrediSmart</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_credismart)}</span>
                      </div>
                      <div className="metodo-item">
                        <span>Sistecredito</span>
                        <span className="monto">{formatearMoneda(cajaSeleccionada.total_sistecredito)}</span>
                      </div>
                    </div>

                    <div className="metodo-grupo">
                      <h4>Egresos</h4>
                      <div className="metodo-item">
                        <span>Total Egresos</span>
                        <span className="monto negativo">{formatearMoneda(cajaSeleccionada.total_egresos)}</span>
                      </div>
                    </div>

                    <div className="metodo-grupo">
                      <h4>Conteo Transacciones</h4>
                      <div className="metodo-item">
                        <span>Total Pagos</span>
                        <span className="monto">{cajaSeleccionada.num_pagos}</span>
                      </div>
                      <div className="metodo-item">
                        <span>Total Egresos</span>
                        <span className="monto">{cajaSeleccionada.num_egresos}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Arqueo de caja */}
              <div className="seccion-detalle seccion-arqueo">
                <h3>Arqueo de Caja</h3>
                <div className="arqueo-grid">
                  <div className="arqueo-item">
                    <span className="arqueo-label">Efectivo Teórico:</span>
                    <span className="arqueo-value">{formatearMoneda(cajaSeleccionada.efectivo_teorico)}</span>
                  </div>
                  <div className="arqueo-item">
                    <span className="arqueo-label">Efectivo Físico Contado:</span>
                    <span className="arqueo-value destacado">{formatearMoneda(cajaSeleccionada.efectivo_fisico)}</span>
                  </div>
                  <div className="arqueo-item full-width">
                    <span className="arqueo-label">Diferencia:</span>
                    <span className={`arqueo-value diferencia-valor ${getDiferenciaTipo(cajaSeleccionada.diferencia)}`}>
                      {getDiferenciaTexto(cajaSeleccionada.diferencia)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Totales */}
              <div className="seccion-detalle seccion-totales">
                <div className="total-item">
                  <span>Total Ingresos:</span>
                  <span className="total-valor positivo">{formatearMoneda(cajaSeleccionada.total_ingresos)}</span>
                </div>
                <div className="total-item">
                  <span>Total Egresos:</span>
                  <span className="total-valor negativo">{formatearMoneda(cajaSeleccionada.total_egresos)}</span>
                </div>
                <div className="total-item destacado-total">
                  <span>Saldo Final Teórico:</span>
                  <span className="total-valor">{formatearMoneda(cajaSeleccionada.saldo_final_teorico)}</span>
                </div>
              </div>

              {/* Observaciones */}
              {(cajaSeleccionada.observaciones_apertura || cajaSeleccionada.observaciones_cierre) && (
                <div className="seccion-detalle">
                  <h3>Observaciones</h3>
                  {cajaSeleccionada.observaciones_apertura && (
                    <div className="observacion-item">
                      <strong>Apertura:</strong>
                      <p>{cajaSeleccionada.observaciones_apertura}</p>
                    </div>
                  )}
                  {cajaSeleccionada.observaciones_cierre && (
                    <div className="observacion-item">
                      <strong>Cierre:</strong>
                      <p>{cajaSeleccionada.observaciones_cierre}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Botón PDF (preparado para futura implementación) */}
              <div className="acciones-modal">
                <button className="btn-pdf" disabled title="Próximamente">
                  <FileText size={18} />
                  Descargar PDF
                </button>
              </div>
          </div>
        </ModalBase>
      )}
    </div>
  );
};
