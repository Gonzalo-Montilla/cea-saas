import { useState, useEffect, useRef } from 'react';
import { X, User, Camera, RotateCcw, Check, Upload, FileText, AlertCircle, Award, ArrowRight, ArrowLeft } from 'lucide-react';
import { instructoresAPI, authAPI, usuariosAPI } from '../services/api';
import { ModalBase } from './ui/ModalBase';
import '../styles/InstructorForm.css';
import '../styles/InstructorFormExtras.css';

interface InstructorFormProps {
  instructor?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export const InstructorForm = ({ instructor, onClose, onSuccess }: InstructorFormProps) => {
  const [step, setStep] = useState(1); // 1 = Usuario, 2 = Foto, 3 = Datos Instructor, 4 = Documentos
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usarUsuarioExistente, setUsarUsuarioExistente] = useState(false);
  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [usuariosEncontrados, setUsuariosEncontrados] = useState<any[]>([]);
  const [buscandoUsuarios, setBuscandoUsuarios] = useState(false);

  // PASO 1: Datos del usuario
  const [nombreCompleto, setNombreCompleto] = useState('');
  const [cedula, setCedula] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');
  const [usuarioId, setUsuarioId] = useState<number | null>(null);
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState<any | null>(null);

  // PASO 2: Captura de foto
  const [fotoCapturada, setFotoCapturada] = useState<string | null>(null);
  const [mostrarWebcam, setMostrarWebcam] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // PASO 3: Datos del instructor
  const [licenciaNumero, setLicenciaNumero] = useState('');
  const [categoriasEnsena, setCategoriasEnsena] = useState<string[]>([]);
  const [especialidad, setEspecialidad] = useState('');
  const [estado, setEstado] = useState('ACTIVO');
  const [fechaContratacion, setFechaContratacion] = useState('');
  const [certificaciones, setCertificaciones] = useState('');
  const [tipoContrato, setTipoContrato] = useState('');
  const [numeroRunt, setNumeroRunt] = useState('');
  
  // Vigencias
  const [licenciaDesde, setLicenciaDesde] = useState('');
  const [licenciaHasta, setLicenciaHasta] = useState('');
  const [certificadoDesde, setCertificadoDesde] = useState('');
  const [certificadoHasta, setCertificadoHasta] = useState('');
  const [examenMedico, setExamenMedico] = useState('');

  // PASO 4: Documentos PDF
  const [cedulaPdf, setCedulaPdf] = useState<string | null>(null);
  const [licenciaPdf, setLicenciaPdf] = useState<string | null>(null);
  const [certificadoPdf, setCertificadoPdf] = useState<string | null>(null);
  const cedulaInputRef = useRef<HTMLInputElement>(null);
  const licenciaInputRef = useRef<HTMLInputElement>(null);
  const certificadoInputRef = useRef<HTMLInputElement>(null);

  const categorias_disponibles = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

  useEffect(() => {
    if (instructor) {
      // Modo edición - saltar creación de usuario
      setStep(2);
      setUsuarioId(instructor.usuario_id);
      setFotoCapturada(instructor.foto_url);
      setLicenciaNumero(instructor.licencia_numero || '');
      setCategoriasEnsena(instructor.categorias_enseña?.split(',') || []);
      setEspecialidad(instructor.especialidad || '');
      setEstado(instructor.estado || 'ACTIVO');
      setFechaContratacion(instructor.fecha_contratacion || '');
      setCertificaciones(instructor.certificaciones || '');
      setTipoContrato(instructor.tipo_contrato || '');
      setNumeroRunt(instructor.numero_runt || '');
      setLicenciaDesde(instructor.licencia_vigencia_desde || '');
      setLicenciaHasta(instructor.licencia_vigencia_hasta || '');
      setCertificadoDesde(instructor.certificado_vigencia_desde || '');
      setCertificadoHasta(instructor.certificado_vigencia_hasta || '');
      setExamenMedico(instructor.examen_medico_fecha || '');
      setCedulaPdf(instructor.cedula_pdf_url);
      setLicenciaPdf(instructor.licencia_pdf_url);
      setCertificadoPdf(instructor.certificado_pdf_url);
    }
  }, [instructor]);

