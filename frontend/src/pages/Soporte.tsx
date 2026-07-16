import { useEffect, useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { SaasSupportTicketItem, tenantSupportAPI } from '../services/api';
import { parseApiError } from '../utils/errors';
import { formatDateTimeCO } from '../utils/formatters';
import '../styles/Soporte.css';

const STATUS_OPTIONS = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const formatDateTime = (value?: string | null) => {
  return formatDateTimeCO(value);
};

const statusClass = (value?: string | null) => `bo-status bo-status-${String(value || 'info').toLowerCase()}`;

export const Soporte = () => {
  const [tickets, setTickets] = useState<SaasSupportTicketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await tenantSupportAPI.getMyTickets({
        search: search || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        limit: 100,
      });
      setTickets(response.items || []);
    } catch (err: any) {
      setError(parseApiError(err, 'No se pudieron cargar los tickets'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const openCount = useMemo(
    () => tickets.filter((ticket) => ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS').length,
    [tickets]
  );

  const handleCreateTicket = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (subject.trim().length < 6) {
      setError('El asunto debe tener al menos 6 caracteres');
      return;
    }
    try {
      setCreating(true);
      setError('');
      setInfoMessage('');
      await tenantSupportAPI.createMyTicket({
        subject: subject.trim(),
        description: description.trim() || undefined,
        category: category.trim() || 'GENERAL',
        priority,
      });
      setSubject('');
      setDescription('');
      setCategory('GENERAL');
      setPriority('MEDIUM');
      setInfoMessage('Ticket creado correctamente. Nuestro equipo lo revisará pronto.');
      await loadTickets();
    } catch (err: any) {
      setError(parseApiError(err, 'No se pudo crear el ticket'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="soporte-tenant-page">
      <PageHeader
        title="Soporte"
        subtitle="Crea tickets y consulta su estado con el equipo SaaS."
        icon={<MessageSquare size={20} />}
      />

      {error && <div className="soporte-tenant-error bo-alert bo-alert-error">{error}</div>}
      {infoMessage && <div className="soporte-tenant-info bo-alert bo-alert-info">{infoMessage}</div>}

      <div className="soporte-tenant-grid">
        <section className="soporte-tenant-card bo-card">
          <h3>Nuevo ticket</h3>
          <form className="soporte-tenant-form" onSubmit={handleCreateTicket}>
            <label>
              Asunto
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ej: No carga el módulo de caja"
                maxLength={255}
                required
              />
            </label>
            <label>
              Categoría
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value.toUpperCase())}
                placeholder="GENERAL"
                maxLength={40}
              />
            </label>
            <label>
              Prioridad
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Descripción
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe el problema con detalle para una solución más rápida."
                rows={4}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={creating}>
              {creating ? 'Creando...' : 'Crear ticket'}
            </button>
          </form>
        </section>

        <section className="soporte-tenant-card bo-card">
          <div className="soporte-tenant-list-header">
            <h3>Tickets de mi escuela</h3>
            <span>{openCount} abiertos</span>
          </div>
          <div className="soporte-tenant-filters bo-toolbar">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por asunto o descripción"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status || 'ALL'} value={status}>
                  {status || 'Todos los estados'}
                </option>
              ))}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">Todas las prioridades</option>
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <button type="button" className="btn-primary" onClick={() => void loadTickets()} disabled={loading}>
              {loading ? 'Consultando...' : 'Buscar'}
            </button>
          </div>

          <div className="soporte-tenant-table-wrap bo-table-wrap">
            <table className="soporte-tenant-table bo-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Asunto</th>
                  <th>Estado</th>
                  <th>Prioridad</th>
                  <th>Creado</th>
                  <th>Vence</th>
                </tr>
              </thead>
              <tbody>
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      Sin tickets registrados para los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>#{ticket.id}</td>
                      <td>
                        <strong>{ticket.subject}</strong>
                        <div className="soporte-tenant-muted">{ticket.category}</div>
                      </td>
                      <td><span className={statusClass(ticket.status)}>{ticket.status}</span></td>
                      <td><span className={statusClass(ticket.priority)}>{ticket.priority}</span></td>
                      <td>{formatDateTime(ticket.created_at)}</td>
                      <td>{formatDateTime(ticket.due_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
