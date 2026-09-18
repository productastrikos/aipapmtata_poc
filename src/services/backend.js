/* ═══════════════════════════════════════════════════════════════════════════
   Client for the S!aP demo API (server/index.js).
   ───────────────────────────────────────────────────────────────────────────
   The API lives on its own port so the demo can be served as a static bundle
   while configuration, audit and integration state persist behind it. The
   base URL resolves from the page host, so the app works unchanged whether
   it is opened on localhost or across the VPN.

   Every call carries the current demo identity in headers — that is what the
   backend writes into the audit trail and what it checks for write access.
   Real deployments take identity from TPCL's AD/SSO instead.
   ═══════════════════════════════════════════════════════════════════════════ */

const API_PORT = 4174;

export const API_BASE =
  process.env.REACT_APP_API_BASE ||
  `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;

/* Identity is set by the role switcher in Security & Administration and read
   back here on every request. */
let identity = { user: 'R. Iyer', role: 'planner' };
export function setIdentity(next) { identity = Object.assign({}, identity, next); }
export function getIdentity() { return identity; }

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
  }
}

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'X-Demo-User': identity.user, 'X-Demo-Role': identity.role },
      options.headers || {}
    ),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let body = null;
  try { body = await res.json(); } catch (e) { /* empty or non-JSON */ }

  if (!res.ok) {
    // The work-order endpoint returns a structured SAP rejection on 422 that
    // the UI wants to display rather than treat as a transport failure.
    const msg = (body && (body.error || (body.response && body.response.MESSAGE))) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body;
}

/* ─── Availability ──────────────────────────────────────────────────────── */
export const health = () => request('/api/health');

/* ─── Section O — configuration ─────────────────────────────────────────── */
export const listConfig   = (kind) => request(`/api/config/${kind}`).then((r) => r.items || []);
export const createConfig = (kind, doc) => request(`/api/config/${kind}`, { method: 'POST', body: doc }).then((r) => r.item);
export const updateConfig = (kind, id, patch) => request(`/api/config/${kind}/${id}`, { method: 'PATCH', body: patch }).then((r) => r.item);
export const deleteConfig = (kind, id) => request(`/api/config/${kind}/${id}`, { method: 'DELETE' }).then((r) => r.item);

/* ─── Section N — audit & users ─────────────────────────────────────────── */
export const listAudit = (limit = 100) => request(`/api/audit-log?limit=${limit}`).then((r) => r.items || []);
export const writeAudit = (entry) => request('/api/audit-log', { method: 'POST', body: entry }).then((r) => r.item);
export const listUsers = () => request('/api/users').then((r) => r.items || []);
export const createUser = (doc) => request('/api/users', { method: 'POST', body: doc }).then((r) => r.item);

/* ─── Section M — integrations ──────────────────────────────────────────── */
export const integrationCatalogue = () => request('/api/integration/catalogue').then((r) => r.items || []);
export const integrationLog = (limit = 50) => request(`/api/integration/log?limit=${limit}`).then((r) => r.items || []);
export const runIngest = (system, records = 25) =>
  request(`/api/integration/${system}/ingest`, { method: 'POST', body: { records } });

/* Returns the SAP response on success; on a 422 the ApiError carries the
   structured SAP rejection in `.body.response` so the UI can render it. */
export const pushWorkOrder = (payload) =>
  request('/api/integration/sap_pm/work-order', { method: 'POST', body: payload });

/* ─── Section Q — service management ────────────────────────────────────── */
export const listTickets = () => request('/api/tickets').then((r) => r.items || []);
export const createTicket = (doc) => request('/api/tickets', { method: 'POST', body: doc }).then((r) => r.item);
export const updateTicket = (id, patch) => request(`/api/tickets/${id}`, { method: 'PATCH', body: patch }).then((r) => r.item);
export const listPatches = () => request('/api/patches').then((r) => r.items || []);
export const listKnowledgeTransfer = () => request('/api/knowledge-transfer').then((r) => r.items || []);

export const resetDemo = () => request('/api/admin/reset', { method: 'POST' });
