/* ═══════════════════════════════════════════════════════════════════════════
   S!aP demo backend — persistence
   ───────────────────────────────────────────────────────────────────────────
   A JSON file on disk. Not a database, and not pretending to be one: the
   delivery build puts this behind the S!aP Datalake on TPCL's VNet. What it
   buys the demo is the thing Section O actually tests — an asset class or an
   alarm created in front of the evaluators is still there after a refresh,
   and every write leaves an audit trail.

   Writes are serialised through a promise chain so two rapid clicks from the
   Config Studio can't interleave and lose one another.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`.toUpperCase();

/* ─── Seed — what a freshly provisioned tenant looks like ───────────────── */
function seed() {
  const t = Date.now();
  const ago = (mins) => new Date(t - mins * 60000).toISOString();

  return {
    meta: { created: now(), version: 1 },

    /* Section N — RBAC. Demo identities, not real authentication. */
    users: [
      { id: 'U-001', name: 'A. Deshpande', email: 'a.deshpande@tatapower.demo', role: 'admin',    title: 'Platform Administrator', mfa: true,  sso: true,  lastLogin: ago(12) },
      { id: 'U-002', name: 'R. Iyer',      email: 'r.iyer@tatapower.demo',      role: 'planner',  title: 'Asset Planning Lead',    mfa: true,  sso: true,  lastLogin: ago(48) },
      { id: 'U-003', name: 'S. Kulkarni',  email: 's.kulkarni@tatapower.demo',  role: 'engineer', title: 'Substation Engineer',    mfa: true,  sso: true,  lastLogin: ago(95) },
      { id: 'U-004', name: 'M. Rao',       email: 'm.rao@tatapower.demo',       role: 'auditor',  title: 'Regulatory Analyst',     mfa: false, sso: true,  lastLogin: ago(310) },
    ],

    /* Section O — everything below is created live during the demo. */
    assetClasses: [],
    healthModels: [],
    dashboards: [],
    businessRules: [],
    alarms: [],
    savedReports: [],
    schedules: [],

    /* Section F — model governance: field feedback and training-run history. */
    modelFeedback: [],
    modelRuns: [],

    /* Section N — audit trail. Every config write appends here. */
    auditLog: [
      { id: 'AUD-SEED-3', at: ago(210), user: 'A. Deshpande', role: 'admin',   action: 'PLATFORM_DEPLOY',  object: 'S!aP tenant',              detail: 'Tenant provisioned on TPCL VNet (ap-south-1)', ip: '10.22.4.18' },
      { id: 'AUD-SEED-2', at: ago(180), user: 'A. Deshpande', role: 'admin',   action: 'INTEGRATION_BIND', object: 'Grid Data Hub',            detail: 'GDH REST endpoint bound, schema v2.4 validated', ip: '10.22.4.18' },
      { id: 'AUD-SEED-1', at: ago(96),  user: 'R. Iyer',      role: 'planner', action: 'SCENARIO_SAVE',    object: 'FY27 baseline',            detail: 'Baseline investment scenario saved', ip: '10.22.7.91' },
    ],

    /* Section Q — incidents, SLA and service management. */
    tickets: [
      { id: 'INC-2041', at: ago(35),  severity: 'P2', status: 'In Progress', title: 'GDH batch rejected 3 work-order records',      raisedBy: 'S. Kulkarni', assignee: 'Astrikos L2', category: 'Integration', slaMins: 240, resolvedAt: null },
      { id: 'INC-2038', at: ago(190), severity: 'P3', status: 'In Progress', title: 'Risk heat map slow to render above 5k assets',  raisedBy: 'R. Iyer',     assignee: 'Astrikos L2', category: 'Performance', slaMins: 480, resolvedAt: null },
      { id: 'INC-2035', at: ago(420), severity: 'P1', status: 'Resolved',    title: 'SCADA telemetry feed stalled for 22 minutes',   raisedBy: 'Automated',   assignee: 'Astrikos L3', category: 'Integration', slaMins: 60,  resolvedAt: ago(385) },
      { id: 'INC-2031', at: ago(900), severity: 'P4', status: 'Resolved',    title: 'Add Marathi locale to consumer impact report',  raisedBy: 'M. Rao',      assignee: 'Astrikos L1', category: 'Enhancement', slaMins: 2880, resolvedAt: ago(320) },
      { id: 'INC-2028', at: ago(1400), severity: 'P3', status: 'Closed',     title: 'Oil BDV unit mismatch on bulk upload template', raisedBy: 'S. Kulkarni', assignee: 'Astrikos L2', category: 'Data Quality', slaMins: 480, resolvedAt: ago(1180) },
    ],

    /* Section Q — patch and release history. */
    patches: [
      { id: 'PTC-0091', at: ago(60 * 24 * 3),  component: 'S!aP ML & AI Central', version: '4.8.2',  type: 'Security', status: 'Applied',   cve: 'CVE-2026-2211', window: 'Sun 02:00–04:00 IST' },
      { id: 'PTC-0090', at: ago(60 * 24 * 11), component: 'S!aP Konnect',         version: '4.8.1',  type: 'Patch',    status: 'Applied',   cve: null,            window: 'Sun 02:00–04:00 IST' },
      { id: 'PTC-0089', at: ago(60 * 24 * 26), component: 'S!aP Viz',             version: '4.8.0',  type: 'Feature',  status: 'Applied',   cve: null,            window: 'Sun 02:00–04:00 IST' },
      { id: 'PTC-0092', at: ago(-60 * 24 * 6), component: 'S!aP Datalake',        version: '4.9.0',  type: 'Feature',  status: 'Scheduled', cve: null,            window: 'Sun 02:00–04:00 IST' },
    ],

    /* Section Q — knowledge transfer against the RFQ training tracks. */
    knowledgeTransfer: [
      { id: 'KT-01', track: 'End Users — Field Engineers & Asset Managers', sessions: 6, completed: 6, attendees: 42, status: 'Complete',    signedOff: true  },
      { id: 'KT-02', track: 'Planning & Regulatory Teams',                  sessions: 4, completed: 4, attendees: 14, status: 'Complete',    signedOff: true  },
      { id: 'KT-03', track: 'System Administrators',                        sessions: 5, completed: 3, attendees: 8,  status: 'In Progress', signedOff: false },
      { id: 'KT-04', track: 'Super Users / Power Users',                    sessions: 3, completed: 1, attendees: 11, status: 'In Progress', signedOff: false },
    ],

    /* Section M — rolling record of every integration call made. */
    integrationLog: [],
  };
}

