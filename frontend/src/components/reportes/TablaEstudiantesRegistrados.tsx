import { UserPlus } from 'lucide-react';
import { formatCurrencyCOP } from '../../utils/formatters';

interface EstudianteRegistrado {
  id: number;
  nombre_completo: string;
  documento: string;
  categoria: string | null;
  fecha_inscripcion: string;
  origen_cliente: string | null;
  referido_por: string | null;
  valor_total_curso: string | null;
  estado: string;
}

interface TablaEstudiantesRegistradosProps {
  estudiantes: EstudianteRegistrado[];
}

export const TablaEstudiantesRegistrados = ({ estudiantes }: TablaEstudiantesRegistradosProps) => {
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

  const getBadgeColor = (estado: string) => {
    const colores: { [key: string]: string } = {
      'PROSPECTO': 'badge-secondary',
      'INSCRITO': 'badge-primary',
      'EN_FORMACION': 'badge-info',
      'LISTO_EXAMEN': 'badge-warning',
      'GRADUADO': 'badge-success',
      'DESERTOR': 'badge-danger',
      'RETIRADO': 'badge-danger'
    };
    return colores[estado] || 'badge-secondary';
  };

  return (
    <div className="tabla-estudiantes-card">
      <div className="tabla-header">
        <div className="tabla-titulo">
          <UserPlus size={20} />
          <h3>Estudiantes Registrados</h3>
        </div>
        <span className="tabla-count">{estudiantes.length} estudiante{estudiantes.length !== 1 ? 's' : ''}</span>
      </div>

      {estudiantes.length === 0 ? (
        <div className="tabla-empty" role="status" aria-live="polite">
          <UserPlus size={48} />
          <p>No hay estudiantes registrados en este período</p>
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="tabla-estudiantes">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Categoría</th>
                <th>Fecha Inscripción</th>
                <th>Origen</th>
                <th>Referido Por</th>
                <th>Valor Curso</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {estudiantes.map((est) => (
                <tr key={est.id}>
                  <td className="td-nombre">{est.nombre_completo}</td>
                  <td>{est.documento}</td>
                  <td>
                    {est.categoria ? (
                      <span className="badge badge-category">{est.categoria}</span>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td className="td-fecha">{formatearFecha(est.fecha_inscripcion)}</td>
                  <td>
                    {est.origen_cliente === 'REFERIDO' ? (
                      <span className="badge badge-referido">Referido</span>
                    ) : est.origen_cliente === 'DIRECTO' ? (
                      <span className="badge badge-directo">Directo</span>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td className="td-referido">{est.referido_por || '-'}</td>
                  <td className="td-monto">{formatearMoneda(est.valor_total_curso)}</td>
                  <td>
                    <span className={`badge ${getBadgeColor(est.estado)}`}>
                      {est.estado.replace('_', ' ')}
                    </span>
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
