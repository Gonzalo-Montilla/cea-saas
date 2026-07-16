import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Users,
  TrendingUp,
  BookOpen,
  DollarSign,
  Database,
  CheckCircle,
  RefreshCw,
  FileText,
  AlertTriangle,
  CreditCard,
  ArrowRight,
  Home
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { reportesAPI } from '../services/api';
import { BRAND_NAME } from '../config/branding';
import { formatCurrencyCOP } from '../utils/formatters';
import '../styles/Dashboard.css';

export const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<any>(null);
  const [alertas, setAlertas] = useState<any>(null);

  useEffect(() => {
    const cargar = async () => {
      try {
        setLoading(true);
        setError(null);
        const hoy = new Date();
        const inicio = new Date(hoy);
        inicio.setHours(0, 0, 0, 0);
        const fin = new Date(hoy);
        fin.setHours(23, 59, 59, 999);
        const [data, alertasData] = await Promise.all([
          reportesAPI.getDashboard({
            fecha_inicio: inicio.toISOString(),
            fecha_fin: fin.toISOString(),
            comparar_periodo_anterior: false
          }),
          reportesAPI.getAlertasOperativas()
        ]);
        setKpis(data.kpis);
        setAlertas(alertasData);
      } catch (err) {
        console.error('Error al cargar dashboard:', err);
        setError('No se pudo cargar el dashboard');
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, []);

  const formatearMoneda = (valor: number) => {
    return formatCurrencyCOP(valor);
  };

  return (
    <>
      <PageHeader
        title={`Bienvenido, ${user?.nombre_completo || ''}`}
        subtitle={`Panel de control - ${BRAND_NAME}`}
        icon={<Home size={20} />}
      />

      <div className="stats-grid">
        <div className="stat-card stat-card-blue">
          <div className="stat-header">
            <span className="stat-icon"><Users size={32} /></span>
            <span className="stat-badge"><TrendingUp size={12} /> Hoy</span>
          </div>
          <div className="stat-info">
            <p className="stat-value">{kpis ? kpis.total_estudiantes_activos : '--'}</p>
            <h3>Estudiantes Activos</h3>
          </div>
        </div>

        <div className="stat-card stat-card-green">
          <div className="stat-header">
            <span className="stat-icon"><BookOpen size={32} /></span>
            <span className="stat-badge">Mes</span>
          </div>
          <div className="stat-info">
            <p className="stat-value">{kpis ? kpis.nuevas_matriculas_mes : '--'}</p>
            <h3>Nuevas Matrículas</h3>
          </div>
        </div>

        <div className="stat-card stat-card-orange">
          <div className="stat-header">
            <span className="stat-icon"><DollarSign size={32} /></span>
            <span className="stat-badge">Hoy</span>
          </div>
          <div className="stat-info">
            <p className="stat-value">
              {kpis ? formatearMoneda(parseFloat(kpis.ingresos_totales.valor_actual)) : '--'}
            </p>
            <h3>Ingresos del Día</h3>
          </div>
        </div>

        <div className="stat-card stat-card-purple">
          <div className="stat-header">
            <span className="stat-icon"><CreditCard size={32} /></span>
            <span className="stat-badge">Pendiente</span>
          </div>
          <div className="stat-info">
            <p className="stat-value">
              {kpis ? formatearMoneda(parseFloat(kpis.saldo_pendiente)) : '--'}
            </p>
            <h3>Saldo Pendiente</h3>
          </div>
        </div>
      </div>

      <div className="info-panel dashboard-panel">
        <div className="panel-header">
          <h3><AlertTriangle size={18} style={{ display: 'inline', marginRight: '8px' }} /> Alertas Operativas</h3>
        </div>
        <div className="panel-body">
          {loading && <p><RefreshCw size={16} style={{ display: 'inline', marginRight: '8px', color: '#3b82f6' }} /> Cargando alertas...</p>}
          {error && <p><AlertTriangle size={16} style={{ display: 'inline', marginRight: '8px', color: '#f59e0b' }} /> {error}</p>}
          {!loading && !error && alertas && (
            <div className="alertas-grid">
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>Caja abierta</strong>
                  <span>{alertas.caja_abierta ? `Abierta hace ${alertas.caja_abierta_horas || 0}h` : 'No hay caja abierta'}</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/caja')}>
                  Ir a Caja <ArrowRight size={14} />
                </button>
              </div>
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>Pagos vencidos</strong>
                  <span>{alertas.pagos_vencidos_cantidad} | {formatearMoneda(parseFloat(alertas.pagos_vencidos_total))}</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/estudiantes')}>
                  Ver lista <ArrowRight size={14} />
                </button>
              </div>
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>Compromisos por vencer (7 días)</strong>
                  <span>{alertas.compromisos_por_vencer_cantidad} | {formatearMoneda(parseFloat(alertas.compromisos_por_vencer_total))}</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/estudiantes')}>
                  Ver lista <ArrowRight size={14} />
                </button>
              </div>
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>PIN por vencer (90 días)</strong>
                  <span>{alertas.pin_por_vencer_cantidad} estudiantes</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/estudiantes')}>
                  Ver estudiantes <ArrowRight size={14} />
                </button>
              </div>
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>Fallas abiertas de vehículos</strong>
                  <span>{alertas.fallas_abiertas_cantidad} registros</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/vehiculos')}>
                  Ver vehículos <ArrowRight size={14} />
                </button>
              </div>
              <div className="alerta-card">
                <div className="alerta-info">
                  <strong>Listos para examen</strong>
                  <span>{alertas.estudiantes_listos_examen_cantidad} estudiantes</span>
                </div>
                <button className="btn-secondary" onClick={() => navigate('/estudiantes')}>
                  Programar <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="quick-actions">
        <button className="quick-action" onClick={() => navigate('/caja')}>
          Ir a Caja <ArrowRight size={16} />
        </button>
        <button className="quick-action" onClick={() => navigate('/nuevo-estudiante')}>
          Nuevo Estudiante <ArrowRight size={16} />
        </button>
        <button className="quick-action" onClick={() => navigate('/reportes')}>
          Ver Reportes <ArrowRight size={16} />
        </button>
        <button className="quick-action" onClick={() => navigate('/vehiculos')}>
          Ver Vehículos <ArrowRight size={16} />
        </button>
      </div>

      <div className="info-panel">
        <div className="panel-header">
          <h3><FileText size={18} style={{ display: 'inline', marginRight: '8px' }} /> Estado del Sistema</h3>
        </div>
        <div className="panel-body">
          <p><CheckCircle size={16} style={{ display: 'inline', marginRight: '8px', color: '#10b981' }} /> Sistema operativo</p>
          <p><Database size={16} style={{ display: 'inline', marginRight: '8px', color: '#8b5cf6' }} /> Base de datos: Conectada</p>
        </div>
      </div>
    </>
  );
};
