import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND_LOGO_URL, BRAND_NAME } from '../config/branding';
import { onboardingAPI } from '../services/api';
import { parseApiError } from '../utils/errors';
import '../styles/SchoolOnboarding.css';

type FormState = {
  nombre_escuela: string;
  slug: string;
  display_name: string;
  contacto_email: string;
  contacto_telefono: string;
  nit: string;
  logo_url: string;
  admin_email: string;
  admin_password: string;
  admin_nombre_completo: string;
  admin_cedula: string;
  admin_telefono: string;
  sucursales_adicionales: string;
};

const initialForm: FormState = {
  nombre_escuela: '',
  slug: '',
  display_name: '',
  contacto_email: '',
  contacto_telefono: '',
  nit: '',
  logo_url: '',
  admin_email: '',
  admin_password: '',
  admin_nombre_completo: '',
  admin_cedula: '',
  admin_telefono: '',
  sucursales_adicionales: '0',
};

export const SchoolOnboarding = () => {
  const [form, setForm] = useState<FormState>(initialForm);
  const [logoFileName, setLogoFileName] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<null | { tenantSlug: string; adminEmail: string }>(null);
  const navigate = useNavigate();

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result.startsWith('data:image')) {
          reject(new Error('No se pudo procesar la imagen del logo'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo del logo'));
      reader.readAsDataURL(file);
    });

  const handleLogoFileChange = async (file: File | null) => {
    if (!file) {
      setLogoFileName('');
      setLogoFile(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('El archivo del logo debe ser una imagen');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo no puede superar 2MB');
      return;
    }
    try {
      setIsProcessingLogo(true);
      const dataUrl = await fileToDataUrl(file);
      setError('');
      setLogoFile(file);
      setLogoFileName(file.name);
      updateField('logo_url', dataUrl);
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la imagen del logo');
      setLogoFile(null);
      setLogoFileName('');
    } finally {
      setIsProcessingLogo(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      let logoUrlFinal = form.logo_url.trim() || undefined;
      if (logoFile) {
        setIsProcessingLogo(true);
        logoUrlFinal = await fileToDataUrl(logoFile);
      }
      const result = await onboardingAPI.publicSignup(
        {
          nombre_escuela: form.nombre_escuela.trim(),
          slug: form.slug.trim() || undefined,
          display_name: form.display_name.trim() || undefined,
          plan: 'FREE',
          contacto_email: form.contacto_email.trim(),
          contacto_telefono: form.contacto_telefono.trim() || undefined,
          nit: form.nit.trim() || undefined,
          logo_url: logoUrlFinal,
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password,
          admin_nombre_completo: form.admin_nombre_completo.trim(),
          admin_cedula: form.admin_cedula.trim(),
          admin_telefono: form.admin_telefono.trim() || undefined,
          sucursales_adicionales: Math.max(0, Math.min(20, Number(form.sucursales_adicionales || 0))),
          send_welcome_email: true,
          activate_tenant: true,
        }
      );

      localStorage.setItem('tenant_slug', result.tenant_slug);
      setSuccess({ tenantSlug: result.tenant_slug, adminEmail: result.admin_email });
    } catch (err: any) {
      setError(parseApiError(err, 'No se pudo registrar la escuela. Intenta nuevamente.'));
    } finally {
      setIsProcessingLogo(false);
      setIsLoading(false);
    }
  };

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <img src={BRAND_LOGO_URL} alt={BRAND_NAME} className="onboarding-logo" />
          <h1>Registro de nueva escuela</h1>
          <p>Al finalizar, recibiras el codigo de escuela para iniciar sesion.</p>
        </div>

        {success ? (
          <div className="onboarding-success">
            <h2>Escuela creada correctamente</h2>
            <p>
              Codigo de escuela (slug): <strong>{success.tenantSlug}</strong>
            </p>
            <p>
              Enlace directo de acceso:{' '}
              <strong>{`${window.location.origin}/login?tenant=${encodeURIComponent(success.tenantSlug)}`}</strong>
            </p>
            <p>
              Usuario administrador: <strong>{success.adminEmail}</strong>
            </p>
            <button
              className="onboarding-button"
              onClick={() =>
                navigate(
                  `/login?tenant=${encodeURIComponent(success.tenantSlug)}&email=${encodeURIComponent(success.adminEmail)}`
                )
              }
            >
              Ir a iniciar sesion
            </button>
          </div>
        ) : (
          <form className="onboarding-form" onSubmit={handleSubmit}>
            <div className="onboarding-grid">
              <label>
                Nombre de escuela
                <input
                  value={form.nombre_escuela}
                  onChange={(e) => updateField('nombre_escuela', e.target.value)}
                  required
                />
              </label>
              <label>
                Codigo de escuela (slug, opcional)
                <input value={form.slug} onChange={(e) => updateField('slug', e.target.value)} />
                <small className="onboarding-help">
                  Este codigo se usa en el login. Si lo dejas vacio, se genera automaticamente.
                </small>
              </label>
              <label>
                Nombre comercial
                <input value={form.display_name} onChange={(e) => updateField('display_name', e.target.value)} />
              </label>
              <label>
                Correo de contacto escuela
                <input
                  type="email"
                  value={form.contacto_email}
                  onChange={(e) => updateField('contacto_email', e.target.value)}
                  required
                />
              </label>
              <label>
                Telefono de contacto
                <input
                  value={form.contacto_telefono}
                  onChange={(e) => updateField('contacto_telefono', e.target.value)}
                />
              </label>
              <label>
                NIT
                <input value={form.nit} onChange={(e) => updateField('nit', e.target.value)} />
              </label>
              <label>
                URL de logo (opcional)
                <input value={form.logo_url} onChange={(e) => updateField('logo_url', e.target.value)} />
              </label>
              <label>
                Subir logo desde PC (opcional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    void handleLogoFileChange(e.target.files?.[0] || null);
                  }}
                />
                {logoFileName && <small className="onboarding-help">Logo cargado: {logoFileName}</small>}
                {isProcessingLogo && <small className="onboarding-help">Procesando logo...</small>}
              </label>
              <label>
                Email administrador
                <input
                  type="email"
                  value={form.admin_email}
                  onChange={(e) => updateField('admin_email', e.target.value)}
                  required
                />
              </label>
              <label>
                Contrasena administrador
                <input
                  type="password"
                  value={form.admin_password}
                  onChange={(e) => updateField('admin_password', e.target.value)}
                  required
                />
              </label>
              <label>
                Nombre completo administrador
                <input
                  value={form.admin_nombre_completo}
                  onChange={(e) => updateField('admin_nombre_completo', e.target.value)}
                  required
                />
              </label>
              <label>
                Cedula administrador
                <input
                  value={form.admin_cedula}
                  onChange={(e) => updateField('admin_cedula', e.target.value)}
                  required
                />
              </label>
              <label>
                Telefono administrador
                <input
                  value={form.admin_telefono}
                  onChange={(e) => updateField('admin_telefono', e.target.value)}
                />
              </label>
              <label>
                Cantidad de sucursales adicionales (opcional)
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={form.sucursales_adicionales}
                  onChange={(e) => updateField('sucursales_adicionales', e.target.value)}
                />
                <small className="onboarding-help">
                  La sede principal se crea automáticamente. El sistema creará las adicionales como Sucursal 2, Sucursal 3, etc.
                </small>
              </label>
            </div>

            {error && <div className="onboarding-error">{error}</div>}

            <button className="onboarding-button" type="submit" disabled={isLoading || isProcessingLogo}>
              {isLoading ? 'Creando escuela...' : isProcessingLogo ? 'Procesando logo...' : 'Crear escuela'}
            </button>
          </form>
        )}

        <div className="onboarding-footer">
          <Link to="/login">Volver a inicio de sesion</Link>
        </div>
      </div>
    </div>
  );
};

