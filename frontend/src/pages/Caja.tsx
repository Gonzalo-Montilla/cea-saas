import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, DollarSign, TrendingUp, TrendingDown, AlertCircle, Plus, X, ChevronDown, Download } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ModalBase } from '../components/ui/ModalBase';
import { ToastAlert } from '../components/ui/ToastAlert';
import { cajaAPI, conceptosIngresoAPI, type ConceptoIngresoTenant } from '../services/api';
import '../styles/Caja.css';

interface CajaActual {
  id: number;
  estado: string;
  fecha_apertura: string;
  usuario_apertura: string;
  saldo_inicial: number;
  total_ingresos: number;
  total_egresos: number;
  saldo_efectivo_caja: number;
  total_ingresos_efectivo: number;
  total_ingresos_transferencia: number;
  total_ingresos_tarjeta: number;
  total_egresos_efectivo: number;
  total_egresos_transferencia: number;
  total_egresos_tarjeta: number;
  // Transferencias separadas
  total_nequi: number;
  total_daviplata: number;
  total_transferencia_bancaria: number;
  // Tarjetas separadas
  total_tarjeta_debito: number;
  total_tarjeta_credito: number;
  // Créditos
  total_credismart: number;
  total_sistecredito: number;
  num_pagos: number;
  num_egresos: number;
}

interface EstudianteFinanciero {
  id: number;
  nombre_completo: string;
  cedula: string;
  tipo_documento?: string;
  matricula_numero: string;
  foto_url?: string;
  tipo_servicio?: string;
  categoria?: string;
  estado: string;
  valor_total_curso?: number;
  saldo_pendiente?: number;
  total_pagado: number;
  fecha_primer_pago?: string;
  fecha_limite_pago?: string;
  dias_restantes?: number;
  estado_financiero: string;
  num_pagos: number;
  ultimo_pago_fecha?: string;
  ultimo_pago_monto?: number;
}

type PendingPdf =
  | { kind: 'pago'; id: number }
  | { kind: 'egreso'; id: number }
  | { kind: 'movimiento'; id: number }
  | { kind: 'cierre'; id: number };

const categoriasIngreso = [
  { value: 'ESTUDIANTE_NO_REGISTRADO', label: 'Estudiante no registrado' },
  { value: 'PAGO_PRESTAMO_EMPLEADO', label: 'Pago préstamo empleado' },
  { value: 'VENTA_MATERIAL', label: 'Venta material / trámites' },
  { value: 'INGRESO_ADMINISTRATIVO', label: 'Ingreso administrativo' },
  { value: 'OTROS', label: 'Otros' }
];

const MONTOS_RAPIDOS_PAGO = [20000, 50000, 100000];

