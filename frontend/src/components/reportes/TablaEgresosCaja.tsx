import { useState } from 'react';
import { FileMinus, Download, Eye } from 'lucide-react';
import { cajaAPI } from '../../services/api';
import { ModalBase } from '../ui/ModalBase';
import { ToastAlert } from '../ui/ToastAlert';

interface EgresoItem {
  egreso_id: number;
  fecha: string;
  concepto: string;
  categoria: string | null;
  metodo_pago: string;
  monto: string;
  usuario?: string | null;
}

interface TablaEgresosCajaProps {
  egresos: EgresoItem[];
}

export const TablaEgresosCaja = ({ egresos }: TablaEgresosCajaProps) => {
  const [reciboUrl, setReciboUrl] = useState<string | null>(null);
  const [reciboId, setReciboId] = useState<number | null>(null);
  const [cargandoRecibo, setCargandoRecibo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const formatearMoneda = (valor: string | null) => {
    if (!valor) return 'N/A';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(parseFloat(valor));
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

  const abrirRecibo = async (egresoId: number) => {
    try {
      setCargandoRecibo(true);
      const blob = await cajaAPI.getEgresoReciboPdf(egresoId);
      const url = window.URL.createObjectURL(blob);
      setReciboUrl(url);
      setReciboId(egresoId);
    } catch (err) {
      console.error('Error al cargar recibo:', err);
      setFeedback('No se pudo cargar el recibo.');
    } finally {
      setCargandoRecibo(false);
    }
  };

  const descargarReciboDirecto = async (egresoId: number) => {
    try {
      const blob = await cajaAPI.getEgresoReciboPdf(egresoId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recibo_egreso_${egresoId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al descargar recibo:', err);
      setFeedback('No se pudo descargar el recibo.');
    }
  };

  const cerrarRecibo = () => {
    if (reciboUrl) {
      window.URL.revokeObjectURL(reciboUrl);
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
          <FileMinus size={20} />
          <h3>Egresos Registrados</h3>
        </div>
        <span className="tabla-count">{egresos.length} egreso{egresos.length !== 1 ? 's' : ''}</span>
      </div>

      {egresos.length === 0 ? (
        <div className="tabla-empty" role="status" aria-live="polite">
          <FileMinus size={48} />
          <p>No hay egresos registrados en este período</p>
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-estudiantes">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Categoría</th>
                <th>Método</th>
                <th>Monto</th>
                <th>Usuario</th>
                <th>Recibo</th>
              </tr>
            </thead>
            <tbody>
              {egresos.map((egreso) => (
                <tr key={`egreso-${egreso.egreso_id}`}>
                  <td className="td-fecha">{formatearFecha(egreso.fecha)}</td>
                  <td className="td-concepto">{egreso.concepto}</td>
                  <td>
                    {egreso.categoria ? (
                      <span className="badge badge-category">{egreso.categoria}</span>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td>{egreso.metodo_pago}</td>
                  <td className="td-monto td-monto-danger">{formatearMoneda(egreso.monto)}</td>
                  <td>{egreso.usuario || 'N/A'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn-ver-detalle"
                        onClick={() => abrirRecibo(egreso.egreso_id)}
                        disabled={cargandoRecibo}
                      >
                        <Eye size={16} />
                        Ver
                      </button>
                      <button
                        className="btn-ver-detalle secondary"
                        onClick={() => descargarReciboDirecto(egreso.egreso_id)}
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
          title="Recibo de Egreso"
          onClose={cerrarRecibo}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={cerrarRecibo}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => reciboId && void descargarReciboDirecto(reciboId)}
              >
                <Download size={16} /> Descargar
              </button>
            </>
          }
        >
          <div className="pdf-preview-body">
            <iframe src={reciboUrl} title="Recibo de egreso" />
          </div>
        </ModalBase>
      )}
    </div>
  );
};
