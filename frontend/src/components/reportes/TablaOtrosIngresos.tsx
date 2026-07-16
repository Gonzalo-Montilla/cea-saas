import { useState } from 'react';
import { FilePlus, Eye, Download } from 'lucide-react';
import { cajaAPI } from '../../services/api';
import { ModalBase } from '../ui/ModalBase';
import { ToastAlert } from '../ui/ToastAlert';
import { formatCurrencyCOP } from '../../utils/formatters';

interface OtrosIngresoItem {
  movimiento_id: number;
  tipo: string;
  fecha: string;
  concepto: string;
  categoria?: string | null;
  metodo_pago?: string | null;
  monto: number;
  tercero_nombre?: string | null;
  tercero_documento?: string | null;
  usuario?: string | null;
}

interface TablaOtrosIngresosProps {
  ingresos: OtrosIngresoItem[];
}

export const TablaOtrosIngresos = ({ ingresos }: TablaOtrosIngresosProps) => {
  const [reciboUrl, setReciboUrl] = useState<string | null>(null);
  const [reciboId, setReciboId] = useState<number | null>(null);
  const [cargandoRecibo, setCargandoRecibo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const formatearMoneda = (valor: number) => {
    return formatCurrencyCOP(valor || 0);
  };

  const formatearFecha = (fecha: string) => {
    return new Date(fecha).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const abrirRecibo = async (movimientoId: number) => {
    try {
      setCargandoRecibo(true);
      const blob = await cajaAPI.getMovimientoReciboPdf(movimientoId);
      const url = URL.createObjectURL(blob);
      setReciboUrl(url);
      setReciboId(movimientoId);
    } catch (error) {
      console.error('Error al abrir recibo:', error);
      setFeedback('No se pudo cargar el recibo.');
    } finally {
      setCargandoRecibo(false);
    }
  };

  const descargarRecibo = async (movimientoId: number) => {
    try {
      const blob = await cajaAPI.getMovimientoReciboPdf(movimientoId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recibo_otro_ingreso_${movimientoId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      console.error('Error al descargar recibo:', error);
      setFeedback('No se pudo descargar el recibo.');
    }
  };

  const cerrarRecibo = () => {
    if (reciboUrl) {
      URL.revokeObjectURL(reciboUrl);
    }
    setReciboUrl(null);
    setReciboId(null);
  };

  return (
    <div className="tabla-estudiantes-card">
      {feedback && (
        <ToastAlert type="error" message={feedback} onClose={() => setFeedback(null)} />
      )}
      <div className="tabla-header">
        <div className="tabla-titulo">
          <FilePlus size={20} />
          <h3>Otros ingresos</h3>
        </div>
        <span className="tabla-count">{ingresos.length} ingreso{ingresos.length !== 1 ? 's' : ''}</span>
      </div>
      {ingresos.length === 0 ? (
        <div className="tabla-empty" role="status" aria-live="polite">
          <FilePlus size={48} />
          <p>No hay ingresos registrados en este período</p>
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-estudiantes">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Categoría</th>
              <th>Pagó</th>
              <th>Documento</th>
              <th>Método</th>
              <th>Monto</th>
              <th>Usuario</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {ingresos.map((mov) => (
              <tr key={mov.movimiento_id}>
                <td className="td-fecha">{formatearFecha(mov.fecha)}</td>
                <td className="td-concepto">{mov.concepto}</td>
                <td>
                  {mov.categoria ? (
                    <span className="badge badge-category">{mov.categoria}</span>
                  ) : (
                    <span className="text-muted">OTROS</span>
                  )}
                </td>
                <td>{mov.tercero_nombre || 'N/A'}</td>
                <td>{mov.tercero_documento || 'N/A'}</td>
                <td>{mov.metodo_pago || 'MIXTO'}</td>
                <td className="td-monto td-monto-success">{formatearMoneda(mov.monto)}</td>
                <td>{mov.usuario || 'N/A'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="btn-ver-detalle"
                      onClick={() => abrirRecibo(mov.movimiento_id)}
                      disabled={cargandoRecibo}
                    >
                      <Eye size={16} />
                      Ver
                    </button>
                    <button
                      className="btn-ver-detalle secondary"
                      onClick={() => descargarRecibo(mov.movimiento_id)}
                      disabled={cargandoRecibo}
                    >
                      <Download size={16} />
                      Descargar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {reciboUrl && (
        <ModalBase
          isOpen={Boolean(reciboUrl)}
          title={`Recibo de otro ingreso #${reciboId || ''}`}
          onClose={cerrarRecibo}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={cerrarRecibo}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => void descargarRecibo(reciboId || 0)}>
                <Download size={16} /> Descargar
              </button>
            </>
          }
        >
          <div className="pdf-preview-body">
            <iframe src={reciboUrl} title="Recibo" />
          </div>
        </ModalBase>
      )}
    </div>
  );
};
