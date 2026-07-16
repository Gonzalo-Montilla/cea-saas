import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import { parseApiError } from '../utils/errors';
import '../styles/Login.css';

export const SaasForcePasswordChange = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { getAuthMode, logout } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    try {
      setIsLoading(true);
      await authAPI.changePasswordGlobal({
        current_password: currentPassword,
        new_password: newPassword,
      });
      // El backend invalida sesiones al cambiar contraseña (session_version).
      // Cerramos sesión explícitamente en contexto y redirigimos al login SaaS.
      logout();
      localStorage.removeItem('tenant_slug');
      localStorage.setItem('auth_mode', 'global');
      window.location.href = '/login-saas';
    } catch (err: any) {
      setError(parseApiError(err, 'No se pudo cambiar la contraseña.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (getAuthMode() !== 'global') {
      navigate('/login-saas');
    }
  }, [getAuthMode, navigate]);

  const handleCurrentPasswordChange = (value: string) => {
    setCurrentPassword(value);
    if (error) setError('');
  };

  const handleNewPasswordChange = (value: string) => {
    setNewPassword(value);
    if (error) setError('');
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (error) setError('');
  };

  return (
    <div className="login-container" role="main">
      <div className="login-card">
        <div className="login-header">
          <ShieldCheck size={52} style={{ color: 'var(--primary)', marginBottom: 8 }} />
          <p>Cambio obligatorio de contraseña</p>
          <small>Por seguridad, se cerrarán todas tus sesiones activas al guardar.</small>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="current_password">Contraseña actual</label>
            <div className="password-field">
              <input
                id="current_password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => handleCurrentPasswordChange(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowCurrentPassword((prev) => !prev)}
                aria-label={showCurrentPassword ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
                title={showCurrentPassword ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
                disabled={isLoading}
              >
                {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="new_password">Nueva contraseña</label>
            <div className="password-field">
              <input
                id="new_password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => handleNewPasswordChange(e.target.value)}
                required
                disabled={isLoading}
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowNewPassword((prev) => !prev)}
                aria-label={showNewPassword ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'}
                title={showNewPassword ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'}
                disabled={isLoading}
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="confirm_password">Confirmar nueva contraseña</label>
            <div className="password-field">
              <input
                id="confirm_password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                required
                disabled={isLoading}
                minLength={6}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'}
                title={showConfirmPassword ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'}
                disabled={isLoading}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && (
            <div className="error-message" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
};
