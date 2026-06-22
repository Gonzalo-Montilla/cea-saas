import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Wrench, Fuel, Paperclip } from 'lucide-react';
import { uploadsAPI, vehiculosAPI } from '../services/api';
import { ModalBase } from '../components/ui/ModalBase';
import { ToastAlert } from '../components/ui/ToastAlert';
import '../styles/VehiculoDetalle.css';

interface Vehiculo {
  id: number;
  placa: string;
  tipo?: string;
  marca?: string;
  modelo?: string;
  año?: number;
  color?: string;
  cilindraje?: string;
  vin?: string;
  numero_motor?: string;
  numero_chasis?: string;
  foto_url?: string;
  kilometraje_actual?: number;
  responsable_instructor_id?: number | null;
  responsable_nombre?: string | null;
  is_active: boolean;
}

interface Repuesto {
  id: number;
  nombre: string;
  cantidad: number;
  costo_unitario: number;
  proveedor?: string;
}

interface Adjunto {
  id: number;
  archivo_url: string;
  nombre_archivo?: string;
  mime?: string;
}

interface Mantenimiento {
  id: number;
  fecha: string;
  tipo: string;
  descripcion_falla?: string;
  diagnostico?: string;
  reparacion_requerida?: string;
  estado: string;
  km_registro?: number;
  costo_total: number;
  taller?: string;
  observaciones?: string;
  repuestos?: Repuesto[];
  adjuntos?: Adjunto[];
}

interface Combustible {
  id: number;
  fecha: string;
  km_inicial: number;
  km_final?: number;
  nivel_inicial?: string;
  nivel_final?: string;
  litros?: number;
  costo?: number;
  recibo_url?: string;
  conductor?: string;
  observaciones?: string;
  adjuntos?: Adjunto[];
}

interface ConsumoResumen {
  vehiculo_id: number;
  registros: number;
  total_km: number;
  total_galones: number;
  consumo_promedio: number;
  costo_total: number;
  costo_por_km: number;
  faltan_km_final: number;
  umbral_km_por_galon_min?: number | null;
  alerta_bajo_consumo: boolean;
}

const niveles = ['1/4', '1/2', '3/4', 'LLENO'];

