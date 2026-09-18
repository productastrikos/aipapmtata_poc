/* Security & Administration — Section N of the checkpoint sheet.
   N.1 MFA, N.2 SSO, N.3 Active Directory, N.4 RBAC, N.5 audit logs,
   N.6 encryption at rest, N.7 encryption in transit, N.8 SIEM integration,
   N.9 vulnerability management, N.10 security administration.

   The role switcher is not decorative: it sets the identity this client sends
   on every API call, and the backend independently checks it on every write.
   Switch to Regulatory Auditor and the Config Studio stops accepting writes —
   server-side, with a 403, not by hiding a button. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRole, ROLES, DEMO_IDENTITIES } from '../services/roleContext';
import { listAudit, listUsers, createUser, health } from '../services/backend';
import { fmtInt } from '../engines/indices';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoLock, IcoShield, IcoPeople, IcoClipboard, IcoAlert, IcoCheck } from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';

/* Section N.6 / N.7 — the controls as designed, with their standard. */
const CONTROLS = [
  { id: 'N.1',  control: 'Multi-Factor Authentication', standard: 'TPCL InfoSec policy',        status: 'Enforced',  detail: 'TOTP + push, enforced for all privileged roles' },
  { id: 'N.2',  control: 'Single Sign-On',              standard: 'SAML 2.0 / OIDC',            status: 'Enforced',  detail: 'Federated against TPCL identity provider' },
  { id: 'N.3',  control: 'Active Directory',            standard: 'LDAPS',                      status: 'Bound',     detail: 'Group-to-role mapping, nested groups resolved' },
  { id: 'N.4',  control: 'Role-Based Access Control',   standard: 'RBAC + ABAC',                status: 'Enforced',  detail: 'Four roles; attribute rules scope by zone and asset class' },
  { id: 'N.5',  control: 'Audit Logging',               standard: 'ISO/IEC 27001 A.12.4',       status: 'Active',    detail: 'Immutable append; user, action, object, timestamp, source IP' },
  { id: 'N.6',  control: 'Encryption at Rest',          standard: 'AES-256',                    status: 'Enforced',  detail: 'Volume and field-level; keys in Azure Key Vault (India)' },
  { id: 'N.7',  control: 'Encryption in Transit',       standard: 'TLS 1.3 (1.2 minimum)',      status: 'Enforced',  detail: 'mTLS on all inter-service and integration traffic' },
  { id: 'N.8',  control: 'SIEM Integration',            standard: 'Microsoft Sentinel',         status: 'Streaming', detail: 'Security events forwarded in CEF; 90-day hot retention' },
  { id: 'N.9',  control: 'Vulnerability Management',    standard: 'CERT-In / VAPT',             status: 'Current',   detail: 'Quarterly scans; annual CERT-In certified VAPT' },
  { id: 'N.10', control: 'Security Administration',     standard: 'Least privilege',            status: 'Active',    detail: 'Separation of duties; privileged access reviewed quarterly' },
];

const SIEM_EVENTS = [
  { at: 4,   sev: 'Info',    rule: 'AUTH_SUCCESS',          detail: 'SSO assertion validated for r.iyer@tatapower.demo', src: '10.22.7.91' },
  { at: 19,  sev: 'Warning', rule: 'RBAC_DENY',             detail: 'Write attempt on /api/config/alarms by role=auditor rejected (403)', src: '10.22.9.14' },
  { at: 41,  sev: 'Info',    rule: 'CONFIG_CHANGE',         detail: 'Health model weight modified — captured to audit trail', src: '10.22.4.18' },
  { at: 77,  sev: 'Info',    rule: 'INTEGRATION_AUTH',      detail: 'OAuth2 client credentials issued to GDH connector', src: '10.22.4.18' },
  { at: 118, sev: 'Warning', rule: 'ANOMALOUS_VOLUME',      detail: 'SCADA ingest volume 3.2σ above 24h baseline — informational', src: '10.22.5.30' },
  { at: 186, sev: 'Info',    rule: 'MFA_CHALLENGE_PASS',    detail: 'Step-up authentication satisfied for privileged action', src: '10.22.4.18' },
  { at: 240, sev: 'Info',    rule: 'KEY_ROTATION',          detail: 'Data encryption key rotated per 90-day schedule', src: 'system' },
];

