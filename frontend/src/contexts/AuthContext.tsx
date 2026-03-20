import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI } from '../services/api';
import type { Usuario, AuthContextType } from '../types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<Usuario | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('access_token'));
  const [isLoading, setIsLoading] = useState(true);

  const getAuthMode = (): 'tenant' | 'global' =>
    (localStorage.getItem('auth_mode') || 'tenant').toLowerCase() === 'global' ? 'global' : 'tenant';

  const refreshUser = async () => {
    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) {
      setUser(null);
      setToken(null);
      return;
    }
    const authMode = getAuthMode();
    const userData = authMode === 'global' ? await authAPI.getCurrentUserGlobal() : await authAPI.getCurrentUser();
    setUser(userData);
    setToken(accessToken);
  };

  useEffect(() => {
    const loadUser = async () => {
      if (localStorage.getItem('access_token')) {
        try {
          await refreshUser();
        } catch (error) {
          console.error('Error al cargar usuario:', error);
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('auth_mode');
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    loadUser();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authAPI.login({ email, password });
    localStorage.setItem('auth_mode', 'tenant');
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    setToken(response.access_token);
    
    const userData = await authAPI.getCurrentUser();
    setUser(userData);
  };

  const loginGlobal = async (email: string, password: string) => {
    localStorage.removeItem('tenant_slug');
    const response = await authAPI.loginGlobal({ email, password });
    localStorage.setItem('auth_mode', 'global');
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    setToken(response.access_token);

    const userData = await authAPI.getCurrentUserGlobal();
    setUser(userData);
  };

  const logout = () => {
    authAPI.logout();
    localStorage.removeItem('auth_mode');
    localStorage.removeItem('tenant_slug');
    setUser(null);
    setToken(null);
  };

  const value: AuthContextType = {
    user,
    token,
    login,
    loginGlobal,
    refreshUser,
    getAuthMode,
    logout,
    isAuthenticated: !!token && !!user,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
