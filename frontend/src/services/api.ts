import axios from 'axios';
import type { LoginRequest, RegisterRequest, TokenResponse, Usuario } from '../types';

const isLocalHost = (host: string): boolean => {
  const normalized = (host || '').trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

const resolveApiUrl = (): string => {
  const configured = (import.meta.env.VITE_API_URL || '').trim();
  if (configured) return configured;

  // Safe-by-default in production: browser hits same origin and nginx proxies /api.
  if (typeof window !== 'undefined' && !isLocalHost(window.location.hostname)) {
    return '/api/v1';
  }
  return 'http://127.0.0.1:8000/api/v1';
};

const RAW_API_URL = resolveApiUrl();
const TENANT_HEADER_NAME = 'X-Tenant-Slug';
const ONBOARDING_HEADER_NAME = 'X-Onboarding-Key';
const TENANT_SLUG_STORAGE_KEY = 'tenant_slug';
const ENV_TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG?.trim() || '';
const API_URL = RAW_API_URL.endsWith('/api/v1')
  ? RAW_API_URL
  : `${RAW_API_URL.replace(/\/$/, '')}/api/v1`;
const HEALTH_URL = API_URL.replace(/\/api\/v1$/, '') + '/health';

const decodeJwtPayload = (token: string | null): Record<string, any> | null => {
  if (!token || !token.includes('.')) return null;
  try {
    const payloadPart = token.split('.')[1];
    const padded = payloadPart.padEnd(payloadPart.length + (4 - (payloadPart.length % 4 || 4)) % 4, '=');
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const resolveTenantFromToken = (): string | null => {
  const accessToken = localStorage.getItem('access_token');
  const payload = decodeJwtPayload(accessToken);
  const tokenTenant = String(payload?.tslug || '').trim();
  return tokenTenant || null;
};

const resolveTenantSlug = (): string | null => {
  const tokenTenant = resolveTenantFromToken();
  if (tokenTenant) return tokenTenant;
  const savedSlug = localStorage.getItem(TENANT_SLUG_STORAGE_KEY);
  if (savedSlug?.trim()) return savedSlug.trim();
  if (ENV_TENANT_SLUG) return ENV_TENANT_SLUG;
  return null;
};

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Interceptor para agregar token a las peticiones
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  const tenantSlug = resolveTenantSlug();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const alreadyHasTenantHeader =
    Boolean((config.headers as any)?.[TENANT_HEADER_NAME]) ||
    Boolean((config.headers as any)?.[TENANT_HEADER_NAME.toLowerCase()]);
  if (tenantSlug && !alreadyHasTenantHeader) {
    (config.headers as any)[TENANT_HEADER_NAME] = tenantSlug;
  }
  return config;
});

// Interceptor para manejar errores de autenticación
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const authMode = (localStorage.getItem('auth_mode') || 'tenant').toLowerCase();
      const originalRequest = error.config || {};
      const isGlobal = authMode === 'global';

      // En modo global no intentamos refresh tenant; forzamos nuevo login SaaS.
      if (isGlobal) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('tenant_slug');
        if (window.location.pathname !== '/login-saas') {
          window.location.href = '/login-saas';
        }
        return Promise.reject(error);
      }

      // Token expirado en modo tenant: intentar refresh (una sola vez)
      const refreshToken = localStorage.getItem('refresh_token');
      const tenantSlug = resolveTenantSlug();
      const isRefreshCall = String(originalRequest?.url || '').includes('/auth/refresh');
      if (refreshToken && !originalRequest._retry && !isRefreshCall) {
        originalRequest._retry = true;
        try {
          const refreshUrl = `${API_URL}/auth/refresh?refresh_token_str=${encodeURIComponent(refreshToken)}`;
          const response = await axios.post(
            refreshUrl,
            {},
            {
              headers: tenantSlug ? { [TENANT_HEADER_NAME]: tenantSlug } : undefined,
              timeout: 15000,
            }
          );
          const { access_token, refresh_token } = response.data;
          localStorage.setItem('access_token', access_token);
          if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
          const freshTenant = resolveTenantFromToken() || tenantSlug;
          if (freshTenant) localStorage.setItem(TENANT_SLUG_STORAGE_KEY, freshTenant);
          
          // Reintentar la petición original
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          if (freshTenant) {
            originalRequest.headers[TENANT_HEADER_NAME] = freshTenant;
          }
          return axios(originalRequest);
        } catch (refreshError) {
          // Si falla el refresh, limpiar tokens y redirigir al login
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('tenant_slug');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  login: async (data: LoginRequest, tenantSlug?: string): Promise<TokenResponse> => {
    const normalizedTenant = (tenantSlug || '').trim().toLowerCase();
    const response = await api.post<TokenResponse>('/auth/login', data, {
      headers: normalizedTenant ? { [TENANT_HEADER_NAME]: normalizedTenant } : undefined,
    });
    return response.data;
  },
  loginGlobal: async (data: LoginRequest): Promise<TokenResponse> => {
    const response = await axios.post<TokenResponse>(`${API_URL}/auth/login-global`, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return response.data;
  },
  setupMfaGlobal: async (): Promise<{ secret: string; otpauth_url: string; qr_url: string; issuer: string }> => {
    const token = localStorage.getItem('access_token');
    const response = await axios.post(`${API_URL}/auth/mfa-global/setup`, {}, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return response.data;
  },
  enableMfaGlobal: async (code: string): Promise<{ backup_codes: string[]; message: string }> => {
    const token = localStorage.getItem('access_token');
    const response = await axios.post(`${API_URL}/auth/mfa-global/enable`, { code }, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return response.data;
  },
  disableMfaGlobal: async (data: { password: string; code: string }): Promise<void> => {
    const token = localStorage.getItem('access_token');
    await axios.post(`${API_URL}/auth/mfa-global/disable`, data, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  },
  regenerateMfaBackupCodesGlobal: async (data: { password: string; code: string }): Promise<{ backup_codes: string[]; message: string }> => {
    const token = localStorage.getItem('access_token');
    const response = await axios.post(`${API_URL}/auth/mfa-global/backup-codes/regenerate`, data, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return response.data;
  },
  checkHealth: async (): Promise<boolean> => {
    try {
      await axios.get(HEALTH_URL, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  },

  register: async (data: RegisterRequest): Promise<Usuario> => {
    const response = await api.post<Usuario>('/auth/register', data);
    return response.data;
  },

  getCurrentUser: async (): Promise<Usuario> => {
    const response = await api.get<Usuario>('/auth/me');
    return response.data;
  },
  getCurrentUserGlobal: async (): Promise<Usuario> => {
    const token = localStorage.getItem('access_token');
    const response = await axios.get<Usuario>(`${API_URL}/auth/me-global`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeout: 15000,
    });
    return response.data;
  },
  changePasswordGlobal: async (data: { current_password: string; new_password: string }): Promise<void> => {
    const token = localStorage.getItem('access_token');
    await axios.post(`${API_URL}/auth/change-password-global`, data, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  },
  logoutAllSessions: async (): Promise<void> => {
    const token = localStorage.getItem('access_token');
    const authMode = (localStorage.getItem('auth_mode') || 'tenant').toLowerCase();
    const endpoint = authMode === 'global' ? '/auth/logout-all-global' : '/auth/logout-all';
    await axios.post(`${API_URL}${endpoint}`, {}, {
      headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },
};

export interface SchoolOnboardingPayload {
  nombre_escuela: string;
  slug?: string;
  display_name?: string;
  plan: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  contacto_email: string;
  contacto_telefono?: string;
  nit?: string;
  logo_url?: string;
  admin_email: string;
  admin_password: string;
  admin_nombre_completo: string;
  admin_cedula: string;
  admin_telefono?: string;
  send_welcome_email: boolean;
  activate_tenant: boolean;
}

export interface SchoolOnboardingResponse {
  tenant_id: number;
  tenant_slug: string;
  tenant_nombre: string;
  tenant_display_name: string;
  tenant_plan: string;
  tenant_activo: boolean;
  admin_user_id: number;
  admin_email: string;
  welcome_email_sent: boolean;
}

export interface TenantContextResponse {
  id: number;
  slug: string;
  nombre: string;
  display_name: string;
  plan: string;
  is_active: boolean;
  logo_url?: string | null;
  branch_primary_id?: number;
  branches?: Array<{
    id: number;
    nombre: string;
    codigo: string;
    is_active: boolean;
    is_primary: boolean;
  }>;
}

export const onboardingAPI = {
  createSchool: async (
    payload: SchoolOnboardingPayload,
    onboardingKey: string
  ): Promise<SchoolOnboardingResponse> => {
    const response = await api.post<SchoolOnboardingResponse>(
      '/tenants/onboarding-school',
      payload,
      {
        headers: {
          [ONBOARDING_HEADER_NAME]: onboardingKey,
        },
      }
    );
    return response.data;
  },
  publicSignup: async (payload: SchoolOnboardingPayload): Promise<SchoolOnboardingResponse> => {
    const response = await api.post<SchoolOnboardingResponse>('/tenants/public-signup', payload);
    return response.data;
  },
};

export const tenantsAPI = {
  getContext: async (tenantSlug?: string): Promise<TenantContextResponse> => {
    const headers = tenantSlug?.trim() ? { [TENANT_HEADER_NAME]: tenantSlug.trim() } : undefined;
    const response = await api.get<TenantContextResponse>('/tenants/context', { headers });
    return response.data;
  },
};

// Estudiantes endpoints
export const estudiantesAPI = {
  create: async (data: any): Promise<any> => {
    const response = await api.post('/estudiantes/', data);
    return response.data;
  },
  startOtp: async (data: any): Promise<{
    session_token: string;
    expires_at: string;
    cooldown_seconds: number;
    email: string;
    otp_sent: boolean;
    debug_otp_code?: string | null;
    warning_message?: string | null;
  }> => {
    const response = await api.post('/estudiantes/otp/start', data);
    return response.data;
  },
  resendOtp: async (sessionToken: string): Promise<{
    session_token: string;
    expires_at: string;
    cooldown_seconds: number;
    email: string;
    otp_sent: boolean;
    debug_otp_code?: string | null;
    warning_message?: string | null;
  }> => {
    const response = await api.post('/estudiantes/otp/resend', { session_token: sessionToken });
    return response.data;
  },
  verifyOtpAndCreate: async (sessionToken: string, otpCode: string): Promise<{
    estudiante: any;
    habeas_email_sent: boolean;
  }> => {
    const response = await api.post('/estudiantes/otp/verify', {
      session_token: sessionToken,
      otp_code: otpCode,
    });
    return response.data;
  },

  getAll: async (params?: { skip?: number; limit?: number; search?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    
    const url = queryParams.toString() ? `/estudiantes/?${queryParams.toString()}` : '/estudiantes/';
    const response = await api.get(url);
    return response.data;
  },

  getById: async (id: number): Promise<any> => {
    const response = await api.get(`/estudiantes/${id}`);
    return response.data;
  },

  getByCedula: async (cedula: string): Promise<any> => {
    const response = await api.get(`/estudiantes/cedula/${cedula}`);
    return response.data;
  },

  reactivar: async (id: number): Promise<any> => {
    const response = await api.put(`/estudiantes/${id}/reactivar`);
    return response.data;
  },

  update: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/estudiantes/${id}`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/estudiantes/${id}`);
  },

  definirServicio: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/estudiantes/${id}/definir-servicio`, data);
    return response.data;
  },

  ampliarServicio: async (
    id: number,
    data: { tipo_servicio_nuevo: string; valor_total_curso?: number | null; observaciones?: string | null }
  ): Promise<any> => {
    const response = await api.put(`/estudiantes/${id}/ampliar-servicio`, data);
    return response.data;
  },

  corregirServicio: async (
    id: number,
    data: { tipo_servicio_nuevo: string; valor_total_curso?: number | null; motivo: string; password: string }
  ): Promise<any> => {
    const response = await api.put(`/estudiantes/${id}/corregir-servicio`, data);
    return response.data;
  },

  acreditarHoras: async (
    id: number,
    data: { tipo: string; horas: number; observaciones?: string | null; instructor_id?: number | null; vehiculo_id?: number | null }
  ): Promise<any> => {
    const response = await api.post(`/estudiantes/${id}/acreditar-horas`, data);
    return response.data;
  },

  getContratoPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/estudiantes/${id}/contrato-pdf`, { responseType: 'blob' });
    return response.data;
  },
  getCertificadoPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/estudiantes/${id}/certificado-pdf`, { responseType: 'blob' });
    return response.data;
  },
  setCertificadoRunt: async (id: number, runtNumero: string): Promise<any> => {
    const response = await api.post(`/estudiantes/${id}/certificado-runt`, { runt_numero: runtNumero });
    return response.data;
  },
  getHabeasFirmadoPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/estudiantes/${id}/habeas-firmado-pdf`, { responseType: 'blob' });
    return response.data;
  },
};

export interface ClaseItem {
  id: number;
  estudiante_id: number;
  estudiante_nombre: string;
  instructor_id?: number | null;
  instructor_nombre?: string | null;
  vehiculo_id?: number | null;
  vehiculo_label?: string | null;
  tipo: 'TEORICA' | 'PRACTICA';
  estado: 'PROGRAMADA' | 'COMPLETADA' | 'CANCELADA';
  fecha_programada: string;
  fecha_completada?: string | null;
  duracion_horas: number;
  created_at: string;
}

export const clasesAPI = {
  getAll: async (params?: {
    skip?: number;
    limit?: number;
    estado?: string;
    tipo?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
    instructor_id?: number;
    estudiante_id?: number;
    vehiculo_id?: number;
  }): Promise<{ items: ClaseItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.estado) queryParams.append('estado', params.estado);
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    if (params?.fecha_desde) queryParams.append('fecha_desde', params.fecha_desde);
    if (params?.fecha_hasta) queryParams.append('fecha_hasta', params.fecha_hasta);
    if (params?.instructor_id !== undefined) queryParams.append('instructor_id', params.instructor_id.toString());
    if (params?.estudiante_id !== undefined) queryParams.append('estudiante_id', params.estudiante_id.toString());
    if (params?.vehiculo_id !== undefined) queryParams.append('vehiculo_id', params.vehiculo_id.toString());
    const query = queryParams.toString();
    const response = await api.get(`/clases/${query ? `?${query}` : ''}`);
    return response.data;
  },
  create: async (data: {
    estudiante_id: number;
    instructor_id: number;
    vehiculo_id?: number | null;
    tipo: 'TEORICA' | 'PRACTICA';
    fecha_programada: string;
    duracion_horas: number;
    observaciones?: string | null;
  }): Promise<ClaseItem> => {
    const response = await api.post<ClaseItem>('/clases/', data);
    return response.data;
  },
  completar: async (claseId: number, data?: { acreditar_horas?: boolean; observaciones?: string | null }): Promise<ClaseItem> => {
    const response = await api.put<ClaseItem>(`/clases/${claseId}/completar`, data || {});
    return response.data;
  },
  cancelar: async (claseId: number, data?: { motivo?: string | null }): Promise<ClaseItem> => {
    const response = await api.put<ClaseItem>(`/clases/${claseId}/cancelar`, data || {});
    return response.data;
  },
  reprogramar: async (
    claseId: number,
    data: {
      fecha_programada: string;
      duracion_horas?: number;
      instructor_id?: number;
      vehiculo_id?: number | null;
      observaciones?: string | null;
    }
  ): Promise<ClaseItem> => {
    const response = await api.put<ClaseItem>(`/clases/${claseId}/reprogramar`, data);
    return response.data;
  }
};

// Caja endpoints
export const cajaAPI = {
  abrirCaja: async (data: { saldo_inicial: number; observaciones_apertura?: string | null }): Promise<any> => {
    const response = await api.post('/caja/abrir', data);
    return response.data;
  },

  getCajaActual: async (): Promise<any> => {
    try {
      const response = await api.get('/caja/actual');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  },

  cerrarCaja: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/caja/${id}/cerrar`, data);
    return response.data;
  },

  buscarEstudiante: async (cedula: string): Promise<any> => {
    const response = await api.get(`/caja/estudiante/${cedula}`);
    return response.data;
  },

  registrarPago: async (data: {
    estudiante_id: number;
    monto: number;
    metodo_pago?: string;
    concepto: string;
    es_pago_mixto?: boolean;
    detalles_pago?: Array<{ metodo_pago: string; monto: number }>;
    referencia_pago?: string | null;
    observaciones?: string | null;
  }): Promise<any> => {
    const response = await api.post('/caja/pagos', data);
    return response.data;
  },

  registrarEgreso: async (data: {
    concepto: string;
    categoria: string;
    monto: number;
    metodo_pago: string;
    numero_factura?: string | null;
    observaciones?: string | null;
  }): Promise<any> => {
    const response = await api.post('/caja/egresos', data);
    return response.data;
  },

  registrarMovimientoGeneral: async (data: {
    tipo: string;
    concepto: string;
    categoria: string;
    monto: number;
    metodo_pago?: string | null;
    tercero_nombre?: string | null;
    tercero_documento?: string | null;
    es_pago_mixto?: boolean;
    detalles_pago?: { metodo_pago: string; monto: number }[];
    observaciones?: string | null;
  }): Promise<any> => {
    const response = await api.post('/caja/movimientos', data);
    return response.data;
  },

  getMovimientoReciboPdf: async (movimientoId: number): Promise<Blob> => {
    const response = await api.get(`/caja/movimientos/${movimientoId}/recibo-pdf`, { responseType: 'blob' });
    return response.data;
  },

  getPagoReciboPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/caja/pagos/${id}/recibo-pdf`, { responseType: 'blob' });
    return response.data;
  },

  getEgresoReciboPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/caja/egresos/${id}/recibo-pdf`, { responseType: 'blob' });
    return response.data;
  },

  getCierrePdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/caja/${id}/cierre-pdf`, { responseType: 'blob' });
    return response.data;
  },

  getDashboard: async (): Promise<any> => {
    const response = await api.get('/caja/dashboard');
    return response.data;
  },

  getHistorial: async (params?: { fecha_inicio?: string; fecha_fin?: string; skip?: number; limit?: number }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    const query = queryParams.toString();
    const response = await api.get(`/caja/historial${query ? `?${query}` : ''}`);
    return response.data;
  },
};

// Caja Fuerte endpoints
export const cajaFuerteAPI = {
  getResumen: async (): Promise<any> => {
    const response = await api.get('/caja-fuerte/resumen');
    return response.data;
  },

  getMovimientos: async (params?: { skip?: number; limit?: number; tipo?: string; metodo_pago?: string; fecha_inicio?: string; fecha_fin?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.tipo) queryParams.append('tipo', params.tipo);
    if (params?.metodo_pago) queryParams.append('metodo_pago', params.metodo_pago);
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    const query = queryParams.toString();
    const response = await api.get(`/caja-fuerte/movimientos${query ? `?${query}` : ''}`);
    return response.data;
  },

  crearMovimiento: async (data: any): Promise<any> => {
    const response = await api.post('/caja-fuerte/movimientos', data);
    return response.data;
  },

  actualizarMovimiento: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/caja-fuerte/movimientos/${id}`, data);
    return response.data;
  },

  eliminarMovimiento: async (id: number, inventario?: any): Promise<any> => {
    if (inventario) {
      const response = await api.post(`/caja-fuerte/movimientos/${id}/eliminar`, inventario);
      return response.data;
    }
    const response = await api.delete(`/caja-fuerte/movimientos/${id}`);
    return response.data;
  },

  getInventario: async (): Promise<any> => {
    const response = await api.get('/caja-fuerte/inventario');
    return response.data;
  },

  updateInventario: async (data: any): Promise<any> => {
    const response = await api.put('/caja-fuerte/inventario', data);
    return response.data;
  },

  getMovimientoReciboPdf: async (id: number): Promise<Blob> => {
    const response = await api.get(`/caja-fuerte/movimientos/${id}/recibo-pdf`, { responseType: 'blob' });
    return response.data;
  },
};

// Instructores endpoints
export const instructoresAPI = {
  getAll: async (params?: { skip?: number; limit?: number; estado?: string; busqueda?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.estado) queryParams.append('estado', params.estado);
    if (params?.busqueda) queryParams.append('busqueda', params.busqueda);
    
    const url = queryParams.toString() ? `/instructores/?${queryParams.toString()}` : '/instructores/';
    const response = await api.get(url);
    return response.data;
  },

  getById: async (id: number): Promise<any> => {
    const response = await api.get(`/instructores/${id}`);
    return response.data;
  },

  create: async (data: any): Promise<any> => {
    const response = await api.post('/instructores/', data);
    return response.data;
  },

  update: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/instructores/${id}`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/instructores/${id}`);
  },

  getEstadisticas: async (id: number): Promise<any> => {
    const response = await api.get(`/instructores/${id}/estadisticas`);
    return response.data;
  },
};

// Reportes endpoints
export const reportesAPI = {
  getDashboard: async (params?: { fecha_inicio?: string; fecha_fin?: string; comparar_periodo_anterior?: boolean }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.comparar_periodo_anterior !== undefined) {
      queryParams.append('comparar_periodo_anterior', String(params.comparar_periodo_anterior));
    }
    const query = queryParams.toString();
    const response = await api.get(`/reportes/dashboard${query ? `?${query}` : ''}`);
    return response.data;
  },
  getAlertasOperativas: async (): Promise<any> => {
    const response = await api.get('/reportes/alertas-operativas');
    return response.data;
  },
  getAlertasVencimientos: async (params?: { dias?: number }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.dias !== undefined) queryParams.append('dias', params.dias.toString());
    const query = queryParams.toString();
    const response = await api.get(`/reportes/alertas-vencimientos${query ? `?${query}` : ''}`);
    return response.data;
  },
  getCierreFinanciero: async (params?: { fecha_inicio?: string; fecha_fin?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    const query = queryParams.toString();
    const response = await api.get(`/reportes/cierre-financiero${query ? `?${query}` : ''}`);
    return response.data;
  },
  getKpisClases: async (params?: { fecha_inicio?: string; fecha_fin?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    const query = queryParams.toString();
    const response = await api.get(`/reportes/kpis-clases${query ? `?${query}` : ''}`);
    return response.data;
  },
  getAsistenciaClasesDiaria: async (params?: { fecha_inicio?: string; fecha_fin?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    const query = queryParams.toString();
    const response = await api.get(`/reportes/asistencia-clases-diaria${query ? `?${query}` : ''}`);
    return response.data;
  },
};

export interface SaasTenantItem {
  id: number;
  slug: string;
  nombre: string;
  display_name?: string | null;
  logo_url?: string | null;
  contacto_nombre?: string | null;
  plan: string;
  plan_label?: string | null;
  is_active: boolean;
  is_demo: boolean;
  demo_ends_at?: string | null;
  contacto_email?: string | null;
  contacto_telefono?: string | null;
  admin_nombre_contacto?: string | null;
  admin_email_contacto?: string | null;
  admin_telefono_contacto?: string | null;
  subscription_status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  billing_cycle?: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY';
  monthly_fee?: number;
  base_fee_effective?: number;
  period_duration_days?: number;
  period_total?: number;
  period_subtotal?: number;
  iva_rate?: number;
  iva_amount?: number;
  active_branches_total?: number;
  active_additional_branches?: number;
  included_free_branches_used?: number;
  billable_branches?: number;
  extra_branch_fee?: number;
  branch_amount?: number;
  next_billing_at?: string | null;
  last_payment_at?: string | null;
  created_at: string;
}

export interface SaasBranchItem {
  id: number;
  tenant_id: number;
  nombre: string;
  codigo: string;
  is_active: boolean;
  is_primary: boolean;
  direccion?: string | null;
  ciudad?: string | null;
  contacto_telefono?: string | null;
  contacto_email?: string | null;
  observaciones?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SaasTenantBranchUserItem {
  user_id: number;
  email: string;
  nombre_completo: string;
  rol: string;
  is_active: boolean;
  branch_ids: number[];
  branch_access: Array<{ branch_id: number; is_active: boolean }>;
}

export interface SaasUserItem {
  id: number;
  email: string;
  nombre_completo: string;
  cedula: string;
  tipo_documento?: string | null;
  telefono?: string | null;
  rol: string;
  is_active: boolean;
  created_at: string;
  last_login?: string | null;
  must_change_password?: boolean;
  password_changed_at?: string | null;
  permisos_modulos?: string[];
}

export interface SaasAuditLogItem {
  id: number;
  actor_user_id: number;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  payload?: Record<string, any>;
  ip_address?: string | null;
  created_at: string;
}

export interface SaasLeadItem {
  id: number;
  escuela_nombre: string;
  contacto_nombre: string;
  contacto_email?: string | null;
  contacto_telefono?: string | null;
  ciudad?: string | null;
  source: string;
  plan_interes?: string | null;
  estado: string;
  valor_estimado_mrr?: number | null;
  owner_email: string;
  proxima_accion_at?: string | null;
  converted_tenant_id?: number | null;
  converted_admin_user_id?: number | null;
  converted_at?: string | null;
  notas?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SaasSupportTicketItem {
  id: number;
  tenant_id: number;
  tenant_slug?: string | null;
  tenant_nombre?: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  subject: string;
  description?: string | null;
  owner_email?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
  resolution_notes?: string | null;
  due_at?: string | null;
  due_in_hours?: number | null;
  sla_state?: 'NO_DUE_DATE' | 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'CLOSED';
  resolved_at?: string | null;
  last_sla_alert_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface SaasBillingEventItem {
  id: number;
  tenant_id: number;
  tenant_slug?: string | null;
  tenant_nombre?: string | null;
  event_type: string;
  status: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  due_at?: string | null;
  reference?: string | null;
  notes?: string | null;
  receipt_available?: boolean;
  receipt?: {
    id: number;
    receipt_number: string;
    subtotal_amount: number;
    iva_rate: number;
    iva_amount: number;
    total_amount: number;
    sent_to_email?: string | null;
    sent_at?: string | null;
    created_at: string;
  } | null;
  created_at: string;
}

export const saasAdminAPI = {
  getSummary: async (params?: { month_ref?: string }): Promise<{
    total_tenants: number;
    active_tenants: number;
    inactive_tenants: number;
    demo_tenants: number;
    demos_por_vencer: number;
    plan_counts: Record<string, number>;
    active_billable_tenants: number;
    mrr_estimado: number;
    mrr_real: number;
    ingresos_30d: number;
    pagos_30d: number;
    ingresos_mes_actual: number;
    ticket_promedio_30d: number;
    arpu_estimado: number;
    overdue_tenants: number;
    overdue_amount: number;
    revenue_analytics?: {
      period_current_start: string;
      period_current_end: string;
      period_previous_start: string;
      period_previous_end: string;
      starting_mrr: number;
      ending_mrr: number;
      new_mrr: number;
      expansion_mrr: number;
      contraction_mrr: number;
      churn_mrr: number;
      net_new_mrr: number;
      logo_churn: number;
      nrr_pct: number;
    };
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.month_ref) queryParams.append('month_ref', params.month_ref);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/summary${query ? `?${query}` : ''}`);
    return response.data;
  },
  getSummaryIncomeBreakdown: async (params?: {
    fecha_inicio?: string;
    fecha_fin?: string;
    limit?: number;
  }): Promise<{
    fecha_inicio?: string | null;
    fecha_fin?: string | null;
    total_amount: number;
    total_payments: number;
    by_tenant: Array<{
      tenant_id: number;
      tenant_slug?: string | null;
      tenant_nombre?: string | null;
      total_amount: number;
      payments_count: number;
      last_payment_at?: string | null;
    }>;
    payments: SaasBillingEventItem[];
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/summary/income-breakdown${query ? `?${query}` : ''}`);
    return response.data;
  },
  getSummaryDataQuality: async (): Promise<{
    generated_at: string;
    healthy: boolean;
    total_issues: number;
    checks: Array<{
      key: string;
      label: string;
      count: number;
      severity: 'warning' | 'critical';
    }>;
  }> => {
    const response = await api.get('/saas-admin/summary/data-quality');
    return response.data;
  },
  runSummaryDataQualityFix: async (
    checkKey: string
  ): Promise<{ ok: boolean; check_key: string; fixed_count: number; summary?: string }> => {
    const query = new URLSearchParams({ check_key: checkKey }).toString();
    const response = await api.post(`/saas-admin/summary/data-quality/fix?${query}`);
    return response.data;
  },
  getTenants: async (params?: {
    skip?: number;
    limit?: number;
    search?: string;
    plan?: string;
    is_demo?: boolean;
    is_active?: boolean;
  }): Promise<{ items: SaasTenantItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.plan) queryParams.append('plan', params.plan);
    if (params?.is_demo !== undefined) queryParams.append('is_demo', String(params.is_demo));
    if (params?.is_active !== undefined) queryParams.append('is_active', String(params.is_active));
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/tenants${query ? `?${query}` : ''}`);
    return response.data;
  },
  createTenant: async (data: {
    nombre_escuela: string;
    slug?: string | null;
    display_name?: string | null;
    plan?: 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE' | 'DEMO' | 'BASICO' | 'EMPRENDEDOR' | 'EMPRESA';
    contacto_nombre?: string | null;
    contacto_email: string;
    contacto_telefono?: string | null;
    nit?: string | null;
    logo_url?: string | null;
    admin_email: string;
    admin_password?: string | null;
    admin_nombre_completo: string;
    admin_cedula: string;
    admin_telefono?: string | null;
    send_welcome_email?: boolean;
    activate_tenant?: boolean;
  }): Promise<{
    tenant_id: number;
    tenant_slug: string;
    tenant_nombre: string;
    tenant_display_name: string;
    tenant_plan: string;
    tenant_activo: boolean;
    admin_user_id: number;
    admin_email: string;
    temporary_password: string;
    welcome_email_sent: boolean;
  }> => {
    const response = await api.post('/saas-admin/tenants', data);
    return response.data;
  },
  updateTenant: async (
    tenantId: number,
    data: {
      plan?: string;
      is_active?: boolean;
      is_demo?: boolean;
      demo_ends_at?: string | null;
      contacto_nombre?: string | null;
      contacto_email?: string | null;
      contacto_telefono?: string | null;
      subscription_status?: string;
      billing_cycle?: string;
      monthly_fee?: number;
      next_billing_at?: string | null;
      last_payment_at?: string | null;
    }
  ): Promise<SaasTenantItem> => {
    const response = await api.put(`/saas-admin/tenants/${tenantId}`, data);
    return response.data;
  },
  getTenantBranches: async (tenantId: number): Promise<{ items: SaasBranchItem[]; total: number }> => {
    const response = await api.get(`/saas-admin/tenants/${tenantId}/branches`);
    return response.data;
  },
  createTenantBranch: async (
    tenantId: number,
    data: {
      nombre: string;
      codigo?: string | null;
      direccion?: string | null;
      ciudad?: string | null;
      contacto_telefono?: string | null;
      contacto_email?: string | null;
      observaciones?: string | null;
      is_active?: boolean;
      is_primary?: boolean;
    }
  ): Promise<SaasBranchItem> => {
    const response = await api.post(`/saas-admin/tenants/${tenantId}/branches`, data);
    return response.data;
  },
  updateTenantBranch: async (
    tenantId: number,
    branchId: number,
    data: {
      nombre?: string;
      codigo?: string;
      direccion?: string | null;
      ciudad?: string | null;
      contacto_telefono?: string | null;
      contacto_email?: string | null;
      observaciones?: string | null;
      is_active?: boolean;
    }
  ): Promise<SaasBranchItem> => {
    const response = await api.put(`/saas-admin/tenants/${tenantId}/branches/${branchId}`, data);
    return response.data;
  },
  setPrimaryTenantBranch: async (
    tenantId: number,
    branchId: number
  ): Promise<SaasBranchItem> => {
    const response = await api.put(`/saas-admin/tenants/${tenantId}/branches/${branchId}/set-primary`);
    return response.data;
  },
  getTenantBranchUsers: async (
    tenantId: number,
    params?: { search?: string }
  ): Promise<{ items: SaasTenantBranchUserItem[]; total: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/tenants/${tenantId}/branch-users${query ? `?${query}` : ''}`);
    return response.data;
  },
  updateTenantUserBranchAccess: async (
    tenantId: number,
    userId: number,
    data: { branch_ids: number[]; is_active?: boolean; mode?: 'replace' | 'merge' }
  ): Promise<{ user_id: number; tenant_id: number; branch_ids: number[]; total_active: number }> => {
    const response = await api.put(`/saas-admin/tenants/${tenantId}/branch-users/${userId}`, data);
    return response.data;
  },
  resendTenantAccessLink: async (
    tenantId: number
  ): Promise<{ sent: boolean; to_email: string; access_link: string }> => {
    const response = await api.post(`/saas-admin/tenants/${tenantId}/resend-access-link`);
    return response.data;
  },
  getBillingEvents: async (params?: {
    skip?: number;
    limit?: number;
    tenant_id?: number;
    status?: string;
    event_type?: string;
    search?: string;
  }): Promise<{ items: SaasBillingEventItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.tenant_id !== undefined) queryParams.append('tenant_id', params.tenant_id.toString());
    if (params?.status) queryParams.append('status', params.status);
    if (params?.event_type) queryParams.append('event_type', params.event_type);
    if (params?.search) queryParams.append('search', params.search);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/billing/events${query ? `?${query}` : ''}`);
    return response.data;
  },
  recordTenantPayment: async (
    tenantId: number,
    data: {
      amount?: number;
      paid_at?: string | null;
      reference?: string | null;
      notes?: string | null;
      next_billing_at?: string | null;
      set_status_active?: boolean;
    }
  ): Promise<{ tenant: Partial<SaasTenantItem>; event: SaasBillingEventItem; receipt?: any; receipt_sent?: boolean; receipts_enabled?: boolean }> => {
    const response = await api.post(`/saas-admin/billing/tenants/${tenantId}/record-payment`, data);
    return response.data;
  },
  downloadBillingReceipt: async (eventId: number): Promise<Blob> => {
    const response = await api.get(`/saas-admin/billing/events/${eventId}/receipt/download`, {
      responseType: 'blob',
    });
    return response.data;
  },
  resendBillingReceipt: async (
    eventId: number,
    data?: { to_email?: string | null }
  ): Promise<{ sent: boolean; to_email: string; receipt?: any }> => {
    const response = await api.post(`/saas-admin/billing/events/${eventId}/receipt/resend`, data || {});
    return response.data;
  },
  runBillingOverdueCheck: async (): Promise<{ updated_tenants: number }> => {
    const response = await api.post('/saas-admin/billing/run-overdue-check');
    return response.data;
  },
  runBillingCycleCharges: async (): Promise<{ created_events: number }> => {
    const response = await api.post('/saas-admin/billing/run-cycle-charges');
    return response.data;
  },
  sendBillingOverdueReminders: async (): Promise<{ evaluated: number; sent: number; stage_counts?: Record<string, number> }> => {
    const response = await api.post('/saas-admin/billing/send-overdue-reminders');
    return response.data;
  },
  getBillingDunningSummary: async (): Promise<{
    generated_at: string;
    window_days: number;
    due_soon_3d: number;
    past_due_total: number;
    in_sequence: number;
    reminders_sent_30d: number;
    stage_counts: Record<string, number>;
    payments_after_reminder_30d: number;
    recovered_after_reminder_30d: number;
    stage_recovery: Record<string, { payments: number; amount: number }>;
    stage_conversion_pct: Record<string, number>;
    monthly_performance: Array<{
      month: string;
      reminders_sent: number;
      recovered_payments: number;
      recovered_amount: number;
    }>;
  }> => {
    const response = await api.get('/saas-admin/billing/dunning-summary');
    return response.data;
  },
  exportBillingDunningSummaryCsv: async (): Promise<Blob> => {
    const response = await api.get('/saas-admin/billing/dunning-summary/export.csv', {
      responseType: 'blob',
    });
    return response.data;
  },
  getBillingAgingSummary: async (): Promise<{
    generated_at: string;
    total_past_due_tenants: number;
    total_past_due_amount: number;
    buckets: {
      '0_30': { tenants: number; amount: number };
      '31_60': { tenants: number; amount: number };
      '61_plus': { tenants: number; amount: number };
    };
  }> => {
    const response = await api.get('/saas-admin/billing/aging-summary');
    return response.data;
  },
  getSupportSummary: async (): Promise<{
    status_counts: Record<string, number>;
    priority_counts: Record<string, number>;
    open_total: number;
    overdue_open: number;
    due_soon_open: number;
  }> => {
    const response = await api.get('/saas-admin/support/summary');
    return response.data;
  },
  getSupportTickets: async (params?: {
    skip?: number;
    limit?: number;
    search?: string;
    status?: string;
    priority?: string;
    tenant_id?: number;
  }): Promise<{ items: SaasSupportTicketItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.priority) queryParams.append('priority', params.priority);
    if (params?.tenant_id !== undefined) queryParams.append('tenant_id', params.tenant_id.toString());
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/support/tickets${query ? `?${query}` : ''}`);
    return response.data;
  },
  createSupportTicket: async (data: {
    tenant_id: number;
    subject: string;
    description?: string | null;
    category?: string;
    priority?: string;
    requester_name?: string | null;
    requester_email?: string | null;
    requester_phone?: string | null;
    due_at?: string | null;
  }): Promise<SaasSupportTicketItem> => {
    const response = await api.post('/saas-admin/support/tickets', data);
    return response.data;
  },
  updateSupportTicket: async (
    ticketId: number,
    data: {
      status?: string;
      priority?: string;
      category?: string;
      subject?: string;
      description?: string | null;
      owner_email?: string | null;
      requester_name?: string | null;
      requester_email?: string | null;
      requester_phone?: string | null;
      due_at?: string | null;
      resolution_notes?: string | null;
    }
  ): Promise<SaasSupportTicketItem> => {
    const response = await api.put(`/saas-admin/support/tickets/${ticketId}`, data);
    return response.data;
  },
  runSupportSlaAlerts: async (): Promise<{ evaluated: number; sent: number }> => {
    const response = await api.post('/saas-admin/support/run-sla-alerts');
    return response.data;
  },
  getUsers: async (params?: {
    skip?: number;
    limit?: number;
    search?: string;
    is_active?: boolean;
  }): Promise<{ items: SaasUserItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.is_active !== undefined) queryParams.append('is_active', String(params.is_active));
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/users${query ? `?${query}` : ''}`);
    return response.data;
  },
  createUser: async (data: {
    email: string;
    password: string;
    nombre_completo: string;
    cedula: string;
    tipo_documento?: string;
    telefono?: string | null;
    rol: string;
    is_active?: boolean;
    permisos_modulos?: string[];
  }): Promise<SaasUserItem> => {
    const response = await api.post('/saas-admin/users', data);
    return response.data;
  },
  updateUser: async (
    userId: number,
    data: {
      nombre_completo?: string;
      telefono?: string | null;
      rol?: string;
      is_active?: boolean;
      permisos_modulos?: string[];
    }
  ): Promise<SaasUserItem> => {
    const response = await api.put(`/saas-admin/users/${userId}`, data);
    return response.data;
  },
  resetUserPassword: async (userId: number, newPassword: string): Promise<void> => {
    await api.put(`/saas-admin/users/${userId}/password`, { new_password: newPassword });
  },
  getAuditLogs: async (params?: {
    skip?: number;
    limit?: number;
    action?: string;
    search?: string;
  }): Promise<{ items: SaasAuditLogItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.action) queryParams.append('action', params.action);
    if (params?.search) queryParams.append('search', params.search);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/audit-logs${query ? `?${query}` : ''}`);
    return response.data;
  },
  exportAuditLogsCsv: async (params?: { action?: string; search?: string }): Promise<Blob> => {
    const queryParams = new URLSearchParams();
    if (params?.action) queryParams.append('action', params.action);
    if (params?.search) queryParams.append('search', params.search);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/audit-logs/export.csv${query ? `?${query}` : ''}`, {
      responseType: 'blob',
    });
    return response.data;
  },
  getPipelineSummary: async (): Promise<{
    total_leads: number;
    stage_counts: Record<string, number>;
    mrr_potencial: number;
    mrr_cerrado: number;
    overdue_followups: number;
  }> => {
    const response = await api.get('/saas-admin/pipeline/summary');
    return response.data;
  },
  getLeads: async (params?: {
    skip?: number;
    limit?: number;
    search?: string;
    estado?: string;
  }): Promise<{ items: SaasLeadItem[]; total: number; skip: number; limit: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.estado) queryParams.append('estado', params.estado);
    const query = queryParams.toString();
    const response = await api.get(`/saas-admin/pipeline/leads${query ? `?${query}` : ''}`);
    return response.data;
  },
  createLead: async (data: {
    escuela_nombre: string;
    contacto_nombre: string;
    contacto_email?: string | null;
    contacto_telefono?: string | null;
    ciudad?: string | null;
    source?: string;
    plan_interes?: string | null;
    estado?: string;
    valor_estimado_mrr?: number | null;
    proxima_accion_at?: string | null;
    notas?: string | null;
  }): Promise<SaasLeadItem> => {
    const response = await api.post('/saas-admin/pipeline/leads', data);
    return response.data;
  },
  updateLead: async (
    leadId: number,
    data: {
      escuela_nombre?: string;
      contacto_nombre?: string;
      contacto_email?: string | null;
      contacto_telefono?: string | null;
      ciudad?: string | null;
      source?: string;
      plan_interes?: string | null;
      estado?: string;
      valor_estimado_mrr?: number | null;
      proxima_accion_at?: string | null;
      notas?: string | null;
    }
  ): Promise<SaasLeadItem> => {
    const response = await api.put(`/saas-admin/pipeline/leads/${leadId}`, data);
    return response.data;
  },
  convertLeadToTenant: async (
    leadId: number,
    data: {
      admin_email: string;
      admin_nombre_completo: string;
      admin_cedula: string;
      admin_telefono?: string | null;
      admin_password?: string | null;
    }
  ): Promise<{
    lead: SaasLeadItem;
    tenant: {
      id: number;
      slug: string;
      nombre: string;
      plan: string;
      is_demo: boolean;
      demo_ends_at?: string | null;
    };
    admin_user: {
      id: number;
      email: string;
      must_change_password: boolean;
      temporary_password: string;
    };
  }> => {
    const response = await api.post(`/saas-admin/pipeline/leads/${leadId}/convert-to-tenant`, data);
    return response.data;
  },
};

