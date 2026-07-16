import { FormEvent, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import { BRAND_LOGO_URL, BRAND_NAME, BRAND_TAGLINE } from '../config/branding';
import { parseApiError } from '../utils/errors';
import '../styles/Login.css';

export const LoginSaas = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { loginGlobal } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const healthy = await authAPI.checkHealth();
      if (!healthy) {
        setError('No se pudo conectar al servidor. Verifica que el backend esté activo.');
        return;
      }
      await loginGlobal(email, password, mfaCode.trim() || undefined, backupCode.trim() || undefined);
      navigate('/saas-admin');
    } catch (err: any) {
      setError(parseApiError(err, 'No fue posible iniciar sesión en backoffice SaaS'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (error) setError('');
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (error) setError('');
  };

  const handleMfaCodeChange = (value: string) => {
    const normalized = value.replace(/\D/g, '').slice(0, 6);
    setMfaCode(normalized);
    if (error) setError('');
  };

  const handleBackupCodeChange = (value: string) => {
    setBackupCode(value.toUpperCase().trimStart());
    if (error) setError('');
  };

  return (
    <div className="login-container" role="main">
      <div className="login-card">
        <div className="login-header">
          {!logoError ? (
            <img
              src={BRAND_LOGO_URL}
              alt={BRAND_NAME}
              className="login-logo"
              onError={() => setLogoError(true)}
            />
          ) : (
            <p>{BRAND_NAME}</p>
          )}
          <p>Acceso Backoffice SaaS</p>
          <small>Ingresa con tu cuenta interna y MFA si está habilitado.</small>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Correo de usuario SaaS</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              required
              disabled={isLoading}
              placeholder="correo@prometheus.tech"
              autoComplete="username"
              inputMode="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                required
                disabled={isLoading}
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                disabled={isLoading}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="mfa_code">Código MFA (si aplica)</label>
            <input
              id="mfa_code"
              type="text"
              value={mfaCode}
              onChange={(e) => handleMfaCodeChange(e.target.value)}
              disabled={isLoading}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="backup_code">Código de respaldo (alternativo)</label>
            <input
              id="backup_code"
              type="text"
              value={backupCode}
              onChange={(e) => handleBackupCodeChange(e.target.value)}
              disabled={isLoading}
              placeholder="AB12CD34"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="error-message" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Iniciando sesión...' : 'Ingresar a Backoffice'}
          </button>
        </form>

        <div className="login-links">
          <Link to="/login">Volver al login de escuela</Link>
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