  useEffect(() => {
    if (usuarioSeleccionado) {
      setNombreCompleto(usuarioSeleccionado.nombre_completo || '');
      setCedula(usuarioSeleccionado.cedula || '');
      setEmail(usuarioSeleccionado.email || '');
      setTelefono(usuarioSeleccionado.telefono || '');
    }
  }, [usuarioSeleccionado]);

  useEffect(() => {
    return () => {
      // Limpiar webcam al desmontar
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // ==================== FUNCIONES DE FOTO ====================
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      setError('Por favor selecciona un archivo de imagen válido');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setFotoCapturada(reader.result as string);
    };
    reader.readAsDataURL(file);
  };
  
  const iniciarWebcam = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 } 
      });
      streamRef.current = stream;
      setMostrarWebcam(true);
      
      setTimeout(() => {
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (error) {
      console.error('Error al acceder a la cámara:', error);
      setError('No se pudo acceder a la webcam. Verifica los permisos.');
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
        const imagenBase64 = canvas.toDataURL('image/jpeg', 0.85);
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ==================== FUNCIONES DE PDFs ====================
  
  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>, tipo: 'cedula' | 'licencia' | 'certificado') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.endsWith('.pdf')) {
      setError('Solo se permiten archivos PDF');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const pdfBase64 = reader.result as string;
      if (tipo === 'cedula') setCedulaPdf(pdfBase64);
      if (tipo === 'licencia') setLicenciaPdf(pdfBase64);
      if (tipo === 'certificado') setCertificadoPdf(pdfBase64);
    };
    reader.readAsDataURL(file);
  };

  const toggleCategoria = (cat: string) => {
    setCategoriasEnsena(prev => 
      prev.includes(cat) 
        ? prev.filter(c => c !== cat)
        : [...prev, cat]
    );
  };

  // ==================== HANDLERS DE PASOS ====================

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usarUsuarioExistente) {
      if (!usuarioSeleccionado) {
        setError('Selecciona un usuario existente');
        return;
      }
      setUsuarioId(usuarioSeleccionado.id);
      setStep(2);
      return;
    }

    if (!nombreCompleto || !cedula || !email || !password) {
      setError('Todos los campos son obligatorios');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const nuevoUsuario = await authAPI.register({
        email,
        password,
        nombre_completo: nombreCompleto,
        cedula,
        telefono: telefono || undefined,
        rol: 'INSTRUCTOR' as any
      });
      
      setUsuarioId(nuevoUsuario.id);
      setStep(2); // Ir a captura de foto
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo crear el usuario.');
    } finally {
      setLoading(false);
    }
  };

  const buscarUsuarios = async () => {
    if (!busquedaUsuario.trim()) {
      setUsuariosEncontrados([]);
      return;
    }
    try {
      setBuscandoUsuarios(true);
      const data = await usuariosAPI.getAll({ search: busquedaUsuario.trim() });
      setUsuariosEncontrados(data || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudieron buscar los usuarios.');
      setUsuariosEncontrados([]);
    } finally {
      setBuscandoUsuarios(false);
    }
  };

  const handleContinuarConFoto = () => {
    if (!fotoCapturada) {
      setError('Debe capturar la fotografía del instructor');
      return;
    }
    setError('');
    setStep(3); // Ir a datos del instructor
  };

  const handleGuardarDatosInstructor = () => {
    if (!licenciaNumero || categoriasEnsena.length === 0) {
      setError('Licencia y al menos una categoría son obligatorias');
      return;
    }
    setError('');
    setStep(4); // Ir a documentos
  };

  const handleCrearInstructor = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      setError('');
      if (!usuarioId) {
        setError('Debe seleccionar o crear un usuario para el instructor');
        return;
      }
      
      const instructorData = {
        usuario_id: usuarioId,
        licencia_numero: licenciaNumero,
        categorias_enseña: categoriasEnsena.join(','),
        especialidad: especialidad || null,
        estado,
        fecha_contratacion: fechaContratacion || null,
        certificaciones: certificaciones || null,
        tipo_contrato: tipoContrato || null,
        foto_url: fotoCapturada,
        numero_runt: numeroRunt || null,
        licencia_vigencia_desde: licenciaDesde || null,
        licencia_vigencia_hasta: licenciaHasta || null,
        certificado_vigencia_desde: certificadoDesde || null,
        certificado_vigencia_hasta: certificadoHasta || null,
        examen_medico_fecha: examenMedico || null,
        cedula_pdf_url: cedulaPdf,
        licencia_pdf_url: licenciaPdf,
        certificado_pdf_url: certificadoPdf
      };

      if (instructor) {
        await instructoresAPI.update(instructor.id, instructorData);
      } else {
        await instructoresAPI.create(instructorData);
      }
      
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo guardar el instructor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalBase
      isOpen={true}
      title={instructor ? 'Editar Instructor' : `Nuevo Instructor - Paso ${step} de 4`}
      onClose={onClose}
      closeDisabled={loading}
      size="lg"
    >

        {error && (
          <div className="error-alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* PASO 1: Crear Usuario */}
        {step === 1 && !instructor && (
          <form onSubmit={handleCrearUsuario} className="form-instructor">
            <h3 className="step-title">
              <User size={20} /> Paso 1: Datos del Usuario
            </h3>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                type="button"
                className={usarUsuarioExistente ? 'btn-cancel' : 'btn-primary'}
                onClick={() => {
                  setUsarUsuarioExistente(false);
                  setUsuarioSeleccionado(null);
                  setUsuariosEncontrados([]);
                  setBusquedaUsuario('');
                }}
              >
                Crear nuevo
              </button>
              <button
                type="button"
                className={usarUsuarioExistente ? 'btn-primary' : 'btn-cancel'}
                onClick={() => {
                  setUsarUsuarioExistente(true);
                  setError('');
                  setPassword('');
                }}
              >
                Usar existente
              </button>
            </div>

            {usarUsuarioExistente && (
              <div className="form-group">
                <label>Buscar usuario (nombre, cédula o email)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={busquedaUsuario}
                    onChange={(e) => setBusquedaUsuario(e.target.value)}
                    placeholder="Ej: 123456 o correo@..."
                  />
                  <button type="button" className="btn-primary" onClick={buscarUsuarios} disabled={buscandoUsuarios}>
                    {buscandoUsuarios ? 'Buscando...' : 'Buscar'}
                  </button>
                </div>
                {usuariosEncontrados.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                    {usuariosEncontrados.map((u) => (
                      <div
                        key={u.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '8px',
                          border: '1px solid var(--border)',
                          borderRadius: '8px'
                        }}
                      >
                        <div>
                          <strong>{u.nombre_completo}</strong>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {u.cedula} · {u.email}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => setUsuarioSeleccionado(u)}
                        >
                          Usar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {usuarioSeleccionado && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Usuario seleccionado: <strong>{usuarioSeleccionado.nombre_completo}</strong>
                  </div>
                )}
              </div>
            )}
            
            <div className="form-row">
              <div className="form-group">
                <label>Nombre Completo *</label>
                <input
                  type="text"
                  value={nombreCompleto}
                  onChange={(e) => setNombreCompleto(e.target.value)}
                  required={!usarUsuarioExistente}
                  disabled={usarUsuarioExistente}
                  placeholder="Ej: Juan Pérez García"
                />
              </div>

              <div className="form-group">
                <label>Cédula *</label>
                <input
                  type="text"
                  value={cedula}
                  onChange={(e) => setCedula(e.target.value)}
                  required={!usarUsuarioExistente}
                  disabled={usarUsuarioExistente}
                  placeholder="Sin puntos ni comas"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={!usarUsuarioExistente}
                  disabled={usarUsuarioExistente}
                  placeholder="instructor@ejemplo.com"
                />
              </div>

              <div className="form-group">
                <label>Teléfono</label>
                <input
                  type="tel"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  disabled={usarUsuarioExistente}
                  placeholder="3001234567"
                />
              </div>
            </div>

            {!usarUsuarioExistente && (
              <div className="form-group">
                <label>Contraseña *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={onClose} className="btn-cancel">
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Creando...' : 'Siguiente'}
                <ArrowRight size={18} />
              </button>
            </div>
          </form>
        )}

        {/* PASO 2: Captura de Foto */}
        {step === 2 && (
          <div className="form-instructor">
            <h3 className="step-title">
              <Camera size={20} /> Paso 2: Fotografía del Instructor
            </h3>

            <div className="foto-section">
              {!fotoCapturada && !mostrarWebcam ? (
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '1rem' }}>
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
                  <button type="button" className="btn-camera btn-secondary" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={18} /> Subir Archivo
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
                    <button type="button" className="btn-primary" onClick={capturarFoto}>
                      <Camera size={20} /> Capturar
                    </button>
                    <button type="button" className="btn-cancel" onClick={detenerWebcam}>
                      Cancelar
                    </button>
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
              ) : (
                <div className="foto-preview">
                  <img src={fotoCapturada!} alt="Foto del instructor" style={{
                    maxWidth: '300px',
                    borderRadius: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                  }} />
                  <div className="foto-actions" style={{ marginTop: '1rem', display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'center' }}>
                    <button type="button" className="btn-secondary" onClick={recapturarFoto}>
                      <RotateCcw size={18} /> Cambiar Foto
                    </button>
                    <span style={{ color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Check size={18} /> Foto lista
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setStep(1)} className="btn-cancel">
                <ArrowLeft size={18} /> Atrás
              </button>
              <button type="button" onClick={handleContinuarConFoto} className="btn-primary">
                Siguiente <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: Datos del Instructor */}
        {step === 3 && (
          <div className="form-instructor">
            <h3 className="step-title">
              <Award size={20} /> Paso 3: Información del Instructor
            </h3>

            <div className="form-row">
              <div className="form-group">
                <label>Número de Licencia *</label>
                <input
                  type="text"
                  value={licenciaNumero}
                  onChange={(e) => setLicenciaNumero(e.target.value)}
                  required
                  placeholder="Ej: L123456789"
                />
              </div>

              <div className="form-group">
                <label>Número RUNT</label>
                <input
                  type="text"
                  value={numeroRunt}
                  onChange={(e) => setNumeroRunt(e.target.value)}
                  placeholder="Registro Único Nacional de Tránsito"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Categorías que Enseña * (seleccione al menos una)</label>
              <div className="categorias-checkbox-grid">
                {categorias_disponibles.map(cat => (
                  <label key={cat} className="checkbox-categoria">
                    <input
                      type="checkbox"
                      checked={categoriasEnsena.includes(cat)}
                      onChange={() => toggleCategoria(cat)}
                    />
                    <span className="categoria-label">{cat}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Vigencia Licencia - Desde</label>
                <input
                  type="date"
                  value={licenciaDesde}
                  onChange={(e) => setLicenciaDesde(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Vigencia Licencia - Hasta *</label>
                <input
                  type="date"
                  value={licenciaHasta}
                  onChange={(e) => setLicenciaHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Certificado - Desde</label>
                <input
                  type="date"
                  value={certificadoDesde}
                  onChange={(e) => setCertificadoDesde(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Certificado - Hasta *</label>
                <input
                  type="date"
                  value={certificadoHasta}
                  onChange={(e) => setCertificadoHasta(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Fecha Último Examen Médico</label>
                <input
                  type="date"
                  value={examenMedico}
                  onChange={(e) => setExamenMedico(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                  <option value="ACTIVO">Activo</option>
                  <option value="VACACIONES">Vacaciones</option>
                  <option value="LICENCIA_MEDICA">Licencia Médica</option>
                  <option value="INACTIVO">Inactivo</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Especialidad</label>
              <input
                type="text"
                value={especialidad}
                onChange={(e) => setEspecialidad(e.target.value)}
                placeholder="Ej: Experto en motos deportivas"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Fecha de Contratación</label>
                <input
                  type="date"
                  value={fechaContratacion}
                  onChange={(e) => setFechaContratacion(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Tipo de Contrato</label>
                <select value={tipoContrato} onChange={(e) => setTipoContrato(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  <option value="POR_HORAS">Por Horas</option>
                  <option value="FIJO">Tiempo Completo</option>
                  <option value="INDEPENDIENTE">Independiente</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Certificaciones</label>
              <textarea
                value={certificaciones}
                onChange={(e) => setCertificaciones(e.target.value)}
                placeholder="Ej: Certificado SENA, Curso de primeros auxilios..."
                rows={3}
              />
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setStep(2)} className="btn-cancel">
                <ArrowLeft size={18} /> Atrás
              </button>
              <button type="button" onClick={handleGuardarDatosInstructor} className="btn-primary">
                Siguiente <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* PASO 4: Subir Documentos PDF */}
        {step === 4 && (
          <form onSubmit={handleCrearInstructor} className="form-instructor">
            <h3 className="step-title">
              <FileText size={20} /> Paso 4: Documentos (Opcional)
            </h3>
            
            <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              Sube los documentos en formato PDF. Puedes hacerlo ahora o después desde la hoja de vida.
            </p>

            {/* Cédula */}
            <div className="documento-upload-group">
              <label className="documento-label">
                <FileText size={18} />
                Cédula de Ciudadanía
              </label>
              <input
                ref={cedulaInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => handlePdfSelect(e, 'cedula')}
                style={{ display: 'none' }}
              />
              <div className="documento-action">
                {cedulaPdf ? (
                  <div className="documento-cargado">
                    <Check size={18} color="#16a34a" />
                    <span>Documento cargado</span>
                    <button type="button" onClick={() => setCedulaPdf(null)} className="btn-remover">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => cedulaInputRef.current?.click()} className="btn-upload">
                    <Upload size={18} /> Subir Cédula
                  </button>
                )}
              </div>
            </div>

            {/* Licencia */}
            <div className="documento-upload-group">
              <label className="documento-label">
                <FileText size={18} />
                Licencia de Conducción
              </label>
              <input
                ref={licenciaInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => handlePdfSelect(e, 'licencia')}
                style={{ display: 'none' }}
              />
              <div className="documento-action">
                {licenciaPdf ? (
                  <div className="documento-cargado">
                    <Check size={18} color="#16a34a" />
                    <span>Documento cargado</span>
                    <button type="button" onClick={() => setLicenciaPdf(null)} className="btn-remover">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => licenciaInputRef.current?.click()} className="btn-upload">
                    <Upload size={18} /> Subir Licencia
                  </button>
                )}
              </div>
            </div>

            {/* Certificado */}
            <div className="documento-upload-group">
              <label className="documento-label">
                <FileText size={18} />
                Certificado de Instructor
              </label>
              <input
                ref={certificadoInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => handlePdfSelect(e, 'certificado')}
                style={{ display: 'none' }}
              />
              <div className="documento-action">
                {certificadoPdf ? (
                  <div className="documento-cargado">
                    <Check size={18} color="#16a34a" />
                    <span>Documento cargado</span>
                    <button type="button" onClick={() => setCertificadoPdf(null)} className="btn-remover">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => certificadoInputRef.current?.click()} className="btn-upload">
                    <Upload size={18} /> Subir Certificado
                  </button>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setStep(3)} className="btn-cancel">
                <ArrowLeft size={18} /> Atrás
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Guardando...' : instructor ? 'Actualizar Instructor' : 'Crear Instructor'}
                <Check size={18} />
              </button>
            </div>
          </form>
        )}
    </ModalBase>
  );
};
