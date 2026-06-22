import { Trophy, Users, DollarSign, GraduationCap, Phone, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface Referido {
  referido_nombre: string;
  telefono: string | null;
  total_estudiantes_referidos: number;
  total_ingresos_generados: string;
  estudiantes_activos: number;
  estudiantes_graduados: number;
  ultima_referencia_fecha: string | null;
}

interface RankingReferidosProps {
  referidos: Referido[];
}

export const RankingReferidos = ({ referidos }: RankingReferidosProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = 'ranking-referidos-panel';
  
  const formatearMoneda = (valor: string) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(parseFloat(valor));
  };

  const formatearFecha = (fecha: string | null) => {
    if (!fecha) return 'N/A';
    return new Date(fecha).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getPosicionColor = (index: number) => {
    const colores = ['#FFD700', '#C0C0C0', '#CD7F32']; // Oro, Plata, Bronce
    return colores[index] || '#6b7280';
  };

  const getPosicionIcon = (index: number) => {
    const icons = ['🥇', '🥈', '🥉'];
    return icons[index] || `${index + 1}°`;
  };

  const toggleExpanded = () => setIsExpanded((prev) => !prev);

  if (!referidos || referidos.length === 0) {
    return (
      <div className="ranking-referidos-card">
        <div className="ranking-header">
          <div className="ranking-titulo">
            <Trophy size={24} />
            <h3>Top 10 Referidos</h3>
          </div>
        </div>
        <div className="ranking-empty" role="status" aria-live="polite">
          <Trophy size={48} />
          <p>No hay referidos registrados aún</p>
        </div>
      </div>
    );
  }

  // Separar top 3 del resto
  const top3 = referidos.slice(0, 3);
  const resto = referidos.slice(3);

  return (
    <div className="ranking-referidos-card">
      <button
        type="button"
        className="ranking-header-clickable" 
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={toggleExpanded}
      >
        <div className="ranking-header-content">
          <div className="ranking-titulo">
            <Trophy size={24} />
            <h3>Top 10 Referidos</h3>
            <span className="ranking-count-badge">
              {referidos.length} referido{referidos.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="ranking-descripcion">
            Personas que más estudiantes han referido a la escuela
          </p>
        </div>
        <span className="collapse-btn" aria-hidden="true">
          {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
        </span>
      </button>

      {isExpanded && (
        <div id={panelId}>
          {/* Podio Top 3 */}
          {top3.length > 0 && (
        <div className="ranking-podio">
          {top3.map((ref, index) => (
            <div 
              key={index} 
              className={`podio-item podio-posicion-${index + 1}`}
              style={{ '--color-medalla': getPosicionColor(index) } as React.CSSProperties}
            >
              <div className="podio-medalla">
                <span className="medalla-icon">{getPosicionIcon(index)}</span>
              </div>
              <div className="podio-contenido">
                <h4 className="podio-nombre">{ref.referido_nombre}</h4>
                {ref.telefono && (
                  <div className="podio-telefono">
                    <Phone size={14} />
                    <span>{ref.telefono}</span>
                  </div>
                )}
                <div className="podio-stats">
                  <div className="stat-item">
                    <Users size={16} />
                    <span className="stat-valor">{ref.total_estudiantes_referidos}</span>
                    <span className="stat-label">Referidos</span>
                  </div>
                  <div className="stat-item">
                    <DollarSign size={16} />
                    <span className="stat-valor">{formatearMoneda(ref.total_ingresos_generados)}</span>
                    <span className="stat-label">Ingresos</span>
                  </div>
                </div>
                <div className="podio-detalles">
                  <div className="detalle-badge badge-success">
                    <GraduationCap size={14} />
                    {ref.estudiantes_graduados} graduados
                  </div>
                  <div className="detalle-badge badge-primary">
                    <Users size={14} />
                    {ref.estudiantes_activos} activos
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lista del resto (posiciones 4-10) */}
      {resto.length > 0 && (
        <div className="ranking-lista">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Total Referidos</th>
                <th>Ingresos Generados</th>
                <th>Activos</th>
                <th>Graduados</th>
                <th>Última Referencia</th>
              </tr>
            </thead>
            <tbody>
              {resto.map((ref, index) => (
                <tr key={index}>
                  <td className="td-posicion">
                    <span className="badge-posicion">{index + 4}°</span>
                  </td>
                  <td className="td-nombre-ref">{ref.referido_nombre}</td>
                  <td className="td-telefono">{ref.telefono || '-'}</td>
                  <td className="td-count">
                    <span className="badge badge-primary">
                      {ref.total_estudiantes_referidos}
                    </span>
                  </td>
                  <td className="td-monto">{formatearMoneda(ref.total_ingresos_generados)}</td>
                  <td className="td-count">{ref.estudiantes_activos}</td>
                  <td className="td-count">{ref.estudiantes_graduados}</td>
                  <td className="td-fecha-small">{formatearFecha(ref.ultima_referencia_fecha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </div>
      )}
    </div>
  );
};
