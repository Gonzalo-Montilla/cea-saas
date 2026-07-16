import { useState } from 'react';
import { FileText, Download, Eye } from 'lucide-react';
import { cajaAPI } from '../../services/api';
import { ModalBase } from '../ui/ModalBase';
import { ToastAlert } from '../ui/ToastAlert';
import { formatCurrencyCOP } from '../../utils/formatters';

interface PagoConcepto {
  pago_id: number;
  estudiante_id: number;
  nombre_completo: string;
  documento: string;
  categoria: string | null;
  fecha_pago: string;
  concepto: string;
  monto: string;
  metodo_pago: string | null;
  es_pago_mixto: boolean;
}

interface TablaConceptosPagosProps {
  pagos: PagoConcepto[];
}

export const TablaConceptosPagos = ({ pagos }: TablaConceptosPagosProps) => {
  const [reciboUrl, setReciboUrl] = useState<string | null>(null);
  const [reciboNombre, setReciboNombre] = useState<string>('');
  const [cargandoRecibo, setCargandoRecibo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const formatearMoneda = (valor: string | null) => {
    if (!valor) return 'N/A';
    return formatCurrencyCOP(parseFloat(valor));
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

  const getMetodoPago = (metodo: string | null, esMixto: boolean) => {
    if (esMixto) return 'Mixto';
    if (!metodo) return 'N/A';
    const nombres: { [key: string]: string } = {
      'EFECTIVO': 'Efectivo',
      'NEQUI': 'Nequi',
      'DAVIPLATA': 'Daviplata',
      'TRANSFERENCIA_BANCARIA': 'Transferencia',
      'TARJETA_DEBITO': 'Tarjeta Débito',
      'TARJETA_CREDITO': 'Tarjeta Crédito',
      'CREDISMART': 'CrediSmart',
      'SISTECREDITO': 'Sistecredito'
    };
    return nombres[metodo] || metodo;
  };

  const abrirRecibo = async (pagoId: number) => {
    try {
      setCargandoRecibo(true);
      const blob = await cajaAPI.getPagoReciboPdf(pagoId);
      const url = window.URL.createObjectURL(blob);
      setReciboUrl(url);
      setReciboNombre(`recibo_pago_${pagoId}.pdf`);
    } catch (err) {
      console.error('Error al cargar recibo:', err);
      setFeedback('No se pudo cargar el recibo.');
    } finally {
      setCargandoRecibo(false);
    }
  };

  const descargarRecibo = () => {
    if (!reciboUrl) return;
    const link = document.createElement('a');
    link.href = reciboUrl;
    link.download = reciboNombre || 'recibo_pago.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const descargarReciboDirecto = async (pagoId: number) => {
    try {
      const blob = await cajaAPI.getPagoReciboPdf(pagoId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recibo_pago_${pagoId}.pdf`;
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
    setReciboNombre('');
  };

  return (
    <div className="tabla-estudiantes-card">
      {feedback && (
        <ToastAlert type="error" message={feedback} onClose={() => setFeedback(null)} />
      )}
      <div className="tabla-header">
        <div className="tabla-titulo">
          <FileText size={20} />
          <h3>Conceptos de Pagos</h3>
        </div>
        <span className="tabla-count">{pagos.length} pago{pagos.length !== 1 ? 's' : ''}</span>
      </div>

      {pagos.length === 0 ? (
        <div className="tabla-empty" role="status" aria-live="polite">
          <FileText size={48} />
          <p>No hay pagos registrados en este período</p>
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-estudiantes">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Estudiante</th>
                <th>Documento</th>
                <th>Categoría</th>
                <th>Método</th>
                <th>Monto</th>
                <th>Recibo</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((pago) => (
                <tr key={`pago-${pago.pago_id}`}>
                  <td className="td-fecha">{formatearFecha(pago.fecha_pago)}</td>
                  <td className="td-concepto">{pago.concepto}</td>
                  <td className="td-nombre">{pago.nombre_completo}</td>
                  <td>{pago.documento}</td>
                  <td>
                    {pago.categoria ? (
                      <span className="badge badge-category">{pago.categoria}</span>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td>{getMetodoPago(pago.metodo_pago, pago.es_pago_mixto)}</td>
                  <td className="td-monto td-monto-success">{formatearMoneda(pago.monto)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        className="btn-ver-detalle"
                        onClick={() => abrirRecibo(pago.pago_id)}
                        disabled={cargandoRecibo}
                      >
                        <Eye size={16} />
                        Ver
                      </button>
                      <button
                        className="btn-ver-detalle secondary"
                        onClick={() => descargarReciboDirecto(pago.pago_id)}
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
          title="Recibo de Pago"
          onClose={cerrarRecibo}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={cerrarRecibo}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={descargarRecibo}>
                <Download size={16} /> Descargar
              </button>
            </>
          }
        >
          <div className="pdf-preview-body">
            <iframe src={reciboUrl} title="Recibo de pago" />
          </div>
        </ModalBase>
      )}
    </div>
  );
};
