import { useEffect, useMemo, useState } from 'react';
import { Building2, DollarSign, Rocket } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { saasAdminAPI, type SaasAuditLogItem, type SaasTenantItem, type SaasUserItem } from '../services/api';
import '../styles/SaasAdmin.css';

const PLANS = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
const SAAS_ROLES = ['ADMIN', 'GERENTE'];
const AUDIT_ACTIONS = ['', 'tenant.updated', 'saas_user.created', 'saas_user.updated', 'saas_user.password_reset'];

const money = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value || 0);

export const SaasAdmin = () => {
  const [summary, setSummary] = useState<any>(null);
  const [tenants, setTenants] = useState<SaasTenantItem[]>([]);
  const [users, setUsers] = useState<SaasUserItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<SaasAuditLogItem[]>([]);
  const [search, setSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [savingTenantId, setSavingTenantId] = useState<number | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    nombre_completo: '',
    cedula: '',
    telefono: '',
    rol: 'ADMIN',
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [summaryData, tenantsData] = await Promise.all([
        saasAdminAPI.getSummary(),
        saasAdminAPI.getTenants({ limit: 200, search: search.trim() || undefined }),
      ]);
      setSummary(summaryData);
      setTenants(tenantsData.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el backoffice SaaS');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      setUsersLoading(true);
      setError('');
      const usersData = await saasAdminAPI.getUsers({ limit: 200, search: userSearch.trim() || undefined });
      setUsers(usersData.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar usuarios SaaS');
    } finally {
      setUsersLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setAuditLoading(true);
      setError('');
      const auditData = await saasAdminAPI.getAuditLogs({
        limit: 100,
        search: auditSearch.trim() || undefined,
        action: auditAction || undefined,
      });
      setAuditLogs(auditData.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar auditoría SaaS');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadUsers();
    void loadAuditLogs();
  }, []);

  const byPlanRows = useMemo(() => {
    const counts = summary?.plan_counts || {};
    return PLANS.map((plan) => ({ plan, total: Number(counts[plan] || 0) }));
  }, [summary]);

  const onSaveTenant = async (tenant: SaasTenantItem) => {
    try {
      setSavingTenantId(tenant.id);
      await saasAdminAPI.updateTenant(tenant.id, {
        plan: tenant.plan,
        is_active: tenant.is_active,
        is_demo: tenant.is_demo,
        demo_ends_at: tenant.demo_ends_at || null,
      });
      await loadData();
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar el tenant');
    } finally {
      setSavingTenantId(null);
    }
  };

  const onCreateUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.nombre_completo || !newUser.cedula) {
      setError('Completa email, contraseña, nombre y cédula para crear el usuario');
      return;
    }
    try {
      setCreatingUser(true);
      setError('');
      await saasAdminAPI.createUser({
        email: newUser.email,
        password: newUser.password,
        nombre_completo: newUser.nombre_completo,
        cedula: newUser.cedula,
        telefono: newUser.telefono || null,
        rol: newUser.rol,
        permisos_modulos: ['saas_admin'],
      });
      setNewUser({
        email: '',
        password: '',
        nombre_completo: '',
        cedula: '',
        telefono: '',
        rol: 'ADMIN',
      });
      await loadUsers();
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo crear el usuario SaaS');
    } finally {
      setCreatingUser(false);
    }
  };

  const onSaveUser = async (user: SaasUserItem) => {
    try {
      setSavingUserId(user.id);
      setError('');
      await saasAdminAPI.updateUser(user.id, {
        nombre_completo: user.nombre_completo,
        telefono: user.telefono || null,
        rol: user.rol,
        is_active: user.is_active,
        permisos_modulos: user.permisos_modulos || ['saas_admin'],
      });
      await loadUsers();
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar el usuario SaaS');
    } finally {
      setSavingUserId(null);
    }
  };

  const onResetPassword = async (user: SaasUserItem) => {
    const newPassword = window.prompt(`Nueva contraseña para ${user.email} (mínimo 6 caracteres):`, '');
    if (!newPassword) return;
    try {
      setResettingUserId(user.id);
      setError('');
      await saasAdminAPI.resetUserPassword(user.id, newPassword);
      await loadUsers();
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo resetear la contraseña');
    } finally {
      setResettingUserId(null);
    }
  };

  return (
    <div className="saas-admin-container">
      <PageHeader
        title="Backoffice SaaS"
        subtitle="Control global de escuelas, planes y operación comercial"
        icon={<Rocket size={20} />}
      />

      <div className="saas-admin-banner">
        Modo Backoffice SaaS: usa una cuenta dueña dedicada (separada de cuentas operativas de escuela).
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="saas-kpi-grid">
        <div className="saas-kpi-card">
          <Building2 size={18} />
          <h4>Escuelas registradas</h4>
          <strong>{summary?.total_tenants ?? '-'}</strong>
          <span>Activas: {summary?.active_tenants ?? '-'} / Inactivas: {summary?.inactive_tenants ?? '-'}</span>
        </div>
        <div className="saas-kpi-card">
          <Rocket size={18} />
          <h4>Escuelas en demo</h4>
          <strong>{summary?.demo_tenants ?? '-'}</strong>
          <span>Por vencer: {summary?.demos_por_vencer ?? '-'}</span>
        </div>
        <div className="saas-kpi-card">
          <DollarSign size={18} />
          <h4>MRR estimado</h4>
          <strong>{money(Number(summary?.mrr_estimado || 0))}</strong>
          <span>Estimación por plan</span>
        </div>
      </div>

      <div className="saas-card">
        <h3>Distribución por plan</h3>
        <div className="saas-plan-grid">
          {byPlanRows.map((row) => (
            <div key={row.plan} className="saas-plan-item">
              <span>{row.plan}</span>
              <strong>{row.total}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="saas-card">
        <div className="saas-card-header">
          <h3>Escuelas (tenants)</h3>
          <div className="saas-search">
            <input
              type="text"
              placeholder="Buscar por nombre, slug o correo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadData()} disabled={loading}>
              Buscar
            </button>
          </div>
        </div>

        <div className="saas-table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Escuela</th>
                <th>Slug</th>
                <th>Plan</th>
                <th>Demo</th>
                <th>Vence demo</th>
                <th>Activa</th>
                <th>Contacto</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t, idx) => (
                <tr key={t.id}>
                  <td>{t.display_name || t.nombre}</td>
                  <td>{t.slug}</td>
                  <td>
                    <select
                      value={t.plan}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, plan: e.target.value } : x))
                        )
                      }
                    >
                      {PLANS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!t.is_demo}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, is_demo: e.target.checked } : x))
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={t.demo_ends_at ? String(t.demo_ends_at).slice(0, 10) : ''}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, demo_ends_at: e.target.value ? `${e.target.value}T23:59:59` : null } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!t.is_active}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, is_active: e.target.checked } : x))
                        )
                      }
                    />
                  </td>
                  <td>{t.contacto_email || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void onSaveTenant(t)}
                      disabled={savingTenantId === t.id}
                    >
                      {savingTenantId === t.id ? 'Guardando...' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="saas-card">
        <div className="saas-card-header">
          <h3>Usuarios SaaS (dueños / equipo comercial)</h3>
          <div className="saas-search">
            <input
              type="text"
              placeholder="Buscar por nombre, correo o cédula"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadUsers()} disabled={usersLoading}>
              Buscar
            </button>
          </div>
        </div>

        <div className="saas-user-form">
          <input
            type="text"
            placeholder="Nombre completo"
            value={newUser.nombre_completo}
            onChange={(e) => setNewUser((prev) => ({ ...prev, nombre_completo: e.target.value }))}
          />
          <input
            type="email"
            placeholder="Correo"
            value={newUser.email}
            onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Cédula"
            value={newUser.cedula}
            onChange={(e) => setNewUser((prev) => ({ ...prev, cedula: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Teléfono (opcional)"
            value={newUser.telefono}
            onChange={(e) => setNewUser((prev) => ({ ...prev, telefono: e.target.value }))}
          />
          <select
            value={newUser.rol}
            onChange={(e) => setNewUser((prev) => ({ ...prev, rol: e.target.value }))}
          >
            {SAAS_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Contraseña temporal"
            value={newUser.password}
            onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
          />
          <button type="button" className="btn-primary" onClick={() => void onCreateUser()} disabled={creatingUser}>
            {creatingUser ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>

        <div className="saas-table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Cédula</th>
                <th>Rol</th>
                <th>Activo</th>
                <th>Último acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr key={u.id}>
                  <td>
                    <input
                      type="text"
                      value={u.nombre_completo}
                      onChange={(e) =>
                        setUsers((prev) => prev.map((x, i) => (i === idx ? { ...x, nombre_completo: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td>{u.email}</td>
                  <td>{u.cedula}</td>
                  <td>
                    <select
                      value={u.rol}
                      onChange={(e) => setUsers((prev) => prev.map((x, i) => (i === idx ? { ...x, rol: e.target.value } : x)))}
                    >
                      {SAAS_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!u.is_active}
                      onChange={(e) => setUsers((prev) => prev.map((x, i) => (i === idx ? { ...x, is_active: e.target.checked } : x)))}
                    />
                  </td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleString('es-CO') : '-'}</td>
                  <td className="saas-user-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void onSaveUser(u)}
                      disabled={savingUserId === u.id}
                    >
                      {savingUserId === u.id ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void onResetPassword(u)}
                      disabled={resettingUserId === u.id}
                    >
                      {resettingUserId === u.id ? 'Reseteando...' : 'Reset pass'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="saas-card">
        <div className="saas-card-header">
          <h3>Auditoría de acciones SaaS</h3>
          <div className="saas-search">
            <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)}>
              <option value="">Todas las acciones</option>
              {AUDIT_ACTIONS.filter(Boolean).map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Buscar por resumen, actor o entidad"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadAuditLogs()} disabled={auditLoading}>
              Buscar
            </button>
          </div>
        </div>

        <div className="saas-table-wrap">
          <table className="saas-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Actor</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Resumen</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  <td>{row.actor_email}</td>
                  <td>{row.action}</td>
                  <td>{row.entity_type}:{row.entity_id}</td>
                  <td>{row.summary}</td>
                  <td>{row.ip_address || '-'}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={6}>{auditLoading ? 'Cargando...' : 'No hay registros de auditoría'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
