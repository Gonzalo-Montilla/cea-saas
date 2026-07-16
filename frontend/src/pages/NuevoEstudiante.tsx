import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { estudiantesAPI } from '../services/api';
import { Camera, RotateCcw, Check, UserPlus, Search } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { parseApiError } from '../utils/errors';
import '../styles/NuevoEstudiante.css';

type CedulaLookupPayload = {
  success: boolean;
  documento: string;
  fuente: string;
  sugerido: {
    primer_nombre?: string;
    segundo_nombre?: string;
    primer_apellido?: string;
    segundo_apellido?: string;
    nombre_completo?: string;
    fecha_nacimiento?: string;
    direccion?: string;
    ciudad?: string;
    telefono?: string;
    email?: string;
  };
};

export const NuevoEstudiante = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [otpSessionToken, setOtpSessionToken] = useState('');
  const [otpMaskedEmail, setOtpMaskedEmail] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpTimeLeft, setOtpTimeLeft] = useState(0);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpWarning, setOtpWarning] = useState('');
  const [otpDebugCode, setOtpDebugCode] = useState('');
  const [otpDeliveryStatus, setOtpDeliveryStatus] = useState<'sent' | 'fallback' | ''>('');
  const [otpCodeCopied, setOtpCodeCopied] = useState(false);
  const [otpCancelConfirmOpen, setOtpCancelConfirmOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [consultandoCedula, setConsultandoCedula] = useState(false);
  const [cedulaLookupMessage, setCedulaLookupMessage] = useState('');
  const [cedulaLookupSource, setCedulaLookupSource] = useState('');
  const [cedulaLookupPending, setCedulaLookupPending] = useState<CedulaLookupPayload | null>(null);
  const [showCedulaMergeModal, setShowCedulaMergeModal] = useState(false);
  const [resultModal, setResultModal] = useState<null | {
    kind: 'success' | 'warning';
    title: string;
    message: string;
  }>(null);
  const [aceptaHabeas, setAceptaHabeas] = useState(false);
  const MAX_IMAGE_SIZE_MB = 2;
  const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
  const MAX_BASE64_LENGTH = 3_000_000;

  // Datos personales
  const [primerNombre, setPrimerNombre] = useState('');
  const [segundoNombre, setSegundoNombre] = useState('');
  const [primerApellido, setPrimerApellido] = useState('');
  const [segundoApellido, setSegundoApellido] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState('CEDULA');
  const [cedula, setCedula] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [barrio, setBarrio] = useState('');
  const [tipoSangre, setTipoSangre] = useState('');
  const [eps, setEps] = useState('');
  const [ocupacion, setOcupacion] = useState('');
  const [estadoCivil, setEstadoCivil] = useState('');
  const [nivelEducativo, setNivelEducativo] = useState('');
  const [estrato, setEstrato] = useState('');
  const [nivelSisben, setNivelSisben] = useState('');
  const [necesidadesEspeciales, setNecesidadesEspeciales] = useState('');
  const ocupacionesDisponibles = [
    { value: 'EMPLEADO', label: 'Empleado' },
    { value: 'INDEPENDIENTE', label: 'Independiente' },
    { value: 'PENSIONADO', label: 'Pensionado' },
    { value: 'ESTUDIANTE', label: 'Estudiante' },
    { value: 'HOGAR', label: 'Hogar' },
    { value: 'OTRO', label: 'Otro' },
  ];
  
  // Contacto de emergencia
  const [contactoEmergenciaNombre, setContactoEmergenciaNombre] = useState('');
  const [contactoEmergenciaTelefono, setContactoEmergenciaTelefono] = useState('');
  
  // Captura de foto
  const [fotoCapturada, setFotoCapturada] = useState<string | null>(null);
  const [mostrarWebcam, setMostrarWebcam] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Verificar que sea una imagen
    if (!file.type.startsWith('image/')) {
      setError('Por favor selecciona un archivo de imagen válido');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError(`La imagen no debe superar ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }
    
    // Convertir a base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      if (base64String.length > MAX_BASE64_LENGTH) {
        setError('La imagen es demasiado grande. Usa una más liviana.');
        return;
      }
      console.log('Foto cargada, tamaño:', base64String.length, 'caracteres');
      setFotoCapturada(base64String);
    };
    reader.onerror = () => {
      setError('No se pudo leer la imagen.');
    };
    reader.readAsDataURL(file);
  };
  
  const abrirArchivo = () => {
    fileInputRef.current?.click();
  };
  
  const iniciarWebcam = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 } 
      });
      streamRef.current = stream;
      setMostrarWebcam(true);
      
      // Esperar un poco antes de asignar el stream
      setTimeout(() => {
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (error) {
      console.error('Error al acceder a la cámara:', error);
      setError('No se pudo acceder a la webcam. Verifica los permisos.');
      setMostrarWebcam(false);
    }
  };
  
  const capturarFoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imagenBase64 = canvas.toDataURL('image/jpeg', 0.75);
        if (imagenBase64.length > MAX_BASE64_LENGTH) {
          setError('La imagen es demasiado grande. Intenta nuevamente.');
          return;
        }
        setFotoCapturada(imagenBase64);
        detenerWebcam();
      }
    }
  };
  
  const detenerWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setMostrarWebcam(false);
  };
  
  const recapturarFoto = () => {
    setFotoCapturada(null);
    // Limpiar el input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const soloDigitos = (value?: string | null) => String(value || '').replace(/\D/g, '');
  const formatDocumento = (value: string) => {
    if (tipoDocumento === 'PASAPORTE') {
      return value.toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 20);
    }
    return soloDigitos(value);
  };

  const sanitizeUpper = (value?: string | null) => String(value || '').trim().toUpperCase();
  const sanitizeLower = (value?: string | null) => String(value || '').trim().toLowerCase();

  const hasDatosPersonalesDigitados = () =>
    Boolean(
      primerNombre ||
      segundoNombre ||
      primerApellido ||
      segundoApellido ||
      fechaNacimiento ||
      email ||
      telefono ||
      direccion ||
      ciudad
    );

  const applyLookupData = (payload: CedulaLookupPayload, mode: 'empty_only' | 'replace_all') => {
    const sugerido = payload.sugerido || {};
    const resolveValue = (current: string, incoming?: string, sanitizer?: (value?: string | null) => string) => {
      const normalizedIncoming = sanitizer ? sanitizer(incoming) : String(incoming || '').trim();
      if (!normalizedIncoming) return current;
      if (mode === 'replace_all') return normalizedIncoming;
      return current.trim() ? current : normalizedIncoming;
    };

    setPrimerNombre((prev) => resolveValue(prev, sugerido.primer_nombre, sanitizeUpper));
    setSegundoNombre((prev) => resolveValue(prev, sugerido.segundo_nombre, sanitizeUpper));
    setPrimerApellido((prev) => resolveValue(prev, sugerido.primer_apellido, sanitizeUpper));
    setSegundoApellido((prev) => resolveValue(prev, sugerido.segundo_apellido, sanitizeUpper));
    setFechaNacimiento((prev) => resolveValue(prev, sugerido.fecha_nacimiento));
    setEmail((prev) => resolveValue(prev, sugerido.email, sanitizeLower));
    setTelefono((prev) => resolveValue(prev, sugerido.telefono, soloDigitos));
    setDireccion((prev) => resolveValue(prev, sugerido.direccion, sanitizeUpper));
    setCiudad((prev) => resolveValue(prev, sugerido.ciudad, sanitizeUpper));

    setCedulaLookupSource(String(payload.fuente || '').trim().toLowerCase());
    setCedulaLookupMessage(
      mode === 'replace_all'
        ? 'Se actualizaron los campos con la consulta externa. Verifica los datos con el cliente antes de guardar.'
        : 'Se completaron los campos vacíos con datos externos. Puedes editarlos si el cliente reporta cambios.'
    );
  };

  const handleConsultarCedula = async () => {
    setError('');
    setCedulaLookupMessage('');
    const documento = formatDocumento(cedula);
    if (tipoDocumento !== 'CEDULA') {
      setError('La consulta externa está disponible solo para cédula de ciudadanía.');
      return;
    }
    if (!documento || documento.length < 5) {
      setError('Ingresa una cédula válida antes de consultar.');
      return;
    }
    try {
      setConsultandoCedula(true);
      const lookup = await estudiantesAPI.lookupDatosPorCedula(documento);
      const sugerido = lookup?.sugerido || {};
      const hasSugerido = Boolean(
        sugerido.primer_nombre ||
        sugerido.segundo_nombre ||
        sugerido.primer_apellido ||
        sugerido.segundo_apellido ||
        sugerido.fecha_nacimiento ||
        sugerido.telefono ||
        sugerido.direccion ||
        sugerido.ciudad ||
        sugerido.email
      );
      if (!hasSugerido) {
        setCedulaLookupMessage('La consulta no devolvió datos aprovechables para autollenado.');
        setCedulaLookupSource(String(lookup?.fuente || '').trim().toLowerCase());
        return;
      }
      if (hasDatosPersonalesDigitados()) {
        setCedulaLookupPending(lookup);
        setShowCedulaMergeModal(true);
        return;
      }
      applyLookupData(lookup, 'replace_all');
    } catch (err: any) {
      setError(parseApiError(err, 'No se pudo consultar la cédula en este momento.'));
    } finally {
      setConsultandoCedula(false);
    }
  };

  useEffect(() => {
    return () => {
      detenerWebcam();
    };
  }, []);

  useEffect(() => {
    if (!otpSessionToken || !otpExpiresAt) return;
    const interval = window.setInterval(() => {
      const expiresAtMs = new Date(otpExpiresAt).getTime();
      const diffSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setOtpTimeLeft(diffSeconds);
      setOtpResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [otpSessionToken, otpExpiresAt]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validar que la foto esté capturada
    if (!fotoCapturada) {
      setError('Debe capturar la fotografía del estudiante');
      return;
    }
    
    const cedulaLimpia = formatDocumento(cedula);
    const telefonoLimpio = soloDigitos(telefono);
    const telefonoEmergenciaLimpio = soloDigitos(contactoEmergenciaTelefono);

    if (cedula && cedula !== cedulaLimpia) {
      setError(tipoDocumento === 'PASAPORTE'
        ? 'El pasaporte solo debe contener letras, números o guiones'
        : 'El documento solo debe contener números');
      return;
    }
    if (cedulaLimpia.length < 5 || cedulaLimpia.length > 20) {
      setError(tipoDocumento === 'PASAPORTE'
        ? 'El pasaporte debe tener entre 5 y 20 caracteres'
        : 'El documento debe tener entre 5 y 20 dígitos');
      return;
    }
    if (telefono && telefono !== telefonoLimpio) {
      setError('El teléfono solo debe contener números');
      return;
    }
    if (telefonoLimpio.length < 7 || telefonoLimpio.length > 15) {
      setError('El teléfono debe tener entre 7 y 15 dígitos');
      return;
    }
    if (contactoEmergenciaTelefono && contactoEmergenciaTelefono !== telefonoEmergenciaLimpio) {
      setError('El teléfono de emergencia solo debe contener números');
      return;
    }
    if (fotoCapturada.length > MAX_BASE64_LENGTH) {
      setError('La imagen es demasiado grande. Usa una más liviana.');
      return;
    }
    if (!aceptaHabeas) {
      setError('Debes aceptar el tratamiento de datos personales');
      return;
    }

    setIsLoading(true);

    try {
      // Preparar datos para enviar
      const estudianteData = {
        // Datos de usuario
        email: email.trim(),
        password: cedulaLimpia, // Usar documento como contraseña inicial
        primer_nombre: primerNombre.trim(),
        segundo_nombre: segundoNombre.trim() || null,
        primer_apellido: primerApellido.trim(),
        segundo_apellido: segundoApellido.trim() || null,
        cedula: cedulaLimpia,
        tipo_documento: tipoDocumento,
        telefono: telefonoLimpio,
        
        // Datos personales
        fecha_nacimiento: fechaNacimiento,
        direccion: direccion || null,
        ciudad: ciudad || null,
        barrio: barrio || null,
        tipo_sangre: tipoSangre || null,
        eps: eps || null,
        ocupacion: ocupacion || null,
        estado_civil: estadoCivil || null,
        nivel_educativo: nivelEducativo || null,
        estrato: estrato ? parseInt(estrato) : null,
        nivel_sisben: nivelSisben || null,
        necesidades_especiales: necesidadesEspeciales || null,
        
        // Contacto de emergencia
        contacto_emergencia_nombre: contactoEmergenciaNombre.trim() || null,
        contacto_emergencia_telefono: telefonoEmergenciaLimpio || null,
        
        // Foto en base64
        foto_base64: fotoCapturada,
        autorizacion_tratamiento: aceptaHabeas
      };

      const otpInit = await estudiantesAPI.startOtp(estudianteData);
      setOtpSessionToken(otpInit.session_token);
      setOtpMaskedEmail(otpInit.email || email.trim());
      setOtpExpiresAt(otpInit.expires_at);
      setOtpCode('');
      setOtpError('');
      setOtpWarning(otpInit.warning_message || '');
      setOtpDebugCode(otpInit.debug_otp_code || '');
      setOtpDeliveryStatus(otpInit.otp_sent ? 'sent' : 'fallback');
      setOtpTimeLeft(Math.max(0, Math.floor((new Date(otpInit.expires_at).getTime() - Date.now()) / 1000)));
      setOtpResendCooldown(Number(otpInit.cooldown_seconds || 60));
    } catch (err: any) {
      console.error('Error al registrar estudiante:', err);
      const statusCode = Number(err?.response?.status || 0);
      if (statusCode === 401) {
        setError('Tu sesión expiró. Inicia sesión nuevamente para continuar.');
      } else if (statusCode === 503) {
        setError('No se pudo enviar OTP por correo en este momento. Intenta de nuevo en unos segundos.');
      } else if (statusCode === 422 && Array.isArray(err.response?.data?.detail)) {
        const errores = err.response.data.detail;
        const mensajesError = errores.map((e: any) => {
          const campo = e.loc ? e.loc.join('.') : 'desconocido';
          return `${campo}: ${e.msg}`;
        }).join(', ');
        setError(`Errores de validación: ${mensajesError}`);
      } else {
        setError(parseApiError(err, 'No se pudo iniciar la validación OTP'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const closeOtpModal = () => {
    if (otpBusy) return;
    if (otpSessionToken) {
      setOtpCancelConfirmOpen(true);
      return;
    }
    closeOtpModalConfirmed();
  };

  const closeOtpModalConfirmed = () => {
    setOtpSessionToken('');
    setOtpMaskedEmail('');
    setOtpExpiresAt(null);
    setOtpCode('');
    setOtpError('');
    setOtpWarning('');
    setOtpDebugCode('');
    setOtpDeliveryStatus('');
    setOtpCodeCopied(false);
    setOtpTimeLeft(0);
    setOtpResendCooldown(0);
    setOtpCancelConfirmOpen(false);
  };

  const copyLocalOtpCode = async () => {
    if (!otpDebugCode) return;
    try {
      await navigator.clipboard.writeText(otpDebugCode);
      setOtpCodeCopied(true);
      setTimeout(() => setOtpCodeCopied(false), 2000);
    } catch {
      // No-op: código visible para copia manual.
    }
  };

  const closeResultModal = () => setResultModal(null);

  const resetFormulario = () => {
    setPrimerNombre('');
    setSegundoNombre('');
    setPrimerApellido('');
    setSegundoApellido('');
    setTipoDocumento('CEDULA');
    setCedula('');
    setFechaNacimiento('');
    setEmail('');
    setTelefono('');
    setDireccion('');
    setCiudad('');
    setBarrio('');
    setTipoSangre('');
    setEps('');
    setOcupacion('');
    setEstadoCivil('');
    setNivelEducativo('');
    setEstrato('');
    setNivelSisben('');
    setNecesidadesEspeciales('');
    setContactoEmergenciaNombre('');
    setContactoEmergenciaTelefono('');
    setFotoCapturada(null);
    setMostrarWebcam(false);
    setCedulaLookupMessage('');
    setCedulaLookupSource('');
    setCedulaLookupPending(null);
    setShowCedulaMergeModal(false);
    setError('');
    setOtpError('');
    setOtpWarning('');
    setOtpDebugCode('');
    setOtpDeliveryStatus('');
    setOtpCodeCopied(false);
    setOtpCode('');
    setOtpSessionToken('');
    setOtpMaskedEmail('');
    setOtpExpiresAt(null);
    setOtpTimeLeft(0);
    setOtpResendCooldown(0);
    setOtpCancelConfirmOpen(false);
    setAceptaHabeas(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const scrollToTopForm = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tieneCambiosSinGuardar = () =>
    Boolean(
      primerNombre ||
      segundoNombre ||
      primerApellido ||
      segundoApellido ||
      cedula ||
      fechaNacimiento ||
      email ||
      telefono ||
      direccion ||
      ciudad ||
      barrio ||
      tipoSangre ||
      eps ||
      ocupacion ||
      estadoCivil ||
      nivelEducativo ||
      estrato ||
      nivelSisben ||
      necesidadesEspeciales ||
      contactoEmergenciaNombre ||
      contactoEmergenciaTelefono ||
      fotoCapturada
    );

  const handleVerifyOtp = async () => {
    const otp = otpCode.trim();
    if (!/^\d{6}$/.test(otp)) {
      setOtpError('Ingresa un código OTP válido de 6 dígitos.');
      return;
    }
    if (!otpSessionToken) return;
    try {
      setOtpBusy(true);
      setOtpError('');
      const result = await estudiantesAPI.verifyOtpAndCreate(otpSessionToken, otp);
      const estudiante = result?.estudiante;
      const matricula = estudiante?.matricula_numero || 'N/A';
      const correoMsg = result?.habeas_email_sent
        ? 'Se envió la confirmación de Habeas Data con el PDF firmado adjunto.'
        : 'Estudiante creado, pero no se pudo enviar el correo de Habeas Data con PDF adjunto.';
      closeOtpModalConfirmed();
      resetFormulario();
      scrollToTopForm();
      setResultModal({
        kind: result?.habeas_email_sent ? 'success' : 'warning',
        title: result?.habeas_email_sent ? 'Registro completado' : 'Registro completado con advertencia',
        message: `Matrícula: ${matricula}.\n${correoMsg}`,
      });
    } catch (err: any) {
      setOtpError(parseApiError(err, 'No se pudo validar el OTP'));
    } finally {
      setOtpBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpSessionToken || otpResendCooldown > 0) return;
    try {
      setOtpBusy(true);
      setOtpError('');
      const result = await estudiantesAPI.resendOtp(otpSessionToken);
      setOtpExpiresAt(result.expires_at);
      setOtpMaskedEmail(result.email || otpMaskedEmail);
      setOtpResendCooldown(Number(result.cooldown_seconds || 60));
      setOtpTimeLeft(Math.max(0, Math.floor((new Date(result.expires_at).getTime() - Date.now()) / 1000)));
      setOtpWarning(result.warning_message || '');
      setOtpDebugCode(result.debug_otp_code || '');
      setOtpDeliveryStatus(result.otp_sent ? 'sent' : 'fallback');
      setOtpCodeCopied(false);
    } catch (err: any) {
      setOtpError(parseApiError(err, 'No se pudo reenviar el OTP'));
    } finally {
      setOtpBusy(false);
    }
  };

  const cedulaActual = formatDocumento(cedula);
  const identificacionCompleta =
    tipoDocumento === 'PASAPORTE'
      ? cedulaActual.length >= 5 && cedulaActual.length <= 20
      : /^\d{5,20}$/.test(cedulaActual);
  const telefonoPrincipalValido = /^\d{7,15}$/.test(soloDigitos(telefono));
  const emailValido = /^\S+@\S+\.\S+$/.test(email.trim());
  const infoPersonalCompleta = Boolean(
    primerNombre.trim() &&
    primerApellido.trim() &&
    fechaNacimiento &&
    emailValido &&
    telefonoPrincipalValido
  );
  const fotoCompleta = Boolean(fotoCapturada);

  const emergenciaNombre = contactoEmergenciaNombre.trim();
  const emergenciaTelefono = soloDigitos(contactoEmergenciaTelefono);
  const emergenciaVacia = !emergenciaNombre && !emergenciaTelefono;
  const emergenciaCompleta = Boolean(emergenciaNombre && /^\d{7,15}$/.test(emergenciaTelefono));
  const emergenciaEstado: 'completo' | 'pendiente' | 'opcional' = emergenciaVacia
    ? 'opcional'
    : emergenciaCompleta
      ? 'completo'
      : 'pendiente';

  const estadoBloque = (estado: 'completo' | 'pendiente' | 'opcional') => {
    if (estado === 'completo') return { text: 'Completo', className: 'block-status-complete' };
    if (estado === 'opcional') return { text: 'Opcional', className: 'block-status-optional' };
    return { text: 'Pendiente', className: 'block-status-pending' };
  };

  return (
    <div className="nuevo-estudiante-container">
      <PageHeader
        title="Registro de Nuevo Estudiante"
        subtitle="Complete todos los datos del estudiante"
        icon={<UserPlus size={20} />}
      />

      <form onSubmit={handleSubmit} className="estudiante-form">
        {/* Fotografía del Estudiante */}
        <div className="form-section form-section-photo">
          <div className="section-title-row">
            <h2>Fotografía del Estudiante *</h2>
            <span className={`block-status ${estadoBloque(fotoCompleta ? 'completo' : 'pendiente').className}`}>
              {estadoBloque(fotoCompleta ? 'completo' : 'pendiente').text}
            </span>
          </div>
          <div className="foto-section">
            {!fotoCapturada && !mostrarWebcam ? (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <button type="button" className="btn-camera" onClick={iniciarWebcam}>
                  <Camera size={18} /> Tomar Foto
                </button>
                <button type="button" className="btn-camera btn-secondary" onClick={abrirArchivo}>
                  Subir Archivo
                </button>
              </div>
            ) : mostrarWebcam ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline
                  style={{ 
                    width: '100%', 
                    maxWidth: '500px', 
                    borderRadius: '12px',
                    transform: 'scaleX(-1)'
                  }}
                />
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className="btn-camera"
                    onClick={capturarFoto}
                  >
                    <Camera size={20} /> Capturar
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={detenerWebcam}
                  >
                    Cancelar
                  </button>
                </div>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
            ) : (
              <div className="foto-preview">
                <img src={fotoCapturada || undefined} alt="Foto del estudiante" />
                <div className="foto-actions">
                  <button
                    type="button"
                    className="btn-recapture"
                    onClick={recapturarFoto}
                  >
                    <RotateCcw size={18} /> Cambiar Foto
                  </button>
                  <span className="foto-ok">
                    <Check size={18} /> Foto cargada
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Datos Personales */}
        <div className="form-section form-section-personal">
          <div className="section-title-row">
            <h2>Datos Personales</h2>
            <span
              className={`block-status ${
                estadoBloque(identificacionCompleta && infoPersonalCompleta ? 'completo' : 'pendiente').className
              }`}
            >
              {estadoBloque(identificacionCompleta && infoPersonalCompleta ? 'completo' : 'pendiente').text}
            </span>
          </div>
          <div className="datos-panel datos-panel-lookup">
            <div className="datos-panel-header">
              <span className="panel-step">1</span>
              <div>
                <h3>Identificación y consulta</h3>
                <p>Ingresa el documento y consulta datos para acelerar el registro.</p>
              </div>
              <span
                className={`block-status block-status-inline ${
                  estadoBloque(identificacionCompleta ? 'completo' : 'pendiente').className
                }`}
              >
                {estadoBloque(identificacionCompleta ? 'completo' : 'pendiente').text}
              </span>
            </div>
            <div className="documento-lookup-grid">
              <div className="form-group">
                <label htmlFor="tipoDocumento">Tipo de Documento *</label>
                <select
                  id="tipoDocumento"
                  value={tipoDocumento}
                  onChange={(e) => {
                    setTipoDocumento(e.target.value);
                    setCedula('');
                    setCedulaLookupMessage('');
                    setCedulaLookupSource('');
                    setCedulaLookupPending(null);
                  }}
                  required
                >
                  <option value="CEDULA">Cédula</option>
                  <option value="TARJETA_IDENTIDAD">Tarjeta de Identidad</option>
                  <option value="PASAPORTE">Pasaporte</option>
                  <option value="CEDULA_EXTRANJERIA">Cédula de Extranjería</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="cedula">Número de Documento *</label>
                <div className="cedula-lookup-row">
                  <input
                    id="cedula"
                    type="text"
                    value={cedula}
                    onChange={(e) => {
                      setCedula(formatDocumento(e.target.value));
                      if (cedulaLookupMessage) setCedulaLookupMessage('');
                      if (cedulaLookupSource) setCedulaLookupSource('');
                    }}
                    required
                    inputMode={tipoDocumento === 'PASAPORTE' ? 'text' : 'numeric'}
                    pattern={tipoDocumento === 'PASAPORTE' ? undefined : '[0-9]*'}
                    maxLength={20}
                  />
                  <button
                    type="button"
                    className="btn-secondary cedula-lookup-button"
                    onClick={() => void handleConsultarCedula()}
                    disabled={
                      consultandoCedula ||
                      tipoDocumento !== 'CEDULA' ||
                      !formatDocumento(cedula) ||
                      isLoading
                    }
                  >
                    <Search size={16} />
                    {consultandoCedula ? 'Consultando...' : 'Consultar cédula'}
                  </button>
                </div>
                <small className="cedula-lookup-help">
                  Esta consulta es opcional y no bloquea el registro. Siempre puedes editar los datos.
                </small>
              </div>
            </div>
          </div>

          {cedulaLookupMessage && (
            <div className="cedula-lookup-banner" role="status" aria-live="polite">
              <span className="cedula-lookup-pill">Autocompletado</span>
              {cedulaLookupMessage}
              {cedulaLookupSource && (
                <span className="cedula-lookup-source"> Fuente: {cedulaLookupSource}.</span>
              )}
            </div>
          )}
          <div className="datos-panel datos-panel-main">
            <div className="datos-panel-header">
              <span className="panel-step">2</span>
              <div>
                <h3>Información personal</h3>
                <p>Confirma con el cliente y ajusta cualquier dato desactualizado.</p>
              </div>
              <span
                className={`block-status block-status-inline ${
                  estadoBloque(infoPersonalCompleta ? 'completo' : 'pendiente').className
                }`}
              >
                {estadoBloque(infoPersonalCompleta ? 'completo' : 'pendiente').text}
              </span>
            </div>
            <div className="form-grid">
            <div className="form-group">
              <label htmlFor="primerNombre">Primer Nombre *</label>
              <input
                id="primerNombre"
                type="text"
                value={primerNombre}
                onChange={(e) => setPrimerNombre(e.target.value.toUpperCase())}
                required
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="segundoNombre">Segundo Nombre</label>
              <input
                id="segundoNombre"
                type="text"
                value={segundoNombre}
                onChange={(e) => setSegundoNombre(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="primerApellido">Primer Apellido *</label>
              <input
                id="primerApellido"
                type="text"
                value={primerApellido}
                onChange={(e) => setPrimerApellido(e.target.value.toUpperCase())}
                required
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="segundoApellido">Segundo Apellido</label>
              <input
                id="segundoApellido"
                type="text"
                value={segundoApellido}
                onChange={(e) => setSegundoApellido(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="fechaNacimiento">Fecha de Nacimiento *</label>
              <input
                id="fechaNacimiento"
                type="date"
                value={fechaNacimiento}
                onChange={(e) => setFechaNacimiento(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email *</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="telefono">Teléfono *</label>
              <input
                id="telefono"
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(soloDigitos(e.target.value))}
                required
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={15}
              />
            </div>

            <div className="form-group">
              <label htmlFor="tipoSangre">Tipo de Sangre</label>
              <select
                id="tipoSangre"
                value={tipoSangre}
                onChange={(e) => setTipoSangre(e.target.value)}
              >
                <option value="">Seleccione</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>

            <div className="form-group full-width">
              <label htmlFor="direccion">Dirección</label>
              <input
                id="direccion"
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="ciudad">Ciudad</label>
              <input
                id="ciudad"
                type="text"
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="barrio">Barrio</label>
              <input
                id="barrio"
                type="text"
                value={barrio}
                onChange={(e) => setBarrio(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="eps">EPS</label>
              <input
                id="eps"
                type="text"
                value={eps}
                onChange={(e) => setEps(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="ocupacion">Ocupación</label>
              <select
                id="ocupacion"
                value={ocupacion}
                onChange={(e) => setOcupacion(e.target.value)}
              >
                <option value="">Seleccione</option>
                {ocupacionesDisponibles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="estadoCivil">Estado Civil</label>
              <select
                id="estadoCivil"
                value={estadoCivil}
                onChange={(e) => setEstadoCivil(e.target.value)}
              >
                <option value="">Seleccione</option>
                <option value="SOLTERO">Soltero(a)</option>
                <option value="CASADO">Casado(a)</option>
                <option value="UNION_LIBRE">Unión Libre</option>
                <option value="DIVORCIADO">Divorciado(a)</option>
                <option value="VIUDO">Viudo(a)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="nivelEducativo">Nivel Educativo</label>
              <select
                id="nivelEducativo"
                value={nivelEducativo}
                onChange={(e) => setNivelEducativo(e.target.value)}
              >
                <option value="">Seleccione</option>
                <option value="SIN_ESTUDIO">Sin Estudio</option>
                <option value="BASICA_PRIMARIA">Básica Primaria</option>
                <option value="BASICA_SECUNDARIA">Básica Secundaria</option>
                <option value="TECNICA">Técnica</option>
                <option value="PREGRADO">Pregrado</option>
                <option value="POSTGRADO">Postgrado</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="estrato">Estrato</label>
              <select
                id="estrato"
                value={estrato}
                onChange={(e) => setEstrato(e.target.value)}
              >
                <option value="">Seleccione</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="nivelSisben">Nivel SISBEN</label>
              <input
                id="nivelSisben"
                type="text"
                value={nivelSisben}
                onChange={(e) => setNivelSisben(e.target.value.toUpperCase())}
                placeholder="Ej: A1, B2, C3"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group full-width">
              <label htmlFor="necesidadesEspeciales">Necesidades Especiales</label>
              <input
                id="necesidadesEspeciales"
                type="text"
                value={necesidadesEspeciales}
                onChange={(e) => setNecesidadesEspeciales(e.target.value.toUpperCase())}
                placeholder="Idioma, Discapacidad, Otra"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            </div>
          </div>
        </div>

        {/* Contacto de Emergencia */}
        <div className="form-section form-section-emergency">
          <div className="section-title-row">
            <h2>Contacto de Emergencia</h2>
            <span className={`block-status ${estadoBloque(emergenciaEstado).className}`}>
              {estadoBloque(emergenciaEstado).text}
            </span>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="contactoEmergenciaNombre">Nombre del Contacto</label>
              <input
                id="contactoEmergenciaNombre"
                type="text"
                value={contactoEmergenciaNombre}
                onChange={(e) => setContactoEmergenciaNombre(e.target.value.toUpperCase())}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="form-group">
              <label htmlFor="contactoEmergenciaTelefono">Teléfono del Contacto</label>
              <input
                id="contactoEmergenciaTelefono"
                type="tel"
                value={contactoEmergenciaTelefono}
                onChange={(e) => setContactoEmergenciaTelefono(soloDigitos(e.target.value))}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={15}
              />
            </div>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="habeas-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={aceptaHabeas}
              onChange={(e) => setAceptaHabeas(e.target.checked)}
            />
            Autorizo el tratamiento de mis datos personales conforme a la Ley 1581 de 2012.
          </label>
          <p className="habeas-text">
            Se enviará un correo con el aviso de privacidad y los canales para ejercer tus derechos.
          </p>
        </div>

        {/* Botones */}
        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (tieneCambiosSinGuardar()) {
                setShowExitConfirm(true);
                return;
              }
              navigate('/dashboard');
            }}
            disabled={isLoading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isLoading}
          >
            {isLoading ? 'Enviando OTP...' : 'Guardar y validar OTP'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showExitConfirm}
        title="Salir sin guardar"
        message="Hay cambios sin guardar. ¿Deseas salir de este formulario?"
        confirmText="Sí, salir"
        cancelText="Seguir editando"
        confirmVariant="danger"
        onCancel={() => setShowExitConfirm(false)}
        onConfirm={() => {
          setShowExitConfirm(false);
          navigate('/dashboard');
        }}
      />

      {showCedulaMergeModal && cedulaLookupPending && (
        <div className="otp-modal-backdrop" onClick={() => setShowCedulaMergeModal(false)}>
          <div className="otp-modal result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Datos encontrados por cédula</h3>
            <div className="otp-warning-box">
              Ya hay información digitada en el formulario.
              {'\n'}Confirma con el cliente cómo deseas aplicar los datos consultados.
            </div>
            <div className="form-actions otp-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  applyLookupData(cedulaLookupPending, 'empty_only');
                  setShowCedulaMergeModal(false);
                  setCedulaLookupPending(null);
                }}
              >
                Completar vacíos
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  applyLookupData(cedulaLookupPending, 'replace_all');
                  setShowCedulaMergeModal(false);
                  setCedulaLookupPending(null);
                }}
              >
                Reemplazar todo
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowCedulaMergeModal(false);
                  setCedulaLookupPending(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {otpSessionToken && (
        <div className="otp-modal-backdrop" onClick={closeOtpModal}>
          <div className="otp-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Validación OTP del estudiante</h3>
            <p>
              Se envió un código al correo <strong>{otpMaskedEmail}</strong>. Solicita el código y escríbelo aquí para completar el registro.
            </p>
            <div className="otp-meta">
              <span>Vence en: <strong>{Math.floor(otpTimeLeft / 60)}:{String(otpTimeLeft % 60).padStart(2, '0')}</strong></span>
              <span>Reenvío: <strong>{otpResendCooldown > 0 ? `${otpResendCooldown}s` : 'Disponible'}</strong></span>
            </div>
            {otpDeliveryStatus === 'sent' && (
              <div className="otp-success-box">
                Código OTP enviado correctamente al correo del estudiante.
              </div>
            )}
            {otpWarning && (
              <div className="otp-warning-box">
                {otpWarning}
                {otpDebugCode ? (
                  <>
                    {' '}Código local: <strong>{otpDebugCode}</strong>
                    {' '}
                    <button type="button" className="otp-copy-btn" onClick={() => void copyLocalOtpCode()}>
                      {otpCodeCopied ? 'Copiado' : 'Copiar código'}
                    </button>
                  </>
                ) : null}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="otpCode">Código OTP (6 dígitos)</label>
              <input
                id="otpCode"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(soloDigitos(e.target.value).slice(0, 6))}
                placeholder="Ej: 123456"
                disabled={otpBusy}
              />
            </div>
            {otpError && <div className="error-message">{otpError}</div>}
            <div className="form-actions otp-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeOtpModal} disabled={otpBusy}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleResendOtp}
                disabled={otpBusy || otpResendCooldown > 0}
              >
                {otpBusy ? 'Procesando...' : 'Reenviar OTP'}
              </button>
              <button type="button" className="btn-primary" onClick={handleVerifyOtp} disabled={otpBusy}>
                {otpBusy ? 'Validando...' : 'Validar y guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {otpCancelConfirmOpen && (
        <div className="otp-modal-backdrop" onClick={() => setOtpCancelConfirmOpen(false)}>
          <div className="otp-modal result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Cancelar validación OTP</h3>
            <div className="otp-warning-box">
              Tienes una validación OTP en curso.
              {'\n'}Si cancelas ahora, deberás solicitar un nuevo código para continuar.
            </div>
            <div className="form-actions otp-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setOtpCancelConfirmOpen(false)}>
                Continuar con la validación
              </button>
              <button type="button" className="btn-primary" onClick={closeOtpModalConfirmed}>
                Sí, cancelar validación OTP
              </button>
            </div>
          </div>
        </div>
      )}

      {resultModal && (
        <div className="otp-modal-backdrop" onClick={closeResultModal}>
          <div className="otp-modal result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{resultModal.title}</h3>
            <div className={resultModal.kind === 'success' ? 'otp-success-box' : 'otp-warning-box'}>
              {resultModal.message}
            </div>
            <div className="form-actions otp-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeResultModal}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => navigate('/dashboard')}>
                Ir al dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
