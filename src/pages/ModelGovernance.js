/* ═══════════════════════════════════════════════════════════════════════════
   Model Governance — Section F.2, F.3, F.8, F.9
   ───────────────────────────────────────────────────────────────────────────
   F.2 Predictive failure model   F.8 ML model training process
   F.3 Anomaly detection          F.9 Feedback mechanism

   RFQ §3.4.11 asks for defined retraining, accuracy-benchmarking and model
   governance mechanisms. A slide saying "we retrain quarterly" answers none of
   that, so this screen does the work instead:

   • Pressing "Run training" actually fits a model — ordinary least squares on a
     deterministic 70/30 split of the live fleet — and reports the error it
     achieves on the holdout it never saw.
   • Drift is measured as Population Stability Index between the factory health
     model and whatever weights are loaded right now. Retune the model on the
     Health Workbench and this number moves, because the population genuinely
     shifted.
   • Anomaly detection is a robust z-score against the asset's own class cohort,
     scanned live, not a list of pre-selected assets.
   • Field feedback persists to the server and changes the precision figure that
     governs whether a model stays in production.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, Tooltip, Legend, Filler,
} from 'chart.js';

import { useApm } from '../services/apmStore';
import { useRole } from '../services/roleContext';
import { HEALTH_PARAMS, computeAHI, fmtInt, fmtPct } from '../engines/indices';
import { ASSETS } from '../data/network';
import {
  MODEL_REGISTRY, trainForecastModel, populationStability,
  detectAnomalies, summariseFeedback,
} from '../engines/mlops';
import { listConfig, createConfig, ApiError } from '../services/backend';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoTrendUp, IcoAlert, IcoScale, IcoCheck, IcoPeople, IcoRecycle }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';
import { getChartTokens, chartTooltip } from '../components/chartUtils';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend, Filler);

/* Parameters the anomaly detector scans, with the direction that counts as bad. */
const ANOMALY_PARAMS = [
  { key: 'dga', label: 'Dissolved gas (TDCG)', unit: 'ppm', higherIsWorse: true },
  { key: 'pd', label: 'Partial discharge', unit: 'pC', higherIsWorse: true },
  { key: 'thermal', label: 'Winding hotspot', unit: '°C', higherIsWorse: true },
  { key: 'loading', label: 'Loading vs rated', unit: '%', higherIsWorse: true },
  { key: 'oil', label: 'Oil breakdown voltage', unit: 'kV', higherIsWorse: false },
];

/* Factory weights, read straight off the engine definitions — the baseline the
   drift measurement compares the live population against. */
const FACTORY_WEIGHTS = Object.entries(HEALTH_PARAMS).reduce((out, [cls, params]) => {
  out[cls] = params.reduce((m, p) => { m[p.key] = p.weight; return m; }, {});
  return out;
}, {});

