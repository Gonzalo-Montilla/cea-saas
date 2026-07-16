import { DollarSign } from 'lucide-react';
import { formatCurrencyCOP } from '../../utils/formatters';

interface EstudiantePago {
  estudiante_id: number;
  nombre_completo: string;
  documento: string;
  categoria: string | null;
  fecha_pago: string;
  concepto: string;
  monto: string;
  metodo_pago: string | null;
  es_pago_mixto: boolean;
  saldo_pendiente: string | null;
}

interface TablaEstudiantesPagosProps {
  pagos: EstudiantePago[];
}

export const TablaEstudiantesPagos = ({ pagos }: TablaEstudiantesPagosProps) => {
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

  const getMetodoPagoBadge = (metodo: string | null, esMixto: boolean) => {
    if (esMixto) {
      return <span className="badge badge-mixto">Mixto</span>;
    }
    
    if (!metodo) return <span className="text-muted">N/A</span>;
    
    const colores: { [key: string]: string } = {
      'EFECTIVO': 'badge-success',
      'NEQUI': 'badge-nequi',
      'DAVIPLATA': 'badge-daviplata',
      'TRANSFERENCIA_BANCARIA': 'badge-primary',
      'TARJETA_DEBITO': 'badge-info',
      'TARJETA_CREDITO': 'badge-warning',
      'CREDISMART': 'badge-secondary',
      'SISTECREDITO': 'badge-secondary'
    };

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

    return (
      <span className={`badge ${colores[metodo] || 'badge-secondary'}`}>
        {nombres[metodo] || metodo}
      </span>
    );
  };

  return (
    <div className="tabla-estudiantes-card">
      <div className="tabla-header">
        <div className="tabla-titulo">
          <DollarSign size={20} />
          <h3>Estudiantes que Realizaron Pagos</h3>
        </div>
        <span className="tabla-count">{pagos.length} pago{pagos.length !== 1 ? 's' : ''}</span>
      </div>

      {pagos.length === 0 ? (
        <div className="tabla-empty" role="status" aria-live="polite">
          <DollarSign size={48} />
          <p>No hay pagos registrados en este período</p>
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-estudiantes">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Categoría</th>
                <th>Fecha Pago</th>
                <th>Concepto</th>
                <th>Monto</th>
                <th>Método Pago</th>
                <th>Saldo Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((pago, index) => (
                <tr key={`${pago.estudiante_id}-${index}`}>
                  <td className="td-nombre">{pago.nombre_completo}</td>
                  <td>{pago.documento}</td>
                  <td>
                    {pago.categoria ? (
                      <span className="badge badge-category">{pago.categoria}</span>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td className="td-fecha">{formatearFecha(pago.fecha_pago)}</td>
                  <td className="td-concepto">{pago.concepto}</td>
                  <td className="td-monto td-monto-success">{formatearMoneda(pago.monto)}</td>
                  <td>
                    {getMetodoPagoBadge(pago.metodo_pago, pago.es_pago_mixto)}
                  </td>
                  <td className="td-monto">
                    {pago.saldo_pendiente && parseFloat(pago.saldo_pendiente) > 0 ? (
                      <span className="saldo-pendiente">{formatearMoneda(pago.saldo_pendiente)}</span>
                    ) : (
                      <span className="saldo-pagado">Pagado</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
