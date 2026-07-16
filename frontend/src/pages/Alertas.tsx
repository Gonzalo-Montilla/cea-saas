import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { reportesAPI } from '../services/api';
import { parseApiError } from '../utils/errors';
import { formatCurrencyCOP, formatDateCO } from '../utils/formatters';
import '../styles/Alertas.css';

type DocumentoAlerta = {
  vehiculo_id: number;
  placa: string;
  documento: string;
  fecha_vencimiento: string;
  dias_restantes: number;
};

type DocumentoInstructor = {
  instructor_id: number;
  nombre_completo: string;
  documento: string;
  fecha_vencimiento: string;
  dias_restantes: number;
};

type PinAlerta = {
  estudiante_id: number;
  nombre_completo: string;
  cedula: string;
  fecha_vencimiento: string;
  dias_restantes: number;
};

type PagoVencido = {
  pago_id: number;
  estudiante_id: number;
  nombre_completo: string;
  monto: number;
  fecha_vencimiento: string;
  dias_mora: number;
};

type Compromiso = {
  cuota_id: number;
  estudiante_id: number;
  nombre_completo: string;
  saldo_cuota: number;
  fecha_vencimiento: string;
  dias_restantes: number;
};

const Alertas = () => {
  const [dias, setDias] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoAlerta[]>([]);
  const [documentosInstructor, setDocumentosInstructor] = useState<DocumentoInstructor[]>([]);
  const [pins, setPins] = useState<PinAlerta[]>([]);
  const [pagos, setPagos] = useState<PagoVencido[]>([]);
  const [compromisos, setCompromisos] = useState<Compromiso[]>([]);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportesAPI.getAlertasVencimientos({ dias });
      setDocumentos(data.documentos_vehiculo || []);
      setDocumentosInstructor(data.documentos_instructor || []);
      setPins(data.pins_por_vencer || []);
      setPagos(data.pagos_vencidos || []);
      setCompromisos(data.compromisos_por_vencer || []);
    } catch (e: any) {
      setError(parseApiError(e, 'No se pudieron cargar las alertas'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, [dias]);

  return (
    <div className="alertas-container">
      <PageHeader
        title="Vencimientos y alertas"
        subtitle="Control de alertas por vencimiento"
        icon={<Bell size={20} />}
        actions={
          <div className="alertas-filter">
            <label>Ventana:</label>
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              <option value={7}>7 días</option>
              <option value={15}>15 días</option>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
          </div>
        }
      />

      {loading && <div className="alertas-loading">Cargando alertas...</div>}
      {error && <div className="alertas-error">{error}</div>}

      <div className="alertas-grid">
        <div className="alertas-card">
          <h3>Documentos de vehículos</h3>
          {documentos.length === 0 ? (
            <div className="alertas-empty">Sin vencimientos en este rango.</div>
          ) : (
            <div className="alertas-list">
              {documentos.map((d) => (
                <div
                  key={`${d.vehiculo_id}-${d.documento}`}
                  className={`alerta-item ${d.dias_restantes < 0 ? 'alerta-item--vencida' : ''}`}
                >
                  <div>
                    <strong>{d.documento}</strong> • {d.placa}
                  </div>
                  <div className="alerta-meta">
                    {formatDateCO(d.fecha_vencimiento)} • {d.dias_restantes} días
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="alertas-card">
          <h3>Documentos de instructores</h3>
          {documentosInstructor.length === 0 ? (
            <div className="alertas-empty">Sin vencimientos en este rango.</div>
          ) : (
            <div className="alertas-list">
              {documentosInstructor.map((d) => (
                <div
                  key={`${d.instructor_id}-${d.documento}`}
                  className={`alerta-item ${d.dias_restantes < 0 ? 'alerta-item--vencida' : ''}`}
                >
                  <div>
                    <strong>{d.documento}</strong> • {d.nombre_completo}
                  </div>
                  <div className="alerta-meta">
                    {formatDateCO(d.fecha_vencimiento)} • {d.dias_restantes} días
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="alertas-card">
          <h3>PIN por vencer</h3>
          {pins.length === 0 ? (
            <div className="alertas-empty">Sin alertas de PIN.</div>
          ) : (
            <div className="alertas-list">
              {pins.map((p) => (
                <div
                  key={p.estudiante_id}
                  className={`alerta-item ${p.dias_restantes < 0 ? 'alerta-item--vencida' : ''}`}
                >
                  <div>
                    <strong>{p.nombre_completo}</strong> • {p.cedula}
                  </div>
                  <div className="alerta-meta">
                    {formatDateCO(p.fecha_vencimiento)} • {p.dias_restantes} días
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="alertas-card">
          <h3>Pagos vencidos</h3>
          {pagos.length === 0 ? (
            <div className="alertas-empty">Sin pagos vencidos.</div>
          ) : (
            <div className="alertas-list">
              {pagos.map((p) => (
                <div
                  key={p.pago_id}
                  className={`alerta-item ${p.dias_mora > 0 ? 'alerta-item--vencida' : ''}`}
                >
                  <div>
                    <strong>{p.nombre_completo}</strong> • {formatCurrencyCOP(p.monto)}
                  </div>
                  <div className="alerta-meta">
                    Venció {formatDateCO(p.fecha_vencimiento)} • {p.dias_mora} días de mora
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="alertas-card">
          <h3>Compromisos por vencer</h3>
          {compromisos.length === 0 ? (
            <div className="alertas-empty">Sin compromisos por vencer.</div>
          ) : (
            <div className="alertas-list">
              {compromisos.map((c) => (
                <div
                  key={c.cuota_id}
                  className={`alerta-item ${c.dias_restantes < 0 ? 'alerta-item--vencida' : ''}`}
                >
                  <div>
                    <strong>{c.nombre_completo}</strong> • {formatCurrencyCOP(c.saldo_cuota)}
                  </div>
                  <div className="alerta-meta">
                    {formatDateCO(c.fecha_vencimiento)} • {c.dias_restantes} días
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Alertas;
