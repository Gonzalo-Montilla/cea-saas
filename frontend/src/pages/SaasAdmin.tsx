import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Building2, DollarSign, Eye, EyeOff, Rocket } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import {
  saasAdminAPI,
  type SaasAuditLogItem,
  type SaasBillingEventItem,
  type SaasLeadItem,
  type SaasSupportTicketItem,
  type SaasTenantItem,
  type SaasUserItem,
} from '../services/api';
import '../styles/SaasAdmin.css';

const PLANS = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED'];
const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const SAAS_ROLES = ['ADMIN', 'GERENTE'];
const SAAS_PERMISSION_PROFILES: Record<string, { label: string; scopes: string[] }> = {
  OWNER: { label: 'Owner (acceso total)', scopes: ['saas_admin'] },
  COMERCIAL: { label: 'Comercial', scopes: ['saas_pipeline_manage', 'saas_tenants_manage'] },
  FINANZAS: { label: 'Finanzas', scopes: ['saas_billing_manage', 'saas_audit_read'] },
  SOPORTE: { label: 'Soporte', scopes: ['saas_support_manage', 'saas_tenants_manage', 'saas_audit_read'] },
};
const AUDIT_ACTIONS = [
  '',
  'tenant.created',
  'tenant.updated',
  'saas_user.created',
  'saas_user.updated',
  'saas_user.password_reset',
  'lead.created',
  'lead.updated',
  'lead.converted_to_tenant',
  'mfa.setup_generated',
  'mfa.enabled',
  'mfa.disabled',
  'mfa.backup_codes_regenerated',
  'mfa.backup_code_used',
  'billing.payment_recorded',
  'billing.overdue_check_run',
  'billing.cycle_charges_run',
  'billing.overdue_reminders_sent',
  'support.ticket_created',
  'support.ticket_updated',
  'support.ticket_in_progress_notified',
  'support.ticket_resolution_notified',
  'support.sla_alert_sent',
  'support.sla_alerts_run',
  'tenant.access_link_resent',
];
const LEAD_STAGES = ['NUEVO', 'CONTACTADO', 'DEMO_AGENDADA', 'PROPUESTA_ENVIADA', 'CERRADO_GANADO', 'CERRADO_PERDIDO'];
const SUPPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];
const SUPPORT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const RESUMEN_PERIODS = [
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: '90d', label: 'Últimos 90 días' },
  { value: 'all', label: 'Histórico' },
] as const;

const money = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value || 0);

const dateCell = (value?: string | null) => (value ? new Date(value).toLocaleDateString('es-CO') : '-');
const statusClass = (value?: string | null) => `bo-status bo-status-${String(value || 'info').toLowerCase()}`;