export default function ModelGovernance() {
  const { fleet, healthWeights, dirty } = useApm();
  const { identity, role, can } = useRole();
  const [tab, setTab] = useState('registry');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);

  const [run, setRun] = useState(null);
  const [training, setTraining] = useState(false);
  const [feedback, setFeedback] = useState([]);
  const [backendUp, setBackendUp] = useState(true);
  const [notice, setNotice] = useState(null);

  const say = (msg, kind = 'ok') => {
    setNotice({ msg, kind });
    setTimeout(() => setNotice(null), 5000);
  };

  const refresh = useCallback(async () => {
    try {
      setFeedback(await listConfig('model-feedback'));
      setBackendUp(true);
    } catch (e) {
      setBackendUp(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* ─── Train on mount so the screen opens with real metrics, not an empty
         state waiting for a click. Re-running is still a deliberate action. ── */
  const doTrain = useCallback(() => {
    setTraining(true);
    setTimeout(() => {
      const t0 = performance.now();
      const result = trainForecastModel(fleet.rows);
      setRun(result ? { ...result, ms: performance.now() - t0, at: new Date() } : null);
      setTraining(false);
    }, 0);
  }, [fleet.rows]);

  useEffect(() => { doTrain(); }, [doTrain]);

  /* ─── Drift: factory baseline vs the live model ─────────────────────────── */
  const drift = useMemo(() => {
    const baseline = ASSETS.map((a) => computeAHI(a, FACTORY_WEIGHTS[a.assetClass]).ahi);
    const current = fleet.rows.map((r) => r.ahi);
    return populationStability(baseline, current, 10, 0, 100);
  }, [fleet.rows]);

  /* ─── Forward drift: where the population goes if nothing is done ─────────
     The live drift figure answers "has the model's population moved?", which on
     a fleet that has not aged since calibration is correctly near zero. The
     more useful question for setting a retraining cadence is "when will it?",
     and that is answerable: age every asset at its own degradation rate and
     measure when the distribution crosses the conventional PSI thresholds. */
  const forward = useMemo(() => {
    const baseline = fleet.rows.map((r) => r.ahi);
    const horizons = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
    const points = horizons.map((years) => {
      const projected = fleet.rows.map((r) => Math.max(r.ahi - r.asset.degradationRate * years, 0));
      const d = populationStability(baseline, projected, 10, 0, 100);
      return { years, psi: d.psi, meanShift: d.meanShift, band: d.band };
    });

    // Linear interpolation between the bracketing horizons for the crossing
    const crossing = (threshold) => {
      for (let i = 1; i < points.length; i++) {
        if (points[i].psi >= threshold && points[i - 1].psi < threshold) {
          const a = points[i - 1];
          const b = points[i];
          const f = (threshold - a.psi) / (b.psi - a.psi);
          return a.years + f * (b.years - a.years);
        }
      }
      return null;
    };

    return {
      points,
      crossModerate: crossing(0.10),
      crossMaterial: crossing(0.25),
    };
  }, [fleet.rows]);

  /* ─── Anomalies ─────────────────────────────────────────────────────────── */
  const anomalies = useMemo(
    () => detectAnomalies(fleet.rows, ANOMALY_PARAMS, { threshold: 3.5 }),
    [fleet.rows]
  );

  const fb = useMemo(() => summariseFeedback(feedback), [feedback]);

  /* ─── Promotion gate — evaluated, not asserted ──────────────────────────── */
  const gate = useMemo(() => {
    if (!run) return { checks: [], passed: 0 };
    const checks = [
      {
        label: 'Holdout MAE ≤ 1.00 AHI points',
        pass: run.test.mae <= 1.0,
        detail: `${run.test.mae.toFixed(3)} on ${run.test.n} unseen assets`,
      },
      {
        label: 'Generalisation gap ≤ 0.25',
        pass: Math.abs(run.overfitGap) <= 0.25,
        detail: `${run.overfitGap >= 0 ? '+' : ''}${run.overfitGap.toFixed(3)} holdout minus training`,
      },
      {
        label: 'Prediction bias within ±0.10',
        pass: Math.abs(run.test.bias) <= 0.10,
        detail: `${run.test.bias >= 0 ? '+' : ''}${run.test.bias.toFixed(3)} mean signed error`,
      },
      {
        label: '90% of forecasts within 2 AHI points',
        pass: run.test.within2 >= 0.90,
        detail: `${(run.test.within2 * 100).toFixed(1)}% inside tolerance`,
      },
      {
        label: 'Population stable since training (PSI < 0.25)',
        pass: drift.psi < 0.25,
        detail: `PSI ${drift.psi.toFixed(4)} — ${drift.band.label.toLowerCase()}`,
      },
      {
        label: 'Field agreement ≥ 85%',
        pass: fb.precision === null ? false : fb.precision >= 0.85,
        detail: fb.precision === null
          ? 'no field feedback recorded yet'
          : `${(fb.precision * 100).toFixed(0)}% across ${fb.total} reviews`,
      },
    ];
    return { checks, passed: checks.filter((c) => c.pass).length };
  }, [run, drift, fb]);

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP ML & AI Central · Glass Box governance"
        title="Model Governance"
        sub="Model registry, live training runs with holdout evaluation, drift measurement and the field feedback loop. Pressing Run training below actually fits a model against the current fleet and reports the error on data it did not see."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Promotion gate</p>
            <p
              className="text-[12px] font-bold mt-1"
              style={{ color: gate.passed === gate.checks.length ? 'var(--app-success)' : 'var(--app-warning)' }}
            >
              {gate.passed} / {gate.checks.length} criteria met
            </p>
          </div>
        }
      />

      {notice && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{
            background: notice.kind === 'ok' ? 'var(--app-success-bg)' : 'var(--app-danger-bg)',
            border: `1px solid ${notice.kind === 'ok' ? 'var(--app-success-border)' : 'var(--app-danger-border)'}`,
            color: notice.kind === 'ok' ? 'var(--app-success)' : 'var(--app-danger)',
          }}
        >
          {notice.msg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoScale />} label="Models In Production" value={String(MODEL_REGISTRY.filter((m) => m.status === 'Production').length)} color={col}
            subValues={[{ label: 'Candidate', value: String(MODEL_REGISTRY.filter((m) => m.status === 'Candidate').length) }, { label: 'Registry', value: String(MODEL_REGISTRY.length) }]}
            onClick={() => showKPIDetail({ icon: <IcoScale />, label: 'Models In Production', value: String(MODEL_REGISTRY.filter((m) => m.status === 'Production').length), unit: 'models', color: col, thresholds: { green: 4, amber: 2 }, inverted: false, definition: 'Models currently scoring live assets, each carrying a version, an algorithm, a declared feature set, an acceptance threshold and a retraining trigger. A model without those five attributes is not governed, whatever its accuracy.', subValues: MODEL_REGISTRY.slice(0, 4).map((m) => ({ label: m.name.split(' ').slice(0, 2).join(' '), value: `v${m.version}` })), target: 'Every production model within its acceptance threshold', analysis: 'Every model here is explainable by construction — none is a black box whose output has to be taken on trust. | That is the Glass Box commitment in the proposal, and it is why each one can state how its output was reached. | The candidate model is the one being evaluated on the Training tab.' })} />
        ); })()}

        {(() => {
          const v = run ? run.test.mae : null;
          const col = v === null ? 'text-slate-400' : v <= 1.0 ? 'text-emerald-400' : v <= 1.5 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoTrendUp />} label="Holdout Error" value={v === null ? '—' : v.toFixed(3)} unit=" AHI pts" color={col}
              subValues={[{ label: 'Unseen Assets', value: run ? fmtInt(run.test.n) : '—' }, { label: 'Skill vs Naive', value: run ? `${(run.skill * 100).toFixed(0)}%` : '—' }]}
              onClick={() => showKPIDetail({ icon: <IcoTrendUp />, label: 'Holdout Error', value: v === null ? '0' : v.toFixed(3), unit: 'AHI points, mean absolute', color: col, thresholds: { green: 1.0, amber: 1.5 }, inverted: true, definition: 'Mean absolute error of the 12-month health forecast on the holdout split — assets the model was never fitted on. This is the number that matters; training error is only useful as a comparison against it.', subValues: run ? [{ label: 'Holdout MAE', value: run.test.mae.toFixed(3) }, { label: 'Naive Forecast MAE', value: run.naiveMae.toFixed(3) }, { label: 'Skill Score', value: `${(run.skill * 100).toFixed(1)}%` }, { label: 'Generalisation Gap', value: `${run.overfitGap >= 0 ? '+' : ''}${run.overfitGap.toFixed(3)}` }] : [], target: 'MAE ≤ 1.0 AHI points at a 12-month horizon', analysis: run ? `Read the skill score, not the R². R² on a level forecast is flattering by construction — next year's health is mostly this year's health, so anything that passes current AHI through scores near 1.0. | The honest comparison is against the naive forecast "next year will be the same as now", which scores ${run.naiveMae.toFixed(3)}; this model scores ${run.test.mae.toFixed(3)}, a ${(run.skill * 100).toFixed(1)}% reduction in error. | Training MAE ${run.train.mae.toFixed(3)} against holdout ${run.test.mae.toFixed(3)} is a gap of ${run.overfitGap.toFixed(3)}, which is the check that the fit is not memorised.` : '' })} />
          );
        })()}

        {(() => {
          const col = drift.psi < 0.10 ? 'text-emerald-400' : drift.psi < 0.25 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoRecycle />} label="Population Drift" value={drift.psi.toFixed(4)} unit=" PSI" color={col}
              subValues={[{ label: 'Band', value: drift.band.label }, { label: 'Model', value: dirty ? 'Edited' : 'Factory' }]}
              onClick={() => showKPIDetail({ icon: <IcoRecycle />, label: 'Population Drift', value: drift.psi.toFixed(4), unit: 'PSI', color: col, thresholds: { green: 0.10, amber: 0.25 }, inverted: true, definition: 'Population Stability Index between the health distribution the models were calibrated against and the distribution they are scoring right now. Conventional bands: below 0.10 stable, 0.10–0.25 moderate, above 0.25 material.', subValues: [{ label: 'PSI', value: drift.psi.toFixed(4) }, { label: 'Band', value: drift.band.label }, { label: 'Bins', value: String(drift.bins) }, { label: 'Live Model', value: dirty ? 'User-edited weights' : 'Factory weights' }], target: 'PSI below 0.10 — no retraining required', analysis: 'This is wired to the live health model, which makes it demonstrable rather than decorative: go to the Health Workbench, move the DGA weighting, come back, and this number has genuinely moved because the scored population shifted. | Crossing 0.25 fires the retraining trigger on the registry. | The per-bin contributions are on the Drift tab, so you can see which part of the distribution moved.' })} />
          );
        })()}

        {(() => {
          const n = anomalies.findings.length;
          const col = n === 0 ? 'text-emerald-400' : n < 25 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoAlert />} label="Anomalies Detected" value={fmtInt(n)} color={col}
              subValues={[{ label: 'Scanned', value: fmtInt(anomalies.scanned) }, { label: 'Threshold', value: `${anomalies.threshold}σ` }]}
              onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Anomalies Detected', value: String(n), unit: 'findings', color: col, thresholds: { green: 10, amber: 25 }, inverted: true, definition: 'Condition readings sitting more than 3.5 robust standard deviations outside their own asset-class cohort. Median and median-absolute-deviation are used rather than mean and standard deviation, so a cluster of genuinely bad assets cannot drag the baseline far enough to conceal itself.', subValues: [{ label: 'Findings', value: fmtInt(n) }, { label: 'Assets Scanned', value: fmtInt(anomalies.scanned) }, { label: 'Parameters', value: String(ANOMALY_PARAMS.length) }, { label: 'Hit Rate', value: fmtPct((n / Math.max(anomalies.scanned, 1)) * 100, 2) }], target: 'False-positive rate at or below 15% on engineer review', analysis: 'Detection is directional — high dissolved gas is a finding, high oil breakdown voltage is not. | Each finding reports the parameter, the cohort median and the deviation, so an engineer can judge it rather than trust it. | Confirming or rejecting a finding on this page writes to the feedback loop and moves the precision figure.' })} />
          );
        })()}

        {(() => {
          const v = fb.precision;
          const col = v === null ? 'text-slate-400' : v >= 0.85 ? 'text-emerald-400' : v >= 0.7 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoPeople />} label="Field Agreement" value={v === null ? '—' : (v * 100).toFixed(0)} unit=" %" color={col}
              subValues={[{ label: 'Reviews', value: fmtInt(fb.total) }, { label: 'Rejected', value: fmtInt(fb.rejected) }]}
              onClick={() => showKPIDetail({ icon: <IcoPeople />, label: 'Field Agreement', value: v === null ? '0' : (v * 100).toFixed(0), unit: '% agreement', color: col, thresholds: { green: 85, amber: 70 }, inverted: false, definition: 'Share of model outputs a field engineer confirmed when they went and looked. An adjusted verdict — right finding, wrong severity — counts as a half. This is the only accuracy measure on the page that comes from reality rather than from the data.', subValues: [{ label: 'Confirmed', value: fmtInt(fb.confirmed) }, { label: 'Adjusted', value: fmtInt(fb.adjusted) }, { label: 'Rejected', value: fmtInt(fb.rejected) }, { label: 'Total Reviews', value: fmtInt(fb.total) }], target: '85% agreement to stay in production', analysis: 'Holdout error measures whether the model fits the data; this measures whether the data was right. | A model can hold a low MAE and still be rejected in the field if the underlying readings are wrong — which is a data-quality finding, not a model finding, and the distinction matters. | Feedback persists server-side and is auditable.' })} />
          );
        })()}

        {(() => {
          const col = gate.passed === gate.checks.length ? 'text-emerald-400' : gate.passed >= gate.checks.length - 1 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoCheck />} label="Promotion Gate" value={`${gate.passed}`} unit={` of ${gate.checks.length}`} color={col}
              subValues={[{ label: 'Candidate', value: 'MDL-FCST-TX-01' }, { label: 'Status', value: gate.passed === gate.checks.length ? 'Promotable' : 'Blocked' }]}
              onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Promotion Gate', value: String(gate.passed), unit: `of ${gate.checks.length} criteria`, color: col, thresholds: { green: gate.checks.length, amber: gate.checks.length - 1 }, inverted: false, definition: 'Criteria a candidate model must satisfy before it replaces the production model. Each one is a boolean evaluated against the live training run, the live drift figure and the accumulated field feedback — none of them is a stored flag.', subValues: gate.checks.slice(0, 4).map((c) => ({ label: c.label.split(' ').slice(0, 3).join(' '), value: c.pass ? 'Met' : 'Not met' })), target: 'All criteria met before promotion', analysis: 'A gate that always passes is decoration. This one does not: field agreement has no data until someone reviews a finding, so it starts failing and stays failing until the loop is genuinely exercised. | That is the correct behaviour — a model with no field validation should not be promotable. | Promotion, rollback and version history are on the Training tab.' })} />
          );
        })()}
      </div>

      <Tabs
        tabs={[
          { key: 'registry', label: 'Model Registry · F.2' },
          { key: 'training', label: 'Training & Evaluation · F.8' },
          { key: 'drift', label: 'Drift & Retraining · F.8' },
          { key: 'anomaly', label: 'Anomaly Detection · F.3' },
          { key: 'feedback', label: 'Feedback Loop · F.9' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {!backendUp && tab === 'feedback' && (
        <SimulatedNote>
          The model service is not reachable, so field feedback cannot be recorded or read.
          Start it with <code>npm run server</code>.
        </SimulatedNote>
      )}

      {tab === 'registry' && <RegistryTab run={run} drift={drift} fb={fb} />}
      {tab === 'training' && (
        <TrainingTab run={run} training={training} doTrain={doTrain} gate={gate} healthWeights={healthWeights} />
      )}
      {tab === 'drift' && <DriftTab drift={drift} forward={forward} dirty={dirty} />}
      {tab === 'anomaly' && (
        <AnomalyTab
          anomalies={anomalies} can={can} role={role} identity={identity}
          backendUp={backendUp} refresh={refresh} say={say} feedback={feedback}
        />
      )}
      {tab === 'feedback' && <FeedbackTab feedback={feedback} fb={fb} />}
    </div>
  );
}

/* ═══ REGISTRY — F.2 ═════════════════════════════════════════════════════ */

function RegistryTab({ run, drift, fb }) {
  const liveMetric = (id) => {
    if (id === 'MDL-FCST-TX-01' && run) return `Holdout MAE ${run.test.mae.toFixed(3)}`;
    if (id === 'MDL-AHI-TX-04') return `PSI ${drift.psi.toFixed(4)}`;
    if (id === 'MDL-ANOM-01') return fb.total ? `${(fb.precision * 100).toFixed(0)}% field agreement` : 'awaiting field review';
    return '—';
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Model registry" checkpoints="F.2 · F.8"
        sub="Every model the platform runs, with the governance attributes RFQ §3.4.11 requires"
        bodyClass="p-0"
      >
        <div className="apm-scroll" style={{ maxHeight: 520 }}>
          <table className="apm-table">
            <thead>
              <tr>
                <th>Model</th><th>Algorithm</th><th>Features</th>
                <th>Acceptance threshold</th><th>Retraining trigger</th><th>Live metric</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_REGISTRY.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="font-semibold" style={{ color: 'var(--app-text)' }}>{m.name}</div>
                    <div className="text-[9.5px] mono" style={{ color: 'var(--app-text-faint)' }}>
                      {m.id} · v{m.version}
                    </div>
                    <span
                      className="apm-pill mt-1"
                      style={{
                        background: m.status === 'Production' ? 'var(--app-success-bg)' : 'var(--app-info-bg)',
                        color: m.status === 'Production' ? 'var(--app-success)' : 'var(--app-info)',
                        border: `1px solid ${m.status === 'Production' ? 'var(--app-success-border)' : 'var(--app-info-border)'}`,
                      }}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="text-[10px]" style={{ maxWidth: 220 }}>{m.algorithm}</td>
                  <td className="text-[10px]" style={{ color: 'var(--app-text-faint)', maxWidth: 200 }}>{m.features}</td>
                  <td className="text-[10px]">{m.acceptance}</td>
                  <td className="text-[10px]" style={{ color: 'var(--app-warning)' }}>{m.retrigger}</td>
                  <td className="mono text-[10px]" style={{ color: 'var(--app-info)' }}>{liveMetric(m.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(360px, 1fr)' }}>
        <Panel title="Explainability commitment" checkpoints="F.2 · F.4">
          <p className="text-[10.5px] leading-relaxed mb-3" style={{ color: 'var(--app-text-muted)' }}>
            Every model in the registry is explainable by construction rather than by post-hoc attribution. There is no
            SHAP layer here because there is nothing opaque underneath that would need one:
          </p>
          <table className="apm-table">
            <thead><tr><th>Model</th><th>How an output is explained</th></tr></thead>
            <tbody>
              {MODEL_REGISTRY.map((m) => (
                <tr key={m.id}>
                  <td style={{ color: 'var(--app-text)' }}>{m.name}</td>
                  <td className="text-[10px]">{m.explainability}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            The trade is deliberate. A gradient-boosted ensemble would likely fit this data more tightly, and TPCL could
            not defend its output to a regulator. The RFQ asks for traceable, auditable automated decisions, so the
            models are chosen to be traceable first.
          </p>
        </Panel>

        <Panel title="Model lifecycle" checkpoints="F.8" sub="How a model gets into production and how it leaves">
          <div className="space-y-2">
            {[
              ['1. Develop', 'Feature set and algorithm agreed with TPCL engineering. Glass Box constraint applies — no model that cannot explain itself.'],
              ['2. Train', 'Deterministic split so runs are comparable. Training and holdout metrics both recorded.'],
              ['3. Evaluate', 'Promotion gate on the Training tab. Every criterion is a measurement, not a sign-off.'],
              ['4. Shadow', 'Candidate scores alongside production without acting, for one review cycle.'],
              ['5. Promote', 'Version incremented, previous version retained. Requires TPCL administrator approval.'],
              ['6. Monitor', 'PSI on every scoring run; field agreement tracked continuously.'],
              ['7. Retrain or roll back', 'Trigger breach fires retraining. A failed promotion rolls back to the retained prior version.'],
            ].map(([step, body]) => (
              <div key={step} className="rounded-lg px-3 py-2" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                <p className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>{step}</p>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>{body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ═══ TRAINING — F.8 ═════════════════════════════════════════════════════ */

function TrainingTab({ run, training, doTrain, gate }) {
  const t = getChartTokens();

  const coefChart = useMemo(() => {
    if (!run) return null;
    const feats = run.features.filter((f) => f.key !== 'bias')
      .sort((a, b) => b.contribution - a.contribution);
    return {
      labels: feats.map((f) => f.label),
      datasets: [{
        label: 'Standardised contribution',
        data: feats.map((f) => +f.contribution.toFixed(4)),
        backgroundColor: feats.map((f) => (f.coefficient >= 0 ? '#3b82f6' : '#f97316')),
        borderRadius: 3, borderWidth: 0,
      }],
    };
  }, [run]);

  /* Residual histogram on the holdout — the shape that tells you whether the
     error is well-behaved noise or a systematic miss. */
  const residualChart = useMemo(() => {
    if (!run) return null;
    const errs = run.test.preds.map((p) => p.error);
    const lo = -3, hi = 3, bins = 24, w = (hi - lo) / bins;
    const h = new Array(bins).fill(0);
    errs.forEach((e) => {
      let b = Math.floor((e - lo) / w);
      if (b < 0) b = 0; if (b >= bins) b = bins - 1;
      h[b] += 1;
    });
    return {
      labels: Array.from({ length: bins }, (_, i) => (lo + i * w + w / 2).toFixed(1)),
      datasets: [{
        label: 'Holdout predictions',
        data: h,
        backgroundColor: '#8b5cf6', borderRadius: 2, borderWidth: 0,
      }],
    };
  }, [run]);

  const barOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false }, tooltip: chartTooltip() },
    scales: {
      x: { grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 } } },
      y: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9 } } },
    },
  };

  const histOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: chartTooltip() },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 8 }, maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 }, precision: 0 } },
    },
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(340px, 1fr) minmax(400px, 1.25fr)' }}>
        <Panel
          title="Training run" checkpoints="F.8"
          sub="Ordinary least squares, deterministic 70/30 split by asset-ID hash"
          right={
            <button type="button" className="apm-btn is-primary" onClick={doTrain} disabled={training}>
              {training ? 'Training…' : 'Run training'}
            </button>
          }
        >
          {run ? (
            <>
              <table className="apm-table">
                <tbody>
                  {[
                    ['Target', `AHI at ${run.horizonYears}-year horizon`],
                    ['Population', `${fmtInt(run.poolSize)} transformers`],
                    ['Training set', `${fmtInt(run.train.n)} assets`],
                    ['Holdout set', `${fmtInt(run.test.n)} assets (never fitted)`],
                    ['Features', `${run.features.length - 1} + intercept`],
                    ['Fit time', `${run.ms.toFixed(1)} ms`],
                    ['Run at', run.at.toLocaleTimeString('en-IN')],
                  ].map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className="num" style={{ color: 'var(--app-text)' }}>{v}</td></tr>
                  ))}
                </tbody>
              </table>

              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-app-border">
                <div>
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Training set</p>
                  <table className="apm-table mt-1">
                    <tbody>
                      <tr><td>MAE</td><td className="num">{run.train.mae.toFixed(3)}</td></tr>
                      <tr><td>RMSE</td><td className="num">{run.train.rmse.toFixed(3)}</td></tr>
                      <tr><td>R²</td><td className="num">{run.train.r2.toFixed(4)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="apm-eyebrow" style={{ fontSize: 9, color: 'var(--app-info)' }}>Holdout — the real one</p>
                  <table className="apm-table mt-1">
                    <tbody>
                      <tr><td>MAE</td><td className="num" style={{ color: 'var(--app-info)', fontWeight: 700 }}>{run.test.mae.toFixed(3)}</td></tr>
                      <tr><td>RMSE</td><td className="num">{run.test.rmse.toFixed(3)}</td></tr>
                      <tr><td>R²</td><td className="num">{run.test.r2.toFixed(4)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="apm-formula mt-3">
                Generalisation gap <span className="op">=</span> holdout MAE
                {' '}<span className="val">{run.test.mae.toFixed(3)}</span> <span className="op">−</span> training MAE
                {' '}<span className="val">{run.train.mae.toFixed(3)}</span> <span className="op">=</span>
                {' '}<span className="res">{run.overfitGap >= 0 ? '+' : ''}{run.overfitGap.toFixed(3)}</span>
              </div>
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
                A gap near zero means the model generalises. A large positive gap would mean it memorised the training
                set — which is what the holdout exists to catch, and why the holdout figure is the one quoted.
              </p>

              <div className="mt-3 pt-3 border-t border-app-border">
                <p className="apm-eyebrow" style={{ fontSize: 9 }}>Skill against the naive forecast</p>
                <div className="apm-formula mt-1.5">
                  Skill <span className="op">=</span> 1 <span className="op">−</span>
                  {' '}<span className="val">{run.test.mae.toFixed(3)}</span> <span className="op">÷</span>
                  {' '}<span className="val">{run.naiveMae.toFixed(3)}</span> <span className="op">=</span>
                  {' '}<span className="res">{(run.skill * 100).toFixed(1)}%</span>
                </div>
                <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
                  This is the figure to quote, not R². An R² of {run.test.r2.toFixed(3)} looks impressive and is close
                  to meaningless on a level forecast — next year&apos;s health is mostly this year&apos;s health, so any
                  model that passes current AHI through scores near 1.0. The honest test is whether it beats the naive
                  forecast &ldquo;next year will be the same as now&rdquo;, which is wrong by{' '}
                  {run.naiveMae.toFixed(2)} AHI points on average. This model is wrong by {run.test.mae.toFixed(2)} —
                  a {(run.skill * 100).toFixed(0)}% reduction in error, which is the value it actually adds.
                </p>
              </div>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
              Not enough assets in the transformer cohort to train against.
            </p>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Feature contribution" checkpoints="F.8 · F.4"
            sub="Coefficient × feature spread — what each input actually moves in the forecast"
          >
            <div className="apm-chart-box" style={{ height: 230 }}>
              {coefChart && <Bar data={coefChart} options={barOpts} />}
            </div>
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
              Raw coefficients are not comparable across features measured in different units, so each is scaled by that
              feature&apos;s spread in the training set. Blue raises the forecast, orange lowers it.
            </p>
          </Panel>

          <Panel
            title="Holdout residuals" checkpoints="F.8"
            sub="Prediction minus actual, on assets the model never saw"
          >
            <div className="apm-chart-box" style={{ height: 180 }}>
              {residualChart && <Bar data={residualChart} options={histOpts} />}
            </div>
            {run && (
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
                Centred at {run.test.bias >= 0 ? '+' : ''}{run.test.bias.toFixed(3)} — a bias near zero means the model
                is not systematically optimistic or pessimistic. {(run.test.within1 * 100).toFixed(0)}% of forecasts land
                within 1 AHI point and {(run.test.within2 * 100).toFixed(0)}% within 2.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Promotion gate" checkpoints="F.8"
        sub={`${gate.passed} of ${gate.checks.length} criteria met — each evaluated against the run above, the live drift figure and accumulated field feedback`}
        bodyClass="p-0"
      >
        <table className="apm-table">
          <tbody>
            {gate.checks.map((c) => (
              <tr key={c.label}>
                <td>
                  <div style={{ color: 'var(--app-text)' }}>{c.label}</div>
                  <div className="text-[9.5px] mono" style={{ color: 'var(--app-text-faint)' }}>{c.detail}</div>
                </td>
                <td className="num" style={{ width: 80 }}>
                  <span
                    className="apm-pill"
                    style={{
                      background: c.pass ? 'var(--app-success-bg)' : 'var(--app-warning-bg)',
                      color: c.pass ? 'var(--app-success)' : 'var(--app-warning)',
                      border: `1px solid ${c.pass ? 'var(--app-success-border)' : 'var(--app-warning-border)'}`,
                    }}
                  >
                    {c.pass ? 'Met' : 'Not met'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SimulatedNote>
        The training run is real — the fit, the split and the metrics are computed in your browser against the live
        fleet when you press the button, and re-running gives identical numbers because the split is hashed from asset
        IDs rather than randomised. What it is trained on is the demonstration dataset, so the accuracy figures
        characterise <em>this</em> data, not TPCL&apos;s. The process, the split discipline, the promotion gate and the
        rollback path are what carry over to delivery; the numbers get recalibrated against real history at Blueprinting.
      </SimulatedNote>
    </div>
  );
}

/* ═══ DRIFT — F.8 ════════════════════════════════════════════════════════ */

function DriftTab({ drift, forward, dirty }) {
  const t = getChartTokens();

  const chart = useMemo(() => ({
    labels: drift.detail.map((d) => d.bin),
    datasets: [
      {
        label: 'Training baseline',
        data: drift.detail.map((d) => +(d.baseline * 100).toFixed(2)),
        backgroundColor: '#64748b', borderRadius: 2, borderWidth: 0,
      },
      {
        label: 'Live population',
        data: drift.detail.map((d) => +(d.current * 100).toFixed(2)),
        backgroundColor: '#3b82f6', borderRadius: 2, borderWidth: 0,
      },
    ],
  }), [drift]);

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: t.legendColor, font: { size: 10 }, boxWidth: 10 } },
      tooltip: chartTooltip(),
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9 } } },
      y: { grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 }, callback: (v) => `${v}%` } },
    },
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Population stability" checkpoints="F.8"
        sub="Health distribution the models were calibrated against, versus the one they are scoring now"
      >
        <div className="apm-chart-box" style={{ height: 260 }}>
          <Bar data={chart} options={opts} />
        </div>
        <div className="apm-formula mt-3">
          PSI <span className="op">=</span> Σ (actual% − expected%) <span className="op">×</span> ln(actual% ÷ expected%)
          {' '}<span className="op">=</span> <span className="res">{drift.psi.toFixed(4)}</span>
          {' '}<span className="op">→</span> <span className="val" style={{ color: drift.band.colour }}>{drift.band.label}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-app-border">
          {[
            ['Baseline mean', `${drift.baselineStats.mean.toFixed(2)} AHI`],
            ['Live mean', `${drift.currentStats.mean.toFixed(2)} AHI`],
            ['Mean shift', `${drift.meanShift >= 0 ? '+' : ''}${drift.meanShift.toFixed(3)}`],
            ['Effect size', `${drift.effectSize >= 0 ? '+' : ''}${drift.effectSize.toFixed(4)} σ`],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="apm-eyebrow" style={{ fontSize: 9 }}>{k}</p>
              <p className="text-[13px] font-bold mono mt-0.5" style={{ color: 'var(--app-text)' }}>{v}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
          A near-zero live PSI is the correct reading, not a broken metric. Health weights are normalised by their own
          sum, so retuning one parameter redistributes influence between parameters rather than moving the population as
          a whole — which is exactly why a weight change should <em>not</em> fire a retraining cycle. What does move the
          population is the fleet ageing, and that is projected below.
        </p>
      </Panel>

      <Panel
        title="Projected drift — when retraining becomes due" checkpoints="F.8"
        sub="Every asset aged at its own degradation rate, with the distribution re-measured at each horizon"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Horizon</th><th className="num">Mean shift</th><th className="num">PSI</th><th>Band</th><th>Action</th></tr>
          </thead>
          <tbody>
            {forward.points.map((pt) => (
              <tr key={pt.years}>
                <td className="mono">{pt.years === 1 ? '12 months' : `${pt.years * 12} months`}</td>
                <td className="num" style={{ color: 'var(--app-warning)' }}>{pt.meanShift.toFixed(2)} AHI</td>
                <td className="num" style={{ color: pt.band.colour, fontWeight: 700 }}>{pt.psi.toFixed(4)}</td>
                <td style={{ color: pt.band.colour }}>{pt.band.label}</td>
                <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                  {pt.psi >= 0.25 ? 'Retraining required' : pt.psi >= 0.10 ? 'Review at next cycle' : 'No action'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-app-border">
          <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
            At current degradation rates the fleet crosses the moderate-shift threshold at{' '}
            <strong style={{ color: 'var(--app-warning)' }}>
              {forward.crossModerate ? `${forward.crossModerate.toFixed(1)} years` : 'beyond 5 years'}
            </strong>{' '}
            and the material-shift threshold at{' '}
            <strong style={{ color: 'var(--app-danger)' }}>
              {forward.crossMaterial ? `${forward.crossMaterial.toFixed(1)} years` : 'beyond 5 years'}
            </strong>. That is the evidence behind the retraining cadence in the registry — the quarterly cycle is not a
            round number picked for a proposal, it is comfortably inside the horizon at which this population stops
            resembling the one the models were calibrated on.
          </p>
        </div>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1.2fr) minmax(320px, 1fr)' }}>
        <Panel title="Per-bin contribution" checkpoints="F.8" sub="Which part of the distribution moved" bodyClass="p-0">
          <table className="apm-table">
            <thead>
              <tr><th>AHI band</th><th className="num">Baseline</th><th className="num">Live</th><th className="num">Shift</th><th className="num">PSI contribution</th></tr>
            </thead>
            <tbody>
              {drift.detail.map((d) => {
                const shift = (d.current - d.baseline) * 100;
                return (
                  <tr key={d.bin}>
                    <td className="mono">{d.bin}</td>
                    <td className="num">{(d.baseline * 100).toFixed(2)}%</td>
                    <td className="num">{(d.current * 100).toFixed(2)}%</td>
                    <td className="num" style={{ color: Math.abs(shift) < 0.05 ? 'var(--app-text-faint)' : shift > 0 ? 'var(--app-success)' : 'var(--app-warning)' }}>
                      {shift >= 0 ? '+' : ''}{shift.toFixed(2)}%
                    </td>
                    <td className="num" style={{ color: d.contribution > 0.02 ? 'var(--app-warning)' : 'var(--app-text-faint)' }}>
                      {d.contribution.toFixed(5)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Retraining triggers" checkpoints="F.8" sub="Evaluated continuously against live state">
          <div className="space-y-2">
            {[
              { label: 'Population drift', value: drift.psi.toFixed(4), threshold: 'PSI > 0.25', fired: drift.psi > 0.25 },
              { label: 'Distribution mean shift', value: `${drift.meanShift >= 0 ? '+' : ''}${drift.meanShift.toFixed(3)} AHI`, threshold: '|shift| > 2.0 points', fired: Math.abs(drift.meanShift) > 2 },
              { label: 'Health model edited this session', value: dirty ? 'Yes' : 'No', threshold: 'Any weight change', fired: dirty },
              {
                label: 'Projected drift horizon',
                value: forward.crossMaterial ? `${forward.crossMaterial.toFixed(1)} yr` : '> 5 yr',
                threshold: 'Retrain before the population crosses 0.25',
                fired: false,
              },
              { label: 'New failure history available', value: 'Awaiting TPCL data', threshold: '12 months of records', fired: false },
            ].map((r) => (
              <div
                key={r.label}
                className="rounded-lg px-3 py-2"
                style={{
                  background: r.fired ? 'var(--app-warning-bg)' : 'var(--app-surface-soft)',
                  border: `1px solid ${r.fired ? 'var(--app-warning-border)' : 'var(--app-border)'}`,
                }}
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--app-text)' }}>{r.label}</span>
                  <span className="text-[10px] mono" style={{ color: r.fired ? 'var(--app-warning)' : 'var(--app-text-faint)' }}>
                    {r.value}
                  </span>
                </div>
                <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>
                  Trigger: {r.threshold} {r.fired ? '— fired' : '— not fired'}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ═══ ANOMALY — F.3 ══════════════════════════════════════════════════════ */

function AnomalyTab({ anomalies, can, role, identity, backendUp, refresh, say, feedback }) {
  const [busy, setBusy] = useState(null);
  const reviewed = useMemo(
    () => new Set(feedback.map((f) => `${f.assetId}:${f.parameter}`)),
    [feedback]
  );

  const record = async (finding, verdict) => {
    if (!can('incident.write')) return;
    const key = `${finding.id}:${finding.parameter}`;
    setBusy(key);
    try {
      await createConfig('model-feedback', {
        name: `${finding.id} · ${finding.label}`,
        modelId: 'MDL-ANOM-01',
        assetId: finding.id,
        parameter: finding.parameter,
        value: finding.value,
        z: +finding.z.toFixed(2),
        verdict,
        reviewer: identity.name,
        auditDetail: `Anomaly on ${finding.id} (${finding.label}, ${finding.z.toFixed(1)}σ) marked ${verdict}`,
      });
      await refresh();
      say(`${finding.id} — ${finding.label} marked ${verdict}. Field agreement recomputed.`);
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Could not reach the model service', 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.5fr) minmax(320px, 1fr)' }}>
        <Panel
          title="Anomaly findings" checkpoints="F.3 · F.6"
          sub={`${anomalies.findings.length} readings beyond ${anomalies.threshold}σ of their asset-class cohort, from ${fmtInt(anomalies.scanned)} scanned`}
          bodyClass="p-0"
        >
          <div className="apm-scroll" style={{ maxHeight: 460 }}>
            <table className="apm-table">
              <thead>
                <tr>
                  <th>Asset</th><th>Parameter</th><th className="num">Reading</th>
                  <th className="num">Cohort median</th><th className="num">Deviation</th><th>Field verdict</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.findings.slice(0, 60).map((f) => {
                  const key = `${f.id}:${f.parameter}`;
                  const done = reviewed.has(key);
                  return (
                    <tr key={key}>
                      <td>
                        <span className="asset-id">{f.id}</span>
                        <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
                          {f.zone} · AHI {f.ahi.toFixed(1)}
                        </div>
                      </td>
                      <td className="text-[10.5px]">{f.label}</td>
                      <td className="num" style={{ color: 'var(--app-danger)', fontWeight: 600 }}>
                        {f.value} {f.unit}
                      </td>
                      <td className="num" style={{ color: 'var(--app-text-faint)' }}>
                        {typeof f.cohortMedian === 'number' ? f.cohortMedian.toFixed(1) : f.cohortMedian} {f.unit}
                      </td>
                      <td className="num" style={{ color: 'var(--app-warning)', fontWeight: 700 }}>
                        {f.z.toFixed(1)}σ
                      </td>
                      <td>
                        {done ? (
                          <span className="apm-pill" style={{ background: 'var(--app-success-bg)', color: 'var(--app-success)', border: '1px solid var(--app-success-border)' }}>
                            Reviewed
                          </span>
                        ) : (
                          <div className="flex gap-1">
                            {['confirmed', 'adjusted', 'rejected'].map((v) => (
                              <button
                                key={v} type="button" className="apm-btn"
                                style={{ padding: '3px 6px', fontSize: 9 }}
                                disabled={!can('incident.write') || !backendUp || busy === key}
                                onClick={() => record(f, v)}
                              >
                                {v === 'confirmed' ? 'Confirm' : v === 'adjusted' ? 'Adjust' : 'Reject'}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!anomalies.findings.length && (
                  <tr><td colSpan={6} style={{ color: 'var(--app-text-faint)' }}>
                    No readings beyond the detection threshold in the current population.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Detection method" checkpoints="F.3" sub="Robust z-score against the asset's own class cohort">
            <div className="apm-formula mb-3">
              z <span className="op">=</span> (reading <span className="op">−</span> cohort median)
              {' '}<span className="op">÷</span> (MAD <span className="op">×</span> <span className="val">1.4826</span>)
            </div>
            <p className="text-[10.5px] leading-relaxed mb-3" style={{ color: 'var(--app-text-muted)' }}>
              Median and median-absolute-deviation rather than mean and standard deviation. The reason is practical: a
              cohort containing a dozen genuinely degraded transformers has a mean and a standard deviation that those
              same transformers inflate, and they end up hiding inside their own influence on the baseline. The median
              is unmoved by them.
            </p>
            <table className="apm-table">
              <thead><tr><th>Parameter</th><th className="num">Median</th><th className="num">Robust σ</th><th className="num">n</th></tr></thead>
              <tbody>
                {anomalies.cohorts.map((c) => (
                  <tr key={c.key}>
                    <td className="text-[10px]">{c.label}</td>
                    <td className="num">{typeof c.median === 'number' ? c.median.toFixed(1) : c.median}</td>
                    <td className="num">{c.sigma.toFixed(2)}</td>
                    <td className="num">{fmtInt(c.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {!can('incident.write') && (
            <SimulatedNote>
              The <strong>{role.label}</strong> role does not hold <code>incident.write</code>, so findings cannot be
              reviewed from this account. The server rejects the write independently of what this interface shows.
            </SimulatedNote>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ FEEDBACK — F.9 ═════════════════════════════════════════════════════ */

function FeedbackTab({ feedback, fb }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1.3fr) minmax(320px, 1fr)' }}>
        <Panel
          title="Field review record" checkpoints="F.9"
          sub="Every model output an engineer went and checked, and what they found"
          bodyClass="p-0"
        >
          <div className="apm-scroll" style={{ maxHeight: 420 }}>
            <table className="apm-table">
              <thead>
                <tr><th>Asset</th><th>Model</th><th>Parameter</th><th className="num">Deviation</th><th>Verdict</th><th>Reviewer</th></tr>
              </thead>
              <tbody>
                {feedback.map((f) => {
                  const colour = f.verdict === 'confirmed' ? 'var(--app-success)'
                    : f.verdict === 'adjusted' ? 'var(--app-warning)' : 'var(--app-danger)';
                  return (
                    <tr key={f.id}>
                      <td className="asset-id">{f.assetId}</td>
                      <td className="mono text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{f.modelId}</td>
                      <td className="text-[10px]">{f.parameter}</td>
                      <td className="num">{f.z}σ</td>
                      <td style={{ color: colour, fontWeight: 600, textTransform: 'capitalize' }}>{f.verdict}</td>
                      <td className="text-[10px]">{f.reviewer}</td>
                    </tr>
                  );
                })}
                {!feedback.length && (
                  <tr><td colSpan={6} style={{ color: 'var(--app-text-faint)' }}>
                    No field reviews recorded. Confirm or reject a finding on the Anomaly Detection tab — the agreement
                    figure and the promotion gate both move when you do.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Agreement by model" checkpoints="F.9" bodyClass="p-0">
            <table className="apm-table">
              <thead><tr><th>Model</th><th className="num">Reviews</th><th className="num">Confirmed</th><th className="num">Agreement</th></tr></thead>
              <tbody>
                {fb.byModel.map((m) => (
                  <tr key={m.modelId}>
                    <td className="mono text-[10px]">{m.modelId}</td>
                    <td className="num">{m.total}</td>
                    <td className="num">{m.confirmed}</td>
                    <td
                      className="num"
                      style={{ color: m.precision >= 0.85 ? 'var(--app-success)' : 'var(--app-warning)', fontWeight: 700 }}
                    >
                      {m.precision === null ? '—' : `${(m.precision * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
                {!fb.byModel.length && (
                  <tr><td colSpan={4} style={{ color: 'var(--app-text-faint)' }}>Awaiting first review.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title="How feedback closes the loop" checkpoints="F.9">
            <ol className="space-y-2 text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
              {[
                ['Engineer reviews a finding', 'Confirm, adjust or reject, recorded against the asset, the parameter and the model version.'],
                ['Agreement recomputes', 'The precision figure on the promotion gate moves immediately — it is derived, not entered.'],
                ['Threshold breach fires retraining', 'Agreement below 85% is a registry-level retraining trigger, the same as a PSI breach.'],
                ['Rejections become training labels', 'A rejected finding is a labelled negative. Accumulated rejections are the highest-value training data the platform generates.'],
                ['Systematic rejection is escalated', 'If rejections cluster on one parameter, that is a data-quality defect upstream, not a model defect — and it is raised as an incident, not a retraining ticket.'],
              ].map(([k, v], i) => (
                <li key={k} className="flex gap-2">
                  <span
                    className="flex-shrink-0 rounded-full flex items-center justify-center mono"
                    style={{ width: 16, height: 16, fontSize: 9, background: 'var(--app-info-bg)', color: 'var(--app-info)', border: '1px solid var(--app-info-border)' }}
                  >
                    {i + 1}
                  </span>
                  <span><strong style={{ color: 'var(--app-text)' }}>{k}.</strong> {v}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <SimulatedNote>
        The feedback loop is real within the demonstration: reviews persist to the server, appear in the audit trail,
        and change the agreement figure and promotion gate without a reload. What the demo does not do is automatically
        refit a production model on accumulated feedback — retraining is a governed action requiring TPCL approval, and
        that is a deliberate design choice rather than a missing feature.
      </SimulatedNote>
    </div>
  );
}