/* ─── Load / persist ────────────────────────────────────────────────────── */
let state = null;

function load() {
  if (state) return state;
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Forward-compatibility: a store written by an older build may be
      // missing collections this build expects.
      const base = seed();
      Object.keys(base).forEach((k) => {
        if (state[k] === undefined) state[k] = base[k];
      });
      return state;
    }
  } catch (e) {
    console.error('  store: could not read ' + DATA_FILE + ' (' + e.message + ') — reseeding');
  }
  state = seed();
  persist();
  return state;
}

let writeChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .then(() => fs.promises.mkdir(DATA_DIR, { recursive: true }))
    .then(() => fs.promises.writeFile(DATA_FILE, snapshot, 'utf8'))
    .catch((e) => console.error('  store: write failed —', e.message));
  return writeChain;
}

/* ─── Audit ─────────────────────────────────────────────────────────────── */
function audit(entry) {
  const s = load();
  const row = {
    id: id('AUD'),
    at: now(),
    user: entry.user || 'System',
    role: entry.role || 'system',
    action: entry.action,
    object: entry.object || '',
    detail: entry.detail || '',
    ip: entry.ip || '—',
  };
  s.auditLog.unshift(row);
  if (s.auditLog.length > 500) s.auditLog.length = 500;
  persist();
  return row;
}

/* ─── Generic collection helpers ────────────────────────────────────────── */
function list(collection) {
  return load()[collection] || [];
}

function insert(collection, doc, auditMeta) {
  const s = load();
  if (!s[collection]) s[collection] = [];
  const row = Object.assign({ id: id(auditMeta.prefix || 'REC'), createdAt: now() }, doc);
  s[collection].unshift(row);
  persist();
  if (auditMeta.action) {
    audit({
      user: auditMeta.user,
      role: auditMeta.role,
      action: auditMeta.action,
      object: auditMeta.object || row.name || row.id,
      detail: auditMeta.detail || '',
      ip: auditMeta.ip,
    });
  }
  return row;
}

function update(collection, rowId, patch, auditMeta) {
  const s = load();
  const arr = s[collection] || [];
  const i = arr.findIndex((r) => r.id === rowId);
  if (i === -1) return null;
  arr[i] = Object.assign({}, arr[i], patch, { updatedAt: now() });
  persist();
  if (auditMeta && auditMeta.action) {
    audit({
      user: auditMeta.user,
      role: auditMeta.role,
      action: auditMeta.action,
      object: auditMeta.object || arr[i].name || rowId,
      detail: auditMeta.detail || '',
      ip: auditMeta.ip,
    });
  }
  return arr[i];
}

function remove(collection, rowId, auditMeta) {
  const s = load();
  const arr = s[collection] || [];
  const i = arr.findIndex((r) => r.id === rowId);
  if (i === -1) return null;
  const [row] = arr.splice(i, 1);
  persist();
  if (auditMeta && auditMeta.action) {
    audit({
      user: auditMeta.user,
      role: auditMeta.role,
      action: auditMeta.action,
      object: auditMeta.object || row.name || rowId,
      detail: auditMeta.detail || '',
      ip: auditMeta.ip,
    });
  }
  return row;
}

function logIntegration(row) {
  const s = load();
  s.integrationLog.unshift(Object.assign({ id: id('INT'), at: now() }, row));
  if (s.integrationLog.length > 200) s.integrationLog.length = 200;
  persist();
}

function reset() {
  state = seed();
  persist();
  return state;
}

module.exports = { load, persist, audit, list, insert, update, remove, logIntegration, reset, id, now, DATA_FILE };
