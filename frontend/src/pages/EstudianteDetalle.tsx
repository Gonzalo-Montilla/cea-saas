import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { estudiantesAPI, tarifasAPI } from '../services/api';
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar,
  FileText,
  DollarSign,
  Edit,
  Download,
  BookOpen,
  PlusCircle,
  Car as CarIcon,
  AlertCircle,
  Award
} from 'lucide-react';
import { ModalBase } from '../components/ui/ModalBase';
import { ToastAlert } from '../components/ui/ToastAlert';
import '../styles/EstudianteDetalle.css';
import '../styles/DefinirServicioModal.css';

interface DetallePagoItem {
  id: number;
  metodo_pago: string;
  monto: number;
  referencia?: string;
}

interface PagoHistorial {
  id: number;
  monto: number;
  metodo_pago?: string;
  fecha_pago: string;
  concepto: string;
  es_pago_mixto: boolean;
  detalles_pago: DetallePagoItem[];
}

interface ServicioHistorialItem {
  id: number;
  tipo_servicio?: string;
  categoria?: string;
  origen_cliente?: string;
  valor_total_curso?: number;
  saldo_pendiente?: number;
  horas_teoricas_completadas?: number;
  horas_practicas_completadas?: number;
  horas_teoricas_requeridas?: number;
  horas_practicas_requeridas?: number;
  fecha_inicio?: string;
  fecha_fin?: string | null;
  estado?: string;
}

interface Estudiante {
  id: number;
  usuario_id: number;
  nombre_completo: string;
  cedula: string;
  tipo_documento?: string;
  email: string;
  telefono: string;
  fecha_nacimiento: string;
  direccion?: string;
  ciudad?: string;
  barrio?: string;
  tipo_sangre?: string;
  eps?: string;
  ocupacion?: string;
  estado_civil?: string;
  nivel_educativo?: string;
  estrato?: number;
  nivel_sisben?: string;
  necesidades_especiales?: string;
  contacto_emergencia_nombre?: string;
  contacto_emergencia_telefono?: string;
  foto_url?: string;
  matricula_numero?: string;
  categoria?: string;
  tipo_servicio?: string;
  origen_cliente?: string;
  referido_por?: string;
  telefono_referidor?: string;
  estado: string;
  fecha_inscripcion: string;
  valor_total_curso?: number;
  saldo_pendiente?: number;
  progreso_teorico: number;
  progreso_practico: number;
  horas_teoricas_completadas: number;
  horas_teoricas_requeridas: number;
  horas_practicas_completadas: number;
  horas_practicas_requeridas: number;
  historial_pagos?: PagoHistorial[];
  servicios?: ServicioHistorialItem[];
  servicio_activo_id?: number | null;
  certificado_runt_numero?: string | null;
}

