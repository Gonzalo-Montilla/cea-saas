import { useState } from 'react';
import {
  BarChart3, DollarSign, Users, TrendingUp, AlertCircle,
  Calendar, CreditCard, PieChart, Download
} from 'lucide-react';
import { reportesAPI } from '../services/api';
import {
  LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { KPICard } from '../components/reportes/KPICard';
import { FiltrosPeriodo } from '../components/reportes/FiltrosPeriodo';
import { RankingReferidos } from '../components/reportes/RankingReferidos';
import { TablaEstudiantesRegistrados } from '../components/reportes/TablaEstudiantesRegistrados';
import { TablaEstudiantesPagos } from '../components/reportes/TablaEstudiantesPagos';
import { TablaConceptosPagos } from '../components/reportes/TablaConceptosPagos';
import { TablaEgresosCaja } from '../components/reportes/TablaEgresosCaja';
import { TablaOtrosIngresos } from '../components/reportes/TablaOtrosIngresos';
import { formatCurrencyCOP, formatPercent } from '../utils/formatters';
import '../styles/Reportes.css';

interface DashboardData {
  kpis: any;
  grafico_ingresos: any;
  grafico_metodos_pago: any;
  grafico_estudiantes: any;
  grafico_egresos: any;
  ranking_referidos: any[];
  lista_estudiantes_registrados: any[];
  lista_estudiantes_pagos: any[];
  lista_egresos_caja: any[];
  lista_otros_movimientos: any[];
}

interface ClasesKpisData {
  total_programadas: number;
  total_completadas: number;
  total_canceladas: number;
  tasa_cumplimiento: number;
  instructores_productividad: {
    instructor_id: number;
    nombre_completo: string;
    clases_programadas: number;
    clases_completadas: number;
    clases_canceladas: number;
    porcentaje_cumplimiento: number;
  }[];
}

interface AsistenciaDiariaData {
  datos: {
    fecha: string;
    total: number;
    programadas: number;
    completadas: number;
    canceladas: number;
  }[];
}

export const Reportes = () => {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [clasesKpis, setClasesKpis] = useState<ClasesKpisData | null>(null);
  const [asistenciaDiaria, setAsistenciaDiaria] = useState<AsistenciaDiariaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El componente FiltrosPeriodo cargará automáticamente con "hoy"

  const cargarDashboard = async (fechaInicio: string, fechaFin: string, comparar: boolean) => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = { comparar_periodo_anterior: comparar };
      if (fechaInicio) {
        const inicio = new Date(fechaInicio);
        inicio.setHours(0, 0, 0, 0);
        params.fecha_inicio = inicio.toISOString();
      }
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59, 999);
        params.fecha_fin = fin.toISOString();
      }

      const [data, clasesData, asistenciaData] = await Promise.all([
        reportesAPI.getDashboard(params),
        reportesAPI.getKpisClases(params),
        reportesAPI.getAsistenciaClasesDiaria(params),
      ]);
      setDashboard(data);
      setClasesKpis(clasesData);
      setAsistenciaDiaria(asistenciaData);
    } catch (err) {
      console.error('Error al cargar dashboard:', err);
      setError('No se pudieron cargar los reportes.');
    } finally {
      setLoading(false);
    }
  };

  const toNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  if (error) {
    return (
      <div className="reportes-container">
        <div className="error-estado">
          <AlertCircle size={48} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Mostrar mensaje de carga inicial
  if (!dashboard && !error) {
    return (
      <div className="reportes-container">
        {/* Header */}
        <div className="reportes-header">
          <div className="header-titulo">
            <BarChart3 size={32} />
            <div>
              <h1>Reportes Gerenciales</h1>
              <p>Dashboard ejecutivo con métricas clave del negocio</p>
            </div>
          </div>
        </div>
        
        {/* Filtros */}
        <FiltrosPeriodo onAplicarFiltros={cargarDashboard} cargando={loading} />
        
        {loading && (
          <div className="loading-estado">
            <div className="spinner"></div>
            <p>Cargando reportes...</p>
          </div>
        )}
      </div>
    );
  }

  const {
    kpis,
    grafico_ingresos,
    grafico_metodos_pago,
    grafico_estudiantes,
    grafico_egresos,
    ranking_referidos,
    lista_estudiantes_registrados,
  lista_estudiantes_pagos,
  lista_otros_movimientos,
  lista_egresos_caja
  } = dashboard!;

  // Preparar datos para gráfico de línea (ingresos)
  const datosIngresosLinea = (grafico_ingresos?.datos || []).map((d: any) => ({
    mes: d.fecha,
    ingresos: parseFloat(d.valor)
  }));

  // Preparar datos para gráfico de barras (métodos de pago)
  const datosMetodosPago = (grafico_metodos_pago?.datos || []).map((d: any) => ({
    nombre: d.nombre,
    valor: parseFloat(d.valor),
    porcentaje: d.porcentaje
  }));

  // Preparar datos para gráfico de dona (estudiantes)
  const datosEstudiantes = (grafico_estudiantes?.datos || []).map((d: any) => ({
    nombre: d.nombre,
    valor: parseFloat(d.valor),
    porcentaje: d.porcentaje,
    color: d.color
  }));

  // Preparar datos para gráfico de barras horizontales (egresos)
  const datosEgresos = (grafico_egresos?.datos || []).map((d: any) => ({
    categoria: d.nombre,
    monto: parseFloat(d.valor)
  }));

  const datosAsistencia = (asistenciaDiaria?.datos || []).map((d) => ({
    fecha: d.fecha,
    programadas: Number(d.programadas || 0),
    completadas: Number(d.completadas || 0),
    canceladas: Number(d.canceladas || 0),
  }));

  const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
  const GRID_COLOR = 'var(--chart-grid)';
  const AXIS_COLOR = 'var(--chart-axis)';

  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const escape = (value: string | number) => {
      const str = String(value ?? '');
      if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportarCSV = () => {
    if (!dashboard) return;
    const rows: (string | number)[][] = [
      ['Reportes Gerenciales'],
      ['Generado', new Date().toLocaleString('es-CO')],
      [],
      ['KPI', 'Valor'],
      ['Ingresos Totales', toNumber(kpis.ingresos_totales?.valor_actual)],
      ['Egresos Totales', toNumber(kpis.egresos_totales?.valor_actual)],
      ['Saldo Pendiente', toNumber(kpis.saldo_pendiente)],
      ['Margen Operativo', toNumber(kpis.margen_operativo)],
      ['Ticket Promedio', toNumber(kpis.ticket_promedio)],
      ['Tasa de Cobranza', toNumber(kpis.tasa_cobranza)],
      ['Estudiantes Activos', toNumber(kpis.total_estudiantes_activos)],
      ['Nuevas Matrículas', toNumber(kpis.nuevas_matriculas_mes)],
      [],
      ['Ingresos por periodo'],
      ['Periodo', 'Ingresos']
    ];
    datosIngresosLinea.forEach((d: { mes: string; ingresos: number }) => rows.push([d.mes, d.ingresos]));
    rows.push([]);
    rows.push(['Métodos de pago', 'Monto', 'Porcentaje']);
    datosMetodosPago.forEach((d: { nombre: string; valor: number; porcentaje: number }) =>
      rows.push([d.nombre, d.valor, d.porcentaje])
    );
    rows.push([]);
    rows.push(['Egresos por categoría', 'Monto']);
    datosEgresos.forEach((d: { categoria: string; monto: number }) => rows.push([d.categoria, d.monto]));
    downloadCSV(`reportes_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="reportes-container">
      {/* Header */}
      <div className="reportes-header">
        <div className="header-titulo">
          <BarChart3 size={32} />
          <div>
            <h1>Reportes Gerenciales</h1>
            <p>Dashboard ejecutivo con métricas clave del negocio</p>
          </div>
        </div>
        <div className="reportes-actions">
          <button className="btn-exportar secondary" onClick={exportarCSV}>
            <Download size={18} />
            Exportar CSV
          </button>
          <button className="btn-exportar" disabled>
            <Download size={18} />
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Filtros */}
      <FiltrosPeriodo onAplicarFiltros={cargarDashboard} cargando={loading} />

      {/* KPIs Grid */}
      <div className="kpis-grid">
        <KPICard
          titulo="Ingresos Totales"
          valor={formatCurrencyCOP(toNumber(kpis.ingresos_totales?.valor_actual))}
          icono={<DollarSign size={24} />}
          cambio={kpis.ingresos_totales.cambio_porcentual}
          tendencia={kpis.ingresos_totales.tendencia}
          colorIcono="#10b981"
        />
        <KPICard
          titulo="Egresos Totales"
          valor={formatCurrencyCOP(toNumber(kpis.egresos_totales?.valor_actual))}
          icono={<TrendingUp size={24} />}
          cambio={kpis.egresos_totales.cambio_porcentual}
          tendencia={kpis.egresos_totales.tendencia}
          colorIcono="#ef4444"
        />
        <KPICard
          titulo="Saldo Pendiente"
          valor={formatCurrencyCOP(toNumber(kpis.saldo_pendiente))}
          icono={<CreditCard size={24} />}
          colorIcono="#f59e0b"
        />
        <KPICard
          titulo="Margen Operativo"
          valor={formatPercent(toNumber(kpis.margen_operativo))}
          icono={<PieChart size={24} />}
          colorIcono="#8b5cf6"
        />
        <KPICard
          titulo="Estudiantes Activos"
          valor={toNumber(kpis.total_estudiantes_activos)}
          icono={<Users size={24} />}
          colorIcono="#2563eb"
        />
        <KPICard
          titulo="Nuevas Matrículas"
          valor={toNumber(kpis.nuevas_matriculas_mes)}
          icono={<Calendar size={24} />}
          colorIcono="#06b6d4"
        />
        <KPICard
          titulo="Ticket Promedio"
          valor={formatCurrencyCOP(toNumber(kpis.ticket_promedio))}
          icono={<DollarSign size={24} />}
          colorIcono="#10b981"
        />
        <KPICard
          titulo="Tasa de Cobranza"
          valor={formatPercent(toNumber(kpis.tasa_cobranza))}
          icono={<TrendingUp size={24} />}
          colorIcono="#22c55e"
        />
      </div>

      {clasesKpis && (
        <>
          <div className="kpis-grid">
            <KPICard
              titulo="Clases Programadas"
              valor={clasesKpis.total_programadas}
              icono={<Calendar size={24} />}
              colorIcono="#2563eb"
            />
            <KPICard
              titulo="Clases Completadas"
              valor={clasesKpis.total_completadas}
              icono={<TrendingUp size={24} />}
              colorIcono="#16a34a"
            />
            <KPICard
              titulo="Clases Canceladas"
              valor={clasesKpis.total_canceladas}
              icono={<AlertCircle size={24} />}
              colorIcono="#dc2626"
            />
            <KPICard
              titulo="Cumplimiento Clases"
              valor={formatPercent(clasesKpis.tasa_cumplimiento || 0)}
              icono={<BarChart3 size={24} />}
              colorIcono="#7c3aed"
            />
          </div>

          <div className="grafico-card">
            <div className="grafico-header">
              <h3>Top Instructores por Cumplimiento</h3>
              <span className="grafico-subtitle">Top 10 por clases completadas</span>
            </div>
            {clasesKpis.instructores_productividad?.length ? (
              <div className="tabla-simple-wrapper">
                <table className="tabla-simple">
                  <thead>
                    <tr>
                      <th>Instructor</th>
                      <th>Programadas</th>
                      <th>Completadas</th>
                      <th>Canceladas</th>
                      <th>Cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clasesKpis.instructores_productividad.map((row) => (
                      <tr key={row.instructor_id}>
                        <td>{row.nombre_completo}</td>
                        <td>{row.clases_programadas}</td>
                        <td>{row.clases_completadas}</td>
                        <td>{row.clases_canceladas}</td>
                        <td>{formatPercent(row.porcentaje_cumplimiento || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="grafico-subtitle">Sin datos de instructores para el período seleccionado.</p>
            )}
          </div>

          <div className="grafico-card grafico-grande">
            <div className="grafico-header">
              <h3>Asistencia diaria de clases</h3>
              <span className="grafico-subtitle">Programadas vs completadas vs canceladas</span>
            </div>
            {datosAsistencia.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={datosAsistencia}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="fecha" stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
                  <YAxis stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="programadas" stackId="a" fill="var(--chart-1)" name="Programadas" />
                  <Bar dataKey="completadas" stackId="a" fill="var(--chart-2)" name="Completadas" />
                  <Bar dataKey="canceladas" stackId="a" fill="var(--chart-4)" name="Canceladas" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="grafico-subtitle">Sin datos de asistencia diaria en el período seleccionado.</p>
            )}
          </div>
        </>
      )}

      {/* Gráficos Grid */}
      <div className="graficos-grid">
        {/* Gráfico de línea: Evolución de ingresos */}
        <div className="grafico-card grafico-grande">
          <div className="grafico-header">
            <h3>Evolución de Ingresos</h3>
            <div className="grafico-stats">
              <span>Total: {formatCurrencyCOP(toNumber(grafico_ingresos.total_periodo))}</span>
              <span>Promedio: {formatCurrencyCOP(toNumber(grafico_ingresos.promedio_mensual))}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={datosIngresosLinea}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="mes" stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
              <YAxis stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}
                formatter={(value: any) => formatCurrencyCOP(value)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="ingresos"
                stroke="var(--chart-1)"
                strokeWidth={3}
                dot={{ fill: 'var(--chart-1)', r: 4 }}
                activeDot={{ r: 6 }}
                name="Ingresos"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gráfico de barras: Métodos de pago */}
        <div className="grafico-card">
          <div className="grafico-header">
            <h3>Ingresos por Método de Pago</h3>
            <span className="grafico-subtitle">Método preferido: {grafico_metodos_pago.metodo_preferido}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={datosMetodosPago}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="nombre" stroke={AXIS_COLOR} style={{ fontSize: '11px' }} angle={-45} textAnchor="end" height={100} />
              <YAxis stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}
                formatter={(value: any) => formatCurrencyCOP(value)}
              />
              <Bar dataKey="valor" name="Monto">
                {datosMetodosPago.map((_entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Gráfico de dona: Estudiantes por categoría */}
        <div className="grafico-card">
          <div className="grafico-header">
            <h3>Estudiantes por Categoría</h3>
            <span className="grafico-subtitle">Total: {grafico_estudiantes.total}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <RePieChart>
              <Pie
                data={datosEstudiantes}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(props: any) => {
                  const nombre = props?.nombre ?? '';
                  const porcentaje = props?.porcentaje;
                  return `${nombre}: ${typeof porcentaje === 'number' ? porcentaje.toFixed(1) : '0.0'}%`;
                }}
                outerRadius={100}
                fill="var(--chart-5)"
                dataKey="valor"
              >
                {datosEstudiantes.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: any) => `${value} estudiantes`} />
            </RePieChart>
          </ResponsiveContainer>
        </div>

        {/* Gráfico de barras: Top egresos */}
        <div className="grafico-card grafico-grande">
          <div className="grafico-header">
            <h3>Top 5 Categorías de Egresos</h3>
            <div className="grafico-stats">
              <span>Total: {formatCurrencyCOP(toNumber(grafico_egresos.total))}</span>
              <span>Mayor: {grafico_egresos.categoria_mayor}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={datosEgresos} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis type="number" stroke={AXIS_COLOR} style={{ fontSize: '12px' }} />
              <YAxis dataKey="categoria" type="category" stroke={AXIS_COLOR} style={{ fontSize: '12px' }} width={150} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}
                formatter={(value: any) => formatCurrencyCOP(value)}
              />
              <Bar dataKey="monto" fill="var(--chart-4)" name="Monto" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ranking de Referidos */}
      <RankingReferidos referidos={ranking_referidos || []} />

      {/* Tablas de Estudiantes */}
      <div className="tablas-estudiantes-grid">
        <TablaEstudiantesRegistrados estudiantes={lista_estudiantes_registrados || []} />
        <TablaEstudiantesPagos pagos={lista_estudiantes_pagos || []} />
        <TablaEgresosCaja egresos={lista_egresos_caja || []} />
        <TablaOtrosIngresos ingresos={lista_otros_movimientos || []} />
        <TablaConceptosPagos pagos={lista_estudiantes_pagos || []} />
      </div>
    </div>
  );
};
