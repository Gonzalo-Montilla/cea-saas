import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, KeyRound, Shield, ChevronDown, Search, X } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ModalBase } from '../components/ui/ModalBase';
import { tenantsAPI, usuariosAPI } from '../services/api';
import { RolUsuario } from '../types';
import '../styles/Usuarios.css';

interface UsuarioItem {
  id: number;
  email: string;
  nombre_completo: string;
  cedula: string;
  telefono?: string;
  rol: RolUsuario;
  is_active: boolean;
  created_at: string;
  last_login?: string;
  permisos_modulos?: string[];
  branch_ids?: number[];
}

interface BranchItem {
  id: number;
  nombre: string;
  codigo: string;
  is_active: boolean;
  is_primary: boolean;
}

const roles = [
  RolUsuario.ADMIN,
  RolUsuario.GERENTE,
  RolUsuario.COORDINADOR,
  RolUsuario.CAJERO,
  RolUsuario.INSTRUCTOR
];

const roleSupportsMultipleBranches = (value: RolUsuario): boolean => value !== RolUsuario.CAJERO;

const MODULOS = [
  { id: 'dashboard', label: 'Inicio (Dashboard)' },
  { id: 'nuevo_estudiante', label: 'Crear estudiante' },
  { id: 'estudiantes', label: 'Ver y gestionar estudiantes' },
  { id: 'caja', label: 'Caja y pagos' },
  { id: 'caja_fuerte', label: 'Caja fuerte' },
  { id: 'historial_cajas', label: 'Historial de cajas' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'alertas', label: 'Alertas y pendientes' },
  { id: 'cierre_financiero', label: 'Cierre financiero' },
  { id: 'instructores', label: 'Instructores' },
  { id: 'vehiculos', label: 'Vehículos' },
  { id: 'clases', label: 'Clases' },
  { id: 'usuarios', label: 'Usuarios y permisos' },
  { id: 'tarifas', label: 'Tarifas y configuración' }
];

const GUIA_ALCANCE_ROLES = [
  {
    rol: 'ADMIN',
    alcance: 'Puede manejar todo en la escuela: usuarios, tarifas, caja, reportes y configuraciones importantes.'
  },
  {
    rol: 'GERENTE',
    alcance: 'Puede manejar casi todo el día a día del negocio, pero no debe escalar permisos de administrador.'
  },
  {
    rol: 'COORDINADOR',
    alcance: 'Se enfoca en la operación académica: clases, instructores, vehículos y seguimiento de procesos.'
  },
  {
    rol: 'CAJERO',
    alcance: 'Se encarga de caja y pagos: registrar ingresos, egresos y movimientos diarios.'
  },
  {
    rol: 'INSTRUCTOR',
    alcance: 'Trabaja en sus clases y solo consulta la información que necesita para su trabajo.'
  },
  {
    rol: 'ESTUDIANTE',
    alcance: 'Acceso al portal del estudiante (cuando aplique).'
  }
];

