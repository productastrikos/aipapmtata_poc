#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — demo backend
   ───────────────────────────────────────────────────────────────────────────
   Zero dependencies, plain node:http. Exists for the three things the
   checkpoint sheet tests that a browser-only build genuinely cannot do:

     Section M  real HTTP round trips to labelled integration simulators,
                with real schema validation that really rejects records
     Section N  an audit trail that survives a refresh
     Section O  configuration created live that persists and takes effect
     Section Q  incidents and SLA state that can be changed and re-read

   Run:  npm run server        (port 4174, all interfaces)
   ═══════════════════════════════════════════════════════════════════════════ */

const http = require('http');
const store = require('./store');
const integrations = require('./integrations');

const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.API_PORT, 10) || 4174;

/* ─── Plumbing ──────────────────────────────────────────────────────────── */
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Demo-User,X-Demo-Role',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/* Identity comes from headers the client sets from its role switcher. This is
   a demo affordance, not authentication — the delivery build takes identity
   from TPCL's Active Directory via SSO, and the audit trail then carries the
   real principal instead of whatever the client claimed. */
function who(req) {
  return {
    user: req.headers['x-demo-user'] || 'Demo User',
    role: req.headers['x-demo-role'] || 'viewer',
    ip: (req.socket.remoteAddress || '').replace('::ffff:', '') || '—',
  };
}

const WRITE_ROLES = { admin: true, planner: true, engineer: true };
function canWrite(role) { return !!WRITE_ROLES[role]; }

/* ─── Routes ────────────────────────────────────────────────────────────── */
const CONFIG_COLLECTIONS = {
  'asset-classes':  { key: 'assetClasses',   prefix: 'ACL', action: 'ASSET_CLASS_CREATE' },
  'health-models':  { key: 'healthModels',   prefix: 'HMD', action: 'HEALTH_MODEL_CREATE' },
  'dashboards':     { key: 'dashboards',     prefix: 'DSH', action: 'DASHBOARD_CREATE' },
  'business-rules': { key: 'businessRules',  prefix: 'BRL', action: 'BUSINESS_RULE_CREATE' },
  'alarms':         { key: 'alarms',         prefix: 'ALM', action: 'ALARM_CREATE' },
  'reports':        { key: 'savedReports',   prefix: 'RPT', action: 'REPORT_CREATE' },
  'schedules':      { key: 'schedules',      prefix: 'SCH', action: 'SCHEDULE_CREATE' },
  'model-feedback': { key: 'modelFeedback',  prefix: 'FBK', action: 'MODEL_FEEDBACK' },
  'model-runs':     { key: 'modelRuns',      prefix: 'RUN', action: 'MODEL_TRAINING_RUN' },
};

