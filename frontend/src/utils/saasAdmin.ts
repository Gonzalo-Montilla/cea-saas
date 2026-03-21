import type { Usuario } from '../types';

export const isSaasAdminUser = (user: Usuario | null | undefined): boolean => {
  if (!user?.email) return false;
  const permisos = Array.isArray(user.permisos_modulos)
    ? user.permisos_modulos.map((p) => String(p).trim().toLowerCase())
    : [];
  if (permisos.some((p) => p.startsWith('saas_'))) return true;
  const raw = ((import.meta as any).env?.VITE_SAAS_ADMIN_EMAILS || '') as string;
  const allowed = new Set(
    raw
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );
  if (allowed.size === 0) return false;
  return allowed.has(String(user.email).trim().toLowerCase());
};
