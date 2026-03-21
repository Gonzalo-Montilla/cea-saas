import { useEffect, useState, FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, tenantsAPI } from '../services/api';
import { BRAND_LOGO_URL, BRAND_NAME, BRAND_TAGLINE } from '../config/branding';
import '../styles/Login.css';

export const Login = () => {
  const [searchParams] = useSearchParams();
  const initialTenantSlug =
    (searchParams.get('tenant') || localStorage.getItem('tenant_slug') || '').trim();
  const initialEmail = (searchParams.get('email') || '').trim();
  const [tenantSlug, setTenantSlug] = useState(initialTenantSlug);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tenantDisplayName, setTenantDisplayName] = useState(BRAND_NAME);
  const [tenantLogoUrl, setTenantLogoUrl] = useState(BRAND_LOGO_URL);
  const { login } = useAuth();
  const navigate = useNavigate();

  const loadTenantPreview = async (slug: string) => {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) {
      setTenantDisplayName(BRAND_NAME);
      setTenantLogoUrl(BRAND_LOGO_URL);
      return;
    }
    try {
      const ctx = await tenantsAPI.getContext(normalized);
      setTenantDisplayName(ctx.display_name || ctx.nombre || BRAND_NAME);
      setTenantLogoUrl(ctx.logo_url || BRAND_LOGO_URL);
    } catch {
      setTenantDisplayName(BRAND_NAME);
      setTenantLogoUrl(BRAND_LOGO_URL);
    }
  };

  useEffect(() => {
    void loadTenantPreview(initialTenantSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const normalizedTenant = tenantSlug.trim().toLowerCase();
      if (!normalizedTenant) {
        setError('Ingresa el codigo de tu escuela.');
        return;
      }
      localStorage.setItem('tenant_slug', normalizedTenant);
      localStorage.setItem('auth_mode', 'tenant');

      const healthy = await authAPI.checkHealth();
      if (!healthy) {
        setError('No se pudo conectar al servidor. Verifica que el backend esté activo.');
        return;
      }
      await login(email, password, normalizedTenant);
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Error al iniciar sesión:', err);
      setError(err.response?.data?.detail || 'Error al iniciar sesión. Verifica tus credenciales.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src={tenantLogoUrl} alt={tenantDisplayName} className="login-logo" />
          <p>Sistema de Gestión</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              placeholder="correo@ejemplo.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tenantSlug">Codigo de escuela (slug)</label>
            <input
              id="tenantSlug"
              type="text"
              value={tenantSlug}
              onChange={(e) => {
                const value = e.target.value;
                setTenantSlug(value);
                void loadTenantPreview(value);
              }}
              onBlur={() => {
                void loadTenantPreview(tenantSlug);
              }}
              required
              disabled={isLoading}
              placeholder="ejemplo: conduce-bien"
            />
            <small className="onboarding-help">Es el mismo codigo de escuela que se genera en el registro.</small>
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="login-links">
          <Link to="/registro-escuela">Registrar nueva escuela</Link>
          <span> · </span>
          <Link to="/login-saas">Acceso SaaS Admin</Link>
        </div>

        <div className="login-footer">
          <p>{`${BRAND_NAME} - ${BRAND_TAGLINE}`}</p>
        </div>
      </div>

      <footer className="login-global-footer">
        <p>Copyright © {new Date().getFullYear()} Prometheus Tech. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};