export const Usuarios = () => {
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPassModal, setShowPassModal] = useState(false);
  const [editando, setEditando] = useState<UsuarioItem | null>(null);
  const [passUsuario, setPassUsuario] = useState<UsuarioItem | null>(null);
  const [guardandoUsuario, setGuardandoUsuario] = useState(false);
  const [reseteandoPassword, setReseteandoPassword] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [telefono, setTelefono] = useState('');
  const [rol, setRol] = useState<RolUsuario>(RolUsuario.CAJERO);
  const [activo, setActivo] = useState(true);
  const [permisosModulos, setPermisosModulos] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [mostrarGuiaRoles, setMostrarGuiaRoles] = useState(false);
  const [sucursales, setSucursales] = useState<BranchItem[]>([]);
  const [sucursalesLoading, setSucursalesLoading] = useState(false);
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);

  const branchNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const branch of sucursales) map.set(branch.id, branch.nombre || branch.codigo);
    return map;
  }, [sucursales]);

  const branchSummary = (u: UsuarioItem) => {
    const ids = (u.branch_ids || []).filter((id) => branchNameMap.has(id));
    if (!ids.length) return '-';
    const names = ids.map((id) => branchNameMap.get(id)).filter(Boolean) as string[];
    return names.join(', ');
  };

  const cargarSucursales = async () => {
    try {
      setSucursalesLoading(true);
      const ctx = await tenantsAPI.getContext();
      const items = Array.isArray(ctx?.branches) ? ctx.branches : [];
      setSucursales(items.filter((b) => b.is_active));
    } catch (err) {
      console.error('Error al cargar sucursales:', err);
      setError('No se pudieron cargar las sucursales activas.');
    } finally {
      setSucursalesLoading(false);
    }
  };

  const cargarUsuarios = async (searchTerm?: string) => {
    try {
      setLoading(true);
      const data = await usuariosAPI.getAll({ search: searchTerm || undefined });
      setUsuarios(data || []);
      setError('');
    } catch (err) {
      console.error('Error al cargar usuarios:', err);
      setError('No se pudieron cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    void cargarUsuarios(debouncedSearch || undefined);
  }, [debouncedSearch]);

  useEffect(() => {
    void cargarSucursales();
  }, []);

  const abrirNuevo = () => {
    setError('');
    setEditando(null);
    setEmail('');
    setPassword('');
    setNombre('');
    setCedula('');
    setTelefono('');
    setRol(RolUsuario.CAJERO);
    setActivo(true);
    setPermisosModulos([]);
    const primary = sucursales.find((b) => b.is_primary) || sucursales[0];
    setSelectedBranchIds(primary ? [primary.id] : []);
    setShowModal(true);
  };

  const abrirEditar = (u: UsuarioItem) => {
    setError('');
    setEditando(u);
    setEmail(u.email);
    setPassword('');
    setNombre(u.nombre_completo);
    setCedula(u.cedula);
    setTelefono(u.telefono || '');
    setRol(u.rol);
    setActivo(u.is_active);
    setPermisosModulos(u.permisos_modulos || []);
    setSelectedBranchIds(u.branch_ids || []);
    setShowModal(true);
  };

  const handleRolChange = (nextRol: RolUsuario) => {
    setRol(nextRol);
    if (!roleSupportsMultipleBranches(nextRol) && selectedBranchIds.length > 1) {
      setSelectedBranchIds((prev) => prev.slice(0, 1));
    }
  };

  const abrirReset = (u: UsuarioItem) => {
    setError('');
    setPassUsuario(u);
    setNewPassword('');
    setShowPassModal(true);
  };

  const guardar = async () => {
    if (!email || !nombre || !cedula || !rol) {
      setError('Completa los campos obligatorios');
      return;
    }
    if (activo && permisosModulos.length === 0) {
      setError('Selecciona al menos un módulo para habilitar acceso');
      return;
    }
    if (activo && selectedBranchIds.length === 0) {
      setError('Selecciona al menos una sucursal para este usuario');
      return;
    }
    if (activo && !roleSupportsMultipleBranches(rol) && selectedBranchIds.length !== 1) {
      setError('El rol CAJERO solo puede tener una sucursal asignada');
      return;
    }
    try {
      setGuardandoUsuario(true);
      if (editando) {
        await usuariosAPI.update(editando.id, {
          email,
          nombre_completo: nombre,
          cedula,
          telefono: telefono || null,
          rol,
          is_active: activo,
          permisos_modulos: permisosModulos,
          branch_ids: selectedBranchIds,
        });
      } else {
        if (!password) {
          setError('La contraseña es obligatoria');
          return;
        }
        await usuariosAPI.create({
          email,
          password,
          nombre_completo: nombre,
          cedula,
          telefono: telefono || null,
          rol,
          is_active: activo,
          permisos_modulos: permisosModulos,
          branch_ids: selectedBranchIds,
        });
      }
      setError('');
      setShowModal(false);
      await cargarUsuarios();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo guardar el usuario.');
    } finally {
      setGuardandoUsuario(false);
    }
  };

  const resetPassword = async () => {
    if (!passUsuario) return;
    if (!newPassword || newPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    try {
      setReseteandoPassword(true);
      await usuariosAPI.resetPassword(passUsuario.id, newPassword);
      setError('');
      setShowPassModal(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'No se pudo restablecer la contraseña.');
    } finally {
      setReseteandoPassword(false);
    }
  };

  const resumenPermisos = `Módulos seleccionados: ${permisosModulos.length}/${MODULOS.length}`;

  return (
    <div className="usuarios-container">
      <PageHeader
        title="Usuarios"
        subtitle="Operadores y permisos del sistema"
        icon={<Shield size={20} />}
        actions={
          <button className="btn-nuevo" onClick={abrirNuevo}>
            <Plus size={16} /> Nuevo
          </button>
        }
      />

      <section className="roles-guia-bloque">
        <button
          type="button"
          className="roles-guia-header"
          onClick={() => setMostrarGuiaRoles((prev) => !prev)}
          aria-expanded={mostrarGuiaRoles}
          aria-controls="usuarios-guia-roles"
        >
          <div className="roles-guia-header-text">
            <h3>Mini guía de alcance por rol</h3>
            <p>Referencia rápida para asignar roles y permisos por módulo.</p>
          </div>
          <ChevronDown size={20} className={`roles-guia-chevron ${mostrarGuiaRoles ? '' : 'collapsed'}`} />
        </button>
        {mostrarGuiaRoles && (
          <div className="roles-guia-content" id="usuarios-guia-roles">
            <div className="roles-guia-grid">
              {GUIA_ALCANCE_ROLES.map((item) => (
                <article key={item.rol} className="roles-guia-card">
                  <h4>{item.rol}</h4>
                  <p>{item.alcance}</p>
                </article>
              ))}
            </div>
            <div className="roles-guia-nota">
              Regla sencilla: primero define bien el rol, y luego marca solo los módulos que realmente necesita.
              Un usuario nunca debería tener más acceso del que su rol permite.
            </div>
          </div>
        )}
      </section>

      <div className="search-section">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            className="search-input"
            placeholder="Buscar por nombre, correo o cédula"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void cargarUsuarios(search.trim() || undefined);
              }
            }}
          />
        </div>
        <div className="search-actions">
          <button
            type="button"
            className="btn-nuevo btn-search"
            onClick={() => void cargarUsuarios(search.trim() || undefined)}
          >
            Buscar
          </button>
          <button
            type="button"
            className="btn-search-clear"
            onClick={() => setSearch('')}
            disabled={!search}
          >
            <X size={14} />
            Limpiar
          </button>
        </div>
      </div>
      <div className="usuarios-meta">
        <span>{loading ? 'Actualizando lista...' : `${usuarios.length} usuario(s) encontrado(s)`}</span>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-container">Cargando usuarios...</div>
      ) : (
        <div className="usuarios-table">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Teléfono</th>
                <th>Rol</th>
                <th>Sucursales</th>
                <th>Estado</th>
                <th>Último login</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td>{u.nombre_completo}</td>
                  <td>{u.email}</td>
                  <td>{u.telefono || '-'}</td>
                  <td>{u.rol}</td>
                  <td>{branchSummary(u)}</td>
                  <td>{u.is_active ? 'Activo' : 'Inactivo'}</td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleString('es-CO') : '-'}</td>
                  <td>
                    <button
                      className="btn-icon"
                      onClick={() => abrirEditar(u)}
                      title="Editar usuario"
                      aria-label={`Editar usuario ${u.nombre_completo}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => abrirReset(u)}
                      title="Restablecer contraseña"
                      aria-label={`Restablecer contraseña de ${u.nombre_completo}`}
                      disabled={loading}
                    >
                      <KeyRound size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">No hay usuarios con ese criterio de búsqueda</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ModalBase
        isOpen={showModal}
        title={editando ? 'Editar usuario' : 'Nuevo usuario'}
        onClose={() => setShowModal(false)}
        closeDisabled={guardandoUsuario}
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowModal(false)} disabled={guardandoUsuario}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={guardar} disabled={guardandoUsuario}>
              {guardandoUsuario ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Nombre completo</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Correo (usuario)</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Cédula</label>
          <input value={cedula} onChange={(e) => setCedula(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Teléfono</label>
          <input
            type="tel"
            autoComplete="tel"
            inputMode="numeric"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </div>
        {!editando && (
          <div className="form-group">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <div className="form-group">
          <label>Rol</label>
          <select value={rol} onChange={(e) => handleRolChange(e.target.value as RolUsuario)}>
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Acceso al sistema</label>
          <select value={activo ? 'SI' : 'NO'} onChange={(e) => setActivo(e.target.value === 'SI')}>
            <option value="SI">Habilitado</option>
            <option value="NO">Bloqueado</option>
          </select>
        </div>
        <div className="form-group">
          <label>Sucursales asignadas</label>
          {sucursalesLoading ? (
            <div className="permisos-resumen">Cargando sucursales...</div>
          ) : sucursales.length === 0 ? (
            <div className="permisos-resumen">No hay sucursales activas configuradas para esta escuela.</div>
          ) : (
            <div className="modulos-grid">
              {sucursales.map((branch) => (
                <label key={branch.id} className="modulo-item">
                  <input
                    type="checkbox"
                    checked={selectedBranchIds.includes(branch.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBranchIds((prev) => {
                          if (!roleSupportsMultipleBranches(rol)) {
                            return [branch.id];
                          }
                          return Array.from(new Set([...prev, branch.id]));
                        });
                      } else {
                        setSelectedBranchIds((prev) => prev.filter((id) => id !== branch.id));
                      }
                    }}
                    disabled={guardandoUsuario}
                  />
                  <span>{branch.nombre}</span>
                </label>
              ))}
            </div>
          )}
          <div className="permisos-resumen">Seleccionadas: {selectedBranchIds.length}</div>
          {!roleSupportsMultipleBranches(rol) && (
            <div className="permisos-resumen">Nota: el rol CAJERO solo puede operar en una sede.</div>
          )}
        </div>
        <div className="form-group">
          <label>Permisos por módulo</label>
          <div className="permisos-resumen">{resumenPermisos}</div>
          <div className="modulos-grid">
            {MODULOS.map((m) => (
              <label key={m.id} className="modulo-item">
                <input
                  type="checkbox"
                  checked={permisosModulos.includes(m.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setPermisosModulos((prev) => [...prev, m.id]);
                    } else {
                      setPermisosModulos((prev) => prev.filter((x) => x !== m.id));
                    }
                  }}
                  disabled={guardandoUsuario}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>
      </ModalBase>

      <ModalBase
        isOpen={showPassModal && Boolean(passUsuario)}
        title="Restablecer contraseña"
        onClose={() => setShowPassModal(false)}
        closeDisabled={reseteandoPassword}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowPassModal(false)} disabled={reseteandoPassword}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={resetPassword} disabled={reseteandoPassword || newPassword.length < 6}>
              {reseteandoPassword ? 'Restableciendo...' : 'Restablecer'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label>Nueva contraseña</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
      </ModalBase>
    </div>
  );
};