async function route(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  const id = who(req);

  /* Health probe */
  if (p === '/api/health') {
    return send(res, 200, { ok: true, service: 'S!aP demo API', port: PORT, at: store.now(), store: store.DATA_FILE });
  }

  /* ── Section O — configuration collections ───────────────────────────── */
  const cfgMatch = p.match(/^\/api\/config\/([a-z-]+)(?:\/([\w-]+))?$/);
  if (cfgMatch) {
    const spec = CONFIG_COLLECTIONS[cfgMatch[1]];
    if (!spec) return send(res, 404, { error: `Unknown configuration collection "${cfgMatch[1]}"` });
    const rowId = cfgMatch[2];

    if (m === 'GET') return send(res, 200, { items: store.list(spec.key) });

    if (!canWrite(id.role)) {
      return send(res, 403, {
        error: 'Role not permitted to modify configuration',
        detail: `Role "${id.role}" has read-only access. Switch to Administrator in Security & Administration.`,
      });
    }

    if (m === 'POST') {
      const body = await readBody(req);
      if (!body.name || !String(body.name).trim()) {
        return send(res, 422, { error: 'Field "name" is required', field: 'name' });
      }
      const row = store.insert(spec.key, Object.assign({}, body, { createdBy: id.user }), {
        prefix: spec.prefix, action: spec.action, user: id.user, role: id.role, ip: id.ip,
        object: body.name, detail: body.auditDetail || `${cfgMatch[1].replace('-', ' ')} created`,
      });
      return send(res, 201, { item: row });
    }

    if (m === 'PATCH' && rowId) {
      const body = await readBody(req);
      const row = store.update(spec.key, rowId, body, {
        action: spec.action.replace('CREATE', 'UPDATE'), user: id.user, role: id.role, ip: id.ip,
        detail: body.auditDetail || 'Configuration updated',
      });
      return row ? send(res, 200, { item: row }) : send(res, 404, { error: 'Not found' });
    }

    if (m === 'DELETE' && rowId) {
      const row = store.remove(spec.key, rowId, {
        action: spec.action.replace('CREATE', 'DELETE'), user: id.user, role: id.role, ip: id.ip,
        detail: 'Configuration deleted',
      });
      return row ? send(res, 200, { item: row }) : send(res, 404, { error: 'Not found' });
    }
  }

  /* ── Section N — audit, users ────────────────────────────────────────── */
  if (p === '/api/audit-log') {
    if (m === 'GET') {
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 100, 500);
      return send(res, 200, { items: store.list('auditLog').slice(0, limit) });
    }
    if (m === 'POST') {
      const body = await readBody(req);
      if (!body.action) return send(res, 422, { error: 'Field "action" is required' });
      return send(res, 201, { item: store.audit(Object.assign({}, body, { user: id.user, role: id.role, ip: id.ip })) });
    }
  }

  if (p === '/api/users') {
    if (m === 'GET') return send(res, 200, { items: store.list('users') });
    if (m === 'POST') {
      if (id.role !== 'admin') return send(res, 403, { error: 'Only an Administrator may create users' });
      const body = await readBody(req);
      if (!body.name || !body.role) return send(res, 422, { error: 'Fields "name" and "role" are required' });
      const row = store.insert('users', Object.assign({ mfa: true, sso: true, lastLogin: null }, body), {
        prefix: 'U', action: 'USER_CREATE', user: id.user, role: id.role, ip: id.ip,
        object: body.name, detail: `User created with role "${body.role}"`,
      });
      return send(res, 201, { item: row });
    }
  }

  /* ── Section M — integrations ────────────────────────────────────────── */
  if (p === '/api/integration/catalogue' && m === 'GET') {
    return send(res, 200, { items: integrations.catalogue() });
  }

  if (p === '/api/integration/log' && m === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
    return send(res, 200, { items: store.list('integrationLog').slice(0, limit) });
  }

  const ingestMatch = p.match(/^\/api\/integration\/([a-z_]+)\/ingest$/);
  if (ingestMatch && m === 'POST') {
    const body = await readBody(req);
    const result = integrations.ingest(ingestMatch[1], body.records);
    if (!result) return send(res, 404, { error: `Unknown system "${ingestMatch[1]}"` });

    // Real latency, so the console's spinner is measuring something.
    await new Promise((r) => setTimeout(r, Math.min(result.durationMs, 1500)));

    store.logIntegration({
      system: result.system, systemName: result.systemName, operation: 'INGEST',
      received: result.received, accepted: result.accepted, rejected: result.rejected,
      durationMs: result.durationMs, status: result.rejected ? 'VARIANCE' : 'OK', user: id.user,
    });
    store.audit({
      user: id.user, role: id.role, ip: id.ip, action: 'INTEGRATION_INGEST',
      object: result.systemName,
      detail: `${result.accepted} accepted, ${result.rejected} rejected of ${result.received}`,
    });
    return send(res, 200, result);
  }

  if (p === '/api/integration/sap_pm/work-order' && m === 'POST') {
    const body = await readBody(req);
    const result = integrations.pushWorkOrder(body);
    await new Promise((r) => setTimeout(r, 420));

    store.logIntegration({
      system: 'sap_pm', systemName: 'SAP Plant Maintenance', operation: 'WORK_ORDER_PUSH',
      received: 1, accepted: result.ok ? 1 : 0, rejected: result.ok ? 0 : 1,
      durationMs: 420, status: result.ok ? 'OK' : 'REJECTED', user: id.user,
      reference: result.ok ? result.response.AUFNR : null,
    });
    store.audit({
      user: id.user, role: id.role, ip: id.ip, action: 'WORK_ORDER_PUSH',
      object: body.EQUNR || 'unknown asset',
      detail: result.ok ? `SAP PM order ${result.response.AUFNR} created` : `Rejected: ${result.response.MESSAGE}`,
    });
    return send(res, result.status, result);
  }

  /* ── Section Q — service management ──────────────────────────────────── */
  if (p === '/api/tickets') {
    if (m === 'GET') return send(res, 200, { items: store.list('tickets') });
    if (m === 'POST') {
      const body = await readBody(req);
      if (!body.title || !body.severity) return send(res, 422, { error: 'Fields "title" and "severity" are required' });
      const SLA = { P1: 60, P2: 240, P3: 480, P4: 2880 };
      const row = store.insert('tickets', {
        at: store.now(), severity: body.severity, status: 'Open', title: body.title,
        raisedBy: id.user, assignee: body.assignee || 'Astrikos L1',
        category: body.category || 'General', slaMins: SLA[body.severity] || 480, resolvedAt: null,
      }, {
        prefix: 'INC', action: 'INCIDENT_RAISE', user: id.user, role: id.role, ip: id.ip,
        object: body.title, detail: `${body.severity} incident raised`,
      });
      return send(res, 201, { item: row });
    }
  }

  const ticketMatch = p.match(/^\/api\/tickets\/([\w-]+)$/);
  if (ticketMatch && m === 'PATCH') {
    const body = await readBody(req);
    const patch = Object.assign({}, body);
    if (body.status === 'Resolved' || body.status === 'Closed') patch.resolvedAt = store.now();
    const row = store.update('tickets', ticketMatch[1], patch, {
      action: 'INCIDENT_UPDATE', user: id.user, role: id.role, ip: id.ip,
      detail: `Status → ${body.status || 'updated'}`,
    });
    return row ? send(res, 200, { item: row }) : send(res, 404, { error: 'Not found' });
  }

  if (p === '/api/patches' && m === 'GET') return send(res, 200, { items: store.list('patches') });
  if (p === '/api/knowledge-transfer' && m === 'GET') return send(res, 200, { items: store.list('knowledgeTransfer') });

  /* ── Demo reset ──────────────────────────────────────────────────────── */
  if (p === '/api/admin/reset' && m === 'POST') {
    if (id.role !== 'admin') return send(res, 403, { error: 'Only an Administrator may reset the demo store' });
    store.reset();
    return send(res, 200, { ok: true, message: 'Demo store reset to seed state' });
  }

  return send(res, 404, { error: `No route for ${m} ${p}` });
}

/* ─── Server ────────────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Demo-User,X-Demo-Role',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (e) { return send(res, 400, { error: 'Bad request URL' }); }

  route(req, res, url).catch((err) => {
    console.error('  api error:', err.message);
    if (!res.headersSent) send(res, 500, { error: 'Internal error', detail: err.message });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  store.load();
  console.log('\n  S!aP demo API');
  console.log('  Listening on http://0.0.0.0:' + PORT);
  console.log('  Store: ' + store.DATA_FILE);
  console.log('\n  Ctrl+C to stop.\n');
});
