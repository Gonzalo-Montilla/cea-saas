import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Home, 
  Users, 
  UserPlus, 
  UserCheck,
  Car,
  Calendar, 
  DollarSign,
  FileText,
  GraduationCap,
  MoreVertical,
  History,
  Shield,
  Bell,
  LifeBuoy,
  ClipboardList,
  Menu,
  Wallet,
  Building2,
  Moon,
  Sun,
} from 'lucide-react';
import { RolUsuario } from '../types';
import { BRAND_LOGO_URL, BRAND_NAME } from '../config/branding';
import { authAPI, saasAdminAPI, tenantsAPI } from '../services/api';
import { isSaasAdminUser } from '../utils/saasAdmin';
import { ConfirmDialog } from './ui/ConfirmDialog';
import '../styles/Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [tenantDisplayName, setTenantDisplayName] = useState(BRAND_NAME);
  const [tenantLogoUrl, setTenantLogoUrl] = useState(BRAND_LOGO_URL);
  const [sessionNotice, setSessionNotice] = useState('');
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [supportNotice, setSupportNotice] = useState('');
  const [closingAllSessions, setClosingAllSessions] = useState(false);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    const saved = (localStorage.getItem('theme_mode') || '').toLowerCase();
    return saved === 'dark' ? 'dark' : 'light';
  });
  const supportPrevUnreadRef = useRef<number | null>(null);
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() => window.innerWidth <= 1024);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('theme_mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const apply = () => {
      const mobile = mq.matches;
      setIsMobileNav(mobile);
      setSidebarExpanded(!mobile);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const loadTenantBranding = async () => {
      const authMode = (localStorage.getItem('auth_mode') || 'tenant').toLowerCase();
      if (authMode === 'global') {
        setTenantDisplayName('Backoffice SaaS');
        setTenantLogoUrl(BRAND_LOGO_URL);
        return;
      }
      try {
        const tenantSlug = (localStorage.getItem('tenant_slug') || '').trim();
        const ctx = await tenantsAPI.getContext(tenantSlug || undefined);
        setTenantDisplayName(ctx.display_name || ctx.nombre || BRAND_NAME);
        setTenantLogoUrl(ctx.logo_url || BRAND_LOGO_URL);
      } catch {
        setTenantDisplayName(BRAND_NAME);
        setTenantLogoUrl(BRAND_LOGO_URL);
      }
    };
    void loadTenantBranding();
  }, []);

  const handleLogout = () => {
    const authMode = (localStorage.getItem('auth_mode') || 'tenant').toLowerCase();
    const tenantSlug = (localStorage.getItem('tenant_slug') || '').trim().toLowerCase();
    logout();
    if (authMode === 'global') {
      navigate('/login-saas');
      return;
    }
    navigate(tenantSlug ? `/login?tenant=${encodeURIComponent(tenantSlug)}` : '/login');
  };

  const handleLogoutAllSessions = async () => {
    if (closingAllSessions) return;
    try {
      setClosingAllSessions(true);
      await authAPI.logoutAllSessions();
      setSessionNotice('Todas las sesiones activas se cerraron con éxito.');
      setTimeout(() => {
        handleLogout();
      }, 900);
    } catch {
      setSessionNotice('No se pudieron cerrar todas las sesiones. Intenta nuevamente.');
    } finally {
      setClosingAllSessions(false);
      setShowLogoutAllConfirm(false);
    }
  };

  const toggleThemeMode = () => {
    setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const adminRoles = [RolUsuario.ADMIN, RolUsuario.COORDINADOR, RolUsuario.GERENTE];
  const showSaasAdmin = isSaasAdminUser(user || undefined);
  const authMode = (localStorage.getItem('auth_mode') || 'tenant').toLowerCase();
  const isGlobalAuth = authMode === 'global';
  const saasScopes = (user?.permisos_modulos || []).map((s) => String(s).trim().toLowerCase());
  const isSaasOwner = saasScopes.includes('saas_admin');
  const canSeeSaasSupport = isSaasOwner || saasScopes.includes('saas_support_manage');
  const supportSeenKey = useMemo(
    () => `saas_support_last_seen_${String(user?.id || 'unknown')}`,
    [user?.id]
  );
  const menuItems = [
    { path: '/dashboard', icon: Home, label: 'Dashboard', moduleId: 'dashboard', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.CAJERO] },
    { path: '/nuevo-estudiante', icon: UserPlus, label: 'Nuevo Estudiante', moduleId: 'nuevo_estudiante', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.CAJERO] },
    { path: '/estudiantes', icon: Users, label: 'Estudiantes', moduleId: 'estudiantes', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.CAJERO] },
    { path: '/caja', icon: DollarSign, label: 'Caja / Pagos', moduleId: 'caja', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.CAJERO] },
    { path: '/caja-fuerte', icon: Wallet, label: 'Caja Fuerte', moduleId: 'caja_fuerte', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE] },
    { path: '/historial-cajas', icon: History, label: 'Historial de Cajas', moduleId: 'historial_cajas', roles: adminRoles },
    { path: '/reportes', icon: FileText, label: 'Reportes', moduleId: 'reportes', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE] },
    { path: '/alertas', icon: Bell, label: 'Alertas', moduleId: 'alertas', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.CAJERO, RolUsuario.COORDINADOR] },
    { path: '/cierre-financiero', icon: ClipboardList, label: 'Cierre Financiero', moduleId: 'cierre_financiero', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE] },
    { path: '/instructores', icon: UserCheck, label: 'Instructores', moduleId: 'instructores', roles: adminRoles },
    { path: '/vehiculos', icon: Car, label: 'Vehículos', moduleId: 'vehiculos', roles: adminRoles },
    { path: '/clases', icon: Calendar, label: 'Programar Clases', moduleId: 'clases', roles: [RolUsuario.INSTRUCTOR, RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.COORDINADOR] },
    { path: '/usuarios', icon: Shield, label: 'Usuarios', moduleId: 'usuarios', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE] },
    { path: '/tarifas', icon: GraduationCap, label: 'Tarifas', moduleId: 'tarifas', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE] },
    { path: '/soporte', icon: LifeBuoy, label: 'Soporte', moduleId: 'soporte_tenant', roles: [RolUsuario.ADMIN, RolUsuario.GERENTE, RolUsuario.COORDINADOR, RolUsuario.CAJERO, RolUsuario.INSTRUCTOR, RolUsuario.ESTUDIANTE] },
    { path: '/saas-admin/resumen', icon: Building2, label: 'Backoffice SaaS', moduleId: 'saas_admin', roles: [RolUsuario.ADMIN] },
  ];
  const saasMenuItems = [
    { path: '/saas-admin/resumen', icon: Home, label: 'Resumen', scope: null },
    { path: '/saas-admin/tenants', icon: Building2, label: 'Tenants', scope: 'saas_tenants_manage' },
    { path: '/saas-admin/billing', icon: DollarSign, label: 'Facturación', scope: 'saas_billing_manage' },
    { path: '/saas-admin/pipeline', icon: ClipboardList, label: 'Pipeline', scope: 'saas_pipeline_manage' },
    { path: '/saas-admin/support', icon: Bell, label: 'Soporte', scope: 'saas_support_manage' },
    { path: '/saas-admin/users', icon: Users, label: 'Usuarios SaaS', scope: 'saas_users_manage' },
    { path: '/saas-admin/audit', icon: FileText, label: 'Auditoría', scope: 'saas_audit_read' },
    { path: '/saas-admin/security', icon: Shield, label: 'Seguridad', scope: null },
  ];

  const allowedItems = menuItems.filter((item) => {
    if (item.path.startsWith('/saas-admin')) return showSaasAdmin && isGlobalAuth;
    if (item.moduleId === 'soporte_tenant') return !isGlobalAuth && Boolean(user?.id);
    if (!user?.rol) return false;
    if (user?.permisos_modulos && user.permisos_modulos.length > 0) {
      return user.permisos_modulos.includes(item.moduleId);
    }
    return item.roles.includes(user.rol as RolUsuario);
  });
  const allowedSaasItems = saasMenuItems.filter((item) => {
    if (!showSaasAdmin) return false;
    if (!item.scope) return true;
    return isSaasOwner || saasScopes.includes(item.scope);
  });

  const isActive = (path: string) => {
    if (path.startsWith('/saas-admin/')) return location.pathname.startsWith(path);
    return location.pathname === path;
  };
  const activeLabel = useMemo(() => {
    const active = (isGlobalAuth ? allowedSaasItems : allowedItems).find((item) => isActive(item.path));
    return active?.label || 'Panel administrativo';
  }, [isGlobalAuth, allowedItems, allowedSaasItems, location.pathname]);

  useEffect(() => {
    if (!(isGlobalAuth && showSaasAdmin && canSeeSaasSupport)) return;
    let mounted = true;
    if (!localStorage.getItem(supportSeenKey)) {
      localStorage.setItem(supportSeenKey, new Date().toISOString());
    }
    const loadSupportCounter = async () => {
      try {
        const supportTickets = await saasAdminAPI.getSupportTickets({ limit: 200 });
        const seenRaw = localStorage.getItem(supportSeenKey);
        const seenAt = seenRaw ? new Date(seenRaw).getTime() : Date.now();
        const nextUnread = (supportTickets.items || []).filter((ticket) => {
          const createdAt = ticket.created_at ? new Date(ticket.created_at).getTime() : 0;
          return createdAt > seenAt && (ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS');
        }).length;
        if (!mounted) return;
        setSupportUnreadCount(nextUnread);
        if (
          supportPrevUnreadRef.current !== null &&
          nextUnread > supportPrevUnreadRef.current &&
          !location.pathname.startsWith('/saas-admin/support')
        ) {
          const incoming = nextUnread - supportPrevUnreadRef.current;
          setSupportNotice(
            incoming === 1
              ? 'Tienes 1 ticket nuevo de soporte.'
              : `Tienes ${incoming} tickets nuevos de soporte.`
          );
        }
        supportPrevUnreadRef.current = nextUnread;
      } catch {
        // ignore
      }
    };
    void loadSupportCounter();
    const intervalId = window.setInterval(() => {
      void loadSupportCounter();
    }, 20000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [isGlobalAuth, showSaasAdmin, canSeeSaasSupport, location.pathname, supportSeenKey]);

  useEffect(() => {
    if (!(isGlobalAuth && showSaasAdmin && canSeeSaasSupport)) return;
    if (!location.pathname.startsWith('/saas-admin/support')) return;
    const nowIso = new Date().toISOString();
    localStorage.setItem(supportSeenKey, nowIso);
    setSupportUnreadCount(0);
    supportPrevUnreadRef.current = 0;
  }, [isGlobalAuth, showSaasAdmin, canSeeSaasSupport, location.pathname, supportSeenKey]);

  useEffect(() => {
    if (!supportNotice) return;
    const timeoutId = window.setTimeout(() => setSupportNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [supportNotice]);

  return (
    <div className="layout-container">
      <aside className={`sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="sidebar-logo">
          <img src={tenantLogoUrl} alt={tenantDisplayName} className="sidebar-logo-img" />
        </div>
        
        <nav className="nav-menu" aria-label="Navegación principal">
          {(isGlobalAuth ? allowedSaasItems : allowedItems).map((item) => {
            const Icon = item.icon;
            const activeItem = isActive(item.path);
            return (
              <a
                key={item.path}
                href={item.path}
                className={`nav-item ${activeItem ? 'active' : ''}`}
                title={item.label}
                aria-current={activeItem ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.path);
                  if (isMobileNav) setSidebarExpanded(false);
                }}
              >
                <span className="nav-icon"><Icon size={22} /></span>
                <span className="nav-text nav-text-row">
                  <span>{item.label}</span>
                  {isGlobalAuth && item.path === '/saas-admin/support' && canSeeSaasSupport && supportUnreadCount > 0 && (
                    <span className="nav-badge">{supportUnreadCount}</span>
                  )}
                </span>
              </a>
            );
          })}
        </nav>
      </aside>
      {isMobileNav && sidebarExpanded && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setSidebarExpanded(false)}
        />
      )}

      <div className={`main-wrapper ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
        <header className="dashboard-header">
          <div className="header-content">
            <div className="header-title">
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setSidebarExpanded((prev) => !prev)}
                title={sidebarExpanded ? 'Contraer menú' : 'Expandir menú'}
                aria-label={sidebarExpanded ? 'Contraer menú lateral' : 'Expandir menú lateral'}
                aria-expanded={sidebarExpanded}
              >
                <Menu size={18} />
              </button>
              <div className="header-brand">
                <h1>{tenantDisplayName}</h1>
                <span>{activeLabel}</span>
              </div>
            </div>
            <div className="header-actions">
              <span className="user-role-badge">{user?.rol}</span>
              <span className="user-name">{user?.nombre_completo}</span>
              <button
                onClick={toggleThemeMode}
                className="icon-button"
                title={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                aria-label={themeMode === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
                aria-pressed={themeMode === 'dark'}
              >
                {themeMode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button
                onClick={() => setShowLogoutAllConfirm(true)}
                className="icon-button"
                title="Cerrar todas las sesiones"
                aria-label="Cerrar sesiones en otros dispositivos"
                disabled={closingAllSessions}
              >
                <Shield size={20} />
              </button>
              <button onClick={handleLogout} className="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión actual">
                <MoreVertical size={20} />
              </button>
            </div>
          </div>
        </header>
        {(sessionNotice || supportNotice) && (
          <div className="layout-notice-stack" aria-live="polite">
            {sessionNotice && <div className="layout-session-notice" role="status">{sessionNotice}</div>}
            {supportNotice && <div className="layout-session-notice" role="status">{supportNotice}</div>}
          </div>
        )}

        <main className="main-content">
          {children}
        </main>
      </div>

      <ConfirmDialog
        isOpen={showLogoutAllConfirm}
        title="Cerrar sesiones en otros dispositivos"
        message="Se cerrarán todas las sesiones activas de esta cuenta en otros dispositivos. ¿Deseas continuar?"
        confirmText="Sí, cerrar sesiones"
        cancelText="Cancelar"
        isLoading={closingAllSessions}
        onCancel={() => setShowLogoutAllConfirm(false)}
        onConfirm={() => void handleLogoutAllSessions()}
      />
    </div>
  );
};