const VULNS = [
  { id: 'VLN-0041', component: 'Node runtime',        severity: 'Medium', cvss: 5.3, status: 'Patched',    found: '2026-08-22', closed: '2026-08-29' },
  { id: 'VLN-0040', component: 'S!aP Viz — bundled JS', severity: 'Low',   cvss: 3.1, status: 'Patched',    found: '2026-08-11', closed: '2026-08-18' },
  { id: 'VLN-0039', component: 'TLS cipher suite',     severity: 'Low',    cvss: 2.6, status: 'Accepted',   found: '2026-07-30', closed: null },
  { id: 'VLN-0042', component: 'Container base image', severity: 'High',   cvss: 7.4, status: 'In Progress', found: '2026-09-14', closed: null },
];

const SEV_TONE = { Critical: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#65a30d', Warning: '#d97706', Info: '#0ea5e9' };

export default function SecurityAdmin() {
  const { identity, role, switchIdentity, can } = useRole();
  const [tab, setTab] = useState('access');
  const [audit, setAudit] = useState([]);
  const [users, setUsers] = useState([]);
  const [apiUp, setApiUp] = useState(null);
  const [newUser, setNewUser] = useState({ name: '', role: 'engineer', title: '' });
  const [msg, setMsg] = useState(null);
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);

  const refresh = useCallback(() => {
    listAudit(120).then(setAudit).catch(() => {});
    listUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    health().then(() => alive && setApiUp(true)).catch(() => alive && setApiUp(false));
    refresh();
    return () => { alive = false; };
  }, [refresh]);

  const auditStats = useMemo(() => {
    const byAction = {};
    audit.forEach((a) => { byAction[a.action] = (byAction[a.action] || 0) + 1; });
    return {
      total: audit.length,
      byAction: Object.entries(byAction).map(([k, n]) => ({ action: k, n })).sort((a, b) => b.n - a.n),
      users: new Set(audit.map((a) => a.user)).size,
    };
  }, [audit]);

  const submitUser = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      await createUser({ name: newUser.name, role: newUser.role, title: newUser.title || ROLES[newUser.role].label });
      setNewUser({ name: '', role: 'engineer', title: '' });
      setMsg({ kind: 'ok', text: `User created and written to the audit trail.` });
      refresh();
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    }
  };

  const openVulns = VULNS.filter((v) => v.status === 'In Progress').length;

  return (
    <div className="space-y-4">
      {selectedKPIDetail && <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />}

      <PageHead
        eyebrow="S!aP Sys Admin · Security & Governance"
        title="Security & Administration"
        sub="Identity, access control, audit and platform security posture. The role selected here is sent with every API call and independently enforced by the service on write."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Active identity</p>
            <p className="text-[12px] font-bold mt-1" style={{ color: 'var(--app-info)' }}>{identity.name}</p>
            <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>{role.label}</p>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoLock />} label="Security Controls Enforced" value={`${CONTROLS.filter((c) => c.status !== 'Accepted').length}`} unit={` / ${CONTROLS.length}`} color={col}
            subValues={[{ label: 'Standard', value: 'ISO 27001' }, { label: 'VAPT', value: 'CERT-In' }]}
            onClick={() => showKPIDetail({ icon: <IcoLock />, label: 'Security Controls Enforced', value: String(CONTROLS.length), unit: 'controls', color: col, thresholds: { green: 10, amber: 8 }, inverted: false, definition: 'The ten security controls Section N enumerates, each mapped to the standard it implements. Encryption, SSO, MFA and SIEM forwarding are architectural, designed in from the outset rather than retrofitted.', subValues: CONTROLS.slice(0, 4).map((c) => ({ label: c.id, value: c.status })), target: 'All ten controls enforced', analysis: 'Defence in depth: network segmentation, least privilege, encryption at rest and in transit, and SIEM forwarding operate independently. | A CERT-In certified VAPT certificate is produced before Go-Live and annually through the AMC. | All data and keys remain India-resident.' })} />
        ); })()}

        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoPeople />} label="Provisioned Users" value={fmtInt(users.length)} color={col}
            subValues={[{ label: 'Roles', value: String(Object.keys(ROLES).length) }, { label: 'MFA', value: `${users.filter((u) => u.mfa).length}/${users.length}` }]}
            onClick={() => showKPIDetail({ icon: <IcoPeople />, label: 'Provisioned Users', value: String(users.length), unit: 'users', color: col, definition: 'Users provisioned in the demo tenant across four roles. In delivery, provisioning is driven from Active Directory group membership over SSO — users are not created in the platform directly.', subValues: Object.values(ROLES).map((r) => ({ label: r.label, value: String(users.filter((u) => u.role === r.key).length) })), target: 'All access via AD group mapping', analysis: 'Roles carry additive permission sets; the backend checks them on every write. | Attribute-based rules scope access further by zone and asset class. | Privileged access is reviewed quarterly under separation of duties.' })} />
        ); })()}

        {(() => { const col = 'text-violet-400'; return (
          <KPICard icon={<IcoClipboard />} label="Audit Entries" value={fmtInt(auditStats.total)} color={col}
            subValues={[{ label: 'Distinct Users', value: String(auditStats.users) }, { label: 'Retention', value: '1 year' }]}
            onClick={() => showKPIDetail({ icon: <IcoClipboard />, label: 'Audit Entries', value: String(auditStats.total), unit: 'entries', color: col, definition: 'Append-only audit trail. Every configuration change, work-order push, integration run and user action is recorded with the principal, the action, the object, the timestamp and the source address — and survives a refresh, because it is written server-side.', subValues: auditStats.byAction.slice(0, 4).map((a) => ({ label: a.action.replace(/_/g, ' '), value: String(a.n) })), target: 'Every privileged action captured', analysis: 'The trail is written by the service, not the browser, so it cannot be bypassed by a client that chooses not to report. | Entries are forwarded to Microsoft Sentinel in CEF format. | Retention is one year, then secure archival per TPCL policy.' })} />
        ); })()}

        {(() => { const col = openVulns === 0 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoAlert />} label="Open Vulnerabilities" value={fmtInt(openVulns)} color={col}
            subValues={[{ label: 'Highest CVSS', value: String(Math.max(...VULNS.filter((v) => v.status === 'In Progress').map((v) => v.cvss), 0) || '—') }, { label: 'Patched', value: String(VULNS.filter((v) => v.status === 'Patched').length) }]}
            onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Open Vulnerabilities', value: String(openVulns), unit: 'open', color: col, thresholds: { green: 0, amber: 3 }, inverted: true, definition: 'Vulnerabilities identified by scanning and by CERT-In certified VAPT that remain unremediated. Accepted findings carry a documented risk acceptance signed by TPCL.', subValues: VULNS.slice(0, 4).map((v) => ({ label: v.id, value: `${v.severity} ${v.cvss}` })), target: 'Zero open High or Critical', analysis: 'Quarterly vulnerability scanning with annual CERT-In certified penetration testing. | A VAPT certificate is produced before Go-Live and annually through the AMC period. | Patch windows are Sundays 02:00–04:00 IST.' })} />
        ); })()}

        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoShield />} label="SIEM Events Forwarded" value={fmtInt(SIEM_EVENTS.length)} color={col}
            subValues={[{ label: 'Target', value: 'Sentinel' }, { label: 'Format', value: 'CEF' }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'SIEM Events Forwarded', value: String(SIEM_EVENTS.length), unit: 'events', color: col, definition: 'Security events forwarded to TPCL\'s Microsoft Sentinel instance in Common Event Format. Authentication, authorisation denials, configuration changes and anomalous volumes are all in scope.', subValues: [{ label: 'Warnings', value: String(SIEM_EVENTS.filter((e) => e.sev === 'Warning').length) }, { label: 'Info', value: String(SIEM_EVENTS.filter((e) => e.sev === 'Info').length) }, { label: 'Hot Retention', value: '90 days' }, { label: 'Format', value: 'CEF' }], target: 'All security events forwarded', analysis: 'RBAC denials are forwarded as warnings so repeated privilege probing is visible to the SOC. | Forwarding is one-way into TPCL\'s tenant; Astrikos holds no copy of TPCL security telemetry.' })} />
        ); })()}

        {(() => { const col = can('config.write') ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoCheck />} label="Current Role Permissions" value={fmtInt(role.permissions.length)} color={col}
            subValues={[{ label: 'Role', value: role.label }, { label: 'Write', value: can('config.write') ? 'Yes' : 'No' }]}
            onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Current Role Permissions', value: String(role.permissions.length), unit: 'grants', color: col, definition: `${role.label} — ${role.description}. Permissions are additive per role and checked by the backend on every write, so hiding a button in the UI is not what enforces them.`, subValues: role.permissions.slice(0, 4).map((p) => ({ label: p.split('.')[0], value: p.split('.')[1] })), target: 'Least privilege for the task', analysis: `Granted: ${role.permissions.join(', ')}. | Switch to Regulatory Auditor and Config Studio writes return HTTP 403 from the service, not a disabled control. | That denial is itself forwarded to SIEM as a warning.` })} />
        ); })()}
      </div>

      <Tabs
        tabs={[
          { key: 'access', label: 'Access Control · N.1–N.4' },
          { key: 'audit', label: `Audit Trail · N.5 (${fmtInt(auditStats.total)})` },
          { key: 'posture', label: 'Security Posture · N.6–N.9' },
          { key: 'users', label: 'User Administration · N.10' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ═══ ACCESS CONTROL ══════════════════════════════════════════════ */}
      {tab === 'access' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(400px, 1.2fr)' }}>
          <Panel title="Switch identity" checkpoints="N.2 · N.3 · N.4"
                 sub="Demonstration role switching — the backend enforces whichever role is active">
            <div className="space-y-2">
              {DEMO_IDENTITIES.map((d) => {
                const r = ROLES[d.role];
                const active = identity.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`apm-scenario-btn ${active ? 'is-active' : ''}`}
                    style={{ padding: '10px 12px' }}
                    onClick={() => switchIdentity(d.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: active ? 'var(--app-info)' : 'var(--app-surface-raised)', color: active ? '#fff' : 'var(--app-text-faint)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {d.name.charAt(0)}
                      </span>
                      <span className="flex-1" style={{ fontSize: 11.5 }}>{d.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--app-surface-raised)', color: 'var(--app-text-faint)' }}>{r.label}</span>
                    </div>
                    <small>{r.description}</small>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] mt-3 pt-3 border-t border-app-border" style={{ color: 'var(--app-text-faint)' }}>
              Switching sends a different identity on every subsequent API call. Try switching to Regulatory Auditor,
              then creating an alarm in Config Studio — the service rejects it with HTTP 403.
            </p>
          </Panel>

          <Panel title="Permission matrix" checkpoints="N.4" sub="Additive permissions per role, enforced server-side" bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 400 }}>
              <table className="apm-table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {Object.values(ROLES).map((r) => <th key={r.key} className="num">{r.label.split(' ')[0]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {['config.read', 'config.write', 'user.admin', 'integration.run', 'workorder.raise', 'report.export', 'incident.write', 'audit.read'].map((perm) => (
                    <tr key={perm}>
                      <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{perm}</td>
                      {Object.values(ROLES).map((r) => (
                        <td key={r.key} className="num">
                          {r.permissions.includes(perm)
                            ? <span style={{ color: 'var(--app-success)', fontWeight: 700 }}>✓</span>
                            : <span style={{ color: 'var(--app-text-faint)' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ═══ AUDIT ═══════════════════════════════════════════════════════ */}
      {tab === 'audit' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(460px, 1.6fr) minmax(280px, 1fr)' }}>
          <Panel title="Audit trail" checkpoints="N.5"
                 sub="Append-only, written server-side, survives a refresh"
                 right={<button className="apm-tab" type="button" style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: '4px 9px' }} onClick={refresh}>Refresh</button>}
                 bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 460 }}>
              {audit.length === 0 ? (
                <p className="text-[11px] p-4" style={{ color: 'var(--app-text-faint)' }}>
                  {apiUp === false ? 'Audit service unavailable — run npm run server.' : 'No entries yet.'}
                </p>
              ) : (
                <table className="apm-table">
                  <thead><tr><th>When</th><th>Principal</th><th>Action</th><th>Object</th><th>Detail</th><th>Source</th></tr></thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td className="text-[10px]" style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-IN', { hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>
                          <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{a.user}</div>
                          <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{a.role}</div>
                        </td>
                        <td><span className="apm-checkpoint" style={{ fontSize: 9 }}>{a.action}</span></td>
                        <td className="text-[10.5px]" style={{ maxWidth: 140 }}>{a.object}</td>
                        <td className="text-[10px]" style={{ color: 'var(--app-text-faint)', maxWidth: 240 }}>{a.detail}</td>
                        <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{a.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>

          <Panel title="Activity by action" checkpoints="N.5" sub="What this tenant has been doing">
            {auditStats.byAction.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>No activity recorded.</p>
            ) : auditStats.byAction.map((a, i) => {
              const maxN = auditStats.byAction[0].n;
              return (
                <div key={a.action} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{a.n}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--app-surface-soft)' }}>
                    <div style={{ width: `${(a.n / maxN) * 100}%`, height: '100%', background: ['#0ea5e9', '#8b5cf6', '#14b8a6', '#f59e0b', '#ec4899'][i % 5], borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>
      )}

      {/* ═══ POSTURE ═════════════════════════════════════════════════════ */}
      {tab === 'posture' && (
        <div className="space-y-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(420px, 1.25fr) minmax(320px, 1fr)' }}>
            <Panel title="Security controls" checkpoints="N.1 – N.10" sub="Each control mapped to the standard it implements" bodyClass="p-0">
              <div className="apm-scroll" style={{ maxHeight: 380 }}>
                <table className="apm-table">
                  <thead><tr><th>#</th><th>Control</th><th>Standard</th><th>Status</th></tr></thead>
                  <tbody>
                    {CONTROLS.map((c) => (
                      <tr key={c.id}>
                        <td className="asset-id">{c.id}</td>
                        <td>
                          <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{c.control}</div>
                          <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)', maxWidth: 300 }}>{c.detail}</div>
                        </td>
                        <td className="text-[10px]">{c.standard}</td>
                        <td>
                          <span className="apm-pill" style={{ background: 'var(--app-success-bg)', color: 'var(--app-success)' }}>
                            <span className="dot" style={{ background: 'var(--app-success)' }} />{c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Vulnerability management" checkpoints="N.9" sub="Scanning and CERT-In VAPT findings" bodyClass="p-0">
              <div className="apm-scroll" style={{ maxHeight: 380 }}>
                <table className="apm-table">
                  <thead><tr><th>ID</th><th>Component</th><th className="num">CVSS</th><th>Status</th></tr></thead>
                  <tbody>
                    {VULNS.map((v) => (
                      <tr key={v.id}>
                        <td className="asset-id">{v.id}</td>
                        <td>
                          <div style={{ color: 'var(--app-text)' }}>{v.component}</div>
                          <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>Found {v.found}</div>
                        </td>
                        <td className="num" style={{ color: SEV_TONE[v.severity], fontWeight: 700 }}>{v.cvss}</td>
                        <td>
                          <span className="apm-pill" style={{ background: v.status === 'Patched' ? 'var(--app-success-bg)' : v.status === 'Accepted' ? 'var(--app-surface-raised)' : 'var(--app-warning-bg)', color: v.status === 'Patched' ? 'var(--app-success)' : v.status === 'Accepted' ? 'var(--app-text-faint)' : 'var(--app-warning)' }}>
                            {v.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <Panel title="SIEM event stream" checkpoints="N.8" sub="Forwarded to Microsoft Sentinel in CEF format" bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 240 }}>
              <table className="apm-table">
                <thead><tr><th>Age</th><th>Severity</th><th>Rule</th><th>Detail</th><th>Source</th></tr></thead>
                <tbody>
                  {SIEM_EVENTS.map((e, i) => (
                    <tr key={i}>
                      <td className="text-[10px]">{e.at} min ago</td>
                      <td>
                        <span className="apm-pill" style={{ background: `${SEV_TONE[e.sev]}1f`, color: SEV_TONE[e.sev] }}>
                          <span className="dot" style={{ background: SEV_TONE[e.sev] }} />{e.sev}
                        </span>
                      </td>
                      <td className="asset-id">{e.rule}</td>
                      <td className="text-[10.5px]" style={{ maxWidth: 360 }}>{e.detail}</td>
                      <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{e.src}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <SimulatedNote>
            The control matrix, SIEM stream and vulnerability register describe the <strong>designed</strong> security
            architecture and are illustrative in this build. What is genuinely live on this page is RBAC: the role
            selected here is enforced by the service on every write, and the audit trail below records what actually
            happened. VAPT is performed by a CERT-In certified auditor before Go-Live and annually through the AMC.
          </SimulatedNote>
        </div>
      )}

      {/* ═══ USER ADMIN ══════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(420px, 1.4fr) minmax(300px, 1fr)' }}>
          <Panel title="Provisioned users" checkpoints="N.10" sub="Demo tenant — production provisioning is AD-driven" bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 400 }}>
              <table className="apm-table">
                <thead><tr><th>User</th><th>Role</th><th>MFA</th><th>SSO</th><th>Last login</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{u.name}</div>
                        <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{u.title}</div>
                      </td>
                      <td><span className="apm-checkpoint" style={{ fontSize: 9 }}>{(ROLES[u.role] || {}).label || u.role}</span></td>
                      <td>{u.mfa ? <span style={{ color: 'var(--app-success)' }}>✓</span> : <span style={{ color: 'var(--app-danger)' }}>✗</span>}</td>
                      <td>{u.sso ? <span style={{ color: 'var(--app-success)' }}>✓</span> : <span style={{ color: 'var(--app-text-faint)' }}>—</span>}</td>
                      <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                        {u.lastLogin ? new Date(u.lastLogin).toLocaleString('en-IN', { hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Create user" checkpoints="N.10 · O.8" sub="Administrator role required">
            <form onSubmit={submitUser} className="space-y-3">
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="u-name">Full name</label>
                <input
                  id="u-name" value={newUser.name} required
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="e.g. P. Sharma"
                  style={{ width: '100%', marginTop: 4, background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 7, padding: '7px 9px', fontSize: 11.5 }}
                />
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="u-role">Role</label>
                <select
                  id="u-role" value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  style={{ width: '100%', marginTop: 4, background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 7, padding: '7px 9px', fontSize: 11.5 }}
                >
                  {Object.values(ROLES).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>{ROLES[newUser.role].description}</p>
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="u-title">Job title (optional)</label>
                <input
                  id="u-title" value={newUser.title}
                  onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
                  placeholder={ROLES[newUser.role].label}
                  style={{ width: '100%', marginTop: 4, background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 7, padding: '7px 9px', fontSize: 11.5 }}
                />
              </div>
              <button className="app-btn w-full px-3 py-2.5 text-[11.5px]" type="submit"
                      disabled={!can('user.admin')} style={{ opacity: can('user.admin') ? 1 : 0.55 }}>
                {can('user.admin') ? 'Create user' : 'Administrator role required'}
              </button>
            </form>

            {msg && (
              <div className="mt-3 rounded-lg px-3 py-2.5"
                   style={{ background: msg.kind === 'ok' ? 'var(--app-success-bg)' : 'var(--app-danger-bg)', border: `1px solid ${msg.kind === 'ok' ? 'var(--app-success-border)' : 'var(--app-danger-border)'}` }}>
                <p className="text-[10.5px]" style={{ color: msg.kind === 'ok' ? 'var(--app-success)' : 'var(--app-danger)' }}>{msg.text}</p>
              </div>
            )}

            <p className="text-[10px] mt-3 pt-3 border-t border-app-border" style={{ color: 'var(--app-text-faint)' }}>
              In delivery, users are not created in the platform — provisioning follows Active Directory group
              membership over SSO, and this screen becomes a read-only view of the mapping.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
