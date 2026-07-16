import { useMemo } from 'react';
import { formatCurrencyCOP, formatDateTimeCO } from '../../utils/formatters';
import '../../styles/Reportes.css';

interface MovimientoCajaItem {
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

interface Props {
  movimientos: MovimientoCajaItem[];
}

export const TablaOtrosMovimientos = ({ movimientos }: Props) => {
  const rows = useMemo(() => movimientos || [], [movimientos]);

  const formatearMoneda = (valor: number) => {
    return formatCurrencyCOP(valor || 0);
  };

  const formatearFecha = (fecha: string) => {
    return formatDateTimeCO(fecha);
  };

  return (
    <div className="tabla-reportes-card">
      <div className="tabla-header">
        <h3>Otros Movimientos en Caja</h3>
        <p>Ingresos y egresos no asociados a estudiantes</p>
      </div>
      <div className="tabla-container">
        <table className="tabla-reportes">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Categoría</th>
              <th>Concepto</th>
              <th>Quién pagó</th>
              <th>Método</th>
              <th>Monto</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>
                  Sin movimientos registrados.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.movimiento_id}>
                <td>{formatearFecha(m.fecha)}</td>
                <td>{m.tipo}</td>
                <td>{m.categoria || 'OTROS'}</td>
                <td>{m.concepto}</td>
                <td>
                  {m.tercero_nombre || 'N/A'}
                  {m.tercero_documento ? ` • ${m.tercero_documento}` : ''}
                </td>
                <td>{m.metodo_pago || 'MIXTO'}</td>
                <td>{formatearMoneda(m.monto)}</td>
                <td>{m.usuario || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
