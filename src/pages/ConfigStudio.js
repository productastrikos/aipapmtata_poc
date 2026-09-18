/* Configuration Studio — Section O of the checkpoint sheet.
   O.1 create asset class, O.2 create health model, O.3 create dashboard,
   O.4 create business rule, O.5 create alarm, O.6 create report,
   O.7 change threshold, O.8 user administration (on Security & Admin).

   This is the section that cannot be faked. Everything created here is POSTed
   to the service, persisted to disk, written to the audit trail and — for
   health models, rules and alarms — evaluated against the live fleet so the
   evaluators can see it take effect, not just appear in a list. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApm } from '../services/apmStore';
import { useRole } from '../services/roleContext';
import { CLASS_LABEL } from '../data/network';
import { HEALTH_PARAMS, paramsFor, computeAHI, fmtCr, fmtInt, healthBand } from '../engines/indices';
import { listConfig, createConfig, deleteConfig, health, API_BASE } from '../services/backend';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';

const TABS = [
  { key: 'asset-classes',  label: 'Asset Class · O.1' },
  { key: 'health-models',  label: 'Health Model · O.2 · O.7' },
  { key: 'dashboards',     label: 'Dashboard · O.3' },
  { key: 'business-rules', label: 'Business Rule · O.4' },
  { key: 'alarms',         label: 'Alarm · O.5' },
];

/* Metrics a rule or alarm can be written against. Each maps to a field the
   fleet rows already carry, so evaluation is real rather than illustrative. */
const METRICS = [
  { key: 'ahi', label: 'Asset Health Index', unit: '/100', get: (r) => r.ahi },
  { key: 'aci', label: 'Asset Criticality Index', unit: '/100', get: (r) => r.aci },
  { key: 'ari', label: 'Asset Risk Index', unit: '₹ Cr/yr', get: (r) => r.ari },
  { key: 'pof', label: 'Probability of Failure', unit: '%/yr', get: (r) => r.pof * 100 },
  { key: 'cof', label: 'Consequence of Failure', unit: '₹ Cr', get: (r) => r.cof },
  { key: 'age', label: 'Asset Age', unit: 'years', get: (r) => r.asset.age },
  { key: 'consumers', label: 'Consumers Served', unit: 'connections', get: (r) => r.asset.impact.consumers },
];

const OPERATORS = [
  { key: 'lt', label: 'is below', test: (v, t) => v < t },
  { key: 'lte', label: 'is at or below', test: (v, t) => v <= t },
  { key: 'gt', label: 'is above', test: (v, t) => v > t },
  { key: 'gte', label: 'is at or above', test: (v, t) => v >= t },
];

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

const ACTIONS = [
  'Raise alarm',
  'Create SAP PM work order',
  'Add to investment candidate register',
  'Notify asset planning team',
  'Escalate to control room',
];

const KPI_PALETTE = [
  { key: 'meanAHI', label: 'Mean Fleet Health Index' },
  { key: 'totalRisk', label: 'Annualised Risk Exposure' },
  { key: 'atRisk', label: 'Assets Below Threshold' },
  { key: 'extreme', label: 'Extreme-Risk Assets' },
  { key: 'funded', label: 'Projects Funded' },
  { key: 'riskRetired', label: 'Risk Retired' },
  { key: 'deferred', label: 'Deferred Risk' },
  { key: 'meanAge', label: 'Mean Asset Age' },
];

const input = {
  width: '100%', marginTop: 4, background: 'var(--app-surface-soft)',
  border: '1px solid var(--app-border)', color: 'var(--app-text)',
  borderRadius: 7, padding: '7px 9px', fontSize: 11.5,
};