export const Caja = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pagoSectionRef = useRef<HTMLDivElement | null>(null);
  const [cajaActual, setCajaActual] = useState<CajaActual | null>(null);
  const [hayCajaAbierta, setHayCajaAbierta] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // Estados para secciones colapsables
  const [mostrarCajaFisica, setMostrarCajaFisica] = useState(true);
  const [mostrarMetodosDigitales, setMostrarMetodosDigitales] = useState(false);
  const [mostrarCreditos, setMostrarCreditos] = useState(false);
  const [mostrarResumen, setMostrarResumen] = useState(false);
  
  // Estados para abrir caja
  const [showAbrirCaja, setShowAbrirCaja] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState('');
  const [abriendoCaja, setAbriendoCaja] = useState(false);
  
  // Estados para buscar estudiante
  const [cedula, setCedula] = useState('');
  const [estudiante, setEstudiante] = useState<EstudianteFinanciero | null>(null);
  const [buscando, setBuscando] = useState(false);
  const montoPagoRef = useRef<HTMLInputElement | null>(null);
  
  // Estados para registrar pago
  const [montoPago, setMontoPago] = useState('');
  const [esPagoMixto, setEsPagoMixto] = useState(false);
  const [detallesPago, setDetallesPago] = useState<Array<{metodo: string, monto: string}>>([{metodo: 'EFECTIVO', monto: ''}]);
  const [registrandoPago, setRegistrandoPago] = useState(false);
  
  // Estados para egreso
  const [showEgreso, setShowEgreso] = useState(false);
  const [conceptoEgreso, setConceptoEgreso] = useState('');
  const [categoriaEgreso, setCategoriaEgreso] = useState('OTROS');
  const [montoEgreso, setMontoEgreso] = useState('');
  const [metodoEgreso, setMetodoEgreso] = useState('EFECTIVO');
  const [registrandoEgreso, setRegistrandoEgreso] = useState(false);

  // Estados para movimientos generales (ingreso/egreso)
  const [showMovimientoGeneral, setShowMovimientoGeneral] = useState(false);
  const [tipoMovimientoGeneral] = useState<'INGRESO'>('INGRESO');
  const [conceptosIngreso, setConceptosIngreso] = useState<ConceptoIngresoTenant[]>([]);
  const [cargandoConceptosIngreso, setCargandoConceptosIngreso] = useState(false);
  const [conceptoIngresoSeleccionadoId, setConceptoIngresoSeleccionadoId] = useState('');
  const [conceptoMovimiento, setConceptoMovimiento] = useState('');
  const [categoriaMovimiento, setCategoriaMovimiento] = useState('OTROS');
  const [terceroNombre, setTerceroNombre] = useState('');
  const [terceroDocumento, setTerceroDocumento] = useState('');
  const [mostrarDatosTercero, setMostrarDatosTercero] = useState(false);
  const [esPagoMixtoMovimiento, setEsPagoMixtoMovimiento] = useState(false);
  const [metodoMovimiento, setMetodoMovimiento] = useState('EFECTIVO');
  const [montoMovimiento, setMontoMovimiento] = useState('');
  const [registrandoMovimiento, setRegistrandoMovimiento] = useState(false);
  const [detallesMovimiento, setDetallesMovimiento] = useState<Array<{metodo: string, monto: string}>>([
    {metodo: 'EFECTIVO', monto: ''}
  ]);
  
  // Estados para cierre de caja
  const [showCerrarCaja, setShowCerrarCaja] = useState(false);
  const [efectivoFisico, setEfectivoFisico] = useState('');
  const [observacionesCierre, setObservacionesCierre] = useState('');
  const [cerrandoCaja, setCerrandoCaja] = useState(false);
  const [mostrarDetalleArqueo, setMostrarDetalleArqueo] = useState(false);

  // Confirmación previa de registro
  const [showConfirmacion, setShowConfirmacion] = useState(false);
  const [confirmacionItems, setConfirmacionItems] = useState<Array<{ label: string; valor: number }>>([]);
  const [confirmacionAction, setConfirmacionAction] = useState<null | (() => Promise<void>)>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [notificacion, setNotificacion] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [pendingPdf, setPendingPdf] = useState<PendingPdf | null>(null);
  const [showConfirmarCierreCaja, setShowConfirmarCierreCaja] = useState(false);

  const soloDigitos = (value: string) => value.replace(/\D/g, '');
  const formatDocumentoBusqueda = (value: string) => {
    return value.toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 20);
  };
  const getMetodoResumenLabel = (metodo: string) => {
    const labels: Record<string, string> = {
      EFECTIVO: 'EFECTIVO',
      NEQUI: 'NEQUI',
      DAVIPLATA: 'DAVIPLATA',
      TRANSFERENCIA_BANCARIA: 'TRANSFERENCIA',
      TARJETA_DEBITO: 'TARJETA DÉBITO',
      TARJETA_CREDITO: 'TARJETA CRÉDITO',
      CREDISMART: 'CREDISMART',
      SISTECREDITO: 'SISTECREDITO'
    };
    return labels[metodo] || metodo;
  };
  const getTipoDocumentoLabel = (tipo?: string) => {
    switch (tipo) {
      case 'TARJETA_IDENTIDAD':
        return 'TI';
      case 'PASAPORTE':
        return 'PAS';
      case 'CEDULA_EXTRANJERIA':
        return 'CE';
      default:
        return 'CC';
    }
  };

  const getTipoServicioLabel = (tipo?: string) => {
    const labels: Record<string, string> = {
      LICENCIA_A2: 'Licencia A2 (Moto)',
      LICENCIA_B1: 'Licencia B1 (Automóvil)',
      LICENCIA_C1: 'Licencia C1 (Camioneta)',
      RECATEGORIZACION_C1: 'Recategorización C1',
      COMBO_A2_B1: 'Combo A2 + B1',
      COMBO_A2_C1: 'Combo A2 + C1',
      CERTIFICADO_MOTO: 'Certificado Moto',
      CERTIFICADO_B1: 'Certificado B1',
      CERTIFICADO_C1: 'Certificado C1',
      CERTIFICADO_B1_SIN_PRACTICA: 'Certificado B1 sin práctica',
      CERTIFICADO_C1_SIN_PRACTICA: 'Certificado C1 sin práctica',
      CERTIFICADO_A2_B1_SIN_PRACTICA: 'Certificado A2 + B1 sin práctica',
      CERTIFICADO_A2_C1_SIN_PRACTICA: 'Certificado A2 + C1 sin práctica',
      CERTIFICADO_A2_B1_CON_PRACTICA: 'Certificado A2 + B1 con práctica',
      CERTIFICADO_A2_C1_CON_PRACTICA: 'Certificado A2 + C1 con práctica'
    };
    if (!tipo) return 'N/A';
    return labels[tipo] || tipo;
  };

  const mostrarNotificacion = (type: 'success' | 'error' | 'info', message: string) => {
    setNotificacion({ type, message });
  };

  const limpiarNotificacion = () => {
    setNotificacion(null);
  };

  const getErrorMessage = (error: any, fallback: string) => error?.response?.data?.detail || fallback;
  useEffect(() => {
    if (!notificacion) return;
    const timer = window.setTimeout(() => {
      setNotificacion(null);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [notificacion]);

  const abrirPdfPendiente = async () => {
    if (!pendingPdf) return;
    try {
      let blob: Blob;
      if (pendingPdf.kind === 'pago') {
        blob = await cajaAPI.getPagoReciboPdf(pendingPdf.id);
      } else if (pendingPdf.kind === 'egreso') {
        blob = await cajaAPI.getEgresoReciboPdf(pendingPdf.id);
      } else if (pendingPdf.kind === 'movimiento') {
        blob = await cajaAPI.getMovimientoReciboPdf(pendingPdf.id);
      } else {
        blob = await cajaAPI.getCierrePdf(pendingPdf.id);
      }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setPendingPdf(null);
      mostrarNotificacion('info', 'Se abrió el PDF en una nueva pestaña.');
    } catch (error: any) {
      mostrarNotificacion('error', getErrorMessage(error, 'No se pudo abrir el PDF.'));
    }
  };

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

  const exportCajaCSV = () => {
    if (!cajaActual) return;
    const rows = [
      ['Caja y Pagos'],
      ['ID Caja', cajaActual.id],
      ['Fecha Apertura', new Date(cajaActual.fecha_apertura).toLocaleString('es-CO')],
      ['Usuario Apertura', cajaActual.usuario_apertura],
      [],
      ['Totales'],
      ['Saldo Inicial', cajaActual.saldo_inicial],
      ['Ingresos Totales', cajaActual.total_ingresos],
      ['Egresos Totales', cajaActual.total_egresos],
      ['Saldo Efectivo en Caja', cajaActual.saldo_efectivo_caja],
      [],
      ['Ingresos por método'],
      ['Efectivo', cajaActual.total_ingresos_efectivo],
      ['Nequi', cajaActual.total_nequi],
      ['Daviplata', cajaActual.total_daviplata],
      ['Transferencia', cajaActual.total_transferencia_bancaria],
      ['Tarjeta Débito', cajaActual.total_tarjeta_debito],
      ['Tarjeta Crédito', cajaActual.total_tarjeta_credito],
      ['Credismart', cajaActual.total_credismart],
      ['Sistecrédito', cajaActual.total_sistecredito],
      [],
      ['Egresos por método'],
      ['Efectivo', cajaActual.total_egresos_efectivo],
      ['Transferencia', cajaActual.total_egresos_transferencia],
      ['Tarjeta', cajaActual.total_egresos_tarjeta]
    ];
    downloadCSV(`caja_${cajaActual.id}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };
  
  useEffect(() => {
    cargarCajaActual();
    cargarConceptosIngreso();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cedulaParam = params.get('cedula');
    if (cedulaParam) {
      const cedulaLimpia = formatDocumentoBusqueda(cedulaParam);
      if (cedulaLimpia) {
        setCedula(cedulaLimpia);
        void buscarEstudiantePorDocumento(cedulaLimpia);
      }
    }
  }, [location.search]);

  useEffect(() => {
    if (!estudiante) return;
    setTimeout(() => {
      montoPagoRef.current?.focus();
    }, 0);
  }, [estudiante]);
  
  const cargarCajaActual = async () => {
    try {
      setIsLoading(true);
      const response = await cajaAPI.getCajaActual();
      if (response) {
        setCajaActual(response);
        setHayCajaAbierta(true);
      } else {
        setHayCajaAbierta(false);
      }
    } catch (error) {
      console.error('Error al cargar caja:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const cargarConceptosIngreso = async () => {
    try {
      setCargandoConceptosIngreso(true);
      const response = await conceptosIngresoAPI.getAll();
      setConceptosIngreso(response || []);
    } catch (error) {
      console.error('Error al cargar conceptos configurables:', error);
      setConceptosIngreso([]);
    } finally {
      setCargandoConceptosIngreso(false);
    }
  };
  
  const handleAbrirCaja = async () => {
    try {
      setAbriendoCaja(true);
      if (!saldoInicial || parseFloat(saldoInicial) < 0) {
        mostrarNotificacion('error', 'El saldo inicial debe ser mayor o igual a cero.');
        return;
      }
      await cajaAPI.abrirCaja({
        saldo_inicial: parseFloat(saldoInicial),
        observaciones_apertura: null
      });
      setShowAbrirCaja(false);
      setSaldoInicial('');
      await cargarCajaActual();
      mostrarNotificacion('success', 'Caja abierta con éxito.');
    } catch (error: any) {
      mostrarNotificacion('error', getErrorMessage(error, 'No se pudo abrir la caja.'));
    } finally {
      setAbriendoCaja(false);
    }
  };
  
  const buscarEstudiantePorDocumento = async (documento: string) => {
    const cedulaLimpia = formatDocumentoBusqueda(documento);
    if (!cedulaLimpia) {
      mostrarNotificacion('error', 'Ingrese el documento del estudiante.');
      return;
    }
    
    try {
      setBuscando(true);
      const response = await cajaAPI.buscarEstudiante(cedulaLimpia);
      setEstudiante(response);
    } catch (error: any) {
      mostrarNotificacion('error', getErrorMessage(error, 'Estudiante no encontrado.'));
      setEstudiante(null);
    } finally {
      setBuscando(false);
    }
  };

  const handleBuscarEstudiante = async () => {
    await buscarEstudiantePorDocumento(cedula);
  };

  const irARegistrarPago = () => {
    pagoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const aplicarMontoPago = (monto: number) => {
    if (!Number.isFinite(monto) || monto <= 0) return;
    const montoNormalizado = String(monto);
    setMontoPago(montoNormalizado);
    if (!esPagoMixto) {
      setDetallesPago([{ metodo: detallesPago[0]?.metodo || 'EFECTIVO', monto: montoNormalizado }]);
    }
  };

  const limpiarFormularioPago = () => {
    setMontoPago('');
    setEsPagoMixto(false);
    setDetallesPago([{ metodo: detallesPago[0]?.metodo || 'EFECTIVO', monto: '' }]);
  };

  const limpiarFormularioMovimientoGeneral = () => {
    setConceptoIngresoSeleccionadoId('');
    setConceptoMovimiento('');
    setCategoriaMovimiento('OTROS');
    setTerceroNombre('');
    setTerceroDocumento('');
    setMostrarDatosTercero(false);
    setEsPagoMixtoMovimiento(false);
    setMetodoMovimiento('EFECTIVO');
    setMontoMovimiento('');
    setDetallesMovimiento([{ metodo: 'EFECTIVO', monto: '' }]);
  };
  
  const handleRegistrarPago = async () => {
    if (!estudiante) {
      mostrarNotificacion('error', 'Debe buscar un estudiante primero.');
      return;
    }
    
    // Calcular monto total
    let montoTotal: number;
    if (esPagoMixto) {
      // Validar que haya al menos 2 métodos
      const detallesConMonto = detallesPago.filter(d => parseFloat(d.monto) > 0);
      if (detallesConMonto.length < 2) {
        mostrarNotificacion('error', 'En pago mixto debes registrar al menos 2 métodos con monto.');
        return;
      }
      montoTotal = detallesPago.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0);
    } else {
      if (!montoPago || isNaN(parseFloat(montoPago))) {
        mostrarNotificacion('error', 'Ingrese el monto a pagar.');
        return;
      }
      montoTotal = parseFloat(montoPago);
    }
    
    if (montoTotal <= 0) {
      mostrarNotificacion('error', 'El monto debe ser mayor a cero.');
      return;
    }
    
    if (estudiante.saldo_pendiente && montoTotal > estudiante.saldo_pendiente) {
      mostrarNotificacion(
        'error',
        `El monto (${formatCurrency(montoTotal)}) excede el saldo pendiente (${formatCurrency(estudiante.saldo_pendiente)}).`
      );
      return;
    }
    
    const resumenItems = esPagoMixto
      ? detallesPago
          .filter(d => parseFloat(d.monto) > 0)
          .map(d => ({ label: getMetodoResumenLabel(d.metodo), valor: parseFloat(d.monto) }))
      : [{ label: getMetodoResumenLabel(detallesPago[0].metodo), valor: montoTotal }];

    setConfirmacionItems(resumenItems);
    setConfirmacionAction(() => async () => {
      try {
        setRegistrandoPago(true);
        
        let pagoResponse: any = null;
        if (esPagoMixto) {
          pagoResponse = await cajaAPI.registrarPago({
            estudiante_id: estudiante.id,
            monto: montoTotal,
            concepto: 'Abono al curso',
            es_pago_mixto: true,
            detalles_pago: detallesPago
              .filter(d => parseFloat(d.monto) > 0)
              .map(d => ({
                metodo_pago: d.metodo,
                monto: parseFloat(d.monto)
              }))
          });
        } else {
          pagoResponse = await cajaAPI.registrarPago({
            estudiante_id: estudiante.id,
            monto: montoTotal,
            metodo_pago: detallesPago[0].metodo,
            concepto: 'Abono al curso',
            es_pago_mixto: false
          });
        }
        
        mostrarNotificacion('success', 'Pago registrado con éxito.');
        if (pagoResponse?.id) {
          setPendingPdf({ kind: 'pago', id: pagoResponse.id });
        }
        setMontoPago('');
        setEsPagoMixto(false);
        setDetallesPago([{metodo: 'EFECTIVO', monto: ''}]);
        setCedula('');
        setEstudiante(null);
        await cargarCajaActual();
      } catch (error: any) {
        mostrarNotificacion('error', getErrorMessage(error, 'No se pudo registrar el pago.'));
      } finally {
        setRegistrandoPago(false);
      }
    });
    setConfirmando(false);
    setShowConfirmacion(true);
  };
  
  const handleRegistrarEgreso = async () => {
    if (!conceptoEgreso.trim() || !montoEgreso) {
      mostrarNotificacion('error', 'Completa los campos obligatorios.');
      return;
    }
    if (parseFloat(montoEgreso) <= 0) {
      mostrarNotificacion('error', 'El monto debe ser mayor a cero.');
      return;
    }
    
    const resumenItems = [{ label: getMetodoResumenLabel(metodoEgreso), valor: parseFloat(montoEgreso) }];
    setConfirmacionItems(resumenItems);
    setConfirmacionAction(() => async () => {
      try {
        setRegistrandoEgreso(true);
        const egresoResponse = await cajaAPI.registrarEgreso({
          concepto: conceptoEgreso,
          categoria: categoriaEgreso,
          monto: parseFloat(montoEgreso),
          metodo_pago: metodoEgreso,
          numero_factura: null,
          observaciones: null
        });
        
        mostrarNotificacion('success', 'Egreso registrado con éxito.');
        if (egresoResponse?.id) {
          setPendingPdf({ kind: 'egreso', id: egresoResponse.id });
        }
        setShowEgreso(false);
        setConceptoEgreso('');
        setMontoEgreso('');
        await cargarCajaActual();
      } catch (error: any) {
        mostrarNotificacion('error', getErrorMessage(error, 'No se pudo registrar el egreso.'));
      } finally {
        setRegistrandoEgreso(false);
      }
    });
    setConfirmando(false);
    setShowConfirmacion(true);
  };

  const handleRegistrarMovimientoGeneral = async () => {
    if (!conceptoMovimiento.trim() || (!esPagoMixtoMovimiento && !montoMovimiento)) {
      mostrarNotificacion('error', 'Completa los campos obligatorios.');
      return;
    }
    const montoTotal = esPagoMixtoMovimiento
      ? detallesMovimiento.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0)
      : parseFloat(montoMovimiento);
    if (montoTotal <= 0) {
      mostrarNotificacion('error', 'El monto debe ser mayor a cero.');
      return;
    }
    if (esPagoMixtoMovimiento) {
      const detallesConMonto = detallesMovimiento.filter(d => parseFloat(d.monto) > 0);
      if (detallesConMonto.length < 2) {
        mostrarNotificacion('error', 'En pago mixto debes registrar al menos 2 métodos con monto.');
        return;
      }
    }
    const resumenItems = esPagoMixtoMovimiento
      ? detallesMovimiento
          .filter(d => parseFloat(d.monto) > 0)
          .map(d => ({ label: getMetodoResumenLabel(d.metodo), valor: parseFloat(d.monto) }))
      : [{ label: getMetodoResumenLabel(metodoMovimiento), valor: montoTotal }];

    setConfirmacionItems(resumenItems);
    setConfirmacionAction(() => async () => {
      try {
        setRegistrandoMovimiento(true);
        const payload: any = {
          tipo: tipoMovimientoGeneral,
          concepto: conceptoMovimiento,
          categoria: categoriaMovimiento,
          monto: montoTotal,
          observaciones: null,
          tercero_nombre: terceroNombre.trim() || null,
          tercero_documento: terceroDocumento.trim() || null,
          es_pago_mixto: esPagoMixtoMovimiento
        };
        if (esPagoMixtoMovimiento) {
          payload.detalles_pago = detallesMovimiento
            .filter(d => parseFloat(d.monto) > 0)
            .map(d => ({ metodo_pago: d.metodo, monto: parseFloat(d.monto) }));
        } else {
          payload.metodo_pago = metodoMovimiento;
        }
        const movimientoResponse = await cajaAPI.registrarMovimientoGeneral(payload);
        mostrarNotificacion('success', 'Movimiento registrado con éxito.');
        if (movimientoResponse?.id) {
          setPendingPdf({ kind: 'movimiento', id: movimientoResponse.id });
        }
        setShowMovimientoGeneral(false);
        limpiarFormularioMovimientoGeneral();
        await cargarCajaActual();
      } catch (error: any) {
        mostrarNotificacion('error', getErrorMessage(error, 'No se pudo registrar el movimiento.'));
      } finally {
        setRegistrandoMovimiento(false);
      }
    });
    setConfirmando(false);
    setShowConfirmacion(true);
  };
  
  const handleCerrarCaja = async () => {
    if (!efectivoFisico) {
      mostrarNotificacion('error', 'Ingrese el efectivo físico contado.');
      return;
    }
    if (!cajaActual) return;
    setShowConfirmarCierreCaja(true);
  };

  const ejecutarCerrarCaja = async () => {
    if (!cajaActual) return;
    try {
      setCerrandoCaja(true);
      await cajaAPI.cerrarCaja(cajaActual.id, {
        efectivo_fisico: parseFloat(efectivoFisico),
        observaciones_cierre: observacionesCierre || null
      });

      mostrarNotificacion('success', 'Caja cerrada con éxito.');
      setPendingPdf({ kind: 'cierre', id: cajaActual.id });
      setShowConfirmarCierreCaja(false);
      setShowCerrarCaja(false);
      setEfectivoFisico('');
      setObservacionesCierre('');
      await cargarCajaActual();
    } catch (error: any) {
      mostrarNotificacion('error', getErrorMessage(error, 'No se pudo cerrar la caja.'));
    } finally {
      setCerrandoCaja(false);
    }
  };
  
  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(value);
  };
  
  const getEstadoFinancieroColor = (estado: string) => {
    switch (estado) {
      case 'PAGADO_COMPLETO': return 'verde';
      case 'AL_DIA': return 'azul';
      case 'PROXIMO_VENCER': return 'amarillo';
      case 'VENCIDO': return 'rojo';
      default: return 'gris';
    }
  };

  const totalPagoActual = esPagoMixto
    ? detallesPago.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0)
    : parseFloat(montoPago || '0') || 0;
  const metodosActivosPago = esPagoMixto
    ? detallesPago.filter((d) => parseFloat(d.monto) > 0).length
    : totalPagoActual > 0 ? 1 : 0;
  const saldoPendienteActual = Number(estudiante?.saldo_pendiente || 0);
  const saldoDespuesPago = Math.max(saldoPendienteActual - totalPagoActual, 0);
  const excedeSaldoEstudiante = Boolean(estudiante?.saldo_pendiente && totalPagoActual > Number(estudiante.saldo_pendiente));
  const puedeRegistrarPago =
    Boolean(estudiante) &&
    totalPagoActual > 0 &&
    (!esPagoMixto || metodosActivosPago >= 2) &&
    !excedeSaldoEstudiante;
  const montoEgresoNumero = parseFloat(montoEgreso || '0') || 0;
  const puedeRegistrarEgreso = conceptoEgreso.trim().length > 0 && montoEgresoNumero > 0 && !registrandoEgreso;
  const totalDigitalDia = Number(cajaActual?.total_ingresos_transferencia || 0) + Number(cajaActual?.total_ingresos_tarjeta || 0);
  const totalCreditosDia = Number(cajaActual?.total_credismart || 0) + Number(cajaActual?.total_sistecredito || 0);
  const totalRecaudadoDia = Number(cajaActual?.total_ingresos_efectivo || 0) + totalDigitalDia + totalCreditosDia;
  const totalMovimientoActual = esPagoMixtoMovimiento
    ? detallesMovimiento.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0)
    : parseFloat(montoMovimiento || '0') || 0;
  const metodosActivosMovimiento = esPagoMixtoMovimiento
    ? detallesMovimiento.filter((d) => parseFloat(d.monto) > 0).length
    : totalMovimientoActual > 0 ? 1 : 0;
  const puedeRegistrarMovimiento =
    conceptoMovimiento.trim().length > 0 &&
    totalMovimientoActual > 0 &&
    (!esPagoMixtoMovimiento || metodosActivosMovimiento >= 2) &&
    !registrandoMovimiento;
  
  if (isLoading) {
    return <div className="loading">Cargando...</div>;
  }
  
  if (!hayCajaAbierta) {
    return (
      <div className="caja-container">
        <div className="caja-cerrada-card">
          <AlertCircle size={64} className="icon-warning" />
          <h2>Caja cerrada</h2>
          <p>Debe abrir una caja para comenzar a registrar movimientos</p>
          <button onClick={() => setShowAbrirCaja(true)} className="btn-primary-large">
            Abrir Caja
          </button>
        </div>
        
        <ModalBase
          isOpen={showAbrirCaja}
          title="Abrir Caja"
          onClose={() => setShowAbrirCaja(false)}
          closeDisabled={abriendoCaja}
          size="sm"
          footer={
            <>
              <button onClick={() => setShowAbrirCaja(false)} className="btn-secondary" disabled={abriendoCaja}>
                Cancelar
              </button>
              <button
                onClick={handleAbrirCaja}
                className="btn-primary"
                disabled={abriendoCaja || !saldoInicial || parseFloat(saldoInicial) < 0}
              >
                {abriendoCaja ? 'Abriendo...' : 'Abrir Caja'}
              </button>
            </>
          }
        >
          <div className="form-group">
            <label>Saldo Inicial en Efectivo</label>
            <input
              type="number"
              value={saldoInicial}
              onChange={(e) => setSaldoInicial(e.target.value)}
              placeholder="0"
              className="form-input"
              min="0"
              step="100"
            />
          </div>
        </ModalBase>
      </div>
    );
  }
  
  return (
    <div className="caja-container">
      <PageHeader
        title="Caja y Pagos"
        subtitle="Pagos, ingresos y egresos del día"
        icon={<DollarSign size={20} />}
        actions={
          <button className="btn-nuevo" onClick={exportCajaCSV} disabled={!cajaActual}>
            <Download size={16} /> Exportar CSV
          </button>
        }
      />

      {notificacion && (
        <ToastAlert
          type={notificacion.type}
          message={notificacion.message}
          onClose={limpiarNotificacion}
        />
      )}

      {pendingPdf && (
        <ToastAlert
          type="info"
          message="Tu comprobante está listo. ¿Quieres abrir el PDF ahora?"
          actionLabel="Abrir PDF"
          onAction={() => void abrirPdfPendiente()}
          onClose={() => setPendingPdf(null)}
        />
      )}

      <section className="caja-kpis-criticos" aria-label="Indicadores críticos de caja">
        <article className="kpi-critico">
          <p className="kpi-critico-label">Efectivo en caja</p>
          <p className="kpi-critico-value">{formatCurrency(cajaActual?.saldo_efectivo_caja)}</p>
          <p className="kpi-critico-note">Dinero físico esperado ahora</p>
        </article>
        <article className="kpi-critico">
          <p className="kpi-critico-label">Ingresos del día</p>
          <p className="kpi-critico-value success">{formatCurrency(totalRecaudadoDia)}</p>
          <p className="kpi-critico-note">{cajaActual?.num_pagos || 0} pagos registrados</p>
        </article>
        <article className="kpi-critico">
          <p className="kpi-critico-label">Egresos del día</p>
          <p className="kpi-critico-value danger">{formatCurrency(cajaActual?.total_egresos)}</p>
          <p className="kpi-critico-note">{cajaActual?.num_egresos || 0} egresos registrados</p>
        </article>
      </section>
      
      {/* =========================== CAJA FÍSICA =========================== */}
      <div className="seccion-caja-fisica">
        <button
          type="button"
          className="section-title-main collapsable" 
          onClick={() => setMostrarCajaFisica(!mostrarCajaFisica)}
          aria-expanded={mostrarCajaFisica}
          aria-controls="caja-fisica-panel"
        >
          💵 Caja física
          <ChevronDown 
            size={24} 
            className={`chevron-icon ${mostrarCajaFisica ? '' : 'rotated'}`}
          />
        </button>
        
        {mostrarCajaFisica && (
        <div className="caja-resumen-grid-main" id="caja-fisica-panel">
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#e0f2fe' }}>
              <DollarSign size={24} color="#0284c7" />
            </div>
            <div className="stat-content">
              <p className="stat-label">Saldo Inicial</p>
              <p className="stat-value">{formatCurrency(cajaActual?.saldo_inicial)}</p>
              <p className="stat-sublabel">Base de apertura</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#dcfce7' }}>
              <TrendingUp size={24} color="#16a34a" />
            </div>
            <div className="stat-content">
              <p className="stat-label">+ Efectivo Recibido</p>
              <p className="stat-value success">{formatCurrency(cajaActual?.total_ingresos_efectivo)}</p>
              <p className="stat-sublabel">Pagos en efectivo</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#fee2e2' }}>
              <TrendingDown size={24} color="#dc2626" />
            </div>
            <div className="stat-content">
              <p className="stat-label">- Egresos en Efectivo</p>
              <p className="stat-value danger">{formatCurrency(cajaActual?.total_egresos_efectivo)}</p>
              <p className="stat-sublabel">{cajaActual?.num_egresos || 0} gastos</p>
            </div>
          </div>
          
          <div className="stat-card highlight">
            <div className="stat-content">
              <p className="stat-label">=EFECTIVO EN CAJA</p>
              <p className="stat-value-large">{formatCurrency(cajaActual?.saldo_efectivo_caja)}</p>
              <p className="stat-sublabel">Dinero físico actual</p>
            </div>
          </div>
        </div>
        )}
      </div>
      
      {/* =========================== MÉTODOS DIGITALES (FUERA DE CAJA) =========================== */}
      <div className="metodos-digitales-section">
        <button
          type="button"
          className="section-title-main collapsable" 
          onClick={() => setMostrarMetodosDigitales(!mostrarMetodosDigitales)}
          aria-expanded={mostrarMetodosDigitales}
          aria-controls="metodos-digitales-panel"
        >
          💳 Ingresos digitales
          <ChevronDown 
            size={24} 
            className={`chevron-icon ${mostrarMetodosDigitales ? '' : 'rotated'}`}
          />
        </button>
        
        {mostrarMetodosDigitales && (
        <div id="metodos-digitales-panel">
        <p className="section-subtitle-white">Ingresos que no pasan por efectivo en caja.</p>
        
        {/* Transferencias */}
        <div className="metodo-grupo">
          <h4 className="metodo-grupo-titulo">Transferencias</h4>
          <div className="metodos-grid">
            <div className="metodo-card transferencia">
              <div className="metodo-header">
                <span className="metodo-icon">📱</span>
                <span className="metodo-nombre">Nequi</span>
              </div>
              <p className="metodo-monto">{formatCurrency(cajaActual?.total_nequi || 0)}</p>
            </div>
            
            <div className="metodo-card transferencia">
              <div className="metodo-header">
                <span className="metodo-icon">📱</span>
                <span className="metodo-nombre">Daviplata</span>
              </div>
              <p className="metodo-monto">{formatCurrency(cajaActual?.total_daviplata || 0)}</p>
            </div>
            
            <div className="metodo-card transferencia">
              <div className="metodo-header">
                <span className="metodo-icon">🏦</span>
                <span className="metodo-nombre">Transf. Bancaria</span>
              </div>
              <p className="metodo-monto">{formatCurrency(cajaActual?.total_transferencia_bancaria || 0)}</p>
            </div>
            
            <div className="metodo-card-total transferencia">
              <p className="metodo-total-label">TOTAL TRANSFERENCIAS</p>
              <p className="metodo-total-monto">{formatCurrency(cajaActual?.total_ingresos_transferencia)}</p>
            </div>
          </div>
        </div>
        
        {/* Tarjetas */}
        <div className="metodo-grupo">
          <h4 className="metodo-grupo-titulo">Tarjetas</h4>
          <div className="metodos-grid">
            <div className="metodo-card tarjetas">
              <div className="metodo-header">
                <span className="metodo-icon">💳</span>
                <span className="metodo-nombre">Débito</span>
              </div>
              <p className="metodo-monto">{formatCurrency(cajaActual?.total_tarjeta_debito || 0)}</p>
            </div>
            
            <div className="metodo-card tarjetas">
              <div className="metodo-header">
                <span className="metodo-icon">💳</span>
                <span className="metodo-nombre">Crédito</span>
              </div>
              <p className="metodo-monto">{formatCurrency(cajaActual?.total_tarjeta_credito || 0)}</p>
            </div>
            
            <div className="metodo-card-total tarjetas">
              <p className="metodo-total-label">TOTAL TARJETAS</p>
              <p className="metodo-total-monto">{formatCurrency(cajaActual?.total_ingresos_tarjeta)}</p>
            </div>
          </div>
        </div>
        </div>
        )}
      </div>
      
      {/* =========================== CRÉDITOS FINANCIERAS (FUERA DE CAJA) =========================== */}
      <div className="creditos-section">
        <button
          type="button"
          className="section-title-main collapsable" 
          onClick={() => setMostrarCreditos(!mostrarCreditos)}
          aria-expanded={mostrarCreditos}
          aria-controls="creditos-panel"
        >
          🏦 Créditos por cobrar
          <ChevronDown 
            size={24} 
            className={`chevron-icon ${mostrarCreditos ? '' : 'rotated'}`}
          />
        </button>
        
        {mostrarCreditos && (
        <div id="creditos-panel">
        <p className="section-subtitle">Pagos diferidos que la financiera transfiere después.</p>
        <div className="metodos-grid">
          <div className="metodo-card credismart">
            <div className="metodo-header">
              <span className="metodo-icon">💵</span>
              <span className="metodo-nombre">CrediSmart</span>
            </div>
            <p className="metodo-monto">{formatCurrency(cajaActual?.total_credismart)}</p>
            <p className="metodo-detalle">Pendiente de pago por financiera</p>
          </div>
          
          <div className="metodo-card sistecredito">
            <div className="metodo-header">
              <span className="metodo-icon">💵</span>
              <span className="metodo-nombre">Sistecredito</span>
            </div>
            <p className="metodo-monto">{formatCurrency(cajaActual?.total_sistecredito)}</p>
            <p className="metodo-detalle">Pendiente de pago por financiera</p>
          </div>
        </div>
        </div>
        )}
      </div>
      
      {/* =========================== RESUMEN GENERAL DEL DÍA =========================== */}
      <div className="resumen-general">
        <button
          type="button"
          className="section-title-main collapsable" 
          onClick={() => setMostrarResumen(!mostrarResumen)}
          aria-expanded={mostrarResumen}
          aria-controls="resumen-dia-panel"
        >
          📊 Resumen del día
          <ChevronDown 
            size={24} 
            className={`chevron-icon ${mostrarResumen ? '' : 'rotated'}`}
          />
        </button>
        
        {mostrarResumen && (
        <div className="stats-row" id="resumen-dia-panel">
          <div className="stat-summary efectivo">
            <div className="stat-summary-icon">💵</div>
            <div className="stat-summary-content">
              <span className="stat-summary-label">Efectivo en Caja</span>
              <span className="stat-summary-value success">{formatCurrency(cajaActual?.saldo_efectivo_caja)}</span>
              <span className="stat-summary-detalle">Disponible para arqueo</span>
            </div>
          </div>
          
          <div className="stat-summary digital">
            <div className="stat-summary-icon">💳</div>
            <div className="stat-summary-content">
              <span className="stat-summary-label">Métodos Digitales</span>
              <span className="stat-summary-value">{formatCurrency(totalDigitalDia)}</span>
              <span className="stat-summary-detalle">Transferencias y tarjetas</span>
            </div>
          </div>
          
          <div className="stat-summary creditos">
            <div className="stat-summary-icon">🏦</div>
            <div className="stat-summary-content">
              <span className="stat-summary-label">Créditos</span>
              <span className="stat-summary-value">{formatCurrency(totalCreditosDia)}</span>
              <span className="stat-summary-detalle">Pendiente de giro</span>
            </div>
          </div>
          
          <div className="stat-summary total">
            <div className="stat-summary-icon">✅</div>
            <div className="stat-summary-content">
              <span className="stat-summary-label">TOTAL RECAUDADO</span>
              <span className="stat-summary-value-large">{formatCurrency(totalRecaudadoDia)}</span>
              <span className="stat-summary-detalle">Todos los ingresos del día ({cajaActual?.num_pagos || 0} pagos)</span>
            </div>
          </div>
        </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showConfirmacion}
        title="Confirmar registro"
        message="Revisa el resumen antes de continuar."
        confirmText="Sí, registrar"
        cancelText="Cancelar"
        isLoading={confirmando}
        onCancel={() => setShowConfirmacion(false)}
        onConfirm={() => {
          if (!confirmacionAction || confirmando) return;
          void (async () => {
            setConfirmando(true);
            setShowConfirmacion(false);
            await confirmacionAction();
            setConfirmacionAction(null);
            setConfirmando(false);
          })();
        }}
      >
        <div className="confirmacion-resumen">
          <h4>RESUMEN</h4>
          <div className="confirmacion-lista">
            {confirmacionItems.map((item, index) => (
              <div key={`${item.label}-${index}`} className="confirmacion-item">
                <span className="confirmacion-label">{item.label}</span>
                <span className="confirmacion-valor">{formatCurrency(item.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={showConfirmarCierreCaja}
        title="Confirmar cierre de caja"
        message="Esta acción cierra la caja del día y no se puede deshacer."
        confirmText="Sí, cerrar caja"
        cancelText="Cancelar"
        confirmVariant="danger"
        isLoading={cerrandoCaja}
        onCancel={() => setShowConfirmarCierreCaja(false)}
        onConfirm={() => void ejecutarCerrarCaja()}
      />

      {/* Acciones rápidas */}
      <div className="acciones-caja-panel">
        <div className="acciones-caja-header">
          <h3>Acciones rápidas</h3>
          <p>Usa estos atajos para registrar movimientos del día más rápido.</p>
        </div>
        <div className="actions-bar">
          <button type="button" onClick={irARegistrarPago} className="btn-action btn-action-primary">
            <span className="btn-action-icon" aria-hidden="true">
              <DollarSign size={18} />
            </span>
            <span className="btn-action-copy">
              <strong>Registrar pago</strong>
              <small>Buscar estudiante por documento</small>
            </span>
          </button>
          <button type="button" onClick={() => setShowMovimientoGeneral(true)} className="btn-action">
            <span className="btn-action-icon" aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className="btn-action-copy">
              <strong>Registrar otro concepto</strong>
              <small>Ingresos administrativos y adicionales</small>
            </span>
          </button>
          <button type="button" onClick={() => setShowEgreso(true)} className="btn-action">
            <span className="btn-action-icon" aria-hidden="true">
              <TrendingDown size={18} />
            </span>
            <span className="btn-action-copy">
              <strong>Registrar egreso</strong>
              <small>Gastos y salidas de caja</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMostrarDetalleArqueo(false);
              setShowCerrarCaja(true);
            }}
            className="btn-action btn-danger btn-action-critical"
          >
            <span className="btn-action-icon" aria-hidden="true">
              <X size={18} />
            </span>
            <span className="btn-action-copy">
              <strong>Cerrar caja</strong>
              <small>Arqueo final y cierre del día</small>
            </span>
          </button>
        </div>
      </div>
      
      {/* Buscar y Registrar Pago */}
      <div className="main-content-grid">
        <div className="search-section" ref={pagoSectionRef}>
          <h2>Registrar Pago</h2>
          
          <div className="search-bar">
            <input
              type="text"
              placeholder="Buscar por documento..."
              value={cedula}
              onChange={(e) => setCedula(formatDocumentoBusqueda(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleBuscarEstudiante();
                }
              }}
              className="search-input"
            />
            <button type="button" onClick={() => void handleBuscarEstudiante()} disabled={buscando} className="btn-search">
              <Search size={20} />
              {buscando ? 'Buscando...' : 'Buscar'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setCedula('');
                setEstudiante(null);
              }}
            >
              Limpiar
            </button>
          </div>
          
          {estudiante && (
            <div className="estudiante-info-card">
              <div className="estudiante-header">
                {estudiante.foto_url && (
                  <img src={estudiante.foto_url} alt={estudiante.nombre_completo} className="estudiante-foto" />
                )}
                <div className="estudiante-datos">
                  <h3>{estudiante.nombre_completo}</h3>
                  <p>{getTipoDocumentoLabel(estudiante.tipo_documento)}: {estudiante.cedula}</p>
                  <p>Matrícula: {estudiante.matricula_numero}</p>
                  <span className={`badge badge-${getEstadoFinancieroColor(estudiante.estado_financiero)}`}>
                    {estudiante.estado_financiero.replace('_', ' ')}
                  </span>
                </div>
              </div>
              
              <div className="financial-info">
                <div className="info-row">
                  <span>Servicio:</span>
                  <strong>{getTipoServicioLabel(estudiante.tipo_servicio)}</strong>
                </div>
                <div className="info-row">
                  <span>Valor Total:</span>
                  <strong>{formatCurrency(estudiante.valor_total_curso)}</strong>
                </div>
                <div className="info-row">
                  <span>Total Pagado:</span>
                  <strong className="success">{formatCurrency(estudiante.total_pagado)}</strong>
                </div>
                <div className="info-row highlight">
                  <span>Saldo Pendiente:</span>
                  <strong className="danger">{formatCurrency(estudiante.saldo_pendiente)}</strong>
                </div>
                {estudiante.dias_restantes !== null && estudiante.dias_restantes !== undefined && (
                  <div className="info-row">
                    <span>Días Restantes:</span>
                    <strong className={estudiante.dias_restantes < 7 ? 'danger' : ''}>
                      {estudiante.dias_restantes} días
                    </strong>
                  </div>
                )}
              </div>
              
              <div className="pago-form">
                <h4>Registrar Pago</h4>
                <div className="pago-quick-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (!estudiante?.saldo_pendiente) return;
                      const saldo = Number(estudiante.saldo_pendiente);
                      aplicarMontoPago(saldo);
                    }}
                  >
                    Usar saldo pendiente
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => navigate(`/estudiantes/${estudiante.id}`)}
                  >
                    Ver detalle del estudiante
                  </button>
                </div>
                <div className="monto-atajos">
                  <span className="monto-atajos-label">Montos rápidos:</span>
                  <div className="monto-atajos-grid">
                    {MONTOS_RAPIDOS_PAGO.map((monto) => (
                      <button
                        key={monto}
                        type="button"
                        className="btn-monto-atajo"
                        onClick={() => aplicarMontoPago(monto)}
                        aria-label={`Usar monto rápido de ${formatCurrency(monto)}`}
                      >
                        {formatCurrency(monto)}
                      </button>
                    ))}
                    <button type="button" className="btn-monto-atajo btn-monto-limpiar" onClick={limpiarFormularioPago}>
                      Limpiar pago
                    </button>
                  </div>
                </div>
                
                {/* Toggle para pago mixto */}
                <div className="form-group">
                  <label className="checkbox-label pago-mixto-label">
                    <input
                      type="checkbox"
                      checked={esPagoMixto}
                      onChange={(e) => {
                        setEsPagoMixto(e.target.checked);
                        if (e.target.checked) {
                          setDetallesPago([{metodo: 'EFECTIVO', monto: ''}, {metodo: 'NEQUI', monto: ''}]);
                        } else {
                          setDetallesPago([{metodo: 'EFECTIVO', monto: montoPago}]);
                        }
                      }}
                    />
                    <span className="checkbox-custom" aria-hidden="true"></span>
                    <span className="checkbox-text">Pago Mixto (varios métodos)</span>
                  </label>
                </div>
                
                {!esPagoMixto ? (
                  // PAGO SIMPLE
                  <>
                    <div className="form-group">
                      <label>Monto a Pagar</label>
                      <input
                        type="number"
                        ref={montoPagoRef}
                        value={montoPago}
                        onChange={(e) => setMontoPago(e.target.value)}
                        placeholder="0"
                        className="form-input"
                        min="0"
                        step="100"
                      />
                    </div>
                    <div className="form-group">
                      <label>Método de Pago</label>
                      <select 
                        value={detallesPago[0].metodo} 
                        onChange={(e) => setDetallesPago([{metodo: e.target.value, monto: montoPago}])} 
                        className="form-select"
                      >
                        <option value="EFECTIVO">Efectivo</option>
                        <option value="NEQUI">Nequi</option>
                        <option value="DAVIPLATA">Daviplata</option>
                        <option value="TRANSFERENCIA_BANCARIA">Transferencia Bancaria</option>
                        <option value="TARJETA_DEBITO">Tarjeta Débito</option>
                        <option value="TARJETA_CREDITO">Tarjeta Crédito</option>
                        <option value="CREDISMART">CrediSmart</option>
                        <option value="SISTECREDITO">Sistecredito</option>
                      </select>
                    </div>
                  </>
                ) : (
                  // PAGO MIXTO
                  <div className="pago-mixto-container">
                    <p className="pago-mixto-ayuda">Distribuye el valor entre 2 o más métodos de pago.</p>
                    {detallesPago.map((detalle, index) => (
                      <div key={index} className="detalle-pago-row">
                        <div className="detalle-pago-index">Método {index + 1}</div>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Tipo de pago</label>
                          <select
                            value={detalle.metodo}
                            onChange={(e) => {
                              const newDetalles = [...detallesPago];
                              newDetalles[index].metodo = e.target.value;
                              setDetallesPago(newDetalles);
                            }}
                            className="form-select"
                          >
                            <option value="EFECTIVO">Efectivo</option>
                            <option value="NEQUI">Nequi</option>
                            <option value="DAVIPLATA">Daviplata</option>
                            <option value="TRANSFERENCIA_BANCARIA">Transferencia</option>
                            <option value="TARJETA_DEBITO">T. Débito</option>
                            <option value="TARJETA_CREDITO">T. Crédito</option>
                            <option value="CREDISMART">CrediSmart</option>
                            <option value="SISTECREDITO">Sistecredito</option>
                          </select>
                        </div>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Monto</label>
                          <input
                            type="number"
                            value={detalle.monto}
                            onChange={(e) => {
                              const newDetalles = [...detallesPago];
                              newDetalles[index].monto = e.target.value;
                              setDetallesPago(newDetalles);
                            }}
                            placeholder="0"
                            className="form-input"
                            min="0"
                            step="100"
                          />
                        </div>
                        {detallesPago.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDetallesPago(detallesPago.filter((_, i) => i !== index));
                            }}
                            className="btn-icon-danger"
                            aria-label={`Quitar método ${index + 1}`}
                          >
                            <X size={20} />
                          </button>
                        )}
                      </div>
                    ))}
                    
                    <button
                      onClick={() => {
                        setDetallesPago([...detallesPago, {metodo: 'EFECTIVO', monto: ''}]);
                      }}
                      className="btn-secondary-small"
                    >
                      <Plus size={16} />
                      Agregar Método
                    </button>
                    
                    <div className="total-mixto">
                      <strong>Total: {formatCurrency(detallesPago.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0))}</strong>
                    </div>
                  </div>
                )}
                
                <div className="pago-preview-resumen">
                  <div className="pago-preview-item">
                    <span>Total a registrar</span>
                    <strong>{formatCurrency(totalPagoActual)}</strong>
                  </div>
                  <div className="pago-preview-item">
                    <span>Saldo luego del pago</span>
                    <strong className={saldoDespuesPago === 0 ? 'success' : ''}>{formatCurrency(saldoDespuesPago)}</strong>
                  </div>
                </div>

              <button type="button" onClick={handleRegistrarPago} disabled={registrandoPago || !puedeRegistrarPago} className="btn-primary-full">
                  {registrandoPago ? 'Registrando...' : 'Registrar Pago'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Modal Egreso */}
      <ModalBase
        isOpen={showEgreso}
        title="Registrar Egreso"
        onClose={() => setShowEgreso(false)}
        closeDisabled={registrandoEgreso}
        size="md"
        footer={
          <>
            <button onClick={() => setShowEgreso(false)} className="btn-secondary" disabled={registrandoEgreso}>
              Cancelar
            </button>
            <button type="button" onClick={handleRegistrarEgreso} className="btn-primary" disabled={!puedeRegistrarEgreso}>
              {registrandoEgreso ? 'Registrando...' : 'Registrar Egreso'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Concepto *</label>
          <input
            type="text"
            value={conceptoEgreso}
            onChange={(e) => setConceptoEgreso(e.target.value.toUpperCase())}
            placeholder="Descripción del gasto"
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label>Categoría</label>
          <select value={categoriaEgreso} onChange={(e) => setCategoriaEgreso(e.target.value)} className="form-select">
            <option value="COMBUSTIBLE">Combustible</option>
            <option value="MANTENIMIENTO_VEHICULO">Mantenimiento Vehículo</option>
            <option value="SERVICIOS_PUBLICOS">Servicios Públicos</option>
            <option value="NOMINA">Nómina</option>
            <option value="PAPELERIA">Papelería</option>
            <option value="ASEO">Aseo</option>
            <option value="ALQUILER">Alquiler</option>
            <option value="OTROS">Otros</option>
          </select>
        </div>
        <div className="form-group">
          <label>Monto *</label>
          <input
            type="number"
            value={montoEgreso}
            onChange={(e) => setMontoEgreso(e.target.value)}
            placeholder="0"
            className="form-input"
            min="0"
            step="100"
          />
        </div>
        <div className="form-group">
          <label>Método de Pago</label>
          <select value={metodoEgreso} onChange={(e) => setMetodoEgreso(e.target.value)} className="form-select">
            <option value="EFECTIVO">Efectivo</option>
            <option value="NEQUI">Nequi</option>
            <option value="DAVIPLATA">Daviplata</option>
            <option value="TRANSFERENCIA_BANCARIA">Transferencia Bancaria</option>
            <option value="TARJETA_DEBITO">Tarjeta Débito</option>
            <option value="TARJETA_CREDITO">Tarjeta Crédito</option>
            <option value="CREDISMART">CrediSmart</option>
            <option value="SISTECREDITO">Sistecredito</option>
          </select>
        </div>
      </ModalBase>

      {/* Modal Movimiento General */}
      <ModalBase
        isOpen={showMovimientoGeneral}
        title="Registrar Otro Concepto"
        onClose={() => setShowMovimientoGeneral(false)}
        closeDisabled={registrandoMovimiento}
        size="md"
        footer={
          <>
            <button onClick={() => setShowMovimientoGeneral(false)} className="btn-secondary" disabled={registrandoMovimiento}>
              Cancelar
            </button>
            <button type="button" onClick={limpiarFormularioMovimientoGeneral} className="btn-secondary" disabled={registrandoMovimiento}>
              Limpiar
            </button>
            <button type="button" onClick={handleRegistrarMovimientoGeneral} className="btn-primary" disabled={!puedeRegistrarMovimiento}>
              {registrandoMovimiento ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="movimiento-ayuda">
          Si aplica, selecciona un concepto preconfigurado. Luego ajusta el valor final antes de guardar.
        </div>
              <div className="form-group">
                <label>Tipo</label>
                <input className="form-input readonly" readOnly value="Ingreso" />
              </div>
              <div className="form-group">
                <label>Concepto preconfigurado (opcional)</label>
                <select
                  value={conceptoIngresoSeleccionadoId}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    setConceptoIngresoSeleccionadoId(selectedId);
                    if (!selectedId) return;
                    const seleccionado = conceptosIngreso.find((concepto) => String(concepto.id) === selectedId);
                    if (!seleccionado) return;
                    setConceptoMovimiento(seleccionado.nombre);
                    setCategoriaMovimiento(seleccionado.categoria || 'OTROS');
                    setMontoMovimiento(String(seleccionado.valor_default ?? ''));
                  }}
                  className="form-select"
                  disabled={cargandoConceptosIngreso}
                >
                  <option value="">
                    {cargandoConceptosIngreso ? 'Cargando conceptos...' : 'Seleccione (opcional)'}
                  </option>
                  {conceptosIngreso.map((concepto) => (
                    <option key={concepto.id} value={concepto.id}>
                      {concepto.nombre} - {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(concepto.valor_default || 0))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Categoría *</label>
                <select
                  value={categoriaMovimiento}
                  onChange={(e) => setCategoriaMovimiento(e.target.value)}
                  className="form-select"
                >
                  {categoriasIngreso.map((categoria) => (
                    <option key={categoria.value} value={categoria.value}>{categoria.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Concepto *</label>
                <input
                  type="text"
                  value={conceptoMovimiento}
                  onChange={(e) => setConceptoMovimiento(e.target.value.toUpperCase())}
                  placeholder="Descripción del movimiento"
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label pago-mixto-label">
                  <input
                    type="checkbox"
                    checked={esPagoMixtoMovimiento}
                    onChange={(e) => {
                      setEsPagoMixtoMovimiento(e.target.checked);
                      if (e.target.checked) {
                        setDetallesMovimiento([{metodo: 'EFECTIVO', monto: ''}, {metodo: 'NEQUI', monto: ''}]);
                      } else {
                        setDetallesMovimiento([{metodo: 'EFECTIVO', monto: montoMovimiento}]);
                      }
                    }}
                  />
                  <span className="checkbox-custom" aria-hidden="true"></span>
                  <span className="checkbox-text">Pago Mixto (varios métodos)</span>
                </label>
              </div>

              {!esPagoMixtoMovimiento ? (
                <>
                  <div className="form-group">
                    <label>Monto *</label>
                    <input
                      type="number"
                      value={montoMovimiento}
                      onChange={(e) => setMontoMovimiento(e.target.value)}
                      placeholder="0"
                      className="form-input"
                      min="0"
                      step="100"
                    />
                  </div>
                  <div className="form-group">
                    <label>Método de Pago</label>
                    <select
                      value={metodoMovimiento}
                      onChange={(e) => setMetodoMovimiento(e.target.value)}
                      className="form-select"
                    >
                      <option value="EFECTIVO">Efectivo</option>
                      <option value="NEQUI">Nequi</option>
                      <option value="DAVIPLATA">Daviplata</option>
                      <option value="TRANSFERENCIA_BANCARIA">Transferencia Bancaria</option>
                      <option value="TARJETA_DEBITO">Tarjeta Débito</option>
                      <option value="TARJETA_CREDITO">Tarjeta Crédito</option>
                      <option value="CREDISMART">CrediSmart</option>
                      <option value="SISTECREDITO">Sistecredito</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="pago-mixto-container">
                  <p className="pago-mixto-ayuda">Distribuye el valor entre 2 o más métodos de pago.</p>
                  {detallesMovimiento.map((detalle, index) => (
                    <div key={index} className="detalle-pago-row">
                      <div className="detalle-pago-index">Método {index + 1}</div>
                      <div className="form-group" style={{flex: 1}}>
                        <label>Tipo de pago</label>
                        <select
                          value={detalle.metodo}
                          onChange={(e) => {
                            const newDetalles = [...detallesMovimiento];
                            newDetalles[index].metodo = e.target.value;
                            setDetallesMovimiento(newDetalles);
                          }}
                          className="form-select"
                        >
                          <option value="EFECTIVO">Efectivo</option>
                          <option value="NEQUI">Nequi</option>
                          <option value="DAVIPLATA">Daviplata</option>
                          <option value="TRANSFERENCIA_BANCARIA">Transferencia</option>
                          <option value="TARJETA_DEBITO">T. Débito</option>
                          <option value="TARJETA_CREDITO">T. Crédito</option>
                          <option value="CREDISMART">CrediSmart</option>
                          <option value="SISTECREDITO">Sistecredito</option>
                        </select>
                      </div>
                      <div className="form-group" style={{flex: 1}}>
                        <label>Monto</label>
                        <input
                          type="number"
                          value={detalle.monto}
                          onChange={(e) => {
                            const newDetalles = [...detallesMovimiento];
                            newDetalles[index].monto = e.target.value;
                            setDetallesMovimiento(newDetalles);
                          }}
                          placeholder="0"
                          className="form-input"
                          min="0"
                          step="100"
                        />
                      </div>
                      {detallesMovimiento.length > 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            setDetallesMovimiento(detallesMovimiento.filter((_, i) => i !== index));
                          }}
                          className="btn-icon-danger"
                          aria-label={`Quitar método ${index + 1}`}
                        >
                          <X size={20} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      setDetallesMovimiento([...detallesMovimiento, {metodo: 'EFECTIVO', monto: ''}]);
                    }}
                    className="btn-secondary-small"
                  >
                    <Plus size={16} />
                    Agregar Método
                  </button>
                  <div className="total-mixto">
                    <strong>Total: {formatCurrency(detallesMovimiento.reduce((sum, d) => sum + (parseFloat(d.monto) || 0), 0))}</strong>
                  </div>
                </div>
              )}

              <button
                type="button"
                className="movimiento-tercero-toggle"
                onClick={() => setMostrarDatosTercero((prev) => !prev)}
                aria-expanded={mostrarDatosTercero}
                aria-controls="movimiento-tercero-detalle"
              >
                Datos de quién paga (opcional)
                <ChevronDown size={18} className={`chevron-icon ${mostrarDatosTercero ? '' : 'rotated'}`} />
              </button>

              {mostrarDatosTercero && (
                <div className="movimiento-tercero-box" id="movimiento-tercero-detalle">
                  <div className="form-group">
                    <label>Pagó / Tercero</label>
                    <input
                      type="text"
                      value={terceroNombre}
                      onChange={(e) => setTerceroNombre(e.target.value.toUpperCase())}
                      placeholder="Nombre de quien paga"
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Documento (opcional)</label>
                    <input
                      type="text"
                      value={terceroDocumento}
                      onChange={(e) => setTerceroDocumento(e.target.value.toUpperCase())}
                      placeholder="Documento"
                      className="form-input"
                    />
                  </div>
                </div>
              )}

              <div className="pago-preview-resumen">
                <div className="pago-preview-item">
                  <span>Total a registrar</span>
                  <strong>{formatCurrency(totalMovimientoActual)}</strong>
                </div>
                <div className="pago-preview-item">
                  <span>Métodos con monto</span>
                  <strong>{metodosActivosMovimiento}</strong>
                </div>
              </div>
      </ModalBase>
      
      {/* Modal Cerrar Caja - Arqueo */}
      <ModalBase
        isOpen={Boolean(showCerrarCaja && cajaActual)}
        title="📋 Arqueo y Cierre de Caja"
        onClose={() => setShowCerrarCaja(false)}
        closeDisabled={cerrandoCaja}
        size="lg"
        footer={
          <>
            <button onClick={() => setShowCerrarCaja(false)} className="btn-secondary" disabled={cerrandoCaja}>
              Cancelar
            </button>
            <button onClick={handleCerrarCaja} className="btn-danger" disabled={cerrandoCaja || !efectivoFisico}>
              {cerrandoCaja ? 'Cerrando...' : 'Cerrar Caja'}
            </button>
          </>
        }
      >
        {cajaActual && (
          <>
            {/* Resumen de Transacciones */}
            <div className="cierre-resumen-rapido">
                <div className="cierre-resumen-item">
                  <span>Ingresos totales</span>
                  <strong className="success">{formatCurrency(cajaActual.total_ingresos)}</strong>
                </div>
                <div className="cierre-resumen-item">
                  <span>Egresos totales</span>
                  <strong className="danger">{formatCurrency(cajaActual.total_egresos)}</strong>
                </div>
                <div className="cierre-resumen-item">
                  <span>Efectivo teórico</span>
                  <strong>{formatCurrency(cajaActual.saldo_efectivo_caja)}</strong>
                </div>
                <div className="cierre-resumen-item">
                  <span>Movimientos</span>
                  <strong>{cajaActual.num_pagos || 0} pagos / {cajaActual.num_egresos || 0} egresos</strong>
                </div>
              </div>

              <button
                type="button"
                className="toggle-detalle-arqueo"
                onClick={() => setMostrarDetalleArqueo((prev) => !prev)}
                aria-expanded={mostrarDetalleArqueo}
                aria-controls="detalle-arqueo-metodos"
              >
                {mostrarDetalleArqueo ? 'Ocultar detalle por método' : 'Ver detalle por método'}
                <ChevronDown size={18} className={`chevron-icon ${mostrarDetalleArqueo ? '' : 'rotated'}`} />
              </button>

              {mostrarDetalleArqueo && (
                <div className="arqueo-transacciones" id="detalle-arqueo-metodos">
                  <h4>📊 Detalle por método</h4>
                  <div className="transacciones-grid">
                    <div className="transaccion-grupo">
                      <h5>📈 Ingresos por Método</h5>
                      <div className="transaccion-detalle">
                        <span>Efectivo:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_ingresos_efectivo)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Nequi:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_nequi || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Daviplata:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_daviplata || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Transferencia Bancaria:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_transferencia_bancaria || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Tarjeta Débito:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_tarjeta_debito || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Tarjeta Crédito:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_tarjeta_credito || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>CrediSmart:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_credismart || 0)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Sistecredito:</span>
                        <strong className="success">{formatCurrency(cajaActual.total_sistecredito || 0)}</strong>
                      </div>
                    </div>

                    <div className="transaccion-grupo">
                      <h5>📉 Egresos por Método</h5>
                      <div className="transaccion-detalle">
                        <span>Efectivo:</span>
                        <strong className="danger">{formatCurrency(cajaActual.total_egresos_efectivo)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Transferencias:</span>
                        <strong className="danger">{formatCurrency(cajaActual.total_egresos_transferencia)}</strong>
                      </div>
                      <div className="transaccion-detalle">
                        <span>Tarjetas:</span>
                        <strong className="danger">{formatCurrency(cajaActual.total_egresos_tarjeta)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Resumen de Caja (Arqueo) */}
              <div className="arqueo-resumen">
                <h4>💵 Arqueo de Efectivo</h4>
                <div className="arqueo-grid">
                  <div className="arqueo-item">
                    <span className="arqueo-label">Saldo Inicial:</span>
                    <span className="arqueo-value">{formatCurrency(cajaActual.saldo_inicial)}</span>
                  </div>
                  <div className="arqueo-item">
                    <span className="arqueo-label">+ Efectivo Recibido:</span>
                    <span className="arqueo-value success">{formatCurrency(cajaActual.total_ingresos_efectivo)}</span>
                  </div>
                  <div className="arqueo-item">
                    <span className="arqueo-label">- Egresos en Efectivo:</span>
                    <span className="arqueo-value danger">{formatCurrency(cajaActual.total_egresos_efectivo)}</span>
                  </div>
                  <div className="arqueo-item highlight">
                    <span className="arqueo-label">=EFECTIVO TEÓRICO:</span>
                    <span className="arqueo-value-large">{formatCurrency(cajaActual.saldo_efectivo_caja)}</span>
                  </div>
                </div>
                <p className="arqueo-nota">
                  💵 El efectivo teórico es lo que DEBE haber en caja según el sistema
                </p>
              </div>
              
              {/* Conteo Físico */}
              <div className="arqueo-conteo">
                <h4>👆 Conteo Físico de Efectivo</h4>
                <div className="form-group">
                  <label>Efectivo Físico Contado *</label>
                  <input
                    type="number"
                    value={efectivoFisico}
                    onChange={(e) => setEfectivoFisico(e.target.value)}
                    placeholder="Ingrese el dinero que realmente hay en caja"
                    className="form-input form-input-large"
                    autoFocus
                    min="0"
                    step="100"
                  />
                </div>
              </div>
              
              {/* Diferencia */}
              {efectivoFisico && (
                <div className="arqueo-diferencia">
                  <div className={`diferencia-card ${
                    parseFloat(efectivoFisico) - cajaActual.saldo_efectivo_caja === 0 ? 'exacto' :
                    parseFloat(efectivoFisico) - cajaActual.saldo_efectivo_caja > 0 ? 'sobrante' : 'faltante'
                  }`}>
                    <h4>
                      {parseFloat(efectivoFisico) - cajaActual.saldo_efectivo_caja === 0 ? '✅ Caja Cuadrada' :
                       parseFloat(efectivoFisico) - cajaActual.saldo_efectivo_caja > 0 ? '🔼 Sobrante' : '🔽 Faltante'}
                    </h4>
                    <p className="diferencia-monto">
                      {formatCurrency(Math.abs(parseFloat(efectivoFisico) - cajaActual.saldo_efectivo_caja))}
                    </p>
                    <p className="diferencia-detalle">
                      Efectivo Físico: {formatCurrency(parseFloat(efectivoFisico))} | 
                      Efectivo Teórico: {formatCurrency(cajaActual.saldo_efectivo_caja)}
                    </p>
                  </div>
                </div>
              )}
              
              {/* Observaciones */}
              <div className="form-group">
                <label>Observaciones del Cierre (opcional)</label>
                <textarea
                  value={observacionesCierre}
                  onChange={(e) => setObservacionesCierre(e.target.value)}
                  placeholder="Notas sobre el cierre, explicación de diferencias, etc."
                  className="form-textarea"
                  rows={3}
                />
              </div>
          </>
        )}
      </ModalBase>
    </div>
  );
};