export const VehiculoDetalle = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [mantenimientos, setMantenimientos] = useState<Mantenimiento[]>([]);
  const [combustibles, setCombustibles] = useState<Combustible[]>([]);
  const [mantTotal, setMantTotal] = useState(0);
  const [combTotal, setCombTotal] = useState(0);
  const [mantPagina, setMantPagina] = useState(1);
  const [combPagina, setCombPagina] = useState(1);
  const mantPorPagina = 10;
  const combPorPagina = 10;
  const [mostrarMantenimientos, setMostrarMantenimientos] = useState(false);
  const [mostrarCombustibles, setMostrarCombustibles] = useState(false);
  const [mantFechaInicio, setMantFechaInicio] = useState('');
  const [mantFechaFin, setMantFechaFin] = useState('');
  const [mantOrden, setMantOrden] = useState<'asc' | 'desc'>('desc');
  const [combFechaInicio, setCombFechaInicio] = useState('');
  const [combFechaFin, setCombFechaFin] = useState('');
  const [combConductorFiltro, setCombConductorFiltro] = useState('');
  const [combOrden, setCombOrden] = useState<'asc' | 'desc'>('desc');
  const [combResumen, setCombResumen] = useState<ConsumoResumen | null>(null);
  const [umbralKmGalon, setUmbralKmGalon] = useState('');
  const [loading, setLoading] = useState(true);

  const [showMantModal, setShowMantModal] = useState(false);
  const [showCombModal, setShowCombModal] = useState(false);
  const [showRepModal, setShowRepModal] = useState(false);
  const [mantenimientoSeleccionado, setMantenimientoSeleccionado] = useState<Mantenimiento | null>(null);
  const [showAdjuntoModal, setShowAdjuntoModal] = useState(false);
  const [adjuntoUrl, setAdjuntoUrl] = useState('');
  const [adjuntoMime, setAdjuntoMime] = useState('');
  const [adjuntoNombre, setAdjuntoNombre] = useState('');

  // Mantenimiento form
  const [mantTipo, setMantTipo] = useState('FALLA');
  const [mantEstado, setMantEstado] = useState('ABIERTO');
  const [mantDesc, setMantDesc] = useState('');
  const [mantDiag, setMantDiag] = useState('');
  const [mantRep, setMantRep] = useState('');
  const [mantKm, setMantKm] = useState('');
  const [mantCosto, setMantCosto] = useState('');
  const [mantTaller, setMantTaller] = useState('');
  const [mantObs, setMantObs] = useState('');
  const [mantAdjuntos, setMantAdjuntos] = useState<File[]>([]);

  // Repuesto form
  const [repNombre, setRepNombre] = useState('');
  const [repCantidad, setRepCantidad] = useState('1');
  const [repCosto, setRepCosto] = useState('');
  const [repProveedor, setRepProveedor] = useState('');

  // Combustible form
  const [combFecha, setCombFecha] = useState('');
  const [combKmIni, setCombKmIni] = useState('');
  const [combKmFin, setCombKmFin] = useState('');
  const [combNivelIni, setCombNivelIni] = useState('');
  const [combNivelFin, setCombNivelFin] = useState('');
  const [combGalones, setCombGalones] = useState('');
  const [combCosto, setCombCosto] = useState('');
  const [combRecibo, setCombRecibo] = useState('');
  const [combReciboFile, setCombReciboFile] = useState<File | null>(null);
  const [combConductor, setCombConductor] = useState('');
  const [combObs, setCombObs] = useState('');
  const [combAdjuntos, setCombAdjuntos] = useState<File[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    cargarDatos();
  }, [id]);

  const cargarDatos = async () => {
    try {
      setLoading(true);
      const veh = await vehiculosAPI.getById(Number(id));
      setVehiculo(veh);
      if (veh.tipo) {
        try {
          const umbral = await vehiculosAPI.getConsumoUmbral(veh.tipo);
          if (umbral?.km_por_galon_min !== undefined && umbral?.km_por_galon_min !== null) {
            setUmbralKmGalon(String(umbral.km_por_galon_min));
          }
        } catch {
          setUmbralKmGalon('');
        }
      }
    } catch (error) {
      console.error('Error al cargar hoja de vida:', error);
    } finally {
      setLoading(false);
    }
  };

  const toIsoStart = (dateStr: string) => (dateStr ? new Date(`${dateStr}T00:00:00`).toISOString() : '');
  const toIsoEnd = (dateStr: string) => (dateStr ? new Date(`${dateStr}T23:59:59`).toISOString() : '');

  const cargarMantenimientos = async (pagina = 1) => {
    const skip = (pagina - 1) * mantPorPagina;
    const data = await vehiculosAPI.getMantenimientosPaged(Number(id), {
      skip,
      limit: mantPorPagina,
      fecha_inicio: toIsoStart(mantFechaInicio),
      fecha_fin: toIsoEnd(mantFechaFin),
      orden: mantOrden
    });
    setMantenimientos(data.items || []);
    setMantTotal(data.total || 0);
  };

  const cargarCombustibles = async (pagina = 1) => {
    const skip = (pagina - 1) * combPorPagina;
    const data = await vehiculosAPI.getCombustiblesPaged(Number(id), {
      skip,
      limit: combPorPagina,
      fecha_inicio: toIsoStart(combFechaInicio),
      fecha_fin: toIsoEnd(combFechaFin),
      conductor: combConductorFiltro || undefined,
      orden: combOrden
    });
    setCombustibles(data.items || []);
    setCombTotal(data.total || 0);
  };

  const cargarResumenCombustible = async () => {
    const data = await vehiculosAPI.getCombustibleResumen(Number(id), {
      fecha_inicio: toIsoStart(combFechaInicio),
      fecha_fin: toIsoEnd(combFechaFin),
      conductor: combConductorFiltro || undefined
    });
    setCombResumen(data);
  };

  const guardarUmbralConsumo = async () => {
    if (!vehiculo?.tipo) {
      setFeedback({ type: 'info', message: 'El vehículo no tiene tipo definido.' });
      return;
    }
    if (!umbralKmGalon) {
      setFeedback({ type: 'info', message: 'Ingresa un umbral válido.' });
      return;
    }
    await vehiculosAPI.upsertConsumoUmbral(vehiculo.tipo, parseFloat(umbralKmGalon));
    await cargarResumenCombustible();
    setFeedback({ type: 'success', message: 'Umbral de consumo guardado con éxito.' });
  };

  const exportarExcel = async () => {
    const data = await vehiculosAPI.getExportData(Number(id), {
      mant_fecha_inicio: toIsoStart(mantFechaInicio),
      mant_fecha_fin: toIsoEnd(mantFechaFin),
      comb_fecha_inicio: toIsoStart(combFechaInicio),
      comb_fecha_fin: toIsoEnd(combFechaFin),
      comb_conductor: combConductorFiltro || undefined
    });
    const lines: string[] = [];
    lines.push('HOJA DE VIDA VEHICULO');
    lines.push(`Placa,${data.vehiculo.placa}`);
    lines.push(`Tipo,${data.vehiculo.tipo || ''}`);
    lines.push(`Marca,${data.vehiculo.marca || ''}`);
    lines.push(`Modelo,${data.vehiculo.modelo || ''}`);
    lines.push(`Responsable,${data.vehiculo.responsable_nombre || ''}`);
    lines.push(`Numero Motor,${data.vehiculo.numero_motor || ''}`);
    lines.push(`Numero Chasis,${data.vehiculo.numero_chasis || ''}`);
    lines.push('');
    lines.push('RESUMEN COMBUSTIBLE');
    lines.push('Total KM,Total Galones,Consumo Promedio (km/gal),Costo Total,Costo por KM');
    lines.push(`${data.resumen.total_km},${data.resumen.total_galones},${data.resumen.consumo_promedio},${data.resumen.costo_total},${data.resumen.costo_por_km}`);
    lines.push('');
    lines.push('MANTENIMIENTOS');
    lines.push('Fecha,Tipo,Estado,KM,Costo,Taller,Descripcion');
    data.mantenimientos.forEach((m: Mantenimiento) => {
      lines.push(`${new Date(m.fecha).toLocaleString('es-CO')},${m.tipo},${m.estado},${m.km_registro || ''},${m.costo_total},${m.taller || ''},"${(m.descripcion_falla || '').replace(/"/g, '""')}"`);
    });
    lines.push('');
    lines.push('COMBUSTIBLE');
    lines.push('Fecha,Conductor,KM Inicial,KM Final,Galones,Costo');
    data.combustibles.forEach((c: Combustible) => {
      lines.push(`${new Date(c.fecha).toLocaleString('es-CO')},${c.conductor || ''},${c.km_inicial},${c.km_final || ''},${c.litros || ''},${c.costo || ''}`);
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hoja_vida_${vehiculo?.placa || 'vehiculo'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportarPDF = async () => {
    const data = await vehiculosAPI.getExportData(Number(id), {
      mant_fecha_inicio: toIsoStart(mantFechaInicio),
      mant_fecha_fin: toIsoEnd(mantFechaFin),
      comb_fecha_inicio: toIsoStart(combFechaInicio),
      comb_fecha_fin: toIsoEnd(combFechaFin),
      comb_conductor: combConductorFiltro || undefined
    });
    const html = `
      <html>
        <head>
          <title>Hoja de Vida ${data.vehiculo.placa}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 16px; }
            h1, h2 { margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; }
            th { background: #f3f4f6; text-align: left; }
          </style>
        </head>
        <body>
          <h1>Hoja de Vida - ${data.vehiculo.placa}</h1>
          <p><strong>Tipo:</strong> ${data.vehiculo.tipo || ''} | <strong>Marca:</strong> ${data.vehiculo.marca || ''} | <strong>Modelo:</strong> ${data.vehiculo.modelo || ''}</p>
          <p><strong>Responsable:</strong> ${data.vehiculo.responsable_nombre || ''}</p>
          <p><strong>Número de Motor:</strong> ${data.vehiculo.numero_motor || ''} | <strong>Número de Chasis:</strong> ${data.vehiculo.numero_chasis || ''}</p>
          <h2>Resumen combustible</h2>
          <p>Total KM: ${data.resumen.total_km.toFixed(0)} | Galones: ${data.resumen.total_galones.toFixed(2)} | Consumo: ${data.resumen.consumo_promedio.toFixed(2)} km/gal</p>
          <p>Costo total: ${data.resumen.costo_total.toFixed(0)} | Costo/km: ${data.resumen.costo_por_km.toFixed(0)}</p>
          <h2>Mantenimientos</h2>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Estado</th><th>KM</th><th>Costo</th><th>Taller</th><th>Descripción</th></tr>
            </thead>
            <tbody>
              ${data.mantenimientos
                .map((m: Mantenimiento) => `<tr>
                  <td>${new Date(m.fecha).toLocaleString('es-CO')}</td>
                  <td>${m.tipo}</td>
                  <td>${m.estado}</td>
                  <td>${m.km_registro || ''}</td>
                  <td>${m.costo_total}</td>
                  <td>${m.taller || ''}</td>
                  <td>${(m.descripcion_falla || '').replace(/</g, '&lt;')}</td>
                </tr>`)
                .join('')}
            </tbody>
          </table>
          <h2>Combustible</h2>
          <table>
            <thead>
              <tr><th>Fecha</th><th>Conductor</th><th>KM inicial</th><th>KM final</th><th>Galones</th><th>Costo</th></tr>
            </thead>
            <tbody>
              ${data.combustibles
                .map((c: Combustible) => `<tr>
                  <td>${new Date(c.fecha).toLocaleString('es-CO')}</td>
                  <td>${c.conductor || ''}</td>
                  <td>${c.km_inicial}</td>
                  <td>${c.km_final || ''}</td>
                  <td>${c.litros || ''}</td>
                  <td>${c.costo || ''}</td>
                </tr>`)
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const guardarMantenimiento = async () => {
    if (!mantDesc && mantTipo === 'FALLA') {
      setFeedback({ type: 'info', message: 'Describe la falla o el mantenimiento.' });
      return;
    }
    const nuevo = await vehiculosAPI.createMantenimiento(Number(id), {
      tipo: mantTipo,
      estado: mantEstado,
      descripcion_falla: mantDesc || null,
      diagnostico: mantDiag || null,
      reparacion_requerida: mantRep || null,
      km_registro: mantKm ? parseInt(mantKm) : null,
      costo_total: mantCosto ? parseFloat(mantCosto) : 0,
      taller: mantTaller || null,
      observaciones: mantObs || null
    });
    if (mantAdjuntos.length > 0) {
      await vehiculosAPI.addMantenimientoAdjuntos(Number(id), nuevo.id, mantAdjuntos);
    }
    setShowMantModal(false);
    setMantDesc('');
    setMantDiag('');
    setMantRep('');
    setMantKm('');
    setMantCosto('');
    setMantTaller('');
    setMantObs('');
    setMantAdjuntos([]);
    await cargarMantenimientos(mantPagina);
    setFeedback({ type: 'success', message: 'Mantenimiento registrado con éxito.' });
  };

  const guardarRepuesto = async () => {
    if (!mantenimientoSeleccionado) return;
    if (!repNombre.trim()) {
      setFeedback({ type: 'info', message: 'Nombre del repuesto obligatorio.' });
      return;
    }
    await vehiculosAPI.addRepuesto(Number(id), mantenimientoSeleccionado.id, {
      nombre: repNombre.trim(),
      cantidad: repCantidad ? parseInt(repCantidad) : 1,
      costo_unitario: repCosto ? parseFloat(repCosto) : 0,
      proveedor: repProveedor || null
    });
    setShowRepModal(false);
    setRepNombre('');
    setRepCantidad('1');
    setRepCosto('');
    setRepProveedor('');
    await cargarMantenimientos(mantPagina);
    setFeedback({ type: 'success', message: 'Repuesto agregado con éxito.' });
  };

  const guardarCombustible = async () => {
    if (!combKmIni) {
      setFeedback({ type: 'info', message: 'Kilometraje inicial es obligatorio.' });
      return;
    }
    let reciboUrl = combRecibo;
    if (combReciboFile) {
      const upload = await uploadsAPI.uploadReciboCombustible(combReciboFile, Number(id));
      reciboUrl = upload.recibo_url;
    }
    const nuevo = await vehiculosAPI.createCombustible(Number(id), {
      fecha: combFecha ? new Date(combFecha).toISOString() : null,
      km_inicial: parseInt(combKmIni),
      km_final: combKmFin ? parseInt(combKmFin) : null,
      nivel_inicial: combNivelIni || null,
      nivel_final: combNivelFin || null,
      litros: combGalones ? parseFloat(combGalones) : null,
      costo: combCosto ? parseFloat(combCosto) : null,
      recibo_url: reciboUrl || null,
      conductor: combConductor || null,
      observaciones: combObs || null
    });
    if (combAdjuntos.length > 0) {
      await vehiculosAPI.addCombustibleAdjuntos(Number(id), nuevo.id, combAdjuntos);
    }
    setShowCombModal(false);
    setCombFecha('');
    setCombKmIni('');
    setCombKmFin('');
    setCombNivelIni('');
    setCombNivelFin('');
    setCombGalones('');
    setCombCosto('');
    setCombRecibo('');
    setCombReciboFile(null);
    setCombConductor('');
    setCombObs('');
    setCombAdjuntos([]);
    await cargarCombustibles(combPagina);
    await cargarResumenCombustible();
    setFeedback({ type: 'success', message: 'Registro de combustible guardado con éxito.' });
  };

  const calcularIndicadoresCombustible = () => {
    const registrosValidos = combustibles.filter((c) => c.km_final && c.litros && c.litros > 0);
    const totalKm = registrosValidos.reduce((sum, c) => sum + (c.km_final! - c.km_inicial), 0);
    const totalGalones = registrosValidos.reduce((sum, c) => sum + (c.litros || 0), 0);
    const totalCosto = registrosValidos.reduce((sum, c) => sum + (c.costo || 0), 0);
    const consumoPromedio = totalGalones > 0 ? totalKm / totalGalones : 0;
    const costoPorKm = totalKm > 0 ? totalCosto / totalKm : 0;
    const alertas = [];
    if (registrosValidos.length === 0) {
      alertas.push('No hay registros suficientes para calcular consumo.');
    }
    if (consumoPromedio > 0 && consumoPromedio < 15) {
      alertas.push('Consumo bajo: revisar posibles fugas o conducción.');
    }
    const sinKmFinal = combustibles.filter((c) => !c.km_final).length;
    if (sinKmFinal > 0) {
      alertas.push(`Faltan ${sinKmFinal} registros con KM final.`);
    }
    return { totalKm, totalGalones, consumoPromedio, costoPorKm, alertas };
  };

  if (loading) {
    return <div className="loading-container">Cargando hoja de vida...</div>;
  }

  if (!vehiculo) {
    return <div className="error-message">Vehículo no encontrado</div>;
  }

  return (
    <div className="vehiculo-detalle-container">
      {feedback && (
        <ToastAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
      )}
      <div className="detalle-header">
        <button
          className="btn-icon"
          onClick={() => navigate('/vehiculos')}
          title="Volver al listado de vehículos"
          aria-label="Volver al listado de vehículos"
        >
          <ArrowLeft size={18} />
        </button>
        <h1>Hoja de Vida - {vehiculo.placa}</h1>
        <div className="export-actions">
          <button className="btn-secondary" onClick={exportarExcel}>Exportar Excel</button>
          <button className="btn-secondary" onClick={exportarPDF}>Exportar PDF</button>
        </div>
      </div>

      <div className="vehiculo-info-card">
        <div className="vehiculo-info-left">
          {vehiculo.foto_url ? (
            <img src={vehiculo.foto_url} alt={vehiculo.placa} className="vehiculo-foto" />
          ) : (
            <div className="vehiculo-foto placeholder">Sin foto</div>
          )}
        </div>
        <div className="vehiculo-info-right">
          <div><strong>Marca/Modelo:</strong> {vehiculo.marca || '-'} {vehiculo.modelo || ''}</div>
          <div><strong>Tipo:</strong> {vehiculo.tipo || '-'}</div>
          <div><strong>Responsable:</strong> {vehiculo.responsable_nombre || '-'}</div>
          <div><strong>Año:</strong> {vehiculo.año || '-'}</div>
          <div><strong>Color:</strong> {vehiculo.color || '-'}</div>
          <div><strong>Cilindraje:</strong> {vehiculo.cilindraje || '-'}</div>
          <div><strong>VIN:</strong> {vehiculo.vin || '-'}</div>
          <div><strong>Número de Motor:</strong> {vehiculo.numero_motor || '-'}</div>
          <div><strong>Número de Chasis:</strong> {vehiculo.numero_chasis || '-'}</div>
          <div><strong>Kilometraje actual:</strong> {vehiculo.kilometraje_actual || '-'}</div>
          <div><strong>Estado:</strong> {vehiculo.is_active ? 'Activo' : 'Inactivo'}</div>
        </div>
      </div>

      <div className="detalle-section">
        <div className="section-header">
          <h2><Wrench size={18} /> Mantenimientos / Fallas</h2>
          <button
            className="btn-secondary"
            onClick={async () => {
              const next = !mostrarMantenimientos;
              setMostrarMantenimientos(next);
              if (next) {
                setMantPagina(1);
                await cargarMantenimientos(1);
              }
            }}
          >
            {mostrarMantenimientos ? 'Ocultar' : 'Ver'}
          </button>
          <button className="btn-primary" onClick={() => setShowMantModal(true)}>
            <Plus size={16} /> Registrar
          </button>
        </div>
        {mostrarMantenimientos && mantenimientos.length === 0 && (
          <div className="empty-state">No hay registros de mantenimiento</div>
        )}
        {mostrarMantenimientos && (
          <div className="filtros-row">
            <div className="form-group">
              <label>Desde</label>
              <input type="date" value={mantFechaInicio} onChange={(e) => setMantFechaInicio(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Hasta</label>
              <input type="date" value={mantFechaFin} onChange={(e) => setMantFechaFin(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Orden</label>
              <select value={mantOrden} onChange={(e) => setMantOrden(e.target.value as 'asc' | 'desc')}>
                <option value="desc">Más recientes</option>
                <option value="asc">Más antiguos</option>
              </select>
            </div>
            <button
              className="btn-primary"
              onClick={async () => {
                setMantPagina(1);
                await cargarMantenimientos(1);
              }}
            >
              Aplicar
            </button>
          </div>
        )}
        {mostrarMantenimientos && mantenimientos.length > 0 && (
          <div className="lista-items">
            {mantenimientos.map((m) => (
              <div key={m.id} className="item-card">
                <div className="item-header">
                  <div>
                    <strong>{m.tipo}</strong> - {m.estado}
                  </div>
                  <div>{new Date(m.fecha).toLocaleString('es-CO')}</div>
                </div>
                <div className="item-body">
                  {m.descripcion_falla && <div><strong>Falla:</strong> {m.descripcion_falla}</div>}
                  {m.reparacion_requerida && <div><strong>Reparación:</strong> {m.reparacion_requerida}</div>}
                  {m.diagnostico && <div><strong>Diagnóstico:</strong> {m.diagnostico}</div>}
                  {m.km_registro && <div><strong>KM:</strong> {m.km_registro}</div>}
                  {m.taller && <div><strong>Taller:</strong> {m.taller}</div>}
                  <div><strong>Costo:</strong> ${m.costo_total}</div>
                  {m.observaciones && <div><strong>Obs:</strong> {m.observaciones}</div>}
                  <div className="repuestos-list">
                    <strong>Repuestos:</strong>
                    {m.repuestos && m.repuestos.length > 0 ? (
                      <ul>
                        {m.repuestos.map((r) => (
                          <li key={r.id}>{r.nombre} x{r.cantidad} (${r.costo_unitario})</li>
                        ))}
                      </ul>
                    ) : (
                      <span> Sin repuestos</span>
                    )}
                  </div>
                  {m.adjuntos && m.adjuntos.length > 0 && (
                    <div className="adjuntos-list">
                      <strong>Adjuntos:</strong>
                      <div className="adjuntos-grid">
                        {m.adjuntos.map((a) => (
                          <button
                            type="button"
                            key={a.id}
                            className="adjunto-item"
                            onClick={() => {
                              setAdjuntoUrl(a.archivo_url);
                              setAdjuntoMime(a.mime || '');
                              setAdjuntoNombre(a.nombre_archivo || 'Adjunto');
                              setShowAdjuntoModal(true);
                            }}
                          >
                            {a.mime?.startsWith('image') ? (
                              <img src={a.archivo_url} alt={a.nombre_archivo || 'Adjunto'} />
                            ) : (
                              <span>{a.nombre_archivo || 'Documento'}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="item-footer">
                  <button className="btn-secondary" onClick={() => { setMantenimientoSeleccionado(m); setShowRepModal(true); }}>
                    <Plus size={14} /> Repuesto
                  </button>
                </div>
              </div>
            ))}
            <div className="pagination">
              <button
                onClick={async () => {
                  if (mantPagina === 1) return;
                  const next = mantPagina - 1;
                  setMantPagina(next);
                  await cargarMantenimientos(next);
                }}
                disabled={mantPagina === 1}
              >
                Anterior
              </button>
              <span>Página {mantPagina}</span>
              <button
                onClick={async () => {
                  if (mantPagina * mantPorPagina >= mantTotal) return;
                  const next = mantPagina + 1;
                  setMantPagina(next);
                  await cargarMantenimientos(next);
                }}
                disabled={mantPagina * mantPorPagina >= mantTotal}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="detalle-section">
        <div className="section-header">
          <h2><Fuel size={18} /> Combustible</h2>
          <button
            className="btn-secondary"
            onClick={async () => {
              const next = !mostrarCombustibles;
              setMostrarCombustibles(next);
              if (next) {
                setCombPagina(1);
                await cargarCombustibles(1);
                await cargarResumenCombustible();
              }
            }}
          >
            {mostrarCombustibles ? 'Ocultar' : 'Ver'}
          </button>
          <button className="btn-primary" onClick={() => setShowCombModal(true)}>
            <Plus size={16} /> Registrar
          </button>
        </div>
        {mostrarCombustibles && combustibles.length === 0 && (
          <div className="empty-state">No hay registros de combustible</div>
        )}
        {mostrarCombustibles && (
          <div className="filtros-row">
            <div className="form-group">
              <label>Desde</label>
              <input type="date" value={combFechaInicio} onChange={(e) => setCombFechaInicio(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Hasta</label>
              <input type="date" value={combFechaFin} onChange={(e) => setCombFechaFin(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Conductor</label>
              <input value={combConductorFiltro} onChange={(e) => setCombConductorFiltro(e.target.value)} placeholder="Nombre" />
            </div>
            <div className="form-group">
              <label>Orden</label>
              <select value={combOrden} onChange={(e) => setCombOrden(e.target.value as 'asc' | 'desc')}>
                <option value="desc">Más recientes</option>
                <option value="asc">Más antiguos</option>
              </select>
            </div>
            <button
              className="btn-primary"
              onClick={async () => {
                setCombPagina(1);
                await cargarCombustibles(1);
                await cargarResumenCombustible();
              }}
            >
              Aplicar
            </button>
          </div>
        )}
        {mostrarCombustibles && combustibles.length > 0 && (
          <div className="lista-items">
            <div className="stats-row">
              {combResumen && (
                <div className="stat-summary total">
                  <div className="stat-summary-content">
                    <span className="stat-summary-label">Resumen global</span>
                    <span className="stat-summary-detalle">
                      KM: {combResumen.total_km.toFixed(0)} | Galones: {combResumen.total_galones.toFixed(2)}
                    </span>
                    <span className="stat-summary-detalle">
                      Consumo: {combResumen.consumo_promedio.toFixed(2)} km/gal
                    </span>
                    <span className="stat-summary-detalle">
                      Costo/km: {combResumen.costo_por_km.toFixed(0)}
                    </span>
                    <div className="umbral-row">
                      <span className="stat-summary-detalle">
                        Umbral (tipo): {combResumen.umbral_km_por_galon_min ?? '-'} km/gal
                      </span>
                      <div className="umbral-actions">
                        <input
                          type="number"
                          placeholder="Nuevo umbral"
                          value={umbralKmGalon}
                          onChange={(e) => setUmbralKmGalon(e.target.value)}
                        />
                        <button className="btn-secondary" onClick={guardarUmbralConsumo}>Guardar</button>
                      </div>
                    </div>
                    <div className="alertas">
                      {combResumen.alerta_bajo_consumo && (
                        <div className="alerta">Consumo bajo según el umbral configurado.</div>
                      )}
                      {combResumen.faltan_km_final > 0 && (
                        <div className="alerta">Faltan {combResumen.faltan_km_final} registros con KM final.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {(() => {
                const { totalKm, totalGalones, consumoPromedio, costoPorKm, alertas } = calcularIndicadoresCombustible();
                return (
                  <div className="stat-summary total">
                    <div className="stat-summary-content">
                      <span className="stat-summary-label">Resumen (página actual)</span>
                      <span className="stat-summary-detalle">KM: {totalKm.toFixed(0)} | Galones: {totalGalones.toFixed(2)}</span>
                      <span className="stat-summary-detalle">Consumo: {consumoPromedio.toFixed(2)} km/gal</span>
                      <span className="stat-summary-detalle">Costo/km: {costoPorKm.toFixed(0)}</span>
                      {alertas.length > 0 && (
                        <div className="alertas">
                          {alertas.map((a, i) => (
                            <div key={i} className="alerta">{a}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            {combustibles.map((c) => (
              <div key={c.id} className="item-card">
                <div className="item-header">
                  <div><strong>{c.conductor || 'Conductor'}</strong></div>
                  <div>{new Date(c.fecha).toLocaleString('es-CO')}</div>
                </div>
                <div className="item-body">
                  <div><strong>KM inicial:</strong> {c.km_inicial}</div>
                  <div><strong>KM final:</strong> {c.km_final || '-'}</div>
                  <div><strong>Nivel inicial:</strong> {c.nivel_inicial || '-'}</div>
                  <div><strong>Nivel final:</strong> {c.nivel_final || '-'}</div>
                  <div><strong>Galones:</strong> {c.litros || '-'}</div>
                  <div><strong>Costo:</strong> {c.costo ? `$${c.costo}` : '-'}</div>
                  {c.observaciones && <div><strong>Obs:</strong> {c.observaciones}</div>}
                  {c.recibo_url && (
                    <button
                      type="button"
                      className="recibo-link"
                      onClick={() => {
                        setAdjuntoUrl(c.recibo_url || '');
                        setAdjuntoMime('');
                        setAdjuntoNombre('Recibo');
                        setShowAdjuntoModal(true);
                      }}
                    >
                      <Paperclip size={14} /> Ver recibo
                    </button>
                  )}
                  {c.adjuntos && c.adjuntos.length > 0 && (
                    <div className="adjuntos-list">
                      <strong>Adjuntos:</strong>
                      <div className="adjuntos-grid">
                        {c.adjuntos.map((a) => (
                          <button
                            type="button"
                            key={a.id}
                            className="adjunto-item"
                            onClick={() => {
                              setAdjuntoUrl(a.archivo_url);
                              setAdjuntoMime(a.mime || '');
                              setAdjuntoNombre(a.nombre_archivo || 'Adjunto');
                              setShowAdjuntoModal(true);
                            }}
                          >
                            {a.mime?.startsWith('image') ? (
                              <img src={a.archivo_url} alt={a.nombre_archivo || 'Adjunto'} />
                            ) : (
                              <span>{a.nombre_archivo || 'Documento'}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="pagination">
              <button
                onClick={async () => {
                  if (combPagina === 1) return;
                  const next = combPagina - 1;
                  setCombPagina(next);
                  await cargarCombustibles(next);
                }}
                disabled={combPagina === 1}
              >
                Anterior
              </button>
              <span>Página {combPagina}</span>
              <button
                onClick={async () => {
                  if (combPagina * combPorPagina >= combTotal) return;
                  const next = combPagina + 1;
                  setCombPagina(next);
                  await cargarCombustibles(next);
                }}
                disabled={combPagina * combPorPagina >= combTotal}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal adjunto */}
      {showAdjuntoModal && (
        <ModalBase
          isOpen={showAdjuntoModal}
          title={adjuntoNombre || 'Adjunto'}
          onClose={() => setShowAdjuntoModal(false)}
          size="lg"
        >
          <div className="modal-body">
            {(adjuntoMime.startsWith('image') || adjuntoUrl.startsWith('data:image')) ? (
              <img src={adjuntoUrl} alt={adjuntoNombre || 'Adjunto'} className="adjunto-preview" />
            ) : (
              <iframe title="Adjunto" src={adjuntoUrl} className="adjunto-iframe" />
            )}
          </div>
        </ModalBase>
      )}

      {/* Modal mantenimiento */}
      {showMantModal && (
        <ModalBase
          isOpen={showMantModal}
          title="Registrar mantenimiento/falla"
          onClose={() => setShowMantModal(false)}
          size="md"
          footer={
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowMantModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarMantenimiento}>Guardar</button>
            </div>
          }
        >
          <div className="modal-body">
              <div className="form-group">
                <label>Tipo</label>
                <select value={mantTipo} onChange={(e) => setMantTipo(e.target.value)}>
                  <option value="FALLA">Falla</option>
                  <option value="PREVENTIVO">Preventivo</option>
                </select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={mantEstado} onChange={(e) => setMantEstado(e.target.value)}>
                  <option value="ABIERTO">Abierto</option>
                  <option value="EN_PROCESO">En proceso</option>
                  <option value="CERRADO">Cerrado</option>
                </select>
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea value={mantDesc} onChange={(e) => setMantDesc(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Diagnóstico</label>
                <textarea value={mantDiag} onChange={(e) => setMantDiag(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Reparación requerida</label>
                <textarea value={mantRep} onChange={(e) => setMantRep(e.target.value)} />
              </div>
              <div className="form-group">
                <label>KM</label>
                <input type="number" value={mantKm} onChange={(e) => setMantKm(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Costo total</label>
                <input type="number" value={mantCosto} onChange={(e) => setMantCosto(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Taller</label>
                <input value={mantTaller} onChange={(e) => setMantTaller(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Observaciones</label>
                <textarea value={mantObs} onChange={(e) => setMantObs(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Adjuntos (fotos/PDF)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => setMantAdjuntos(Array.from(e.target.files || []))}
                />
              </div>
          </div>
        </ModalBase>
      )}

      {/* Modal repuesto */}
      {showRepModal && mantenimientoSeleccionado && (
        <ModalBase
          isOpen={showRepModal && Boolean(mantenimientoSeleccionado)}
          title="Agregar repuesto"
          onClose={() => setShowRepModal(false)}
          size="md"
          footer={
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowRepModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarRepuesto}>Guardar</button>
            </div>
          }
        >
          <div className="modal-body">
              <div className="form-group">
                <label>Nombre</label>
                <input value={repNombre} onChange={(e) => setRepNombre(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Cantidad</label>
                <input type="number" min="1" value={repCantidad} onChange={(e) => setRepCantidad(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Costo unitario</label>
                <input type="number" value={repCosto} onChange={(e) => setRepCosto(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Proveedor</label>
                <input value={repProveedor} onChange={(e) => setRepProveedor(e.target.value)} />
              </div>
          </div>
        </ModalBase>
      )}

      {/* Modal combustible */}
      {showCombModal && (
        <ModalBase
          isOpen={showCombModal}
          title="Registrar combustible"
          onClose={() => setShowCombModal(false)}
          size="md"
          footer={
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCombModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarCombustible}>Guardar</button>
            </div>
          }
        >
          <div className="modal-body">
              <div className="form-group">
                <label>Fecha</label>
                <input type="date" value={combFecha} onChange={(e) => setCombFecha(e.target.value)} />
              </div>
              <div className="form-group">
                <label>KM inicial *</label>
                <input type="number" value={combKmIni} onChange={(e) => setCombKmIni(e.target.value)} />
              </div>
              <div className="form-group">
                <label>KM final</label>
                <input type="number" value={combKmFin} onChange={(e) => setCombKmFin(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Nivel inicial</label>
                <select value={combNivelIni} onChange={(e) => setCombNivelIni(e.target.value)}>
                  <option value="">Seleccione</option>
                  {niveles.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Nivel final</label>
                <select value={combNivelFin} onChange={(e) => setCombNivelFin(e.target.value)}>
                  <option value="">Seleccione</option>
                  {niveles.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Galones</label>
                <input type="number" value={combGalones} onChange={(e) => setCombGalones(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Costo</label>
                <input type="number" value={combCosto} onChange={(e) => setCombCosto(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Conductor</label>
                <input value={combConductor} onChange={(e) => setCombConductor(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Recibo</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCombReciboFile(file);
                    }
                  }}
                />
              </div>
              <div className="form-group">
                <label>Adjuntos adicionales</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => setCombAdjuntos(Array.from(e.target.files || []))}
                />
              </div>
              <div className="form-group">
                <label>Observaciones</label>
                <textarea value={combObs} onChange={(e) => setCombObs(e.target.value)} />
              </div>
          </div>
        </ModalBase>
      )}
    </div>
  );
};