export default function ConfigStudio() {
  const { fleet, summary, portfolio, healthWeights, setHealthWeight, resetModel, dirty } = useApm();
  const { can, identity, role } = useRole();

  const [tab, setTab] = useState('asset-classes');
  const [items, setItems] = useState({});
  const [apiUp, setApiUp] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  /* ─── Form state, one per creator ─────────────────────────────────────── */
  const [cls, setCls] = useState({ name: '', baseClass: 'power_transformer', voltage: '', designLife: 30, attributes: '' });
  const [model, setModel] = useState({ name: '', assetClass: 'power_transformer', weights: null });
  const [dash, setDash] = useState({ name: '', audience: 'Executive', tiles: ['meanAHI', 'totalRisk', 'extreme'] });
  const [rule, setRule] = useState({ name: '', metric: 'ahi', operator: 'lt', threshold: 50, action: ACTIONS[0], scope: 'all' });
  const [alarm, setAlarm] = useState({ name: '', metric: 'ari', operator: 'gte', threshold: 1.0, severity: 'High', notify: 'Control room' });

  const refresh = useCallback(() => {
    Promise.all(TABS.map((t) => listConfig(t.key).then((rows) => [t.key, rows]).catch(() => [t.key, []])))
      .then((pairs) => setItems(Object.fromEntries(pairs)));
  }, []);

  useEffect(() => {
    let alive = true;
    health().then(() => alive && setApiUp(true)).catch(() => alive && setApiUp(false));
    refresh();
    return () => { alive = false; };
  }, [refresh]);

  /* Seed the model editor from the live weights for the chosen class. */
  useEffect(() => {
    setModel((m) => ({ ...m, weights: { ...healthWeights[m.assetClass] } }));
  }, [model.assetClass, healthWeights]);

  const save = async (kind, doc, detail) => {
    setBusy(true);
    setMsg(null);
    try {
      const row = await createConfig(kind, { ...doc, auditDetail: detail });
      setMsg({ kind: 'ok', text: `Created ${row.id} — persisted and written to the audit trail.` });
      refresh();
      return row;
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const drop = async (kind, id) => {
    try { await deleteConfig(kind, id); refresh(); }
    catch (e) { setMsg({ kind: 'err', text: e.message }); }
  };

  /* ─── Live evaluation — what would this rule/alarm actually match? ────── */
  const evaluate = useCallback((metricKey, operatorKey, threshold) => {
    const metric = METRICS.find((m) => m.key === metricKey);
    const op = OPERATORS.find((o) => o.key === operatorKey);
    if (!metric || !op) return { count: 0, sample: [], pct: 0 };
    const matched = fleet.rows.filter((r) => op.test(metric.get(r), Number(threshold)));
    return {
      count: matched.length,
      pct: (matched.length / fleet.rows.length) * 100,
      sample: [...matched].sort((a, b) => b.ari - a.ari).slice(0, 6),
      metric, op,
    };
  }, [fleet]);

  const ruleEval = useMemo(() => evaluate(rule.metric, rule.operator, rule.threshold), [evaluate, rule]);
  const alarmEval = useMemo(() => evaluate(alarm.metric, alarm.operator, alarm.threshold), [evaluate, alarm]);

  /* Preview the drafted health model against the live fleet without saving. */
  const modelPreview = useMemo(() => {
    if (!model.weights) return null;
    const cohort = fleet.rows.filter((r) => r.assetClass === model.assetClass);
    if (!cohort.length) return null;
    const sample = cohort.slice(0, 400);
    let now = 0, next = 0;
    sample.forEach((r) => {
      now += r.ahi;
      next += computeAHI(r.asset, model.weights).ahi;
    });
    return {
      cohort: cohort.length,
      sampled: sample.length,
      current: now / sample.length,
      drafted: next / sample.length,
      delta: (next - now) / sample.length,
    };
  }, [model.weights, model.assetClass, fleet]);

  if (apiUp === false) {
    return (
      <div className="space-y-4">
        <PageHead eyebrow="S!aP Sys Admin · Configuration" title="Configuration Studio" />
        <Panel title="Configuration service unavailable">
          <p className="text-[12px] mb-3" style={{ color: 'var(--app-text-muted)' }}>
            Configuration is persisted server-side so it survives a refresh — the service is not responding at
            <code style={{ color: 'var(--app-info)' }}> {API_BASE}</code>.
          </p>
          <div className="apm-formula">npm run server</div>
        </Panel>
      </div>
    );
  }

  const readOnlyBanner = !can('config.write') && (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)' }}>
      <p className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>
        <strong>{identity.name}</strong> holds the {role.label} role, which is read-only for configuration. Creation is
        rejected by the service with HTTP 403 — not merely hidden here. Switch identity in Security &amp; Administration.
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="S!aP Sys Admin · Configuration"
        title="Configuration Studio"
        sub="Create asset classes, health models, dashboards, business rules and alarms without vendor code changes. Everything created here persists server-side, is audited, and takes effect against the live fleet."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Configured objects</p>
            <p className="text-[12px] font-bold mt-1" style={{ color: 'var(--app-info)' }}>
              {fmtInt(Object.values(items).reduce((s, a) => s + (a ? a.length : 0), 0))}
            </p>
            <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>Persisted &amp; audited</p>
          </div>
        }
      />

      {readOnlyBanner}

      <Tabs tabs={TABS} active={tab} onChange={(k) => { setTab(k); setMsg(null); }} />

      {msg && (
        <div className="rounded-lg px-3 py-2.5"
             style={{ background: msg.kind === 'ok' ? 'var(--app-success-bg)' : 'var(--app-danger-bg)', border: `1px solid ${msg.kind === 'ok' ? 'var(--app-success-border)' : 'var(--app-danger-border)'}` }}>
          <p className="text-[11px]" style={{ color: msg.kind === 'ok' ? 'var(--app-success)' : 'var(--app-danger)' }}>{msg.text}</p>
        </div>
      )}

      {/* ═══ O.1 ASSET CLASS ═════════════════════════════════════════════ */}
      {tab === 'asset-classes' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(330px, 1fr) minmax(400px, 1.25fr)' }}>
          <Panel title="Create asset class" checkpoints="O.1" sub="Define a new equipment class with its own attributes">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const attrs = cls.attributes.split(',').map((s) => s.trim()).filter(Boolean);
                const row = await save('asset-classes', {
                  name: cls.name, baseClass: cls.baseClass, voltage: cls.voltage,
                  designLife: Number(cls.designLife), attributes: attrs,
                  inheritsParams: paramsFor(cls.baseClass).map((p) => p.key),
                }, `Asset class "${cls.name}" created, inheriting ${paramsFor(cls.baseClass).length} condition parameters from ${CLASS_LABEL[cls.baseClass]}`);
                if (row) setCls({ name: '', baseClass: 'power_transformer', voltage: '', designLife: 30, attributes: '' });
              }}
              className="space-y-3"
            >
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="c-name">Class name</label>
                <input id="c-name" required value={cls.name} style={input}
                       placeholder="e.g. Gas Insulated Switchgear"
                       onChange={(e) => setCls({ ...cls, name: e.target.value })} />
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="c-base">Inherit condition model from</label>
                <select id="c-base" value={cls.baseClass} style={input}
                        onChange={(e) => setCls({ ...cls, baseClass: e.target.value })}>
                  {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                  Inherits {paramsFor(cls.baseClass).length} parameters: {paramsFor(cls.baseClass).map((p) => p.short).join(', ')}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="c-volt">Voltage class</label>
                  <input id="c-volt" value={cls.voltage} style={input} placeholder="e.g. 220 kV"
                         onChange={(e) => setCls({ ...cls, voltage: e.target.value })} />
                </div>
                <div>
                  <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="c-life">Design life (yrs)</label>
                  <input id="c-life" type="number" min="1" max="60" value={cls.designLife} style={input}
                         onChange={(e) => setCls({ ...cls, designLife: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="c-attrs">Custom attributes (comma separated)</label>
                <input id="c-attrs" value={cls.attributes} style={input}
                       placeholder="e.g. SF6 pressure, Bay count, Enclosure IP rating"
                       onChange={(e) => setCls({ ...cls, attributes: e.target.value })} />
              </div>
              <button className="app-btn w-full px-3 py-2.5 text-[11.5px]" type="submit"
                      disabled={busy || !can('config.write')} style={{ opacity: busy || !can('config.write') ? 0.55 : 1 }}>
                {busy ? 'Saving…' : 'Create asset class'}
              </button>
            </form>
          </Panel>

          <ConfigList
            title="Asset classes" checkpoints="O.1" kind="asset-classes"
            rows={items['asset-classes']} onDelete={drop} canWrite={can('config.write')}
            columns={[
              { head: 'Class', render: (r) => (<><div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.name}</div><div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{r.voltage || '—'} · {r.designLife}y design life</div></>) },
              { head: 'Inherits', render: (r) => <span className="text-[10px]">{CLASS_LABEL[r.baseClass]}</span> },
              { head: 'Attributes', render: (r) => <span className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{(r.attributes || []).join(', ') || '—'}</span> },
            ]}
            empty="No custom asset classes yet. The platform ships with three modelled classes; create a fourth here and it persists."
          />
        </div>
      )}

      {/* ═══ O.2 / O.7 HEALTH MODEL ══════════════════════════════════════ */}
      {tab === 'health-models' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1.1fr) minmax(360px, 1fr)' }}>
          <Panel title="Create health model" checkpoints="O.2 · O.7"
                 sub="Set parameter weights and thresholds — preview the effect before saving">
            <div className="space-y-3">
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="m-name">Model name</label>
                <input id="m-name" value={model.name} style={input}
                       placeholder="e.g. FY27 Transformer Condition Model v2"
                       onChange={(e) => setModel({ ...model, name: e.target.value })} />
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="m-class">Asset class</label>
                <select id="m-class" value={model.assetClass} style={input}
                        onChange={(e) => setModel({ ...model, assetClass: e.target.value })}>
                  {Object.keys(HEALTH_PARAMS).map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
                </select>
              </div>

              <div className="pt-2">
                <p className="apm-eyebrow mb-1" style={{ fontSize: 9 }}>Parameter weights</p>
                {model.weights && paramsFor(model.assetClass).map((p) => (
                  <div key={p.key} className="apm-weight-row">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--app-text-muted)' }}>{p.label}</p>
                      <p className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{p.good} → {p.bad} {p.unit}</p>
                    </div>
                    <input
                      type="range" min="0" max="0.6" step="0.01"
                      value={model.weights[p.key]} className="apm-slider"
                      aria-label={`${p.label} draft weight`}
                      onChange={(e) => setModel({ ...model, weights: { ...model.weights, [p.key]: parseFloat(e.target.value) } })}
                    />
                    <span className="text-[11px] font-bold text-right" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {(model.weights[p.key] * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>

              {modelPreview && (
                <div className="apm-formula" style={{ fontSize: 11.5 }}>
                  Across <span className="val">{fmtInt(modelPreview.sampled)}</span> of {fmtInt(modelPreview.cohort)} {CLASS_LABEL[model.assetClass]}s:<br />
                  mean AHI <span className="val">{modelPreview.current.toFixed(1)}</span>
                  <span className="op">→</span> <span className="res">{modelPreview.drafted.toFixed(1)}</span>
                  <span className="op"> · </span>
                  <span style={{ color: modelPreview.delta >= 0 ? 'var(--app-success)' : 'var(--app-danger)' }}>
                    {modelPreview.delta >= 0 ? '+' : ''}{modelPreview.delta.toFixed(2)}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  className="app-btn flex-1 px-3 py-2.5 text-[11.5px]" type="button"
                  disabled={busy || !can('config.write') || !model.name.trim()}
                  style={{ opacity: busy || !can('config.write') || !model.name.trim() ? 0.55 : 1 }}
                  onClick={() => save('health-models', {
                    name: model.name, assetClass: model.assetClass, weights: model.weights,
                    meanBefore: modelPreview ? +modelPreview.current.toFixed(2) : null,
                    meanAfter: modelPreview ? +modelPreview.drafted.toFixed(2) : null,
                  }, `Health model "${model.name}" saved for ${CLASS_LABEL[model.assetClass]}${modelPreview ? ` — cohort mean AHI ${modelPreview.current.toFixed(1)} → ${modelPreview.drafted.toFixed(1)}` : ''}`)}
                >
                  {busy ? 'Saving…' : 'Save model'}
                </button>
                <button
                  className="apm-tab" type="button"
                  style={{ border: '1px solid var(--app-info)', borderRadius: 8, padding: '8px 12px', color: 'var(--app-info)' }}
                  disabled={!model.weights}
                  onClick={() => {
                    // O.7 — apply the drafted weights to the live model. Every
                    // screen recomputes immediately.
                    Object.entries(model.weights).forEach(([k, v]) => setHealthWeight(model.assetClass, k, v));
                    setMsg({ kind: 'ok', text: 'Applied to the live model — fleet health, risk ranking and the investment portfolio have all recomputed.' });
                  }}
                >
                  Apply live
                </button>
              </div>
              {dirty && (
                <button className="apm-tab w-full" type="button"
                        style={{ border: '1px solid var(--app-border)', borderRadius: 8, padding: '7px 12px' }}
                        onClick={() => { resetModel(); setMsg({ kind: 'ok', text: 'Live model reset to factory defaults.' }); }}>
                  Reset live model to factory defaults
                </button>
              )}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Live model effect" checkpoints="O.7" sub="What the active weights currently produce">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Fleet mean AHI', summary.meanAHI.toFixed(1), healthBand(summary.meanAHI).color],
                  ['Below threshold', fmtInt(summary.atRisk), 'var(--app-warning)'],
                  ['Risk exposure', fmtCr(summary.totalRisk, 0), 'var(--app-danger)'],
                  ['Candidates', fmtInt(portfolio.selected.length + portfolio.deferred.length), 'var(--app-text)'],
                ].map(([k, v, c]) => (
                  <div key={k} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{k}</p>
                    <p className="text-[16px] font-bold mt-0.5" style={{ color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] mt-3" style={{ color: 'var(--app-text-faint)' }}>
                {dirty
                  ? 'The live model has been edited this session — these figures reflect the edited weights.'
                  : 'The live model is at factory defaults. Draft weights on the left, then Apply live to move these.'}
              </p>
            </Panel>

            <ConfigList
              title="Saved health models" checkpoints="O.2" kind="health-models"
              rows={items['health-models']} onDelete={drop} canWrite={can('config.write')}
              columns={[
                { head: 'Model', render: (r) => (<><div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.name}</div><div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{CLASS_LABEL[r.assetClass]}</div></>) },
                { head: 'Effect', render: (r) => r.meanBefore != null
                    ? <span className="text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.meanBefore} → {r.meanAfter}</span>
                    : <span className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>—</span> },
              ]}
              empty="No saved models yet. Draft weights on the left and save — the effect on cohort mean AHI is recorded with it."
            />
          </div>
        </div>
      )}

      {/* ═══ O.3 DASHBOARD ═══════════════════════════════════════════════ */}
      {tab === 'dashboards' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(330px, 1fr) minmax(400px, 1.25fr)' }}>
          <Panel title="Create dashboard" checkpoints="O.3" sub="Compose a KPI layout for a named audience">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const row = await save('dashboards', { name: dash.name, audience: dash.audience, tiles: dash.tiles },
                  `Dashboard "${dash.name}" created for ${dash.audience} with ${dash.tiles.length} tiles`);
                if (row) setDash({ name: '', audience: 'Executive', tiles: ['meanAHI', 'totalRisk', 'extreme'] });
              }}
              className="space-y-3"
            >
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="d-name">Dashboard name</label>
                <input id="d-name" required value={dash.name} style={input}
                       placeholder="e.g. Board Quarterly Review"
                       onChange={(e) => setDash({ ...dash, name: e.target.value })} />
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="d-aud">Audience</label>
                <select id="d-aud" value={dash.audience} style={input}
                        onChange={(e) => setDash({ ...dash, audience: e.target.value })}>
                  {['Executive', 'Asset Management', 'Operations', 'Regulatory', 'Field Engineering'].map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <p className="apm-eyebrow" style={{ fontSize: 9 }}>KPI tiles ({dash.tiles.length} selected)</p>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  {KPI_PALETTE.map((k) => {
                    const on = dash.tiles.includes(k.key);
                    return (
                      <button
                        key={k.key} type="button"
                        className={`apm-scenario-btn ${on ? 'is-active' : ''}`}
                        style={{ padding: '7px 9px', fontSize: 10 }}
                        onClick={() => setDash({ ...dash, tiles: on ? dash.tiles.filter((t) => t !== k.key) : [...dash.tiles, k.key] })}
                      >
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button className="app-btn w-full px-3 py-2.5 text-[11.5px]" type="submit"
                      disabled={busy || !can('config.write') || dash.tiles.length === 0}
                      style={{ opacity: busy || !can('config.write') || dash.tiles.length === 0 ? 0.55 : 1 }}>
                {busy ? 'Saving…' : 'Create dashboard'}
              </button>
            </form>
          </Panel>

          <div className="space-y-4">
            <Panel title="Live preview" checkpoints="O.3" sub="Rendered from current fleet data">
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                {dash.tiles.map((t) => {
                  const def = KPI_PALETTE.find((k) => k.key === t);
                  const vals = {
                    meanAHI: summary.meanAHI.toFixed(1),
                    totalRisk: fmtCr(summary.totalRisk, 0),
                    atRisk: fmtInt(summary.atRisk),
                    extreme: fmtInt(summary.extreme),
                    funded: fmtInt(portfolio.selected.length),
                    riskRetired: fmtCr(portfolio.riskBoughtDown, 1),
                    deferred: fmtCr(portfolio.residualRisk, 1),
                    meanAge: (fleet.rows.reduce((s, r) => s + r.asset.age, 0) / fleet.rows.length).toFixed(1),
                  };
                  return (
                    <div key={t} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{def ? def.label : t}</p>
                      <p className="text-[16px] font-bold mt-0.5" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{vals[t]}</p>
                    </div>
                  );
                })}
              </div>
              {dash.tiles.length === 0 && (
                <p className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>Select tiles to preview the layout.</p>
              )}
            </Panel>

            <ConfigList
              title="Saved dashboards" checkpoints="O.3" kind="dashboards"
              rows={items.dashboards} onDelete={drop} canWrite={can('config.write')}
              columns={[
                { head: 'Dashboard', render: (r) => (<><div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.name}</div><div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{r.audience}</div></>) },
                { head: 'Tiles', render: (r) => <span className="text-[10px]">{(r.tiles || []).length}</span> },
              ]}
              empty="No custom dashboards yet."
            />
          </div>
        </div>
      )}

      {/* ═══ O.4 BUSINESS RULE ═══════════════════════════════════════════ */}
      {tab === 'business-rules' && (
        <RuleBuilder
          kind="business-rules" checkpoints="O.4" title="Create business rule"
          sub="IF a condition holds THEN take an action — evaluated against the live fleet"
          state={rule} setState={setRule} evaluation={ruleEval}
          extraField={(
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="r-action">Then</label>
              <select id="r-action" value={rule.action} style={input}
                      onChange={(e) => setRule({ ...rule, action: e.target.value })}>
                {ACTIONS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
          )}
          onSave={() => save('business-rules', {
            name: rule.name, metric: rule.metric, operator: rule.operator,
            threshold: Number(rule.threshold), action: rule.action, matchesAtCreation: ruleEval.count,
          }, `Business rule "${rule.name}" created — matches ${ruleEval.count} assets at creation`)}
          busy={busy} canWrite={can('config.write')}
          rows={items['business-rules']} onDelete={drop}
          listColumns={[
            { head: 'Rule', render: (r) => (<><div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.name}</div><div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{(METRICS.find((m) => m.key === r.metric) || {}).label} {(OPERATORS.find((o) => o.key === r.operator) || {}).label} {r.threshold}</div></>) },
            { head: 'Action', render: (r) => <span className="text-[10px]">{r.action}</span> },
            { head: 'Matched', render: (r) => <span className="text-[10px] num">{fmtInt(r.matchesAtCreation || 0)}</span> },
          ]}
        />
      )}

      {/* ═══ O.5 ALARM ═══════════════════════════════════════════════════ */}
      {tab === 'alarms' && (
        <RuleBuilder
          kind="alarms" checkpoints="O.5" title="Create alarm"
          sub="Threshold alarm with severity and routing — evaluated against the live fleet"
          state={alarm} setState={setAlarm} evaluation={alarmEval}
          extraField={(
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="a-sev">Severity</label>
                <select id="a-sev" value={alarm.severity} style={input}
                        onChange={(e) => setAlarm({ ...alarm, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="a-not">Notify</label>
                <select id="a-not" value={alarm.notify} style={input}
                        onChange={(e) => setAlarm({ ...alarm, notify: e.target.value })}>
                  {['Control room', 'Asset planning', 'Field engineering', 'Regulatory'].map((n) => <option key={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}
          onSave={() => save('alarms', {
            name: alarm.name, metric: alarm.metric, operator: alarm.operator,
            threshold: Number(alarm.threshold), severity: alarm.severity, notify: alarm.notify,
            firingAtCreation: alarmEval.count,
          }, `${alarm.severity} alarm "${alarm.name}" created — firing on ${alarmEval.count} assets at creation`)}
          busy={busy} canWrite={can('config.write')}
          rows={items.alarms} onDelete={drop}
          listColumns={[
            { head: 'Alarm', render: (r) => (<><div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.name}</div><div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{(METRICS.find((m) => m.key === r.metric) || {}).label} {(OPERATORS.find((o) => o.key === r.operator) || {}).label} {r.threshold}</div></>) },
            { head: 'Severity', render: (r) => <span className="apm-pill" style={{ background: 'var(--app-warning-bg)', color: 'var(--app-warning)' }}>{r.severity}</span> },
            { head: 'Firing', render: (r) => <span className="text-[10px] num">{fmtInt(r.firingAtCreation || 0)}</span> },
          ]}
        />
      )}

      <SimulatedNote>
        Configuration created here is persisted to the demo service and survives a refresh. In delivery this sits in
        the S!aP Datalake on TPCL's VNet with change approval through S!aP BPM. New asset classes register their
        definition but carry no assets until bound to a Grid Data Hub feed or a bulk upload.
      </SimulatedNote>
    </div>
  );
}

/* ─── Shared rule/alarm builder ─────────────────────────────────────────── */
function RuleBuilder({ kind, checkpoints, title, sub, state, setState, evaluation, extraField, onSave, busy, canWrite, rows, onDelete, listColumns }) {
  const metric = METRICS.find((m) => m.key === state.metric);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(330px, 1fr) minmax(400px, 1.25fr)' }}>
      <Panel title={title} checkpoints={checkpoints} sub={sub}>
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-3">
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor={`${kind}-name`}>Name</label>
            <input id={`${kind}-name`} required value={state.name} style={input}
                   placeholder={kind === 'alarms' ? 'e.g. Critical risk exposure' : 'e.g. Auto-escalate degraded transformers'}
                   onChange={(e) => setState({ ...state, name: e.target.value })} />
          </div>
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor={`${kind}-metric`}>If</label>
            <select id={`${kind}-metric`} value={state.metric} style={input}
                    onChange={(e) => setState({ ...state, metric: e.target.value })}>
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor={`${kind}-op`}>Operator</label>
              <select id={`${kind}-op`} value={state.operator} style={input}
                      onChange={(e) => setState({ ...state, operator: e.target.value })}>
                {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor={`${kind}-thr`}>Threshold ({metric ? metric.unit : ''})</label>
              <input id={`${kind}-thr`} type="number" step="any" value={state.threshold} style={input}
                     onChange={(e) => setState({ ...state, threshold: e.target.value })} />
            </div>
          </div>
          {extraField}
          <button className="app-btn w-full px-3 py-2.5 text-[11.5px]" type="submit"
                  disabled={busy || !canWrite} style={{ opacity: busy || !canWrite ? 0.55 : 1 }}>
            {busy ? 'Saving…' : title}
          </button>
        </form>
      </Panel>

      <div className="space-y-4">
        <Panel title="Live evaluation" checkpoints={checkpoints}
               sub="What this would match right now, against the current fleet">
          <div className="apm-formula mb-3">
            {metric ? metric.label : ''} <span className="op">{(OPERATORS.find((o) => o.key === state.operator) || {}).label}</span>
            <span className="val">{state.threshold}</span> {metric ? metric.unit : ''}
            <span className="op">→</span> <span className="res">{fmtInt(evaluation.count)} assets</span>
            <span className="op"> · </span>{evaluation.pct.toFixed(1)}% of fleet
          </div>
          {evaluation.sample.length > 0 ? (
            <table className="apm-table">
              <thead><tr><th>Asset</th><th>Substation</th><th className="num">AHI</th><th className="num">ARI</th></tr></thead>
              <tbody>
                {evaluation.sample.map((r) => (
                  <tr key={r.id}>
                    <td className="asset-id">{r.id}</td>
                    <td className="truncate" style={{ maxWidth: 150 }}>{r.asset.substation}</td>
                    <td className="num" style={{ color: healthBand(r.ahi).color, fontWeight: 700 }}>{r.ahi.toFixed(1)}</td>
                    <td className="num">{r.ari.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>No assets currently match this condition.</p>
          )}
        </Panel>

        <ConfigList title={kind === 'alarms' ? 'Configured alarms' : 'Configured rules'} checkpoints={checkpoints}
                    kind={kind} rows={rows} onDelete={onDelete} canWrite={canWrite}
                    columns={listColumns} empty="Nothing configured yet." />
      </div>
    </div>
  );
}

/* ─── Shared persisted-object list ──────────────────────────────────────── */
function ConfigList({ title, checkpoints, kind, rows, onDelete, canWrite, columns, empty }) {
  return (
    <Panel title={title} checkpoints={checkpoints} sub="Persisted server-side — survives a refresh" bodyClass="p-0">
      <div className="apm-scroll" style={{ maxHeight: 340 }}>
        {!rows || rows.length === 0 ? (
          <p className="text-[11px] p-4" style={{ color: 'var(--app-text-faint)' }}>{empty}</p>
        ) : (
          <table className="apm-table">
            <thead>
              <tr>{columns.map((c) => <th key={c.head}>{c.head}</th>)}<th>Created</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => <td key={c.head}>{c.render(r)}</td>)}
                  <td className="text-[10px]" style={{ color: 'var(--app-text-faint)', whiteSpace: 'nowrap' }}>
                    {new Date(r.createdAt).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                    <div>{r.createdBy}</div>
                  </td>
                  <td>
                    {canWrite && (
                      <button type="button" className="apm-tab" style={{ padding: '2px 7px', fontSize: 10, color: 'var(--app-danger)' }}
                              onClick={() => onDelete(kind, r.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
