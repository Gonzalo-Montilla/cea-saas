import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ClipboardList,
  Menu,
  Wallet
} from 'lucide-react';
import { RolUsuario } from '../types';
import { BRAND_LOGO_URL, BRAND_NAME } from '../config/branding';
import { tenantsAPI } from '../services/api';
import '../styles/Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [tenantDisplayName, setTenantDisplayName] = useState(BRAND_NAME);
  const [tenantLogoUrl, setTenantLogoUrl] = useState(BRAND_LOGO_URL);

  useEffect(() => {
    const loadTenantBranding = async () => {
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
    logout();
    navigate('/login');
  };

  const adminRoles = [RolUsuario.ADMIN, RolUsuario.COORDINADOR, RolUsuario.GERENTE];
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
  ];

  const allowedItems = menuItems.filter((item) => {
    if (!user?.rol) return false;
    if (user?.permisos_modulos && user.permisos_modulos.length > 0) {
      return user.permisos_modulos.includes(item.moduleId);
    }
    return item.roles.includes(user.rol as RolUsuario);
  });

  const isActive = (path: string) => {
    return window.location.pathname === path;
  };

  return (
    <div className="layout-container">
      <aside className={`sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="sidebar-logo">
          <img src={tenantLogoUrl} alt={tenantDisplayName} className="sidebar-logo-img" />
        </div>
        
        <nav className="nav-menu">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.path}
                href={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                title={item.label}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.path);
                }}
              >
                <span className="nav-icon"><Icon size={22} /></span>
                <span className="nav-text">{item.label}</span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className={`main-wrapper ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
        <header className="dashboard-header">
          <div className="header-content">
            <div className="header-title">
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setSidebarExpanded((prev) => !prev)}
                title={sidebarExpanded ? 'Contraer menú' : 'Expandir menú'}
              >
                <Menu size={18} />
              </button>
              <div className="header-brand">
                <h1>{tenantDisplayName}</h1>
                <span>Panel administrativo</span>
              </div>
            </div>
            <div className="header-actions">
              <span className="user-role-badge">{user?.rol}</span>
              <span className="user-name">{user?.nombre_completo}</span>
              <button onClick={handleLogout} className="icon-button" title="Cerrar sesión">
                <MoreVertical size={20} />
              </button>
            </div>
          </div>
        </header>

        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
};