const normalizeScopes = (scopes?: string[]) =>
  (scopes || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort();

const detectPermissionProfile = (scopes?: string[]) => {
  const normalized = normalizeScopes(scopes);
  for (const [key, value] of Object.entries(SAAS_PERMISSION_PROFILES)) {
    const target = normalizeScopes(value.scopes);
    if (target.length === normalized.length && target.every((x, i) => x === normalized[i])) return key;
  }
  return 'CUSTOM';
};

export const SaasAdmin = () => {
  const location = useLocation();
  const { user, refreshUser } = useAuth();
  const scopes = (user?.permisos_modulos || []).map((x) => String(x).trim().toLowerCase());
  const isOwnerScope = scopes.includes('saas_admin');
  const canTenants = isOwnerScope || scopes.includes('saas_tenants_manage');
  const canBilling = isOwnerScope || scopes.includes('saas_billing_manage');
  const canUsers = isOwnerScope || scopes.includes('saas_users_manage');
  const canAudit = isOwnerScope || scopes.includes('saas_audit_read');
  const canPipeline = isOwnerScope || scopes.includes('saas_pipeline_manage');
  const canSupport = isOwnerScope || scopes.includes('saas_support_manage');
  const saasView = useMemo(() => {
    const clean = location.pathname.replace('/saas-admin', '').replace(/^\/+/, '');
    const value = (clean.split('/')[0] || 'resumen').toLowerCase();
    if (['resumen', 'tenants', 'billing', 'pipeline', 'support', 'users', 'audit', 'security'].includes(value)) {
      return value;
    }
    return 'resumen';
  }, [location.pathname]);
  const viewAccess = useMemo(() => ({
    resumen: true,
    tenants: canTenants || canBilling,
    billing: canBilling,
    pipeline: canPipeline,
    support: canSupport,
    users: canUsers,
    audit: canAudit,
    security: true,
  }), [canTenants, canBilling, canPipeline, canSupport, canUsers, canAudit]);
  const hasCurrentViewAccess = viewAccess[saasView as keyof typeof viewAccess] ?? true;
  const availableViewLabels = useMemo(() => {
    const labels: Record<string, string> = {
      resumen: 'Resumen',
      tenants: 'Tenants',
      billing: 'Facturación',
      pipeline: 'Pipeline',
      support: 'Soporte',
      users: 'Usuarios SaaS',
      audit: 'Auditoría',
      security: 'Seguridad',
    };
    return Object.entries(viewAccess)
      .filter(([, allowed]) => allowed)
      .map(([key]) => labels[key])
      .join(' | ');
  }, [viewAccess]);
  const [summary, setSummary] = useState<any>(null);
  const [pipelineSummary, setPipelineSummary] = useState<any>(null);
  const [agingSummary, setAgingSummary] = useState<any>(null);
  const [tenants, setTenants] = useState<SaasTenantItem[]>([]);
  const [users, setUsers] = useState<SaasUserItem[]>([]);
  const [leads, setLeads] = useState<SaasLeadItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<SaasAuditLogItem[]>([]);
  const [billingEvents, setBillingEvents] = useState<SaasBillingEventItem[]>([]);
  const [supportSummary, setSupportSummary] = useState<any>(null);
  const [supportTickets, setSupportTickets] = useState<SaasSupportTicketItem[]>([]);
  const [resumenLeads, setResumenLeads] = useState<SaasLeadItem[]>([]);
  const [resumenSupportTickets, setResumenSupportTickets] = useState<SaasSupportTicketItem[]>([]);
  const [search, setSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [billingSearch, setBillingSearch] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadStage, setLeadStage] = useState('');
  const [supportSearch, setSupportSearch] = useState('');
  const [resumenPeriod, setResumenPeriod] = useState<(typeof RESUMEN_PERIODS)[number]['value']>('30d');
  const [tenantMonthlyFeeDrafts, setTenantMonthlyFeeDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [resumenLoading, setResumenLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditSkip, setAuditSkip] = useState(0);
  const [auditLimit, setAuditLimit] = useState(50);
  const [auditTotal, setAuditTotal] = useState(0);
  const [billingSkip, setBillingSkip] = useState(0);
  const [billingLimit, setBillingLimit] = useState(50);
  const [billingTotal, setBillingTotal] = useState(0);
  const [supportSkip, setSupportSkip] = useState(0);
  const [supportLimit, setSupportLimit] = useState(50);
  const [supportTotal, setSupportTotal] = useState(0);
  const [savingTenantId, setSavingTenantId] = useState<number | null>(null);
  const [resendingAccessLinkTenantId, setResendingAccessLinkTenantId] = useState<number | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [processingOverdueCheck, setProcessingOverdueCheck] = useState(false);
  const [processingCycleCharges, setProcessingCycleCharges] = useState(false);
  const [sendingOverdueReminders, setSendingOverdueReminders] = useState(false);
  const [savingLeadId, setSavingLeadId] = useState<number | null>(null);
  const [savingSupportTicketId, setSavingSupportTicketId] = useState<number | null>(null);
  const [processingSupportAlerts, setProcessingSupportAlerts] = useState(false);
  const [submittingConversion, setSubmittingConversion] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [conversionModalLead, setConversionModalLead] = useState<SaasLeadItem | null>(null);
  const [createTenantModalOpen, setCreateTenantModalOpen] = useState(false);
  const [paymentModalTenant, setPaymentModalTenant] = useState<SaasTenantItem | null>(null);
  const [supportDescriptionModal, setSupportDescriptionModal] = useState<null | {
    ticketId: number;
    tenantName: string;
    subject: string;
    description: string;
  }>(null);
  const [conversionError, setConversionError] = useState('');
  const [conversionResult, setConversionResult] = useState<null | {
    tenantSlug: string;
    adminEmail: string;
    temporaryPassword: string;
  }>(null);
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [credentialsCopied, setCredentialsCopied] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [createTenantSuccessModal, setCreateTenantSuccessModal] = useState<null | {
    tenantSlug: string;
    adminEmail: string;
    temporaryPassword: string;
    welcomeEmailSent: boolean;
  }>(null);
  const [createTenantLogoFileName, setCreateTenantLogoFileName] = useState('');
  const [processingCreateTenantLogo, setProcessingCreateTenantLogo] = useState(false);
  const [conversionForm, setConversionForm] = useState({
    admin_email: '',
    admin_nombre_completo: '',
    admin_cedula: '',
    admin_telefono: '',
    admin_password: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paid_at: '',
    reference: '',
    notes: '',
    set_status_active: true,
  });
  const [mfaSetup, setMfaSetup] = useState<null | { secret: string; otpauth_url: string; qr_url: string }>(null);
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[]>([]);
  const [mfaEnableCode, setMfaEnableCode] = useState('');
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  const [mfaRegenPassword, setMfaRegenPassword] = useState('');
  const [mfaRegenCode, setMfaRegenCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaMessage, setMfaMessage] = useState('');
  const [mfaCodesCopied, setMfaCodesCopied] = useState(false);
  const [mfaCodesAcknowledge, setMfaCodesAcknowledge] = useState(false);
  const [closingAllSessions, setClosingAllSessions] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    nombre_completo: '',
    cedula: '',
    telefono: '',
    rol: 'ADMIN',
    permisos_modulos: 'saas_admin',
  });
  const [newUserProfile, setNewUserProfile] = useState('OWNER');
  const [newLead, setNewLead] = useState({
    escuela_nombre: '',
    contacto_nombre: '',
    contacto_email: '',
    contacto_telefono: '',
    ciudad: '',
    source: 'manual',
    plan_interes: 'BASIC',
    estado: 'NUEVO',
    valor_estimado_mrr: '',
    proxima_accion_at: '',
    notas: '',
  });
  const [createTenantForm, setCreateTenantForm] = useState({
    nombre_escuela: '',
    slug: '',
    display_name: '',
    plan: 'FREE',
    contacto_email: '',
    contacto_telefono: '',
    nit: '',
    logo_url: '',
    admin_email: '',
    admin_password: '',
    admin_nombre_completo: '',
    admin_cedula: '',
    admin_telefono: '',
    send_welcome_email: true,
    activate_tenant: true,
  });

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result.startsWith('data:image')) {
          reject(new Error('No se pudo procesar la imagen del logo'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo del logo'));
      reader.readAsDataURL(file);
    });

  const handleCreateTenantLogoFileChange = async (file: File | null) => {
    if (!file) {
      setCreateTenantLogoFileName('');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('El archivo del logo debe ser una imagen');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('El logo no puede superar 2MB');
      return;
    }
    try {
      setProcessingCreateTenantLogo(true);
      const dataUrl = await fileToDataUrl(file);
      setError('');
      setCreateTenantLogoFileName(file.name);
      setCreateTenantForm((prev) => ({ ...prev, logo_url: dataUrl }));
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la imagen del logo');
      setCreateTenantLogoFileName('');
    } finally {
      setProcessingCreateTenantLogo(false);
    }
  };

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

  const loadPipeline = async () => {
    try {
      setLeadsLoading(true);
      setError('');
      const [pipelineData, leadsData] = await Promise.all([
        saasAdminAPI.getPipelineSummary(),
        saasAdminAPI.getLeads({
          limit: 200,
          search: leadSearch.trim() || undefined,
          estado: leadStage || undefined,
        }),
      ]);
      setPipelineSummary(pipelineData);
      setLeads(leadsData.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar pipeline comercial');
    } finally {
      setLeadsLoading(false);
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

  const loadAuditLogs = async (pageSkip = auditSkip, pageLimit = auditLimit) => {
    try {
      setAuditLoading(true);
      setError('');
      const auditData = await saasAdminAPI.getAuditLogs({
        skip: pageSkip,
        limit: pageLimit,
        search: auditSearch.trim() || undefined,
        action: auditAction || undefined,
      });
      setAuditLogs(auditData.items || []);
      setAuditSkip(Number(auditData.skip || 0));
      setAuditLimit(Number(auditData.limit || pageLimit));
      setAuditTotal(Number(auditData.total || 0));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar auditoría SaaS');
    } finally {
      setAuditLoading(false);
    }
  };

  const loadBillingEvents = async (pageSkip = billingSkip, pageLimit = billingLimit) => {
    try {
      setBillingLoading(true);
      setError('');
      const [data, aging] = await Promise.all([
        saasAdminAPI.getBillingEvents({
          skip: pageSkip,
          limit: pageLimit,
          search: billingSearch.trim() || undefined,
        }),
        saasAdminAPI.getBillingAgingSummary(),
      ]);
      setBillingEvents(data.items || []);
      setBillingSkip(Number(data.skip || 0));
      setBillingLimit(Number(data.limit || pageLimit));
      setBillingTotal(Number(data.total || 0));
      setAgingSummary(aging);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar historial de cobros');
    } finally {
      setBillingLoading(false);
    }
  };

  const loadSupportTickets = async (pageSkip = supportSkip, pageLimit = supportLimit) => {
    try {
      setSupportLoading(true);
      setError('');
      const [summaryData, ticketsData] = await Promise.all([
        saasAdminAPI.getSupportSummary(),
        saasAdminAPI.getSupportTickets({
          skip: pageSkip,
          limit: pageLimit,
          search: supportSearch.trim() || undefined,
        }),
      ]);
      setSupportSummary(summaryData);
      setSupportTickets(ticketsData.items || []);
      setSupportSkip(Number(ticketsData.skip || 0));
      setSupportLimit(Number(ticketsData.limit || pageLimit));
      setSupportTotal(Number(ticketsData.total || 0));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo cargar soporte SaaS');
    } finally {
      setSupportLoading(false);
    }
  };

  const loadResumenInsights = async () => {
    try {
      setResumenLoading(true);
      const tasks: Promise<void>[] = [];
      if (canBilling) {
        tasks.push(
          (async () => {
            const [aging, events] = await Promise.all([
              saasAdminAPI.getBillingAgingSummary(),
              saasAdminAPI.getBillingEvents({ limit: 200 }),
            ]);
            setAgingSummary(aging);
            setBillingEvents(events.items || []);
          })()
        );
      }
      if (canPipeline) {
        tasks.push(
          (async () => {
            const [pipelineData, leadsData] = await Promise.all([
              saasAdminAPI.getPipelineSummary(),
              saasAdminAPI.getLeads({ limit: 300 }),
            ]);
            setPipelineSummary(pipelineData);
            setResumenLeads(leadsData.items || []);
          })()
        );
      }
      if (canSupport) {
        tasks.push(
          (async () => {
            const [supportData, ticketsData] = await Promise.all([
              saasAdminAPI.getSupportSummary(),
              saasAdminAPI.getSupportTickets({ limit: 300 }),
            ]);
            setSupportSummary(supportData);
            setResumenSupportTickets(ticketsData.items || []);
          })()
        );
      }
      await Promise.all(tasks);
    } catch {
      // Resumen debe seguir visible incluso si un bloque no carga.
    } finally {
      setResumenLoading(false);
    }
  };

  useEffect(() => {
    if ((saasView === 'resumen' || saasView === 'tenants') && (canTenants || canBilling)) void loadData();
    if (saasView === 'resumen') void loadResumenInsights();
    if (saasView === 'billing' && canBilling) void loadBillingEvents(billingSkip, billingLimit);
    if (saasView === 'users' && canUsers) void loadUsers();
    if (saasView === 'pipeline' && canPipeline) void loadPipeline();
    if (saasView === 'support' && canSupport) void loadSupportTickets(supportSkip, supportLimit);
    if ((saasView === 'audit' || saasView === 'security') && canAudit) void loadAuditLogs(auditSkip, auditLimit);
  }, [canTenants, canBilling, canUsers, canPipeline, canSupport, canAudit, saasView]);

  const auditPage = Math.floor(auditSkip / Math.max(auditLimit, 1)) + 1;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / Math.max(auditLimit, 1)));
  const auditFrom = auditTotal === 0 ? 0 : auditSkip + 1;
  const auditTo = Math.min(auditSkip + auditLogs.length, auditTotal);
  const canAuditPrev = auditSkip > 0;
  const canAuditNext = auditSkip + auditLimit < auditTotal;
  const billingPage = Math.floor(billingSkip / Math.max(billingLimit, 1)) + 1;
  const billingTotalPages = Math.max(1, Math.ceil(billingTotal / Math.max(billingLimit, 1)));
  const billingFrom = billingTotal === 0 ? 0 : billingSkip + 1;
  const billingTo = Math.min(billingSkip + billingEvents.length, billingTotal);
  const canBillingPrev = billingSkip > 0;
  const canBillingNext = billingSkip + billingLimit < billingTotal;
  const supportPage = Math.floor(supportSkip / Math.max(supportLimit, 1)) + 1;
  const supportTotalPages = Math.max(1, Math.ceil(supportTotal / Math.max(supportLimit, 1)));
  const supportFrom = supportTotal === 0 ? 0 : supportSkip + 1;
  const supportTo = Math.min(supportSkip + supportTickets.length, supportTotal);
  const canSupportPrev = supportSkip > 0;
  const canSupportNext = supportSkip + supportLimit < supportTotal;

  const byPlanRows = useMemo(() => {
    const counts = summary?.plan_counts || {};
    return PLANS.map((plan) => ({ plan, total: Number(counts[plan] || 0) }));
  }, [summary]);

  const subscriptionRows = useMemo(() => {
    const counts = new Map<string, number>();
    SUBSCRIPTION_STATUSES.forEach((s) => counts.set(s, 0));
    (tenants || []).forEach((tenant) => {
      const key = String(tenant.subscription_status || 'TRIAL').toUpperCase();
      counts.set(key, Number(counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [tenants]);

  const resumenCutoffDate = useMemo(() => {
    if (resumenPeriod === 'all') return null;
    const days = resumenPeriod === '7d' ? 7 : resumenPeriod === '90d' ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoff.setHours(0, 0, 0, 0);
    return cutoff;
  }, [resumenPeriod]);

  const filteredBillingEvents = useMemo(() => {
    if (!resumenCutoffDate) return billingEvents;
    const cutoffMs = resumenCutoffDate.getTime();
    return (billingEvents || []).filter((event) => {
      if (!event?.created_at) return false;
      const ts = new Date(event.created_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
  }, [billingEvents, resumenCutoffDate]);

  const filteredResumenLeads = useMemo(() => {
    if (!resumenCutoffDate) return resumenLeads;
    const cutoffMs = resumenCutoffDate.getTime();
    return (resumenLeads || []).filter((lead) => {
      if (!lead?.created_at) return false;
      const ts = new Date(lead.created_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
  }, [resumenLeads, resumenCutoffDate]);

  const filteredResumenSupportTickets = useMemo(() => {
    if (!resumenCutoffDate) return resumenSupportTickets;
    const cutoffMs = resumenCutoffDate.getTime();
    return (resumenSupportTickets || []).filter((ticket) => {
      if (!ticket?.created_at) return false;
      const ts = new Date(ticket.created_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
  }, [resumenSupportTickets, resumenCutoffDate]);

  const supportPriorityRows = useMemo(
    () =>
      SUPPORT_PRIORITIES.map((name) => ({
        name,
        value: filteredResumenSupportTickets.filter((ticket) => ticket.priority === name).length,
      })),
    [filteredResumenSupportTickets]
  );

  const supportStatusRows = useMemo(
    () =>
      SUPPORT_STATUSES.map((name) => ({
        name,
        value: filteredResumenSupportTickets.filter((ticket) => ticket.status === name).length,
      })),
    [filteredResumenSupportTickets]
  );

  const agingRows = useMemo(
    () => [
      { name: '0-30', amount: Number(agingSummary?.buckets?.['0_30']?.amount || 0) },
      { name: '31-60', amount: Number(agingSummary?.buckets?.['31_60']?.amount || 0) },
      { name: '61+', amount: Number(agingSummary?.buckets?.['61_plus']?.amount || 0) },
    ],
    [agingSummary]
  );

  const pipelineRows = useMemo(
    () =>
      LEAD_STAGES.map((name) => ({
        name,
        value: filteredResumenLeads.filter((lead) => lead.estado === name).length,
      })),
    [filteredResumenLeads]
  );

  const billingTrendRows = useMemo(() => {
    const byMonth = new Map<string, { month: string; payments: number; charges: number }>();
    (filteredBillingEvents || []).forEach((event) => {
      if (!event?.created_at) return;
      const date = new Date(event.created_at);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(key) || { month: key, payments: 0, charges: 0 };
      const amount = Number(event.amount || 0);
      if (event.event_type === 'PAYMENT_RECORDED') bucket.payments += amount;
      if (event.event_type === 'INVOICE_ISSUED') bucket.charges += amount;
      byMonth.set(key, bucket);
    });
    return Array.from(byMonth.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-8);
  }, [filteredBillingEvents]);

  const collectionRiskPct = useMemo(() => {
    const overdue = Number(summary?.overdue_amount || 0);
    const mrrReal = Number(summary?.mrr_real || 0);
    if (mrrReal <= 0) return 0;
    return Math.min(999, (overdue / mrrReal) * 100);
  }, [summary]);

  const mfaRecentEvents = useMemo(
    () => auditLogs.filter((row) => row.action.startsWith('mfa.')).slice(0, 5),
    [auditLogs]
  );
  const onSaveTenant = async (tenant: SaasTenantItem) => {
    try {
      setSavingTenantId(tenant.id);
      const feeDraft = tenantMonthlyFeeDrafts[tenant.id];
      const monthlyFeeValue = feeDraft !== undefined ? Number(feeDraft || 0) : Number(tenant.monthly_fee || 0);
      await saasAdminAPI.updateTenant(tenant.id, {
        plan: tenant.plan,
        is_active: tenant.is_active,
        is_demo: tenant.is_demo,
        demo_ends_at: tenant.demo_ends_at || null,
        subscription_status: tenant.subscription_status,
        billing_cycle: tenant.billing_cycle,
        monthly_fee: monthlyFeeValue,
        next_billing_at: tenant.next_billing_at || null,
      });
      setTenantMonthlyFeeDrafts((prev) => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
      if (canTenants || canBilling) await loadData();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar el tenant');
    } finally {
      setSavingTenantId(null);
    }
  };

  const openCreateTenantModal = () => {
    setCreateTenantLogoFileName('');
    setError('');
    setCreateTenantModalOpen(true);
  };

  const closeCreateTenantModal = () => {
    if (creatingTenant) return;
    setCreateTenantModalOpen(false);
  };

  const onCreateTenant = async () => {
    if (!createTenantForm.nombre_escuela || !createTenantForm.contacto_email || !createTenantForm.admin_email || !createTenantForm.admin_nombre_completo || !createTenantForm.admin_cedula) {
      setError('Completa nombre de escuela, correo contacto, correo admin, nombre admin y cédula admin');
      return;
    }
    try {
      setCreatingTenant(true);
      setError('');
      const result = await saasAdminAPI.createTenant({
        nombre_escuela: createTenantForm.nombre_escuela.trim(),
        slug: createTenantForm.slug.trim() || null,
        display_name: createTenantForm.display_name.trim() || null,
        plan: createTenantForm.plan as 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE',
        contacto_email: createTenantForm.contacto_email.trim().toLowerCase(),
        contacto_telefono: createTenantForm.contacto_telefono.trim() || null,
        nit: createTenantForm.nit.trim() || null,
        logo_url: createTenantForm.logo_url.trim() || null,
        admin_email: createTenantForm.admin_email.trim().toLowerCase(),
        admin_password: createTenantForm.admin_password.trim() || null,
        admin_nombre_completo: createTenantForm.admin_nombre_completo.trim(),
        admin_cedula: createTenantForm.admin_cedula.trim(),
        admin_telefono: createTenantForm.admin_telefono.trim() || null,
        send_welcome_email: createTenantForm.send_welcome_email,
        activate_tenant: createTenantForm.activate_tenant,
      });
      setCreateTenantSuccessModal({
        tenantSlug: result.tenant_slug,
        adminEmail: result.admin_email,
        temporaryPassword: result.temporary_password,
        welcomeEmailSent: Boolean(result.welcome_email_sent),
      });
      setInfoMessage(
        `Escuela creada: ${result.tenant_slug}. ` +
        (result.welcome_email_sent ? 'Se envió correo de acceso.' : 'No se pudo enviar correo de acceso.')
      );
      setCreateTenantForm({
        nombre_escuela: '',
        slug: '',
        display_name: '',
        plan: 'FREE',
        contacto_email: '',
        contacto_telefono: '',
        nit: '',
        logo_url: '',
        admin_email: '',
        admin_password: '',
        admin_nombre_completo: '',
        admin_cedula: '',
        admin_telefono: '',
        send_welcome_email: true,
        activate_tenant: true,
      });
      setCreateTenantLogoFileName('');
      setCreateTenantModalOpen(false);
      if (canTenants || canBilling) await loadData();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo crear la escuela');
    } finally {
      setCreatingTenant(false);
    }
  };

  const openPaymentModal = (tenant: SaasTenantItem) => {
    const suggestedAmount = Number(tenant.monthly_fee || 0);
    setPaymentModalTenant(tenant);
    setPaymentForm({
      amount: suggestedAmount > 0 ? String(suggestedAmount) : '',
      paid_at: '',
      reference: '',
      notes: '',
      set_status_active: true,
    });
  };

  const closePaymentModal = () => {
    if (recordingPayment) return;
    setPaymentModalTenant(null);
  };

  const submitTenantPayment = async () => {
    if (!paymentModalTenant) return;
    const amountValue = Number(paymentForm.amount || 0);
    if (amountValue <= 0) {
      setError('El monto del pago debe ser mayor a 0');
      return;
    }
    try {
      setRecordingPayment(true);
      setError('');
      setInfoMessage('');
      await saasAdminAPI.recordTenantPayment(paymentModalTenant.id, {
        amount: amountValue,
        paid_at: paymentForm.paid_at ? `${paymentForm.paid_at}:00` : null,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
        set_status_active: paymentForm.set_status_active,
      });
      closePaymentModal();
      if (canTenants || canBilling) await loadData();
      if (canBilling) await loadBillingEvents();
      if (canAudit) await loadAuditLogs();
      setInfoMessage('Pago registrado correctamente.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo registrar el pago');
    } finally {
      setRecordingPayment(false);
    }
  };

  const runOverdueCheck = async () => {
    try {
      setProcessingOverdueCheck(true);
      setError('');
      setInfoMessage('');
      const result = await saasAdminAPI.runBillingOverdueCheck();
      if (canTenants || canBilling) await loadData();
      if (canBilling) await loadBillingEvents();
      if (canAudit) await loadAuditLogs();
      setInfoMessage(`Control de vencimientos ejecutado. Tenants actualizados: ${Number(result.updated_tenants || 0)}.`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo ejecutar control de vencimientos');
    } finally {
      setProcessingOverdueCheck(false);
    }
  };

  const runCycleCharges = async () => {
    try {
      setProcessingCycleCharges(true);
      setError('');
      setInfoMessage('');
      const result = await saasAdminAPI.runBillingCycleCharges();
      if (canBilling) await loadBillingEvents();
      if (canAudit) await loadAuditLogs();
      setInfoMessage(`Cargos por ciclo generados: ${Number(result.created_events || 0)}.`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron generar cargos por ciclo');
    } finally {
      setProcessingCycleCharges(false);
    }
  };

  const sendOverdueReminders = async () => {
    try {
      setSendingOverdueReminders(true);
      setError('');
      setInfoMessage('');
      const result = await saasAdminAPI.sendBillingOverdueReminders();
      if (canBilling) await loadBillingEvents();
      if (canAudit) await loadAuditLogs();
      setInfoMessage(
        `Recordatorios ejecutados. Evaluados: ${Number(result.evaluated || 0)} | Enviados: ${Number(result.sent || 0)}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron enviar recordatorios de cartera');
    } finally {
      setSendingOverdueReminders(false);
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
        permisos_modulos: newUser.permisos_modulos
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      });
      setNewUser({
        email: '',
        password: '',
        nombre_completo: '',
        cedula: '',
        telefono: '',
        rol: 'ADMIN',
        permisos_modulos: 'saas_admin',
      });
      setNewUserProfile('OWNER');
      if (canUsers) await loadUsers();
      if (canAudit) await loadAuditLogs();
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
      if (canUsers) await loadUsers();
      if (canAudit) await loadAuditLogs();
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
      if (canUsers) await loadUsers();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo resetear la contraseña');
    } finally {
      setResettingUserId(null);
    }
  };

  const onCreateLead = async () => {
    if (!newLead.escuela_nombre || !newLead.contacto_nombre) {
      setError('Completa mínimo escuela y contacto para crear lead');
      return;
    }
    try {
      setCreatingLead(true);
      setError('');
      await saasAdminAPI.createLead({
        escuela_nombre: newLead.escuela_nombre,
        contacto_nombre: newLead.contacto_nombre,
        contacto_email: newLead.contacto_email || null,
        contacto_telefono: newLead.contacto_telefono || null,
        ciudad: newLead.ciudad || null,
        source: newLead.source || 'manual',
        plan_interes: newLead.plan_interes || null,
        estado: newLead.estado || 'NUEVO',
        valor_estimado_mrr: newLead.valor_estimado_mrr ? Number(newLead.valor_estimado_mrr) : null,
        proxima_accion_at: newLead.proxima_accion_at ? `${newLead.proxima_accion_at}:00` : null,
        notas: newLead.notas || null,
      });
      setNewLead({
        escuela_nombre: '',
        contacto_nombre: '',
        contacto_email: '',
        contacto_telefono: '',
        ciudad: '',
        source: 'manual',
        plan_interes: 'BASIC',
        estado: 'NUEVO',
        valor_estimado_mrr: '',
        proxima_accion_at: '',
        notas: '',
      });
      if (canPipeline) await loadPipeline();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo crear el lead');
    } finally {
      setCreatingLead(false);
    }
  };

  const onSaveLead = async (lead: SaasLeadItem) => {
    try {
      setSavingLeadId(lead.id);
      setError('');
      await saasAdminAPI.updateLead(lead.id, {
        escuela_nombre: lead.escuela_nombre,
        contacto_nombre: lead.contacto_nombre,
        contacto_email: lead.contacto_email || null,
        contacto_telefono: lead.contacto_telefono || null,
        ciudad: lead.ciudad || null,
        source: lead.source || 'manual',
        plan_interes: lead.plan_interes || null,
        estado: lead.estado,
        valor_estimado_mrr: lead.valor_estimado_mrr ?? null,
        proxima_accion_at: lead.proxima_accion_at || null,
        notas: lead.notas || null,
      });
      if (canPipeline) await loadPipeline();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar el lead');
    } finally {
      setSavingLeadId(null);
    }
  };

  const onSaveSupportTicket = async (ticket: SaasSupportTicketItem) => {
    try {
      setSavingSupportTicketId(ticket.id);
      setError('');
      await saasAdminAPI.updateSupportTicket(ticket.id, {
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description || null,
        owner_email: ticket.owner_email || null,
        requester_name: ticket.requester_name || null,
        requester_email: ticket.requester_email || null,
        requester_phone: ticket.requester_phone || null,
        due_at: ticket.due_at || null,
        resolution_notes: ticket.resolution_notes || null,
      });
      if (canSupport) await loadSupportTickets();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo actualizar ticket de soporte');
    } finally {
      setSavingSupportTicketId(null);
    }
  };

  const runSupportSlaAlerts = async () => {
    try {
      setProcessingSupportAlerts(true);
      setError('');
      setInfoMessage('');
      const result = await saasAdminAPI.runSupportSlaAlerts();
      if (canSupport) await loadSupportTickets();
      if (canAudit) await loadAuditLogs();
      setInfoMessage(
        `Alertas SLA soporte ejecutadas. Evaluados: ${Number(result.evaluated || 0)} | Enviados: ${Number(result.sent || 0)}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudieron ejecutar alertas SLA de soporte');
    } finally {
      setProcessingSupportAlerts(false);
    }
  };

  const copySchoolAccessLink = async (tenant: SaasTenantItem) => {
    const slug = (tenant.slug || '').trim();
    if (!slug) return;
    const link = `${window.location.origin}/login?tenant=${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(link);
      setInfoMessage(`Enlace de acceso copiado para ${tenant.display_name || tenant.nombre}: ${link}`);
    } catch {
      setError('No se pudo copiar el enlace. Cópialo manualmente desde la barra de direcciones.');
    }
  };

  const resendSchoolAccessLink = async (tenant: SaasTenantItem) => {
    try {
      setResendingAccessLinkTenantId(tenant.id);
      setError('');
      setInfoMessage('');
      const result = await saasAdminAPI.resendTenantAccessLink(tenant.id);
      if (canAudit) await loadAuditLogs();
      if (result.sent) {
        setInfoMessage(`Enlace reenviado a ${result.to_email}`);
      } else {
        setError('No se pudo enviar el correo (SMTP no configurado o envío fallido).');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo reenviar el enlace de acceso');
    } finally {
      setResendingAccessLinkTenantId(null);
    }
  };

  const openConvertLeadModal = (lead: SaasLeadItem) => {
    setConversionModalLead(lead);
    setConversionError('');
    setConversionResult(null);
    setShowTemporaryPassword(false);
    setCredentialsCopied(false);
    setConversionForm({
      admin_email: (lead.contacto_email || '').trim(),
      admin_nombre_completo: (lead.contacto_nombre || '').trim(),
      admin_cedula: '',
      admin_telefono: (lead.contacto_telefono || '').trim(),
      admin_password: '',
    });
  };

  const closeConvertLeadModal = () => {
    if (conversionResult && !credentialsCopied) {
      const confirmClose = window.confirm(
        'Aún no has copiado las credenciales temporales. ¿Seguro que quieres cerrar?'
      );
      if (!confirmClose) return;
    }
    setConversionModalLead(null);
    setConversionError('');
    setConversionResult(null);
    setShowTemporaryPassword(false);
    setCredentialsCopied(false);
  };

  const onSubmitConvertLead = async () => {
    if (!conversionModalLead) return;
    if (!conversionForm.admin_email || !conversionForm.admin_nombre_completo || !conversionForm.admin_cedula) {
      setConversionError('Completa correo, nombre y cédula del administrador');
      return;
    }
    try {
      setSubmittingConversion(true);
      setConversionError('');
      const result = await saasAdminAPI.convertLeadToTenant(conversionModalLead.id, {
        admin_email: conversionForm.admin_email.trim(),
        admin_nombre_completo: conversionForm.admin_nombre_completo.trim(),
        admin_cedula: conversionForm.admin_cedula.trim(),
        admin_telefono: conversionForm.admin_telefono.trim() || null,
        admin_password: conversionForm.admin_password.trim() || null,
      });
      setConversionResult({
        tenantSlug: result.tenant.slug,
        adminEmail: result.admin_user.email,
        temporaryPassword: result.admin_user.temporary_password,
      });
      setCredentialsCopied(false);
      setShowTemporaryPassword(false);
      if (canTenants || canBilling) await loadData();
      if (canPipeline) await loadPipeline();
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setConversionError(err?.response?.data?.detail || 'No se pudo convertir el lead a tenant');
    } finally {
      setSubmittingConversion(false);
    }
  };

  const copyConversionCredentials = async () => {
    if (!conversionResult) return;
    const text =
      `Tenant: ${conversionResult.tenantSlug}\n` +
      `Admin: ${conversionResult.adminEmail}\n` +
      `Password temporal: ${conversionResult.temporaryPassword}`;
    try {
      await navigator.clipboard.writeText(text);
      setCredentialsCopied(true);
    } catch {
      // No-op: fallback manual copy from UI.
    }
  };

  const generateMfaSetup = async () => {
    try {
      setMfaLoading(true);
      setMfaMessage('');
      const data = await authAPI.setupMfaGlobal();
      setMfaSetup({ secret: data.secret, otpauth_url: data.otpauth_url, qr_url: data.qr_url });
      setMfaBackupCodes([]);
      setMfaCodesCopied(false);
      setMfaCodesAcknowledge(false);
      setMfaEnableCode('');
    } catch (err: any) {
      setMfaMessage(err?.response?.data?.detail || 'No se pudo generar configuración MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const enableMfa = async () => {
    if (!mfaEnableCode.trim()) {
      setMfaMessage('Ingresa el código MFA de 6 dígitos para activar.');
      return;
    }
    try {
      setMfaLoading(true);
      setMfaMessage('');
      const result = await authAPI.enableMfaGlobal(mfaEnableCode.trim());
      await refreshUser();
      setMfaSetup(null);
      setMfaBackupCodes(result.backup_codes || []);
      setMfaCodesCopied(false);
      setMfaCodesAcknowledge(false);
      setMfaEnableCode('');
      setMfaMessage('MFA activado correctamente. Guarda tus backup codes.');
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setMfaMessage(err?.response?.data?.detail || 'No se pudo activar MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const disableMfa = async () => {
    if (!mfaDisablePassword.trim() || !mfaDisableCode.trim()) {
      setMfaMessage('Para desactivar MFA debes ingresar contraseña y código MFA.');
      return;
    }
    try {
      setMfaLoading(true);
      setMfaMessage('');
      await authAPI.disableMfaGlobal({
        password: mfaDisablePassword,
        code: mfaDisableCode.trim(),
      });
      await refreshUser();
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaRegenPassword('');
      setMfaRegenCode('');
      setMfaBackupCodes([]);
      setMfaCodesCopied(false);
      setMfaCodesAcknowledge(false);
      setMfaMessage('MFA desactivado.');
      if (canAudit) await loadAuditLogs();
    } catch (err: any) {
      setMfaMessage(err?.response?.data?.detail || 'No se pudo desactivar MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const regenerateBackupCodes = async () => {
    if (!mfaRegenPassword.trim() || !mfaRegenCode.trim()) {
      setMfaMessage('Ingresa contraseña y código MFA para regenerar backup codes.');
      return;
    }
    try {
      setMfaLoading(true);
      setMfaMessage('');
      const result = await authAPI.regenerateMfaBackupCodesGlobal({
        password: mfaRegenPassword,
        code: mfaRegenCode.trim(),
      });
      setMfaBackupCodes(result.backup_codes || []);
      setMfaCodesCopied(false);
      setMfaCodesAcknowledge(false);
      setMfaRegenPassword('');
      setMfaRegenCode('');
      await refreshUser();
      if (canAudit) await loadAuditLogs();
      setMfaMessage('Backup codes regenerados. Guarda los nuevos códigos.');
    } catch (err: any) {
      setMfaMessage(err?.response?.data?.detail || 'No se pudieron regenerar los backup codes');
    } finally {
      setMfaLoading(false);
    }
  };

  const copyAllMfaBackupCodes = async () => {
    if (mfaBackupCodes.length === 0) return;
    const text = mfaBackupCodes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setMfaCodesCopied(true);
      setMfaMessage('Backup codes copiados al portapapeles.');
    } catch {
      setMfaMessage('No se pudieron copiar automáticamente. Copia manualmente.');
    }
  };

  const confirmBackupCodesSaved = () => {
    if (!mfaCodesAcknowledge) {
      setMfaMessage('Confirma que guardaste los backup codes antes de ocultarlos.');
      return;
    }
    setMfaBackupCodes([]);
    setMfaCodesCopied(false);
    setMfaCodesAcknowledge(false);
    setMfaMessage('Backup codes ocultados.');
  };

  const closeAllMySessions = async () => {
    const confirmed = window.confirm(
      'Se cerrarán todas tus sesiones activas (incluyendo otros dispositivos). ¿Deseas continuar?'
    );
    if (!confirmed) return;
    try {
      setClosingAllSessions(true);
      await authAPI.logoutAllSessions();
      setMfaMessage('Sesiones cerradas correctamente. Redirigiendo al login...');
      setTimeout(() => {
        window.location.href = '/login-saas';
      }, 900);
    } catch (err: any) {
      setMfaMessage(err?.response?.data?.detail || 'No se pudieron cerrar todas las sesiones');
    } finally {
      setClosingAllSessions(false);
    }
  };

  const exportAuditCsv = async () => {
    try {
      setAuditExporting(true);
      const blob = await saasAdminAPI.exportAuditLogsCsv({
        action: auditAction || undefined,
        search: auditSearch.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `saas_audit_logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo exportar la auditoría');
    } finally {
      setAuditExporting(false);
    }
  };

  return (
    <div className="saas-admin-container">
      {!hasCurrentViewAccess && (
        <div className="saas-card bo-card">
          <h3>Sin permiso para este módulo</h3>
          <p>
            Tu usuario no tiene acceso a <strong>{saasView}</strong>.
          </p>
          <p>Módulos disponibles para tu cuenta: {availableViewLabels || 'ninguno'}.</p>
        </div>
      )}
      {hasCurrentViewAccess && (
      <>
      {error && <div className="error-message">{error}</div>}
      {infoMessage && <div className="saas-info-message">{infoMessage}</div>}

      {saasView === 'security' && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Seguridad de cuenta (MFA)</h3>
        </div>
        <p>
          Estado actual: <strong>{user?.mfa_enabled ? 'MFA ACTIVO' : 'MFA INACTIVO'}</strong>
        </p>
        {!user?.mfa_enabled ? (
          <div className="saas-user-form">
            <button type="button" className="btn-primary" onClick={() => void generateMfaSetup()} disabled={mfaLoading}>
              {mfaLoading ? 'Generando...' : 'Generar configuración MFA'}
            </button>
            {mfaSetup && (
              <>
                <div>
                  <img src={mfaSetup.qr_url} alt="QR MFA" style={{ width: 180, height: 180, borderRadius: 8 }} />
                </div>
                <input type="text" readOnly value={mfaSetup.secret} />
                <input
                  type="text"
                  placeholder="Código MFA (6 dígitos)"
                  value={mfaEnableCode}
                  onChange={(e) => setMfaEnableCode(e.target.value)}
                />
                <button type="button" className="btn-primary" onClick={() => void enableMfa()} disabled={mfaLoading}>
                  {mfaLoading ? 'Activando...' : 'Activar MFA'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="saas-user-form">
            <input
              type="password"
              placeholder="Contraseña actual"
              value={mfaDisablePassword}
              onChange={(e) => setMfaDisablePassword(e.target.value)}
            />
            <input
              type="text"
              placeholder="Código MFA"
              value={mfaDisableCode}
              onChange={(e) => setMfaDisableCode(e.target.value)}
            />
            <button type="button" className="btn-danger" onClick={() => void disableMfa()} disabled={mfaLoading}>
              {mfaLoading ? 'Procesando...' : 'Desactivar MFA'}
            </button>
            <input
              type="password"
              placeholder="Contraseña (regenerar backup codes)"
              value={mfaRegenPassword}
              onChange={(e) => setMfaRegenPassword(e.target.value)}
            />
            <input
              type="text"
              placeholder="Código MFA (regenerar)"
              value={mfaRegenCode}
              onChange={(e) => setMfaRegenCode(e.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={() => void regenerateBackupCodes()} disabled={mfaLoading}>
              {mfaLoading ? 'Procesando...' : 'Regenerar backup codes'}
            </button>
          </div>
        )}
        {mfaSetup && (
          <p>
            URL manual para app autenticadora: <code>{mfaSetup.otpauth_url}</code>
          </p>
        )}
        {mfaMessage && (
          <div className={mfaMessage.toLowerCase().includes('no se pudo') ? 'error-message' : 'saas-info-message'}>
            {mfaMessage}
          </div>
        )}
        {mfaBackupCodes.length > 0 && (
          <div className="saas-mfa-codes">
            <p><strong>Backup codes (guárdalos ahora):</strong></p>
            <div className="saas-plan-grid">
              {mfaBackupCodes.map((code) => (
                <div key={code} className="saas-plan-item">
                  <strong>{code}</strong>
                </div>
              ))}
            </div>
            <div className="saas-user-actions">
              <button type="button" className="btn-secondary" onClick={() => void copyAllMfaBackupCodes()}>
                {mfaCodesCopied ? 'Backup codes copiados' : 'Copiar todos los backup codes'}
              </button>
              <label className="saas-mfa-ack">
                <input
                  type="checkbox"
                  checked={mfaCodesAcknowledge}
                  onChange={(e) => setMfaCodesAcknowledge(e.target.checked)}
                />
                Ya guardé estos códigos en un lugar seguro
              </label>
              <button type="button" className="btn-primary" onClick={confirmBackupCodesSaved}>
                Confirmar y ocultar
              </button>
            </div>
          </div>
        )}
        {!!user?.mfa_enabled && (
          <p>Backup codes disponibles: <strong>{Number(user?.mfa_backup_codes_remaining || 0)}</strong></p>
        )}
        <div className="saas-user-actions">
          <button
            type="button"
            className="btn-danger"
            onClick={() => void closeAllMySessions()}
            disabled={closingAllSessions}
          >
            {closingAllSessions ? 'Cerrando sesiones...' : 'Cerrar todas mis sesiones'}
          </button>
        </div>
        <div className="saas-mfa-events">
          <h4>Bitácora MFA (reciente)</h4>
          {mfaRecentEvents.length === 0 ? (
            <p>No hay eventos MFA recientes todavía.</p>
          ) : (
            <div className="saas-table-wrap bo-table-wrap">
              <table className="saas-table bo-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Evento</th>
                    <th>Detalle</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {mfaRecentEvents.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString('es-CO')}</td>
                      <td>{row.action}</td>
                      <td>{row.summary}</td>
                      <td>{row.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}

      {saasView === 'resumen' && (canTenants || canBilling) && (
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
          <h4>MRR estimado / real</h4>
          <strong>{money(Number(summary?.mrr_estimado || 0))}</strong>
          <span>Real: {money(Number(summary?.mrr_real || 0))}</span>
        </div>
        <div className="saas-kpi-card">
          <DollarSign size={18} />
          <h4>Cartera vencida</h4>
          <strong>{summary?.overdue_tenants ?? 0}</strong>
          <span>Monto: {money(Number(summary?.overdue_amount || 0))}</span>
        </div>
        <div className="saas-kpi-card">
          <DollarSign size={18} />
          <h4>Riesgo cartera / MRR real</h4>
          <strong>{collectionRiskPct.toFixed(1)}%</strong>
          <span>{resumenLoading ? 'Actualizando KPIs...' : 'Monitorea morosidad en relación al ingreso recurrente real'}</span>
        </div>
      </div>
      )}

      {saasView === 'support' && canSupport && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Soporte operativo SaaS</h3>
          <div className="saas-search">
            <input
              type="text"
              placeholder="Buscar por tenant, asunto o owner"
              value={supportSearch}
              onChange={(e) => setSupportSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadSupportTickets(0, supportLimit)} disabled={supportLoading}>
              Buscar
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void runSupportSlaAlerts()}
              disabled={processingSupportAlerts}
            >
              {processingSupportAlerts ? 'Enviando...' : 'Alertas SLA'}
            </button>
          </div>
        </div>

        <div className="saas-lead-metrics">
          <span>Abiertos: <strong>{Number(supportSummary?.open_total || 0)}</strong></span>
          <span>Vencidos: <strong>{Number(supportSummary?.overdue_open || 0)}</strong></span>
          <span>Por vencer (24h): <strong>{Number(supportSummary?.due_soon_open || 0)}</strong></span>
          <span>Críticos: <strong>{Number(supportSummary?.priority_counts?.CRITICAL || 0)}</strong></span>
        </div>

        <div className="saas-lead-metrics">
          <span>
            Este módulo recibe tickets del portal de escuelas y permite gestionarlos.
          </span>
        </div>

        <div className="saas-table-wrap bo-table-wrap">
          <table className="saas-table bo-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Asunto</th>
                <th>Descripción (solicitud)</th>
                <th>SLA</th>
                <th>Estado</th>
                <th>Prioridad</th>
                <th>Owner</th>
                <th>Vence</th>
                <th>Resolución</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {supportTickets.map((ticket, idx) => (
                <tr key={ticket.id}>
                  <td>{ticket.tenant_nombre || ticket.tenant_slug || `#${ticket.tenant_id}`}</td>
                  <td>
                    <input
                      type="text"
                      value={ticket.subject}
                      onChange={(e) => setSupportTickets((prev) => prev.map((x, i) => (i === idx ? { ...x, subject: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <div className="saas-support-description-preview">
                      {ticket.description && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            setSupportDescriptionModal({
                              ticketId: ticket.id,
                              tenantName: ticket.tenant_nombre || ticket.tenant_slug || `#${ticket.tenant_id}`,
                              subject: ticket.subject || '-',
                              description: ticket.description || '',
                            })
                          }
                        >
                          Ver
                        </button>
                      )}
                      {!ticket.description && <span>Sin descripción</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`saas-sla-badge ${String(ticket.sla_state || 'NO_DUE_DATE').toLowerCase()}`}>
                      {ticket.sla_state || 'NO_DUE_DATE'}
                    </span>
                  </td>
                  <td>
                    <div className="saas-inline-status-editor">
                      <span className={statusClass(ticket.status)}>{ticket.status}</span>
                      <select
                        value={ticket.status}
                        onChange={(e) => setSupportTickets((prev) => prev.map((x, i) => (i === idx ? { ...x, status: e.target.value as any } : x)))}
                      >
                        {SUPPORT_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <div className="saas-inline-status-editor">
                      <span className={statusClass(ticket.priority)}>{ticket.priority}</span>
                      <select
                        value={ticket.priority}
                        onChange={(e) => setSupportTickets((prev) => prev.map((x, i) => (i === idx ? { ...x, priority: e.target.value as any } : x)))}
                      >
                        {SUPPORT_PRIORITIES.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={ticket.owner_email || ''}
                      onChange={(e) => setSupportTickets((prev) => prev.map((x, i) => (i === idx ? { ...x, owner_email: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      value={ticket.due_at ? String(ticket.due_at).slice(0, 16) : ''}
                      onChange={(e) =>
                        setSupportTickets((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, due_at: e.target.value ? `${e.target.value}:00` : null } : x))
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={ticket.resolution_notes || ''}
                      onChange={(e) =>
                        setSupportTickets((prev) => prev.map((x, i) => (i === idx ? { ...x, resolution_notes: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void onSaveSupportTicket(ticket)}
                      disabled={savingSupportTicketId === ticket.id}
                    >
                      {savingSupportTicketId === ticket.id ? 'Guardando...' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              ))}
              {supportTickets.length === 0 && (
                <tr>
                  <td colSpan={10}>{supportLoading ? 'Cargando...' : 'No hay tickets de soporte'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="saas-pagination">
          <span>
            Mostrando {supportFrom}-{supportTo} de {supportTotal}
          </span>
          <label>
            Filas:
            <select
              value={supportLimit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value || 50);
                void loadSupportTickets(0, nextLimit);
              }}
              disabled={supportLoading}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadSupportTickets(Math.max(0, supportSkip - supportLimit), supportLimit)}
            disabled={supportLoading || !canSupportPrev}
          >
            Anterior
          </button>
          <span>
            Página {supportPage} de {supportTotalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadSupportTickets(supportSkip + supportLimit, supportLimit)}
            disabled={supportLoading || !canSupportNext}
          >
            Siguiente
          </button>
        </div>
      </div>
      )}

      {saasView === 'resumen' && (canTenants || canBilling) && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Resumen analítico SaaS</h3>
          <div className="saas-search">
            <select value={resumenPeriod} onChange={(e) => setResumenPeriod(e.target.value as any)}>
              {RESUMEN_PERIODS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="saas-lead-metrics">
          <span>Leads en período: <strong>{filteredResumenLeads.length}</strong></span>
          <span>Tickets creados en período: <strong>{filteredResumenSupportTickets.length}</strong></span>
          <span>Eventos de facturación en período: <strong>{filteredBillingEvents.length}</strong></span>
        </div>
        <div className="saas-plan-grid">
          {byPlanRows.map((row) => (
            <div key={row.plan} className="saas-plan-item">
              <span>{row.plan}</span>
              <strong>{row.total}</strong>
            </div>
          ))}
        </div>
        <div className="saas-charts-grid">
          <div className="saas-chart-card">
            <h4>Escuelas por estado de suscripción</h4>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={subscriptionRows} dataKey="value" nameKey="name" outerRadius={85}>
                  {subscriptionRows.map((row, idx) => (
                    <Cell key={row.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {canBilling && (
            <div className="saas-chart-card">
              <h4>Aging de cartera vencida</h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agingRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(value: any) => money(Number(value || 0))} />
                  <Bar dataKey="amount" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {canPipeline && (
            <div className="saas-chart-card">
              <h4>Embudo comercial (pipeline)</h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={pipelineRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} angle={-15} height={64} textAnchor="end" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {canSupport && (
            <div className="saas-chart-card">
              <h4>Tickets por prioridad</h4>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={supportPriorityRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="var(--chart-5)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {canSupport && (
            <div className="saas-chart-card">
              <h4>Tickets por estado</h4>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={supportStatusRows} dataKey="value" nameKey="name" outerRadius={85}>
                    {supportStatusRows.map((row, idx) => (
                      <Cell key={row.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {canBilling && (
            <div className="saas-chart-card saas-chart-card-wide">
              <h4>Tendencia cobros vs cargos (últimos meses)</h4>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={billingTrendRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value: any) => money(Number(value || 0))} />
                  <Legend />
                  <Line type="monotone" dataKey="payments" name="Pagos registrados" stroke="var(--chart-2)" strokeWidth={2} />
                  <Line type="monotone" dataKey="charges" name="Cargos emitidos" stroke="var(--chart-4)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      )}

      {saasView === 'pipeline' && canPipeline && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Pipeline comercial SaaS</h3>
          <div className="saas-search">
            <select value={leadStage} onChange={(e) => setLeadStage(e.target.value)}>
              <option value="">Todos los estados</option>
              {LEAD_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Buscar escuela, contacto o correo"
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadPipeline()} disabled={leadsLoading}>
              Buscar
            </button>
          </div>
        </div>

        <div className="saas-plan-grid">
          {LEAD_STAGES.map((stage) => (
            <div key={stage} className="saas-plan-item">
              <span>{stage}</span>
              <strong>{Number(pipelineSummary?.stage_counts?.[stage] || 0)}</strong>
            </div>
          ))}
        </div>
        <div className="saas-lead-metrics">
          <span>MRR potencial: <strong>{money(Number(pipelineSummary?.mrr_potencial || 0))}</strong></span>
          <span>MRR cerrado ganado: <strong>{money(Number(pipelineSummary?.mrr_cerrado || 0))}</strong></span>
          <span>Seguimientos vencidos: <strong>{Number(pipelineSummary?.overdue_followups || 0)}</strong></span>
        </div>

        <div className="saas-lead-form">
          <input
            type="text"
            placeholder="Escuela"
            value={newLead.escuela_nombre}
            onChange={(e) => setNewLead((prev) => ({ ...prev, escuela_nombre: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Contacto"
            value={newLead.contacto_nombre}
            onChange={(e) => setNewLead((prev) => ({ ...prev, contacto_nombre: e.target.value }))}
          />
          <input
            type="email"
            placeholder="Correo"
            value={newLead.contacto_email}
            onChange={(e) => setNewLead((prev) => ({ ...prev, contacto_email: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Teléfono"
            value={newLead.contacto_telefono}
            onChange={(e) => setNewLead((prev) => ({ ...prev, contacto_telefono: e.target.value }))}
          />
          <select
            value={newLead.plan_interes}
            onChange={(e) => setNewLead((prev) => ({ ...prev, plan_interes: e.target.value }))}
          >
            {PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {plan}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="MRR estimado"
            value={newLead.valor_estimado_mrr}
            onChange={(e) => setNewLead((prev) => ({ ...prev, valor_estimado_mrr: e.target.value }))}
          />
          <button type="button" className="btn-primary" onClick={() => void onCreateLead()} disabled={creatingLead}>
            {creatingLead ? 'Creando...' : 'Crear lead'}
          </button>
        </div>

        <div className="saas-table-wrap bo-table-wrap">
          <table className="saas-table bo-table">
            <thead>
              <tr>
                <th>Escuela</th>
                <th>Contacto</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>MRR</th>
                <th>Owner</th>
                <th>Conversión</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, idx) => (
                <tr key={lead.id}>
                  <td>
                    <input
                      type="text"
                      value={lead.escuela_nombre}
                      onChange={(e) => setLeads((prev) => prev.map((x, i) => (i === idx ? { ...x, escuela_nombre: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={lead.contacto_nombre}
                      onChange={(e) => setLeads((prev) => prev.map((x, i) => (i === idx ? { ...x, contacto_nombre: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <select
                      value={lead.plan_interes || 'BASIC'}
                      onChange={(e) => setLeads((prev) => prev.map((x, i) => (i === idx ? { ...x, plan_interes: e.target.value } : x)))}
                    >
                      {PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {plan}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="saas-inline-status-editor">
                      <span className={statusClass(lead.estado)}>{lead.estado}</span>
                      <select
                        value={lead.estado}
                        onChange={(e) => setLeads((prev) => prev.map((x, i) => (i === idx ? { ...x, estado: e.target.value } : x)))}
                      >
                        {LEAD_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={lead.valor_estimado_mrr ?? 0}
                      onChange={(e) => setLeads((prev) => prev.map((x, i) => (i === idx ? { ...x, valor_estimado_mrr: Number(e.target.value) } : x)))}
                    />
                  </td>
                  <td>{lead.owner_email}</td>
                  <td>
                    {lead.converted_tenant_id ? (
                      <span className="saas-lead-converted">Tenant #{lead.converted_tenant_id}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openConvertLeadModal(lead)}
                      >
                        Convertir a demo
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void onSaveLead(lead)}
                      disabled={savingLeadId === lead.id}
                    >
                      {savingLeadId === lead.id ? 'Guardando...' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={8}>{leadsLoading ? 'Cargando...' : 'No hay leads registrados'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {saasView === 'tenants' && (canTenants || canBilling) && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Escuelas</h3>
          <div className="saas-search">
            <input
              type="text"
              placeholder="Buscar por nombre, codigo de escuela o correo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadData()} disabled={loading}>
              Buscar
            </button>
            {canTenants && (
              <button type="button" className="btn-secondary" onClick={openCreateTenantModal}>
                Nueva escuela
              </button>
            )}
          </div>
        </div>

        <div className="saas-table-wrap bo-table-wrap saas-table-wrap-tenants">
          <table className="saas-table bo-table">
            <thead>
              <tr>
                <th className="saas-sticky-col">
                  <div className="saas-sticky-cell saas-sticky-cell-header">Escuela</div>
                </th>
                <th>Codigo de escuela</th>
                <th>Plan</th>
                <th>Suscripción</th>
                <th>Ciclo</th>
                <th>Tarifa mensual</th>
                <th>Próx. cobro</th>
                <th>Últ. pago</th>
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
                  <td className="saas-sticky-col">
                    <div className="saas-sticky-cell">{t.display_name || t.nombre}</div>
                  </td>
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
                    <div className="saas-inline-status-editor">
                      <span className={statusClass(t.subscription_status || 'TRIAL')}>{t.subscription_status || 'TRIAL'}</span>
                      <select
                        value={t.subscription_status || 'TRIAL'}
                        onChange={(e) =>
                          setTenants((prev) =>
                            prev.map((x, i) => {
                              if (i !== idx) return x;
                              const nextStatus = e.target.value as any;
                              return {
                                ...x,
                                subscription_status: nextStatus,
                                is_demo: nextStatus === 'TRIAL',
                              };
                            })
                          )
                        }
                      >
                        {SUBSCRIPTION_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <select
                      value={t.billing_cycle || 'MONTHLY'}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, billing_cycle: e.target.value as any } : x))
                        )
                      }
                    >
                      {BILLING_CYCLES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={
                        tenantMonthlyFeeDrafts[t.id] !== undefined
                          ? tenantMonthlyFeeDrafts[t.id]
                          : t.monthly_fee !== undefined && t.monthly_fee !== null
                          ? String(t.monthly_fee)
                          : ''
                      }
                      onFocus={() => {
                        const currentDraft = tenantMonthlyFeeDrafts[t.id];
                        if (currentDraft !== undefined) return;
                        if (Number(t.monthly_fee || 0) === 0) {
                          setTenantMonthlyFeeDrafts((prev) => ({ ...prev, [t.id]: '' }));
                        }
                      }}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setTenantMonthlyFeeDrafts((prev) => ({ ...prev, [t.id]: raw }));
                        setTenants((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? { ...x, monthly_fee: raw === '' ? undefined : Number(raw) }
                              : x
                          )
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={t.next_billing_at ? String(t.next_billing_at).slice(0, 10) : ''}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, next_billing_at: e.target.value ? `${e.target.value}T23:59:59` : null } : x
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <span>{dateCell(t.last_payment_at)}</span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!t.is_demo}
                      onChange={(e) =>
                        setTenants((prev) =>
                          prev.map((x, i) => {
                            if (i !== idx) return x;
                            const isDemo = e.target.checked;
                            return {
                              ...x,
                              is_demo: isDemo,
                              subscription_status: isDemo
                                ? 'TRIAL'
                                : (x.subscription_status === 'TRIAL' ? 'ACTIVE' : x.subscription_status),
                            };
                          })
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
                    <div className="saas-user-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void onSaveTenant(t)}
                        disabled={savingTenantId === t.id}
                      >
                        {savingTenantId === t.id ? 'Guardando...' : 'Guardar'}
                      </button>
                      {canBilling && (
                        <button type="button" className="btn-secondary" onClick={() => openPaymentModal(t)}>
                          Registrar pago
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => void copySchoolAccessLink(t)}>
                        Copiar enlace acceso
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void resendSchoolAccessLink(t)}
                        disabled={resendingAccessLinkTenantId === t.id}
                      >
                        {resendingAccessLinkTenantId === t.id ? 'Enviando...' : 'Reenviar enlace'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {saasView === 'billing' && canBilling && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
          <h3>Historial de cobros SaaS</h3>
          <div className="saas-search">
            <input
              type="text"
              placeholder="Buscar por tenant, referencia o nota"
              value={billingSearch}
              onChange={(e) => setBillingSearch(e.target.value)}
            />
            <button type="button" className="btn-primary" onClick={() => void loadBillingEvents(0, billingLimit)} disabled={billingLoading}>
              Buscar
            </button>
            <button type="button" className="btn-secondary" onClick={() => void runCycleCharges()} disabled={processingCycleCharges}>
              {processingCycleCharges ? 'Procesando...' : 'Generar cargos ciclo'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void runOverdueCheck()} disabled={processingOverdueCheck}>
              {processingOverdueCheck ? 'Procesando...' : 'Ejecutar vencimientos'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void sendOverdueReminders()} disabled={sendingOverdueReminders}>
              {sendingOverdueReminders ? 'Enviando...' : 'Enviar recordatorios'}
            </button>
          </div>
        </div>

        <div className="saas-lead-metrics">
          <span>Aging 0-30: <strong>{money(Number(agingSummary?.buckets?.['0_30']?.amount || 0))}</strong> ({Number(agingSummary?.buckets?.['0_30']?.tenants || 0)} tenants)</span>
          <span>31-60: <strong>{money(Number(agingSummary?.buckets?.['31_60']?.amount || 0))}</strong> ({Number(agingSummary?.buckets?.['31_60']?.tenants || 0)} tenants)</span>
          <span>61+: <strong>{money(Number(agingSummary?.buckets?.['61_plus']?.amount || 0))}</strong> ({Number(agingSummary?.buckets?.['61_plus']?.tenants || 0)} tenants)</span>
        </div>

        <div className="saas-table-wrap bo-table-wrap">
          <table className="saas-table bo-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tenant</th>
                <th>Evento</th>
                <th>Estado</th>
                <th>Monto</th>
                <th>Referencia</th>
                <th>Pago/Vence</th>
              </tr>
            </thead>
            <tbody>
              {billingEvents.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString('es-CO')}</td>
                  <td>{row.tenant_nombre || row.tenant_slug || `#${row.tenant_id}`}</td>
                  <td><span className={statusClass(row.event_type)}>{row.event_type}</span></td>
                  <td><span className={statusClass(row.status)}>{row.status}</span></td>
                  <td>{money(Number(row.amount || 0))}</td>
                  <td>{row.reference || '-'}</td>
                  <td>
                    {row.paid_at ? `Pagado: ${new Date(row.paid_at).toLocaleDateString('es-CO')}` : '-'}
                    {row.due_at ? ` | Vence: ${new Date(row.due_at).toLocaleDateString('es-CO')}` : ''}
                  </td>
                </tr>
              ))}
              {billingEvents.length === 0 && (
                <tr>
                  <td colSpan={7}>{billingLoading ? 'Cargando...' : 'No hay eventos de facturación registrados'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="saas-pagination">
          <span>
            Mostrando {billingFrom}-{billingTo} de {billingTotal}
          </span>
          <label>
            Filas:
            <select
              value={billingLimit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value || 50);
                void loadBillingEvents(0, nextLimit);
              }}
              disabled={billingLoading}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadBillingEvents(Math.max(0, billingSkip - billingLimit), billingLimit)}
            disabled={billingLoading || !canBillingPrev}
          >
            Anterior
          </button>
          <span>
            Página {billingPage} de {billingTotalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadBillingEvents(billingSkip + billingLimit, billingLimit)}
            disabled={billingLoading || !canBillingNext}
          >
            Siguiente
          </button>
        </div>
      </div>
      )}

      {saasView === 'users' && canUsers && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
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
            value={newUserProfile}
            onChange={(e) => {
              const profile = e.target.value;
              setNewUserProfile(profile);
              if (profile !== 'CUSTOM') {
                setNewUser((prev) => ({
                  ...prev,
                  permisos_modulos: SAAS_PERMISSION_PROFILES[profile].scopes.join(', '),
                }));
              }
            }}
          >
            {Object.entries(SAAS_PERMISSION_PROFILES).map(([key, profile]) => (
              <option key={key} value={key}>
                {profile.label}
              </option>
            ))}
            <option value="CUSTOM">Personalizado</option>
          </select>
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
          <input
            type="text"
            placeholder="Scopes (coma) ej: saas_admin o saas_audit_read"
            value={newUser.permisos_modulos}
            onChange={(e) => {
              setNewUserProfile('CUSTOM');
              setNewUser((prev) => ({ ...prev, permisos_modulos: e.target.value }));
            }}
          />
          <button type="button" className="btn-primary" onClick={() => void onCreateUser()} disabled={creatingUser}>
            {creatingUser ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>

        <div className="saas-table-wrap bo-table-wrap">
          <table className="saas-table bo-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Cédula</th>
                <th>Rol</th>
                <th>Activo</th>
                <th>Último acceso</th>
                <th>Perfil permisos</th>
                <th>Scopes</th>
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
                  <td>
                    <select
                      value={detectPermissionProfile(u.permisos_modulos)}
                      onChange={(e) =>
                        setUsers((prev) =>
                          prev.map((x, i) =>
                            i === idx && e.target.value !== 'CUSTOM'
                              ? { ...x, permisos_modulos: [...SAAS_PERMISSION_PROFILES[e.target.value].scopes] }
                              : x
                          )
                        )
                      }
                    >
                      {Object.entries(SAAS_PERMISSION_PROFILES).map(([key, profile]) => (
                        <option key={key} value={key}>
                          {profile.label}
                        </option>
                      ))}
                      <option value="CUSTOM">Personalizado</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={(u.permisos_modulos || []).join(', ')}
                      onChange={(e) =>
                        setUsers((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  permisos_modulos: e.target.value
                                    .split(',')
                                    .map((v) => v.trim().toLowerCase())
                                    .filter(Boolean),
                                }
                              : x
                          )
                        )
                      }
                    />
                  </td>
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
      )}

      {saasView === 'audit' && canAudit && (
      <div className="saas-card bo-card">
        <div className="saas-card-header bo-card-header">
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
            <button type="button" className="btn-primary" onClick={() => void loadAuditLogs(0, auditLimit)} disabled={auditLoading}>
              Buscar
            </button>
            <button type="button" className="btn-secondary" onClick={() => void exportAuditCsv()} disabled={auditExporting}>
              {auditExporting ? 'Exportando...' : 'Exportar CSV'}
            </button>
          </div>
        </div>

        <div className="saas-table-wrap bo-table-wrap">
          <table className="saas-table bo-table">
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
        <div className="saas-pagination">
          <span>
            Mostrando {auditFrom}-{auditTo} de {auditTotal}
          </span>
          <label>
            Filas:
            <select
              value={auditLimit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value || 50);
                void loadAuditLogs(0, nextLimit);
              }}
              disabled={auditLoading}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadAuditLogs(Math.max(0, auditSkip - auditLimit), auditLimit)}
            disabled={auditLoading || !canAuditPrev}
          >
            Anterior
          </button>
          <span>
            Página {auditPage} de {auditTotalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadAuditLogs(auditSkip + auditLimit, auditLimit)}
            disabled={auditLoading || !canAuditNext}
          >
            Siguiente
          </button>
        </div>
      </div>
      )}

      {createTenantModalOpen && (
        <div className="saas-modal-backdrop" onClick={closeCreateTenantModal}>
          <div className="saas-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nueva escuela (alta interna)</h3>
            <div className="saas-modal-grid">
              <label>
                Nombre escuela
                <input
                  type="text"
                  value={createTenantForm.nombre_escuela}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, nombre_escuela: e.target.value }))}
                />
              </label>
              <label>
                Código escuela (opcional)
                <input
                  type="text"
                  value={createTenantForm.slug}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, slug: e.target.value }))}
                />
              </label>
              <label>
                Nombre comercial (opcional)
                <input
                  type="text"
                  value={createTenantForm.display_name}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, display_name: e.target.value }))}
                />
              </label>
              <label>
                Plan
                <select
                  value={createTenantForm.plan}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, plan: e.target.value }))}
                >
                  {PLANS.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Correo contacto
                <input
                  type="email"
                  value={createTenantForm.contacto_email}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, contacto_email: e.target.value }))}
                />
              </label>
              <label>
                Teléfono contacto (opcional)
                <input
                  type="text"
                  value={createTenantForm.contacto_telefono}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, contacto_telefono: e.target.value }))}
                />
              </label>
              <label>
                NIT (opcional)
                <input
                  type="text"
                  value={createTenantForm.nit}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, nit: e.target.value }))}
                />
              </label>
              <label>
                URL logo (opcional)
                <input
                  type="text"
                  value={createTenantForm.logo_url}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, logo_url: e.target.value }))}
                />
              </label>
              <label>
                Explorar archivo de logo (opcional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    void handleCreateTenantLogoFileChange(e.target.files?.[0] || null);
                  }}
                />
                {createTenantLogoFileName && <small>Logo cargado: {createTenantLogoFileName}</small>}
                {processingCreateTenantLogo && <small>Procesando logo...</small>}
              </label>
              <label>
                Correo admin
                <input
                  type="email"
                  value={createTenantForm.admin_email}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, admin_email: e.target.value }))}
                />
              </label>
              <label>
                Nombre admin
                <input
                  type="text"
                  value={createTenantForm.admin_nombre_completo}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, admin_nombre_completo: e.target.value }))}
                />
              </label>
              <label>
                Cédula admin
                <input
                  type="text"
                  value={createTenantForm.admin_cedula}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, admin_cedula: e.target.value }))}
                />
              </label>
              <label>
                Teléfono admin (opcional)
                <input
                  type="text"
                  value={createTenantForm.admin_telefono}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, admin_telefono: e.target.value }))}
                />
              </label>
              <label>
                Contraseña temporal admin (opcional)
                <input
                  type="text"
                  value={createTenantForm.admin_password}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, admin_password: e.target.value }))}
                />
              </label>
            </div>
            <label className="saas-mfa-ack">
              <input
                type="checkbox"
                checked={createTenantForm.send_welcome_email}
                onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, send_welcome_email: e.target.checked }))}
              />
              Enviar correo de bienvenida/acceso al admin
            </label>
            <label className="saas-mfa-ack">
              <input
                type="checkbox"
                checked={createTenantForm.activate_tenant}
                onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, activate_tenant: e.target.checked }))}
              />
              Activar escuela al crear
            </label>
            <div className="saas-user-actions">
              <button type="button" className="btn-secondary" onClick={closeCreateTenantModal} disabled={creatingTenant}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => void onCreateTenant()} disabled={creatingTenant}>
                {creatingTenant ? 'Creando...' : 'Crear escuela'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createTenantSuccessModal && (
        <div className="saas-modal-backdrop" onClick={() => setCreateTenantSuccessModal(null)}>
          <div className="saas-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Escuela creada correctamente</h3>
            <div className="saas-conversion-result">
              <p><strong>Escuela:</strong> {createTenantSuccessModal.tenantSlug}</p>
              <p><strong>Admin:</strong> {createTenantSuccessModal.adminEmail}</p>
              <p><strong>Password temporal:</strong> {createTenantSuccessModal.temporaryPassword}</p>
              <p>
                <strong>Correo de acceso:</strong>{' '}
                {createTenantSuccessModal.welcomeEmailSent ? 'Enviado' : 'No enviado'}
              </p>
            </div>
            <div className="saas-user-actions">
              <button type="button" className="btn-primary" onClick={() => setCreateTenantSuccessModal(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentModalTenant && (
        <div className="saas-modal-backdrop" onClick={closePaymentModal}>
          <div className="saas-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Registrar pago SaaS</h3>
            <p>
              Tenant: <strong>{paymentModalTenant.display_name || paymentModalTenant.nombre}</strong> ({paymentModalTenant.slug})
            </p>
            <div className="saas-modal-grid">
              <label>
                Monto (COP)
                <input
                  type="number"
                  min={1}
                  value={paymentForm.amount}
                  onFocus={() => {
                    if (paymentForm.amount === '0') {
                      setPaymentForm((prev) => ({ ...prev, amount: '' }));
                    }
                  }}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </label>
              <label>
                Fecha/hora pago (opcional)
                <input
                  type="datetime-local"
                  value={paymentForm.paid_at}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, paid_at: e.target.value }))}
                />
              </label>
              <label>
                Referencia (opcional)
                <input
                  type="text"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference: e.target.value }))}
                />
              </label>
              <label>
                Nota (opcional)
                <input
                  type="text"
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </label>
            </div>
            <label className="saas-mfa-ack">
              <input
                type="checkbox"
                checked={paymentForm.set_status_active}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, set_status_active: e.target.checked }))}
              />
              Cambiar estado de suscripción a ACTIVE al registrar pago
            </label>
            <div className="saas-user-actions">
              <button type="button" className="btn-secondary" onClick={closePaymentModal} disabled={recordingPayment}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={() => void submitTenantPayment()} disabled={recordingPayment}>
                {recordingPayment ? 'Registrando...' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {conversionModalLead && (
        <div className="saas-modal-backdrop" onClick={closeConvertLeadModal}>
          <div className="saas-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Convertir lead a tenant demo</h3>
            <p>
              Lead: <strong>{conversionModalLead.escuela_nombre}</strong>
            </p>
            <div className="saas-modal-grid">
              <label>
                Correo admin
                <input
                  type="email"
                  value={conversionForm.admin_email}
                  onChange={(e) => setConversionForm((prev) => ({ ...prev, admin_email: e.target.value }))}
                />
              </label>
              <label>
                Nombre admin
                <input
                  type="text"
                  value={conversionForm.admin_nombre_completo}
                  onChange={(e) => setConversionForm((prev) => ({ ...prev, admin_nombre_completo: e.target.value }))}
                />
              </label>
              <label>
                Cédula admin
                <input
                  type="text"
                  value={conversionForm.admin_cedula}
                  onChange={(e) => setConversionForm((prev) => ({ ...prev, admin_cedula: e.target.value }))}
                />
              </label>
              <label>
                Teléfono admin (opcional)
                <input
                  type="text"
                  value={conversionForm.admin_telefono}
                  onChange={(e) => setConversionForm((prev) => ({ ...prev, admin_telefono: e.target.value }))}
                />
              </label>
              <label>
                Password temporal (opcional)
                <input
                  type="text"
                  value={conversionForm.admin_password}
                  onChange={(e) => setConversionForm((prev) => ({ ...prev, admin_password: e.target.value }))}
                />
              </label>
            </div>
            {conversionError && <div className="error-message">{conversionError}</div>}
            {conversionResult && (
              <div className="saas-conversion-result">
                <p><strong>Tenant:</strong> {conversionResult.tenantSlug}</p>
                <p><strong>Admin:</strong> {conversionResult.adminEmail}</p>
                <p>
                  <strong>Password temporal:</strong>{' '}
                  {showTemporaryPassword ? conversionResult.temporaryPassword : '••••••••••••'}
                </p>
                <div className="saas-user-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowTemporaryPassword((prev) => !prev)}
                  >
                    {showTemporaryPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showTemporaryPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void copyConversionCredentials()}>
                    {credentialsCopied ? 'Credenciales copiadas' : 'Copiar credenciales'}
                  </button>
                </div>
              </div>
            )}
            <div className="saas-user-actions">
              <button type="button" className="btn-secondary" onClick={closeConvertLeadModal}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => void onSubmitConvertLead()} disabled={submittingConversion}>
                {submittingConversion ? 'Convirtiendo...' : 'Confirmar conversión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {supportDescriptionModal && (
        <div className="saas-modal-backdrop" onClick={() => setSupportDescriptionModal(null)}>
          <div className="saas-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Detalle de solicitud</h3>
            <p>
              Ticket <strong>#{supportDescriptionModal.ticketId}</strong> - {supportDescriptionModal.tenantName}
            </p>
            <p>
              Asunto: <strong>{supportDescriptionModal.subject}</strong>
            </p>
            <div className="saas-support-description-body">{supportDescriptionModal.description}</div>
            <div className="saas-user-actions">
              <button type="button" className="btn-primary" onClick={() => setSupportDescriptionModal(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
