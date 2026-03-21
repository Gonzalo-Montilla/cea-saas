import { FormEvent, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import '../styles/Login.css';

export const SaasForcePasswordChange = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
      setError(err?.response?.data?.detail || 'No se pudo cambiar la contraseña.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (getAuthMode() !== 'global') {
      navigate('/login-saas');
    }
  }, [getAuthMode, navigate]);

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <ShieldCheck size={52} style={{ color: 'var(--primary)', marginBottom: 8 }} />
          <p>Cambio obligatorio de contraseña</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="current_password">Contraseña actual</label>
            <input
              id="current_password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="new_password">Nueva contraseña</label>
            <input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={isLoading}
              minLength={6}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm_password">Confirmar nueva contraseña</label>
            <input
              id="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isLoading}
              minLength={6}
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
};