export const tenantSupportAPI = {
  getMyTickets: async (params?: {
    skip?: number;
    limit?: number;
    search?: string;
    status?: string;
    priority?: string;
  }): Promise<{ items: SaasSupportTicketItem[]; total: number; skip: number; limit: number; requester_email?: string }> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.priority) queryParams.append('priority', params.priority);
    const query = queryParams.toString();
    const response = await api.get(`/support/my-tickets${query ? `?${query}` : ''}`);
    return response.data;
  },
  createMyTicket: async (data: {
    subject: string;
    description?: string | null;
    category?: string | null;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Promise<SaasSupportTicketItem> => {
    const response = await api.post('/support/my-tickets', data);
    return response.data;
  },
};

// Vehículos endpoints
export const vehiculosAPI = {
  getAll: async (params?: { skip?: number; limit?: number; search?: string; activo?: boolean }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.activo !== undefined) queryParams.append('activo', String(params.activo));
    const query = queryParams.toString();
    const response = await api.get(`/vehiculos/${query ? `?${query}` : ''}`);
    return response.data;
  },

  getById: async (id: number): Promise<any> => {
    const response = await api.get(`/vehiculos/${id}`);
    return response.data;
  },

  create: async (data: any): Promise<any> => {
    const response = await api.post('/vehiculos/', data);
    return response.data;
  },

  update: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/vehiculos/${id}`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/vehiculos/${id}`);
  },

  getMantenimientos: async (vehiculoId: number): Promise<any> => {
    const response = await api.get(`/vehiculos/${vehiculoId}/mantenimientos`);
    return response.data;
  },

  getMantenimientosPaged: async (
    vehiculoId: number,
    params?: { skip?: number; limit?: number; fecha_inicio?: string; fecha_fin?: string; orden?: string }
  ): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.orden) queryParams.append('orden', params.orden);
    const query = queryParams.toString();
    const response = await api.get(`/vehiculos/${vehiculoId}/mantenimientos${query ? `?${query}` : ''}`);
    return response.data;
  },

  createMantenimiento: async (vehiculoId: number, data: any): Promise<any> => {
    const response = await api.post(`/vehiculos/${vehiculoId}/mantenimientos`, data);
    return response.data;
  },

  updateMantenimiento: async (vehiculoId: number, mantenimientoId: number, data: any): Promise<any> => {
    const response = await api.put(`/vehiculos/${vehiculoId}/mantenimientos/${mantenimientoId}`, data);
    return response.data;
  },

  addRepuesto: async (vehiculoId: number, mantenimientoId: number, data: any): Promise<any> => {
    const response = await api.post(`/vehiculos/${vehiculoId}/mantenimientos/${mantenimientoId}/repuestos`, data);
    return response.data;
  },

  getCombustibles: async (vehiculoId: number): Promise<any> => {
    const response = await api.get(`/vehiculos/${vehiculoId}/combustible`);
    return response.data;
  },

  getCombustiblesPaged: async (
    vehiculoId: number,
    params?: { skip?: number; limit?: number; fecha_inicio?: string; fecha_fin?: string; conductor?: string; orden?: string }
  ): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.skip !== undefined) queryParams.append('skip', params.skip.toString());
    if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.conductor) queryParams.append('conductor', params.conductor);
    if (params?.orden) queryParams.append('orden', params.orden);
    const query = queryParams.toString();
    const response = await api.get(`/vehiculos/${vehiculoId}/combustible${query ? `?${query}` : ''}`);
    return response.data;
  },

  createCombustible: async (vehiculoId: number, data: any): Promise<any> => {
    const response = await api.post(`/vehiculos/${vehiculoId}/combustible`, data);
    return response.data;
  },

  addMantenimientoAdjuntos: async (vehiculoId: number, mantenimientoId: number, archivos: File[]): Promise<any> => {
    const formData = new FormData();
    archivos.forEach((archivo) => formData.append('archivos', archivo));
    const response = await api.post(`/vehiculos/${vehiculoId}/mantenimientos/${mantenimientoId}/adjuntos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  addCombustibleAdjuntos: async (vehiculoId: number, combustibleId: number, archivos: File[]): Promise<any> => {
    const formData = new FormData();
    archivos.forEach((archivo) => formData.append('archivos', archivo));
    const response = await api.post(`/vehiculos/${vehiculoId}/combustible/${combustibleId}/adjuntos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  getCombustibleResumen: async (
    vehiculoId: number,
    params?: { fecha_inicio?: string; fecha_fin?: string; conductor?: string }
  ): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.fecha_inicio) queryParams.append('fecha_inicio', params.fecha_inicio);
    if (params?.fecha_fin) queryParams.append('fecha_fin', params.fecha_fin);
    if (params?.conductor) queryParams.append('conductor', params.conductor);
    const query = queryParams.toString();
    const response = await api.get(`/vehiculos/${vehiculoId}/combustible/resumen${query ? `?${query}` : ''}`);
    return response.data;
  },

  getConsumoUmbral: async (tipo: string): Promise<any> => {
    const response = await api.get(`/vehiculos/consumo-umbrales/${tipo}`);
    return response.data;
  },

  upsertConsumoUmbral: async (tipo: string, km_por_galon_min: number): Promise<any> => {
    const response = await api.put(`/vehiculos/consumo-umbrales/${tipo}`, { km_por_galon_min });
    return response.data;
  },

  getExportData: async (
    vehiculoId: number,
    params?: {
      mant_fecha_inicio?: string;
      mant_fecha_fin?: string;
      comb_fecha_inicio?: string;
      comb_fecha_fin?: string;
      comb_conductor?: string;
    }
  ): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.mant_fecha_inicio) queryParams.append('mant_fecha_inicio', params.mant_fecha_inicio);
    if (params?.mant_fecha_fin) queryParams.append('mant_fecha_fin', params.mant_fecha_fin);
    if (params?.comb_fecha_inicio) queryParams.append('comb_fecha_inicio', params.comb_fecha_inicio);
    if (params?.comb_fecha_fin) queryParams.append('comb_fecha_fin', params.comb_fecha_fin);
    if (params?.comb_conductor) queryParams.append('comb_conductor', params.comb_conductor);
    const query = queryParams.toString();
    const response = await api.get(`/vehiculos/${vehiculoId}/export-data${query ? `?${query}` : ''}`);
    return response.data;
  }
};

