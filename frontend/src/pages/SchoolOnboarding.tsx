import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND_LOGO_URL, BRAND_NAME } from '../config/branding';
import { onboardingAPI } from '../services/api';
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
};

export const SchoolOnboarding = () => {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<null | { tenantSlug: string; adminEmail: string }>(null);
  const navigate = useNavigate();

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await onboardingAPI.publicSignup(
        {
          nombre_escuela: form.nombre_escuela.trim(),
          slug: form.slug.trim() || undefined,
          display_name: form.display_name.trim() || undefined,
          plan: 'FREE',
          contacto_email: form.contacto_email.trim(),
          contacto_telefono: form.contacto_telefono.trim() || undefined,
          nit: form.nit.trim() || undefined,
          logo_url: form.logo_url.trim() || undefined,
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password,
          admin_nombre_completo: form.admin_nombre_completo.trim(),
          admin_cedula: form.admin_cedula.trim(),
          admin_telefono: form.admin_telefono.trim() || undefined,
          send_welcome_email: true,
          activate_tenant: true,
        }
      );

      localStorage.setItem('tenant_slug', result.tenant_slug);
      setSuccess({ tenantSlug: result.tenant_slug, adminEmail: result.admin_email });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo registrar la escuela. Intenta nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <img src={BRAND_LOGO_URL} alt={BRAND_NAME} className="onboarding-logo" />
          <h1>Registro de nueva escuela</h1>
          <p>Flujo MVP para crear tenant y usuario administrador.</p>
        </div>

        {success ? (
          <div className="onboarding-success">
            <h2>Escuela creada correctamente</h2>
            <p>
              Tenant: <strong>{success.tenantSlug}</strong>
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
                Slug (opcional)
                <input value={form.slug} onChange={(e) => updateField('slug', e.target.value)} />
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
                URL de logo
                <input value={form.logo_url} onChange={(e) => updateField('logo_url', e.target.value)} />
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
            </div>

            {error && <div className="onboarding-error">{error}</div>}

            <button className="onboarding-button" type="submit" disabled={isLoading}>
              {isLoading ? 'Creando escuela...' : 'Crear escuela'}
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