export const EstudianteDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [estudiante, setEstudiante] = useState<Estudiante | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<null | {
    url: string;
    title: string;
    filename: string;
  }>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editFotoBase64, setEditFotoBase64] = useState<string | null>(null);
  const [showAmpliarModal, setShowAmpliarModal] = useState(false);
  const [ampliarError, setAmpliarError] = useState('');
  const [ampliarSaving, setAmpliarSaving] = useState(false);
  const [tarifas, setTarifas] = useState<any[]>([]);
  const [servicioAdicional, setServicioAdicional] = useState('');
  const [comboTipo, setComboTipo] = useState('');
  const [valorCombo, setValorCombo] = useState('');
  const [observacionesCombo, setObservacionesCombo] = useState('');
  const [servicioVistaId, setServicioVistaId] = useState<number | null>(null);
  const [showCorregirModal, setShowCorregirModal] = useState(false);
  const [corregirTipoServicio, setCorregirTipoServicio] = useState('');
  const [corregirValor, setCorregirValor] = useState('');
  const [corregirMotivo, setCorregirMotivo] = useState('');
  const [corregirPassword, setCorregirPassword] = useState('');
  const [corregirError, setCorregirError] = useState('');
  const [corregirLoading, setCorregirLoading] = useState(false);
  const [showRuntModal, setShowRuntModal] = useState(false);
  const [runtNumero, setRuntNumero] = useState('');
  const [runtError, setRuntError] = useState('');
  const [runtSaving, setRuntSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);
  const [editForm, setEditForm] = useState({
    primer_nombre: '',
    segundo_nombre: '',
    primer_apellido: '',
    segundo_apellido: '',
    email: '',
    cedula: '',
    tipo_documento: 'CEDULA',
    telefono: '',
    fecha_nacimiento: '',
    direccion: '',
    ciudad: '',
    barrio: '',
    tipo_sangre: '',
    eps: '',
    ocupacion: '',
    estado_civil: '',
    nivel_educativo: '',
    estrato: '',
    nivel_sisben: '',
    necesidades_especiales: '',
    contacto_emergencia_nombre: '',
    contacto_emergencia_telefono: ''
  });

  useEffect(() => {
    cargarEstudiante();
  }, [id]);

  useEffect(() => {
    if (!showAmpliarModal || !comboTipo) return;
    if (estudiante?.origen_cliente === 'DIRECTO') {
      const minimo = calcularPrecioMinimo(comboTipo);
      if (minimo && valorCombo !== minimo.toString()) {
        setValorCombo(minimo.toString());
      }
    }
  }, [showAmpliarModal, comboTipo, tarifas, estudiante?.origen_cliente, valorCombo]);

  useEffect(() => {
    if (!estudiante?.servicios || estudiante.servicios.length === 0) return;
    const activo = estudiante.servicio_activo_id ?? estudiante.servicios[0].id;
    setServicioVistaId(activo);
  }, [estudiante]);

  const cargarEstudiante = async () => {
    try {
      setIsLoading(true);
      const data = await estudiantesAPI.getById(Number(id));
      setEstudiante(data);
    } catch (err) {
      console.error('Error al cargar estudiante:', err);
      setError('No se pudieron cargar los datos del estudiante.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerContrato = async () => {
    if (!id) return;
    try {
      const pdfBlob = await estudiantesAPI.getContratoPdf(Number(id));
      const fileUrl = URL.createObjectURL(pdfBlob);
      const filename = estudiante?.matricula_numero
        ? `contrato_${estudiante.matricula_numero}.pdf`
        : `contrato_${id}.pdf`;
      setPdfPreview({
        url: fileUrl,
        title: 'Contrato del Estudiante',
        filename,
      });
    } catch (err) {
      console.error('Error al descargar contrato:', err);
      setFeedback({ type: 'error', message: 'No se pudo cargar el contrato.' });
    }
  };

  const handleVerHabeasFirmado = async () => {
    if (!id) return;
    try {
      const pdfBlob = await estudiantesAPI.getHabeasFirmadoPdf(Number(id));
      const fileUrl = URL.createObjectURL(pdfBlob);
      const filename = estudiante?.matricula_numero
        ? `habeas_firmado_${estudiante.matricula_numero}.pdf`
        : `habeas_firmado_${id}.pdf`;
      setPdfPreview({
        url: fileUrl,
        title: 'Habeas Data firmado',
        filename,
      });
    } catch (err: any) {
      console.error('Error al descargar Habeas firmado:', err);
      setFeedback({ type: 'error', message: err?.response?.data?.detail || 'No se pudo cargar el Habeas firmado.' });
    }
  };

  const abrirCertificadoPreview = async () => {
    if (!id) return;
    const pdfBlob = await estudiantesAPI.getCertificadoPdf(Number(id));
    const fileUrl = URL.createObjectURL(pdfBlob);
    const filename = estudiante?.matricula_numero
      ? `certificado_${estudiante.matricula_numero}.pdf`
      : `certificado_${id}.pdf`;
    setPdfPreview({
      url: fileUrl,
      title: 'Certificado de aprobacion',
      filename,
    });
  };

  const handleVerCertificado = async () => {
    if (!id) return;
    const runtRegistrado = String(estudiante?.certificado_runt_numero || '').trim();
    if (!runtRegistrado) {
      setRuntNumero('');
      setRuntError('');
      setShowRuntModal(true);
      return;
    }
    try {
      await abrirCertificadoPreview();
    } catch (err: any) {
      console.error('Error al generar certificado:', err);
      setFeedback({ type: 'error', message: err?.response?.data?.detail || 'No se pudo generar el certificado.' });
    }
  };

  const guardarRuntYGenerar = async () => {
    if (!id) return;
    const runtNormalizado = runtNumero.trim().toUpperCase();
    if (!/^[A-Z0-9/-]{4,40}$/.test(runtNormalizado)) {
      setRuntError("Número RUNT inválido. Usa 4-40 caracteres alfanuméricos, '-' o '/'.");
      return;
    }
    setRuntSaving(true);
    setRuntError('');
    try {
      const actualizado = await estudiantesAPI.setCertificadoRunt(Number(id), runtNormalizado);
      setEstudiante(actualizado);
      setShowRuntModal(false);
      await abrirCertificadoPreview();
    } catch (err: any) {
      console.error('Error al guardar número RUNT:', err);
      setRuntError(err?.response?.data?.detail || 'No se pudo guardar el número RUNT.');
    } finally {
      setRuntSaving(false);
    }
  };

  const cerrarPdfPreview = () => {
    if (pdfPreview?.url) {
      URL.revokeObjectURL(pdfPreview.url);
    }
    setPdfPreview(null);
  };

  const descargarPdfPreview = () => {
    if (!pdfPreview?.url) return;
    const link = document.createElement('a');
    link.href = pdfPreview.url;
    link.download = pdfPreview.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const formatearFecha = (fecha: string) => {
    return new Date(fecha).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatearFechaCorta = (fecha?: string | null) => {
    if (!fecha) return 'N/A';
    return formatearFecha(fecha);
  };

  const getServicioVista = () => {
    if (!estudiante?.servicios || estudiante.servicios.length === 0) return null;
    const id = servicioVistaId ?? estudiante.servicio_activo_id ?? estudiante.servicios[0].id;
    return estudiante.servicios.find((s) => s.id === id) || null;
  };

  const resolverValor = (valorServicio?: number, fallback?: number) => {
    if (valorServicio === undefined || valorServicio === null) return fallback || 0;
    if (valorServicio === 0 && (fallback || 0) > 0) return fallback || 0;
    return valorServicio;
  };

  const getProgreso = (completadas?: number, requeridas?: number) => {
    if (!requeridas) return 0;
    return Math.min(100, (Number(completadas || 0) / Number(requeridas)) * 100);
  };

  const servicioVista = getServicioVista();

  const formatearMoneda = (valor?: number) => {
    if (!valor) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(valor);
  };

  const calcularPrecioMinimo = (tipo: string) => {
    const tarifa = tarifas.find((t) => t.tipo_servicio === tipo && t.activo);
    if (!tarifa) return 0;
    const base = Number(tarifa.precio_base || 0);
    const practica = Number(tarifa.costo_practica || 0);
    const esCertificado = ['CERTIFICADO_B1', 'CERTIFICADO_C1'].includes(tipo);
    return esCertificado ? base + practica : base;
  };

  const getServicioLabel = (tipo?: string) => {
    const map: Record<string, string> = {
      LICENCIA_A2: 'Licencia A2 (Moto)',
      LICENCIA_B1: 'Licencia B1 (Automóvil)',
      LICENCIA_C1: 'Licencia C1 (Camioneta)',
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
    return map[tipo || ''] || (tipo || 'N/A');
  };

  const tiposServicio = [
    { value: 'LICENCIA_A2', label: 'Licencia A2 (Moto)' },
    { value: 'LICENCIA_B1', label: 'Licencia B1 (Automóvil)' },
    { value: 'LICENCIA_C1', label: 'Licencia C1 (Camioneta)' },
    { value: 'COMBO_A2_B1', label: 'Combo A2 + B1' },
    { value: 'COMBO_A2_C1', label: 'Combo A2 + C1' },
    { value: 'CERTIFICADO_MOTO', label: 'Certificado Moto' },
    { value: 'CERTIFICADO_B1', label: 'Certificado B1' },
    { value: 'CERTIFICADO_C1', label: 'Certificado C1' },
    { value: 'CERTIFICADO_B1_SIN_PRACTICA', label: 'Certificado B1 sin práctica' },
    { value: 'CERTIFICADO_C1_SIN_PRACTICA', label: 'Certificado C1 sin práctica' },
    { value: 'CERTIFICADO_A2_B1_SIN_PRACTICA', label: 'Certificado A2 + B1 sin práctica' },
    { value: 'CERTIFICADO_A2_C1_SIN_PRACTICA', label: 'Certificado A2 + C1 sin práctica' },
    { value: 'CERTIFICADO_A2_B1_CON_PRACTICA', label: 'Certificado A2 + B1 con práctica' },
    { value: 'CERTIFICADO_A2_C1_CON_PRACTICA', label: 'Certificado A2 + C1 con práctica' },
  ];

  const getServicioActualLabel = () => getServicioLabel(estudiante?.tipo_servicio);

  const abrirCorregirServicio = () => {
    if (!estudiante?.tipo_servicio) return;
    setCorregirTipoServicio(estudiante.tipo_servicio);
    if (estudiante.origen_cliente === 'DIRECTO') {
      const minimo = calcularPrecioMinimo(estudiante.tipo_servicio);
      setCorregirValor(minimo ? minimo.toString() : '');
    } else {
      setCorregirValor(estudiante.valor_total_curso ? String(estudiante.valor_total_curso) : '');
    }
    setCorregirMotivo('');
    setCorregirPassword('');
    setCorregirError('');
    setShowCorregirModal(true);
  };

  const cerrarCorregirServicio = () => {
    setShowCorregirModal(false);
  };

  const guardarCorreccionServicio = async () => {
    if (!estudiante) return;
    if (!corregirTipoServicio || !corregirMotivo.trim() || !corregirPassword.trim()) {
      setCorregirError('Complete el servicio, motivo y contraseña');
      return;
    }
    setCorregirLoading(true);
    setCorregirError('');
    try {
      const payload: any = {
        tipo_servicio_nuevo: corregirTipoServicio,
        motivo: corregirMotivo.trim(),
        password: corregirPassword
      };
      if (estudiante.origen_cliente === 'REFERIDO') {
        const valorNum = parseInt(corregirValor || '0', 10);
        if (!valorNum || valorNum <= 0) {
          setCorregirError('El valor debe ser mayor a 0');
          setCorregirLoading(false);
          return;
        }
        payload.valor_total_curso = valorNum;
      }
      await estudiantesAPI.corregirServicio(estudiante.id, payload);
      const actualizado = await estudiantesAPI.getById(estudiante.id);
      setEstudiante(actualizado);
      setShowCorregirModal(false);
    } catch (err: any) {
      setCorregirError(err.response?.data?.detail || 'No se pudo corregir el servicio.');
    } finally {
      setCorregirLoading(false);
    }
  };

  const getOpcionesAdicional = () => {
    const actual = estudiante?.tipo_servicio;
    if (actual === 'LICENCIA_A2') {
      return [
        { value: 'B1', label: 'B1' },
        { value: 'C1', label: 'C1' }
      ];
    }
    if (actual === 'LICENCIA_B1') {
      return [{ value: 'A2', label: 'A2' }];
    }
    if (actual === 'LICENCIA_C1') {
      return [{ value: 'A2', label: 'A2' }];
    }
    return [];
  };

  const calcularComboTipo = (adicional: string) => {
    const actual = estudiante?.tipo_servicio;
    if (actual === 'LICENCIA_A2' && adicional === 'B1') return 'COMBO_A2_B1';
    if (actual === 'LICENCIA_A2' && adicional === 'C1') return 'COMBO_A2_C1';
    if (actual === 'LICENCIA_B1' && adicional === 'A2') return 'COMBO_A2_B1';
    if (actual === 'LICENCIA_C1' && adicional === 'A2') return 'COMBO_A2_C1';
    return '';
  };

  const totalAbonado = (estudiante?.valor_total_curso || 0) - (estudiante?.saldo_pendiente || 0);
  const valorComboNumero = parseInt(valorCombo || '0', 10) || 0;
  const nuevoSaldo = Math.max(valorComboNumero - totalAbonado, 0);

  const splitNombre = (fullName?: string) => {
    const partes = (fullName || '').trim().split(/\s+/).filter(Boolean);
    const [primerNombre, segundoNombre, primerApellido, ...resto] = partes;
    return {
      primer_nombre: primerNombre || '',
      segundo_nombre: segundoNombre || '',
      primer_apellido: primerApellido || '',
      segundo_apellido: resto.length ? resto.join(' ') : ''
    };
  };

  const abrirAmpliarServicio = async () => {
    setAmpliarError('');
    setServicioAdicional('');
    setComboTipo('');
    setValorCombo('');
    setObservacionesCombo('');
    setShowAmpliarModal(true);
    if (!tarifas.length) {
      try {
        const data = await tarifasAPI.getAll();
        setTarifas(data || []);
      } catch (err) {
        console.error('Error al cargar tarifas:', err);
      }
    }
  };

  const handleServicioAdicionalChange = (value: string) => {
    setServicioAdicional(value);
    const tipo = calcularComboTipo(value);
    setComboTipo(tipo);
    if (!tipo) {
      setValorCombo('');
      return;
    }
    const minimo = calcularPrecioMinimo(tipo);
    if (estudiante?.origen_cliente === 'DIRECTO') {
      setValorCombo(minimo ? minimo.toString() : '');
    } else {
      setValorCombo('');
    }
  };

  const handleGuardarAmpliacion = async () => {
    if (!id || !estudiante) return;
    setAmpliarError('');

    if (!comboTipo) {
      setAmpliarError('Seleccione el servicio adicional para calcular el combo');
      return;
    }

    const minimo = calcularPrecioMinimo(comboTipo);
    if (estudiante.origen_cliente === 'DIRECTO' && minimo <= 0) {
      setAmpliarError('No hay tarifa definida para este combo');
      return;
    }

    if (estudiante.origen_cliente === 'REFERIDO') {
      if (!valorCombo) {
        setAmpliarError('Debe ingresar el valor del combo');
        return;
      }
      if (minimo > 0 && parseInt(valorCombo, 10) < minimo) {
        setAmpliarError(`El valor no puede ser menor a ${formatearMoneda(minimo)}`);
        return;
      }
    }

    setAmpliarSaving(true);
    try {
      await estudiantesAPI.ampliarServicio(Number(id), {
        tipo_servicio_nuevo: comboTipo,
        valor_total_curso: estudiante.origen_cliente === 'REFERIDO' ? parseInt(valorCombo, 10) : null,
        observaciones: observacionesCombo || null
      });
      await cargarEstudiante();
      setShowAmpliarModal(false);
    } catch (err: any) {
      console.error('Error al ampliar servicio:', err);
      setAmpliarError(err.response?.data?.detail || 'No se pudo ampliar el servicio.');
    } finally {
      setAmpliarSaving(false);
    }
  };

  const abrirEditar = () => {
    if (!estudiante) return;
    const nombres = splitNombre(estudiante.nombre_completo);
    setEditForm({
      primer_nombre: nombres.primer_nombre,
      segundo_nombre: nombres.segundo_nombre,
      primer_apellido: nombres.primer_apellido,
      segundo_apellido: nombres.segundo_apellido,
      email: estudiante.email || '',
      cedula: estudiante.cedula || '',
      tipo_documento: estudiante.tipo_documento || 'CEDULA',
      telefono: estudiante.telefono || '',
      fecha_nacimiento: estudiante.fecha_nacimiento || '',
      direccion: estudiante.direccion || '',
      ciudad: estudiante.ciudad || '',
      barrio: estudiante.barrio || '',
      tipo_sangre: estudiante.tipo_sangre || '',
      eps: estudiante.eps || '',
      ocupacion: estudiante.ocupacion || '',
      estado_civil: estudiante.estado_civil || '',
      nivel_educativo: estudiante.nivel_educativo || '',
      estrato: estudiante.estrato ? String(estudiante.estrato) : '',
      nivel_sisben: estudiante.nivel_sisben || '',
      necesidades_especiales: estudiante.necesidades_especiales || '',
      contacto_emergencia_nombre: estudiante.contacto_emergencia_nombre || '',
      contacto_emergencia_telefono: estudiante.contacto_emergencia_telefono || ''
    });
    setEditFotoBase64(null);
    setEditError('');
    setShowEditModal(true);
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFotoChange = (file?: File | null) => {
    if (!file) {
      setEditFotoBase64(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      setEditFotoBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleGuardarEdicion = async () => {
    if (!id) return;
    setIsSaving(true);
    setEditError('');
    try {
      const addIfNotEmpty = (value: string) => {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      };
      const payload: any = {
        tipo_documento: editForm.tipo_documento,
        foto_base64: editFotoBase64 || undefined,
        fecha_nacimiento: editForm.fecha_nacimiento || null,
        direccion: editForm.direccion || null,
        ciudad: editForm.ciudad || null,
        barrio: editForm.barrio || null,
        tipo_sangre: editForm.tipo_sangre || null,
        eps: editForm.eps || null,
        ocupacion: editForm.ocupacion || null,
        estado_civil: editForm.estado_civil || null,
        nivel_educativo: editForm.nivel_educativo || null,
        estrato: editForm.estrato ? Number(editForm.estrato) : null,
        nivel_sisben: editForm.nivel_sisben || null,
        necesidades_especiales: editForm.necesidades_especiales || null,
        contacto_emergencia_nombre: editForm.contacto_emergencia_nombre || null,
        contacto_emergencia_telefono: editForm.contacto_emergencia_telefono || null
      };
      const primerNombre = addIfNotEmpty(editForm.primer_nombre);
      const segundoNombre = addIfNotEmpty(editForm.segundo_nombre);
      const primerApellido = addIfNotEmpty(editForm.primer_apellido);
      const segundoApellido = addIfNotEmpty(editForm.segundo_apellido);
      const email = addIfNotEmpty(editForm.email);
      const cedula = addIfNotEmpty(editForm.cedula);
      const telefono = addIfNotEmpty(editForm.telefono);

      if (primerNombre !== undefined) payload.primer_nombre = primerNombre;
      if (segundoNombre !== undefined) payload.segundo_nombre = segundoNombre;
      if (primerApellido !== undefined) payload.primer_apellido = primerApellido;
      if (segundoApellido !== undefined) payload.segundo_apellido = segundoApellido;
      if (email !== undefined) payload.email = email;
      if (cedula !== undefined) payload.cedula = cedula;
      if (telefono !== undefined) payload.telefono = telefono;
      const data = await estudiantesAPI.update(Number(id), payload);
      setEstudiante(data);
      setShowEditModal(false);
    } catch (err: any) {
      console.error('Error al actualizar estudiante:', err);
      setEditError(err.response?.data?.detail || 'No se pudo actualizar el estudiante');
    } finally {
      setIsSaving(false);
    }
  };

  const getEstadoBadgeClass = (estado: string) => {
    const estados: { [key: string]: string } = {
      'PROSPECTO': 'badge-warning',
      'INSCRITO': 'badge-info',
      'EN_FORMACION': 'badge-primary',
      'LISTO_EXAMEN': 'badge-success',
      'GRADUADO': 'badge-success',
      'DESERTOR': 'badge-danger',
      'RETIRADO': 'badge-danger'
    };
    return estados[estado] || 'badge-secondary';
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

  const teoricasCompletas = (estudiante?.horas_teoricas_completadas ?? 0) >= (estudiante?.horas_teoricas_requeridas ?? 0);
  const practicasCompletas = (estudiante?.horas_practicas_completadas ?? 0) >= (estudiante?.horas_practicas_requeridas ?? 0);
  const saldoAlDia = Number(estudiante?.saldo_pendiente ?? 0) <= 0;
  const estadoCertificable = ['LISTO_EXAMEN', 'GRADUADO'].includes(estudiante?.estado || '');
  const certificadoBloqueos = [
    !teoricasCompletas ? 'Horas teóricas incompletas' : '',
    !practicasCompletas ? 'Horas prácticas incompletas' : '',
    !saldoAlDia ? 'Saldo pendiente' : '',
    !estadoCertificable ? 'Estado académico no habilitado' : '',
  ].filter(Boolean);
  const puedeGenerarCertificado = certificadoBloqueos.length === 0;

  if (isLoading) {
    return (
      <div className="loading-container">
        <p>Cargando información del estudiante...</p>
      </div>
    );
  }

  if (error || !estudiante) {
    return (
      <div className="error-container">
        <AlertCircle size={48} color="#ef4444" />
        <p>{error || 'Estudiante no encontrado'}</p>
        <button className="btn-primary" onClick={() => navigate('/estudiantes')}>
          Volver a Estudiantes
        </button>
      </div>
    );
  }

  return (
    <div className="estudiante-detalle-container">
      {feedback && (
        <ToastAlert type={feedback.type} message={feedback.message} onClose={() => setFeedback(null)} />
      )}
      {showEditModal && (
        <ModalBase
          isOpen={showEditModal}
          title="Editar Estudiante"
          onClose={() => setShowEditModal(false)}
          closeDisabled={isSaving}
          size="lg"
        >
            <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
              {editError && <div className="error-message">{editError}</div>}
              <div className="form-group">
                <label>Primer Nombre</label>
                <input
                  className="form-input"
                  value={editForm.primer_nombre}
                  onChange={(e) => handleEditChange('primer_nombre', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Segundo Nombre</label>
                <input
                  className="form-input"
                  value={editForm.segundo_nombre}
                  onChange={(e) => handleEditChange('segundo_nombre', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Primer Apellido</label>
                <input
                  className="form-input"
                  value={editForm.primer_apellido}
                  onChange={(e) => handleEditChange('primer_apellido', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Segundo Apellido</label>
                <input
                  className="form-input"
                  value={editForm.segundo_apellido}
                  onChange={(e) => handleEditChange('segundo_apellido', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Foto</label>
                <input
                  type="file"
                  accept="image/*"
                  className="form-input"
                  onChange={(e) => handleFotoChange(e.target.files?.[0])}
                />
                {(editFotoBase64 || estudiante?.foto_url) && (
                  <div style={{ marginTop: '8px' }}>
                    <img
                      src={editFotoBase64 || estudiante?.foto_url}
                      alt="Foto"
                      style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '8px' }}
                    />
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="form-input"
                  value={editForm.email}
                  onChange={(e) => handleEditChange('email', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Tipo de Documento</label>
                <select
                  className="form-input"
                  value={editForm.tipo_documento}
                  onChange={(e) => handleEditChange('tipo_documento', e.target.value)}
                >
                  <option value="CEDULA">Cédula</option>
                  <option value="TARJETA_IDENTIDAD">Tarjeta de Identidad</option>
                  <option value="PASAPORTE">Pasaporte</option>
                  <option value="CEDULA_EXTRANJERIA">Cédula de Extranjería</option>
                </select>
              </div>
              <div className="form-group">
                <label>Número de Documento</label>
                <input
                  className="form-input"
                  value={editForm.cedula}
                  onChange={(e) => handleEditChange('cedula', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Teléfono</label>
                <input
                  className="form-input"
                  value={editForm.telefono}
                  onChange={(e) => handleEditChange('telefono', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Fecha de Nacimiento</label>
                <input
                  type="date"
                  className="form-input"
                  value={editForm.fecha_nacimiento}
                  onChange={(e) => handleEditChange('fecha_nacimiento', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Dirección</label>
                <input
                  className="form-input"
                  value={editForm.direccion}
                  onChange={(e) => handleEditChange('direccion', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Ciudad</label>
                <input
                  className="form-input"
                  value={editForm.ciudad}
                  onChange={(e) => handleEditChange('ciudad', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Barrio</label>
                <input
                  className="form-input"
                  value={editForm.barrio}
                  onChange={(e) => handleEditChange('barrio', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Tipo de Sangre</label>
                <input
                  className="form-input"
                  value={editForm.tipo_sangre}
                  onChange={(e) => handleEditChange('tipo_sangre', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>EPS</label>
                <input
                  className="form-input"
                  value={editForm.eps}
                  onChange={(e) => handleEditChange('eps', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Ocupación</label>
                <input
                  className="form-input"
                  value={editForm.ocupacion}
                  onChange={(e) => handleEditChange('ocupacion', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Estado Civil</label>
                <input
                  className="form-input"
                  value={editForm.estado_civil}
                  onChange={(e) => handleEditChange('estado_civil', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Nivel Educativo</label>
                <input
                  className="form-input"
                  value={editForm.nivel_educativo}
                  onChange={(e) => handleEditChange('nivel_educativo', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Estrato</label>
                <input
                  type="number"
                  min="1"
                  max="6"
                  className="form-input"
                  value={editForm.estrato}
                  onChange={(e) => handleEditChange('estrato', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Nivel SISBEN</label>
                <input
                  className="form-input"
                  value={editForm.nivel_sisben}
                  onChange={(e) => handleEditChange('nivel_sisben', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Necesidades Especiales</label>
                <input
                  className="form-input"
                  value={editForm.necesidades_especiales}
                  onChange={(e) => handleEditChange('necesidades_especiales', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Contacto de Emergencia (Nombre)</label>
                <input
                  className="form-input"
                  value={editForm.contacto_emergencia_nombre}
                  onChange={(e) => handleEditChange('contacto_emergencia_nombre', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Contacto de Emergencia (Teléfono)</label>
                <input
                  className="form-input"
                  value={editForm.contacto_emergencia_telefono}
                  onChange={(e) => handleEditChange('contacto_emergencia_telefono', e.target.value)}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={handleGuardarEdicion} disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
        </ModalBase>
      )}
      {showAmpliarModal && (
        <ModalBase
          isOpen={showAmpliarModal}
          title="Ampliar Servicio a Combo"
          onClose={() => setShowAmpliarModal(false)}
          closeDisabled={ampliarSaving}
          size="md"
        >
            <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
              {ampliarError && <div className="error-message">{ampliarError}</div>}
              <div className="form-group">
                <label>Servicio actual</label>
                <input className="form-input readonly" readOnly value={getServicioActualLabel()} />
              </div>
              <div className="form-group">
                <label>Servicio adicional *</label>
                <select
                  className="form-select"
                  value={servicioAdicional}
                  onChange={(e) => handleServicioAdicionalChange(e.target.value)}
                  required
                >
                  <option value="">Seleccione</option>
                  {getOpcionesAdicional().map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Combo resultante</label>
                <input
                  className="form-input readonly"
                  readOnly
                  value={
                    comboTipo === 'COMBO_A2_B1'
                      ? 'Combo A2 + B1'
                      : comboTipo === 'COMBO_A2_C1'
                      ? 'Combo A2 + C1'
                      : ''
                  }
                  placeholder="Seleccione servicio adicional"
                />
              </div>
              <div className="form-group">
                <label>Valor total del combo *</label>
                {estudiante.origen_cliente === 'REFERIDO' && comboTipo && (
                  <small className="help-text">
                    Mínimo permitido: {formatearMoneda(calcularPrecioMinimo(comboTipo))}
                  </small>
                )}
                <input
                  className={`form-input ${estudiante.origen_cliente === 'DIRECTO' ? 'readonly' : ''}`}
                  value={valorCombo}
                  onChange={(e) => setValorCombo(e.target.value.replace(/\D/g, ''))}
                  readOnly={estudiante.origen_cliente === 'DIRECTO'}
                  placeholder="Ingrese el valor"
                  required
                />
              </div>
              <div className="form-group">
                <label>Total abonado</label>
                <input className="form-input readonly" readOnly value={formatearMoneda(totalAbonado)} />
              </div>
              <div className="form-group">
                <label>Nuevo saldo pendiente</label>
                <input className="form-input readonly" readOnly value={formatearMoneda(nuevoSaldo)} />
              </div>
              <div className="form-group">
                <label>Observaciones</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={observacionesCombo}
                  onChange={(e) => setObservacionesCombo(e.target.value.toUpperCase())}
                  placeholder="OBSERVACIONES (OPCIONAL)"
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAmpliarModal(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={handleGuardarAmpliacion} disabled={ampliarSaving}>
                  {ampliarSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
        </ModalBase>
      )}
      {showCorregirModal && (
        <ModalBase
          isOpen={showCorregirModal}
          title="Corregir servicio"
          onClose={cerrarCorregirServicio}
          closeDisabled={corregirLoading}
          size="md"
        >
            <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
              {corregirError && <div className="error-message">{corregirError}</div>}
              <div className="form-group">
                <label>Servicio actual</label>
                <input className="form-input readonly" readOnly value={getServicioActualLabel()} />
              </div>
              <div className="form-group">
                <label>Nuevo servicio *</label>
                <select
                  className="form-select"
                  value={corregirTipoServicio}
                  onChange={(e) => setCorregirTipoServicio(e.target.value)}
                  required
                >
                  <option value="">Seleccione</option>
                  {tiposServicio.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {estudiante.origen_cliente === 'REFERIDO' && (
                <div className="form-group">
                  <label>Valor total del curso *</label>
                  <small className="help-text">
                    Mínimo permitido: {formatearMoneda(calcularPrecioMinimo(corregirTipoServicio))}
                  </small>
                  <input
                    className="form-input"
                    value={corregirValor}
                    onChange={(e) => setCorregirValor(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ingrese el valor"
                  />
                </div>
              )}
              <div className="form-group">
                <label>Motivo de corrección *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={corregirMotivo}
                  onChange={(e) => setCorregirMotivo(e.target.value.toUpperCase())}
                  placeholder="DETALLE DEL ERROR Y CORRECCIÓN"
                  required
                />
              </div>
              <div className="form-group">
                <label>Contraseña Admin/Gerente *</label>
                <input
                  type="password"
                  className="form-input"
                  value={corregirPassword}
                  onChange={(e) => setCorregirPassword(e.target.value)}
                  placeholder="********"
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={cerrarCorregirServicio}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={guardarCorreccionServicio} disabled={corregirLoading}>
                  {corregirLoading ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
        </ModalBase>
      )}
      {showRuntModal && (
        <ModalBase
          isOpen={showRuntModal}
          title="Registrar número RUNT"
          onClose={() => setShowRuntModal(false)}
          closeDisabled={runtSaving}
          size="md"
        >
            <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
              {runtError && <div className="error-message">{runtError}</div>}
              <div className="form-group">
                <label>Número RUNT del certificado *</label>
                <input
                  className="form-input"
                  value={runtNumero}
                  onChange={(e) => setRuntNumero(e.target.value.toUpperCase())}
                  placeholder="Ej: RUNT-2026-00125"
                  maxLength={40}
                  autoFocus
                />
                <small className="help-text">
                  Este dato se solicita una sola vez y quedará bloqueado para el certificado.
                </small>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowRuntModal(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={guardarRuntYGenerar} disabled={runtSaving}>
                  {runtSaving ? 'Guardando...' : 'Guardar y generar'}
                </button>
              </div>
            </form>
        </ModalBase>
      )}
      {pdfPreview && (
        <ModalBase
          isOpen={Boolean(pdfPreview)}
          title={pdfPreview.title}
          onClose={cerrarPdfPreview}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={cerrarPdfPreview}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={descargarPdfPreview}>
                <Download size={16} /> Descargar
              </button>
            </>
          }
        >
          <div className="pdf-preview-body">
            <iframe src={pdfPreview.url} title={pdfPreview.title} />
          </div>
        </ModalBase>
      )}
      {/* Header */}
      <div className="detalle-header">
        <button className="btn-back" onClick={() => navigate('/estudiantes')}>
          <ArrowLeft size={20} /> Volver
        </button>
        <div className="header-actions">
          <button className="btn-action" onClick={abrirEditar}>
            <Edit size={18} /> Editar
          </button>
          <button className="btn-action" onClick={handleVerContrato}>
            <FileText size={18} /> Ver Contrato
          </button>
          <button className="btn-action" onClick={handleVerHabeasFirmado}>
            <FileText size={18} /> Ver Habeas firmado
          </button>
          <button
            className="btn-action btn-action-success"
            onClick={handleVerCertificado}
            disabled={!puedeGenerarCertificado}
            title={
              puedeGenerarCertificado
                ? 'Generar certificado'
                : `No disponible: ${certificadoBloqueos.join(' | ')}`
            }
          >
            <Award size={18} /> Ver Certificado
          </button>
        </div>
      </div>

      {/* Información Principal */}
      <div className="info-principal">
        <div className="foto-grande">
          {estudiante.foto_url ? (
            <img src={estudiante.foto_url} alt={estudiante.nombre_completo} />
          ) : (
            <div className="foto-placeholder-grande">
              <User size={80} />
            </div>
          )}
        </div>
        
        <div className="info-basica">
          <h1>{estudiante.nombre_completo}</h1>
          <p className="cedula">
            {getTipoDocumentoLabel(estudiante.tipo_documento)}: {estudiante.cedula}
          </p>
          {estudiante.matricula_numero && (
            <p className="matricula">Matrícula: {estudiante.matricula_numero}</p>
          )}
          {estudiante.certificado_runt_numero && (
            <p className="matricula">RUNT certificado: {estudiante.certificado_runt_numero}</p>
          )}
          
          {/* Badge de origen del cliente */}
          {estudiante.origen_cliente && (
            <div className="origen-badge-container">
              {estudiante.origen_cliente === 'DIRECTO' ? (
                <span className="badge badge-directo">
                  Cliente Directo
                </span>
              ) : (
                <span className="badge badge-referido">
                  Referido por: {estudiante.referido_por || 'N/A'}
                  {estudiante.telefono_referidor && (
                    <span className="telefono-ref"> • {estudiante.telefono_referidor}</span>
                  )}
                </span>
              )}
            </div>
          )}
          
          <span className={`badge ${getEstadoBadgeClass(estudiante.estado)}`}>
            {estudiante.estado.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="detalle-grid">
        {/* Datos Personales */}
        <div className="detalle-card">
          <h2><User size={20} /> Datos Personales</h2>
          <div className="info-rows">
            <div className="info-row">
              <span className="label">Fecha de Nacimiento:</span>
              <span className="value">{formatearFecha(estudiante.fecha_nacimiento)}</span>
            </div>
            <div className="info-row">
              <span className="label"><Mail size={16} /> Email:</span>
              <span className="value">{estudiante.email}</span>
            </div>
            <div className="info-row">
              <span className="label"><Phone size={16} /> Teléfono:</span>
              <span className="value">{estudiante.telefono}</span>
            </div>
            {estudiante.direccion && (
              <div className="info-row">
                <span className="label"><MapPin size={16} /> Dirección:</span>
                <span className="value">{estudiante.direccion}</span>
              </div>
            )}
            {estudiante.ciudad && (
              <div className="info-row">
                <span className="label">Ciudad:</span>
                <span className="value">{estudiante.ciudad}</span>
              </div>
            )}
            {estudiante.barrio && (
              <div className="info-row">
                <span className="label">Barrio:</span>
                <span className="value">{estudiante.barrio}</span>
              </div>
            )}
            {estudiante.tipo_sangre && (
              <div className="info-row">
                <span className="label">Tipo de Sangre:</span>
                <span className="value">{estudiante.tipo_sangre}</span>
              </div>
            )}
            {estudiante.eps && (
              <div className="info-row">
                <span className="label">EPS:</span>
                <span className="value">{estudiante.eps}</span>
              </div>
            )}
          </div>
        </div>

        {/* Información Académica */}
        {estudiante.categoria && (
          <div className="detalle-card">
            <h2><FileText size={20} /> Información Académica</h2>
            {estudiante.servicios && estudiante.servicios.length > 0 && (
              <div className="form-group">
                <label>Ver servicio</label>
                <select
                  value={servicioVistaId ?? ''}
                  onChange={(e) => setServicioVistaId(Number(e.target.value))}
                >
                  {estudiante.servicios.map((s) => (
                    <option key={s.id} value={s.id}>
                      Servicio {s.id} {s.estado ? `(${s.estado})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="info-rows">
              <div className="info-row">
                <span className="label">Servicio:</span>
                <span className="value badge-categoria">
                  {servicioVista ? getServicioLabel(servicioVista.tipo_servicio) : getServicioActualLabel()}
                </span>
              </div>
              <div className="info-row">
                <span className="label">Fecha de Inscripción:</span>
                <span className="value">
                  {formatearFechaCorta(servicioVista?.fecha_inicio || estudiante.fecha_inscripcion)}
                </span>
              </div>
              <div className="info-row">
                <span className="label">Horas Teóricas:</span>
                <span className="value">
                  {resolverValor(servicioVista?.horas_teoricas_completadas, estudiante.horas_teoricas_completadas)} / {resolverValor(servicioVista?.horas_teoricas_requeridas, estudiante.horas_teoricas_requeridas)}
                </span>
              </div>
              <div className="progreso-bar">
                {(() => {
                  const teoricasCompletadas = resolverValor(servicioVista?.horas_teoricas_completadas, estudiante.horas_teoricas_completadas);
                  const teoricasRequeridas = resolverValor(servicioVista?.horas_teoricas_requeridas, estudiante.horas_teoricas_requeridas);
                  const progreso = getProgreso(teoricasCompletadas, teoricasRequeridas);
                  return (
                    <>
                      <div className="progreso-fill" style={{ width: `${progreso}%` }}></div>
                      <span className="progreso-text">{progreso.toFixed(0)}%</span>
                    </>
                  );
                })()}
              </div>
              <div className="info-row">
                <span className="label">Horas Prácticas:</span>
                <span className="value">
                  {resolverValor(servicioVista?.horas_practicas_completadas, estudiante.horas_practicas_completadas)} / {resolverValor(servicioVista?.horas_practicas_requeridas, estudiante.horas_practicas_requeridas)}
                </span>
              </div>
              <div className="progreso-bar">
                {(() => {
                  const practicasCompletadas = resolverValor(servicioVista?.horas_practicas_completadas, estudiante.horas_practicas_completadas);
                  const practicasRequeridas = resolverValor(servicioVista?.horas_practicas_requeridas, estudiante.horas_practicas_requeridas);
                  const progreso = getProgreso(practicasCompletadas, practicasRequeridas);
                  return (
                    <>
                      <div className="progreso-fill progreso-practica" style={{ width: `${progreso}%` }}></div>
                      <span className="progreso-text">{progreso.toFixed(0)}%</span>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="acciones-academicas acciones-academicas-row">
              {['LICENCIA_A2', 'LICENCIA_B1', 'LICENCIA_C1'].includes(estudiante.tipo_servicio || '') && (
                <button className="btn-ampliar btn-ampliar-primary" onClick={abrirAmpliarServicio}>
                  <PlusCircle size={18} /> Ampliar servicio a combo
                </button>
              )}
              <button className="btn-ampliar btn-ampliar-secondary" onClick={abrirCorregirServicio}>
                <AlertCircle size={18} /> Corregir servicio
              </button>
            </div>

            {estudiante.servicios && estudiante.servicios.length > 0 && (
              <div className="servicios-historial">
                <h3 className="historial-title">Historial de servicios</h3>
                <div className="servicios-lista">
                  {estudiante.servicios.map((serv) => (
                    <div key={serv.id} className="servicio-item">
                      <div className="servicio-header">
                        <span className="servicio-titulo">
                          Servicio {serv.id} • {getServicioLabel(serv.tipo_servicio)}
                        </span>
                        <span className={`servicio-estado ${serv.estado === 'ACTIVO' ? 'activo' : ''}`}>
                          {serv.estado || 'FINALIZADO'}
                        </span>
                      </div>
                      <div className="servicio-detalles">
                        <span>Inicio: {formatearFechaCorta(serv.fecha_inicio)}</span>
                        <span>Fin: {formatearFechaCorta(serv.fecha_fin)}</span>
                      </div>
                      <div className="servicio-detalles">
                        <span>
                          Teóricas: {serv.horas_teoricas_completadas ?? 0}/{serv.horas_teoricas_requeridas ?? 0}
                        </span>
                        <span>
                          Prácticas: {serv.horas_practicas_completadas ?? 0}/{serv.horas_practicas_requeridas ?? 0}
                        </span>
                      </div>
                      <div className="servicio-detalles">
                        <span>Valor: {formatearMoneda(serv.valor_total_curso || 0)}</span>
                        <span>Saldo: {formatearMoneda(serv.saldo_pendiente || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Información Financiera */}
        {estudiante.valor_total_curso && (
          <div className="detalle-card">
            <h2><DollarSign size={20} /> Información Financiera</h2>
            <div className="info-rows">
              <div className="info-row">
                <span className="label">Valor Total del Curso:</span>
                <span className="value">{formatearMoneda(estudiante.valor_total_curso)}</span>
              </div>
              <div className="info-row">
                <span className="label">Saldo Pendiente:</span>
                <span className="value saldo-pendiente">{formatearMoneda(estudiante.saldo_pendiente)}</span>
              </div>
              <div className="info-row">
                <span className="label">Pagado:</span>
                <span className="value">{formatearMoneda((estudiante.valor_total_curso || 0) - (estudiante.saldo_pendiente || 0))}</span>
              </div>
            </div>
            
            {/* Historial de Pagos */}
            {estudiante.historial_pagos && estudiante.historial_pagos.length > 0 && (
              <div className="historial-pagos-section">
                <h3 className="historial-title">Historial de Pagos</h3>
                <div className="historial-lista">
                  {estudiante.historial_pagos.map((pago) => (
                    <div key={pago.id} className="pago-item">
                      <div className="pago-header">
                        <span className="pago-fecha">
                          <Calendar size={14} />
                          {new Date(pago.fecha_pago).toLocaleDateString('es-CO', { 
                            day: '2-digit', 
                            month: '2-digit', 
                            year: 'numeric' 
                          })}
                        </span>
                        <span className="pago-monto">{formatearMoneda(pago.monto)}</span>
                      </div>
                      
                      {!pago.es_pago_mixto ? (
                        // Pago Simple
                        <div className="pago-metodo-simple">
                          <span className="badge-metodo">{pago.metodo_pago}</span>
                        </div>
                      ) : (
                        // Pago Mixto
                        <div className="pago-mixto-desglose">
                          <span className="mixto-label">Pago Mixto:</span>
                          {pago.detalles_pago.map((detalle, idx) => (
                            <div key={idx} className="detalle-item">
                              <span className="detalle-metodo">{detalle.metodo_pago}</span>
                              <span className="detalle-monto">{formatearMoneda(detalle.monto)}</span>
                              {detalle.referencia && (
                                <span className="detalle-ref">Ref: {detalle.referencia}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <button
              className="btn-pago"
              onClick={() => navigate(`/caja?cedula=${encodeURIComponent(estudiante.cedula)}`)}
            >
              <DollarSign size={18} /> Registrar Pago
            </button>
          </div>
        )}

        {/* Contacto de Emergencia */}
        {estudiante.contacto_emergencia_nombre && (
          <div className="detalle-card">
            <h2><AlertCircle size={20} /> Contacto de Emergencia</h2>
            <div className="info-rows">
              <div className="info-row">
                <span className="label">Nombre:</span>
                <span className="value">{estudiante.contacto_emergencia_nombre}</span>
              </div>
              <div className="info-row">
                <span className="label">Teléfono:</span>
                <span className="value">{estudiante.contacto_emergencia_telefono}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