// Tarifas endpoints
export const tarifasAPI = {
  getAll: async (): Promise<any> => {
    const response = await api.get('/tarifas');
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post('/tarifas', data);
    return response.data;
  },
  update: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/tarifas/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await api.delete(`/tarifas/${id}`);
  }
};

export interface ConceptoIngresoTenant {
  id: number;
  nombre: string;
  categoria: string;
  valor_default: number;
  activo: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface ConceptoIngresoCreatePayload {
  nombre: string;
  categoria: string;
  valor_default: number;
  activo?: boolean;
}

export interface ConceptoIngresoUpdatePayload {
  nombre?: string;
  categoria?: string;
  valor_default?: number;
  activo?: boolean;
}

export const conceptosIngresoAPI = {
  getAll: async (params?: { include_inactivos?: boolean }): Promise<ConceptoIngresoTenant[]> => {
    const queryParams = new URLSearchParams();
    if (params?.include_inactivos) queryParams.append('include_inactivos', 'true');
    const query = queryParams.toString();
    const response = await api.get<ConceptoIngresoTenant[]>(`/conceptos-ingreso${query ? `?${query}` : ''}`);
    return response.data;
  },
  create: async (data: ConceptoIngresoCreatePayload): Promise<ConceptoIngresoTenant> => {
    const response = await api.post<ConceptoIngresoTenant>('/conceptos-ingreso', data);
    return response.data;
  },
  update: async (id: number, data: ConceptoIngresoUpdatePayload): Promise<ConceptoIngresoTenant> => {
    const response = await api.put<ConceptoIngresoTenant>(`/conceptos-ingreso/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await api.delete(`/conceptos-ingreso/${id}`);
  }
};

export interface TenantServiceRule {
  tipo_servicio: string;
  horas_teoricas_requeridas: number;
  horas_practicas_requeridas: number;
  activo: boolean;
  es_personalizado: boolean;
  updated_at?: string | null;
}

export const tenantServiceRulesAPI = {
  getAll: async (): Promise<TenantServiceRule[]> => {
    const response = await api.get<TenantServiceRule[]>('/tenant-service-rules');
    return response.data;
  },
  upsert: async (
    tipoServicio: string,
    data: { horas_teoricas_requeridas: number; horas_practicas_requeridas: number; activo?: boolean }
  ): Promise<TenantServiceRule> => {
    const response = await api.put<TenantServiceRule>(`/tenant-service-rules/${tipoServicio}`, data);
    return response.data;
  },
  reset: async (tipoServicio: string): Promise<TenantServiceRule> => {
    const response = await api.delete<TenantServiceRule>(`/tenant-service-rules/${tipoServicio}`);
    return response.data;
  }
};

// Usuarios endpoints
export const usuariosAPI = {
  getAll: async (params?: { search?: string }): Promise<any> => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    const query = queryParams.toString();
    const response = await api.get(`/usuarios${query ? `?${query}` : ''}`);
    return response.data;
  },
  create: async (data: any): Promise<any> => {
    const response = await api.post('/usuarios', data);
    return response.data;
  },
  update: async (id: number, data: any): Promise<any> => {
    const response = await api.put(`/usuarios/${id}`, data);
    return response.data;
  },
  resetPassword: async (id: number, new_password: string): Promise<void> => {
    await api.put(`/usuarios/${id}/password`, { new_password });
  }
};

// Uploads endpoints
export const uploadsAPI = {
  uploadVehiculoFoto: async (foto_base64: string, vehiculo_id?: number): Promise<any> => {
    const response = await api.post('/uploads/vehiculo/foto', { foto_base64, vehiculo_id });
    return response.data;
  },

  uploadReciboCombustible: async (archivo: File, vehiculo_id?: number): Promise<any> => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    if (vehiculo_id !== undefined) {
      formData.append('vehiculo_id', String(vehiculo_id));
    }
    const response = await api.post('/uploads/vehiculo/recibo-combustible', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },
};

export default api;
