import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Rocket } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import '../styles/Login.css';

export const LoginSaas = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      setError(err?.response?.data?.detail || 'No fue posible iniciar sesión en backoffice SaaS');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <Rocket size={54} style={{ color: 'var(--primary)', marginBottom: 8 }} />
          <p>Acceso Backoffice SaaS</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Correo dueño SaaS</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              placeholder="owner@prometheus.tech"
            />
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

          <div className="form-group">
            <label htmlFor="mfa_code">Código MFA (si aplica)</label>
            <input
              id="mfa_code"
              type="text"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              disabled={isLoading}
              placeholder="123456"
              inputMode="numeric"
            />
          </div>

          <div className="form-group">
            <label htmlFor="backup_code">Backup code (alternativo)</label>
            <input
              id="backup_code"
              type="text"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              disabled={isLoading}
              placeholder="AB12CD34"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Iniciando sesión...' : 'Ingresar a Backoffice'}
          </button>
        </form>

        <div className="login-links">
          <Link to="/login">Volver al login de escuela</Link>
        </div>
      </div>

      <footer className="login-global-footer">
        <p>Copyright © {new Date().getFullYear()} Prometheus Tech. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};
