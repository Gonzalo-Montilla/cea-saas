import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { reportesAPI } from '../services/api';
import { parseApiError } from '../utils/errors';
import { formatCurrencyCOP, formatDateTimeCO } from '../utils/formatters';
import '../styles/CierreFinanciero.css';

type CajaItem = {
  id: number;
  fecha_apertura: string;
  fecha_cierre?: string;
  estado: string;
  total_ingresos: number;
  total_egresos: number;
  diferencia?: number;
};

type CierreResponse = {
  fecha_inicio: string;
  fecha_fin: string;
  total_ingresos: number;
  total_egresos: number;
  saldo_efectivo_teorico: number;
  total_efectivo: number;
  total_transferencias: number;
  total_tarjetas: number;
  total_nequi: number;
  total_daviplata: number;
  total_transferencia_bancaria: number;
  total_tarjeta_debito: number;
  total_tarjeta_credito: number;
  total_credismart: number;
  total_sistecredito: number;
  cajas: CajaItem[];
};

const CierreFinanciero = () => {
  const hoy = new Date();
  const [fechaInicio, setFechaInicio] = useState(
    new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10)
  );
  const [fechaFin, setFechaFin] = useState(hoy.toISOString().slice(0, 10));
  const [data, setData] = useState<CierreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reportesAPI.getCierreFinanciero({
        fecha_inicio: `${fechaInicio}T00:00:00`,
        fecha_fin: `${fechaFin}T23:59:59`,
      });
      setData(res);
    } catch (e: any) {
      setError(parseApiError(e, 'No se pudo cargar el cierre financiero'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const exportarCSV = () => {
    if (!data) return;
    const rows = [
      ['Cierre financiero'],
      ['Fecha inicio', data.fecha_inicio],
      ['Fecha fin', data.fecha_fin],
      ['Total ingresos', data.total_ingresos],
      ['Total egresos', data.total_egresos],
      ['Saldo efectivo teórico', data.saldo_efectivo_teorico],
      [],
      ['Detalle por caja'],
      ['ID', 'Apertura', 'Cierre', 'Estado', 'Ingresos', 'Egresos', 'Diferencia'],
      ...data.cajas.map((c) => [
        c.id,
        c.fecha_apertura,
        c.fecha_cierre || '',
        c.estado,
        c.total_ingresos,
        c.total_egresos,
        c.diferencia ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `cierre_financiero_${fechaInicio}_${fechaFin}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cierre-container">
      <PageHeader
        title="Cierre financiero"
        subtitle="Consolidado financiero por periodo"
        icon={<ClipboardList size={20} />}
        actions={
          <div className="cierre-actions">
            <div className="cierre-fechas">
              <label>Inicio</label>
              <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              <label>Fin</label>
              <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </div>
            <button className="btn" onClick={cargar}>Actualizar</button>
            <button className="btn-outline" onClick={exportarCSV} disabled={!data}>Exportar CSV</button>
          </div>
        }
      />

      {loading && <div className="cierre-loading">Cargando cierre...</div>}
      {error && <div className="cierre-error">{error}</div>}

      {data && (
        <div className="cierre-content">
          <div className="cierre-grid">
            <div className="cierre-card">
              <div className="cierre-label">Total ingresos</div>
              <div className="cierre-value">{formatCurrencyCOP(data.total_ingresos)}</div>
            </div>
            <div className="cierre-card">
              <div className="cierre-label">Total egresos</div>
              <div className="cierre-value">{formatCurrencyCOP(data.total_egresos)}</div>
            </div>
            <div className="cierre-card">
              <div className="cierre-label">Saldo efectivo teórico</div>
              <div className="cierre-value">{formatCurrencyCOP(data.saldo_efectivo_teorico)}</div>
            </div>
            <div className="cierre-card">
              <div className="cierre-label">Efectivo</div>
              <div className="cierre-value">{formatCurrencyCOP(data.total_efectivo)}</div>
            </div>
            <div className="cierre-card">
              <div className="cierre-label">Transferencias</div>
              <div className="cierre-value">{formatCurrencyCOP(data.total_transferencias)}</div>
            </div>
            <div className="cierre-card">
              <div className="cierre-label">Tarjetas</div>
              <div className="cierre-value">{formatCurrencyCOP(data.total_tarjetas)}</div>
            </div>
          </div>

          <div className="cierre-table mobile-table-wrap">
            <h3>Detalle por caja</h3>
            {data.cajas.length === 0 ? (
              <div className="cierre-empty">Sin cajas en el período.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Apertura</th>
                    <th>Cierre</th>
                    <th>Estado</th>
                    <th>Ingresos</th>
                    <th>Egresos</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cajas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{formatDateTimeCO(c.fecha_apertura)}</td>
                      <td>{c.fecha_cierre ? formatDateTimeCO(c.fecha_cierre) : '-'}</td>
                      <td>{c.estado}</td>
                      <td>{formatCurrencyCOP(c.total_ingresos)}</td>
                      <td>{formatCurrencyCOP(c.total_egresos)}</td>
                      <td>{c.diferencia != null ? formatCurrencyCOP(c.diferencia) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CierreFinanciero;
