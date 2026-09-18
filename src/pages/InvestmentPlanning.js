/* Investment Planning & Scenario Lab — Sections I, J and K.
   I.1 investment value score, I.2 prioritisation, I.3/I.4 CAPEX/OPEX,
   I.5 portfolio optimisation, I.6 budget allocation, I.7/I.8 constraints,
   J.1–J.6 scenarios, K.1–K.6 ARR and tariff impact.

   The budget control re-runs optimisePortfolio() against the live candidate
   set. Nothing is precomputed, so an evaluator can set any budget they like. */

import React, { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';

import { useApm, DEFAULT_BUDGET_CR, BUDGET_MAX_CR, TOTAL_NEED_CR } from '../services/apmStore';
import { optimisePortfolio, fmtCr, fmtInt, healthBand } from '../engines/indices';
import { Panel, PageHead, Tabs, BarRow, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoDollar, IcoCheck, IcoShield, IcoHourglass, IcoClock, IcoScale }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';
import { getChartTokens, chartTooltip } from '../components/chartUtils';
import { ARR_PARAMS, computeARR } from '../engines/regulatory';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/* The six scenarios Section J names, expressed as budget and constraint
   transforms against the approved baseline. */
const SCENARIOS = [
  { key: 'baseline',   label: 'Baseline',              note: 'FY27 approved plan',        budget: (b) => b,       minACI: 0 },
  { key: 'cut20',      label: 'Budget reduced 20%',    note: 'Capital constraint',        budget: (b) => b * 0.8, minACI: 0 },
  { key: 'up20',       label: 'Budget increased 20%',  note: 'Accelerated programme',     budget: (b) => b * 1.2, minACI: 0 },
  { key: 'reliability',label: 'Reliability target',    note: 'Critical assets first',     budget: (b) => b,       minACI: 55 },
  { key: 'riskcut',    label: 'Risk reduction target', note: 'Retire 60% of exposure',    budget: (b) => b * 1.45, minACI: 0 },
  { key: 'replace',    label: 'Replacement strategy',  note: 'Replace-only, no refurb',   budget: (b) => b,       minACI: 0, only: ['replace'] },
];

export default function InvestmentPlanning() {
  const { candidates, portfolio, budgetCr, setBudgetCr, minCriticality, setMinCriticality, setOnlyInterventions } = useApm();
  const [tab, setTab] = useState('portfolio');
  const [scenario, setScenario] = useState('baseline');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (data) => setSelectedKPIDetail(data);
  const t = getChartTokens();

  /* Baseline is always recomputed at the approved budget so every scenario has
     something honest to be compared against. */
  const baseline = useMemo(
    () => optimisePortfolio(candidates, DEFAULT_BUDGET_CR, { minCriticality: 0 }),
    [candidates]
  );

  const applyScenario = (s) => {
    setScenario(s.key);
    setBudgetCr(Math.round(s.budget(DEFAULT_BUDGET_CR)));
    setMinCriticality(s.minACI);
    setOnlyInterventions(s.only || null);
  };

  /* ─── Spend split by intervention type ─────────────────────────────── */
  const byIntervention = useMemo(() => {
    const m = {};
    portfolio.selected.forEach((c) => {
      m[c.interventionLabel] = m[c.interventionLabel] || { n: 0, capex: 0, risk: 0 };
      m[c.interventionLabel].n += 1;
      m[c.interventionLabel].capex += c.capex;
      m[c.interventionLabel].risk += c.riskAvoided;
    });
    return Object.entries(m).map(([k, v]) => ({ label: k, ...v })).sort((a, b) => b.capex - a.capex);
  }, [portfolio]);

  /* ─── Scenario comparison chart ────────────────────────────────────── */
  const comparison = useMemo(() => {
    const runs = SCENARIOS.map((s) => ({
      label: s.label,
      result: optimisePortfolio(candidates, s.budget(DEFAULT_BUDGET_CR), {
        minCriticality: s.minACI, onlyInterventions: s.only || null,
      }),
    }));
    return runs;
  }, [candidates]);

  const compChart = useMemo(() => ({
    labels: comparison.map((r) => r.label.replace(' ', '\n')),
    datasets: [
      {
        label: 'Risk retired (₹ Cr/yr)',
        data: comparison.map((r) => +r.result.riskBoughtDown.toFixed(1)),
        backgroundColor: '#16a34a', borderRadius: 3, borderWidth: 0,
      },
      {
        label: 'Deferred risk (₹ Cr/yr)',
        data: comparison.map((r) => +r.result.residualRisk.toFixed(1)),
        backgroundColor: '#dc2626', borderRadius: 3, borderWidth: 0,
      },
    ],
  }), [comparison]);

  const deltaVsBaseline = portfolio.riskBoughtDown - baseline.riskBoughtDown;

  /* Trend badges compare the active scenario against the approved baseline —
     a real comparison, not a fabricated time series. */
  const pctVs = (now, base) => (base > 0 ? ((now - base) / base) * 100 : 0);
  const vsBase = {
    budget: pctVs(portfolio.budgetCr, baseline.budgetCr),
    funded: pctVs(portfolio.selected.length, baseline.selected.length),
    retired: pctVs(portfolio.riskBoughtDown, baseline.riskBoughtDown),
    deferred: pctVs(portfolio.residualRisk, baseline.residualRisk),
    saidi: pctVs(Math.abs(portfolio.saidiDelta), Math.abs(baseline.saidiDelta)),
  };

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP BPM · Asset Investment Planning"
        title="Investment Planning"
        sub="Risk-ranked capital candidates optimised against a budget ceiling. Every candidate's benefit is the reduction in annualised risk the intervention produces, recomputed through the same risk engine used on the Risk Cockpit."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Active scenario</p>
            <p className="text-[12px] font-bold mt-1" style={{ color: 'var(--app-info)' }}>
              {SCENARIOS.find((s) => s.key === scenario)?.label}
            </p>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoDollar />} label="Capital Budget" value={portfolio.budgetCr.toFixed(0)} unit=" ₹ Cr" trend={vsBase.budget} color={col}
            subValues={[{ label: 'Committed', value: fmtCr(portfolio.spend, 0) }, { label: 'Utilisation', value: `${portfolio.utilisation.toFixed(1)}%` }]}
            onClick={() => showKPIDetail({ icon: <IcoDollar />, label: 'Capital Budget', value: portfolio.budgetCr.toFixed(0), unit: '₹ Cr', trend: vsBase.budget, color: col, thresholds: { green: DEFAULT_BUDGET_CR, amber: DEFAULT_BUDGET_CR * 0.8 }, inverted: false, definition: 'Capital ceiling the portfolio optimiser works within for this scenario. The approved FY27 plan is derived as 62% of total identified capital need, so the funding gap is explicit rather than hidden.', subValues: [{ label: 'Committed', value: fmtCr(portfolio.spend, 1) }, { label: 'Unallocated', value: fmtCr(Math.max(portfolio.budgetCr - portfolio.spend, 0), 1) }, { label: 'Identified Need', value: fmtCr(TOTAL_NEED_CR, 0) }, { label: 'Baseline Budget', value: fmtCr(DEFAULT_BUDGET_CR, 0) }], target: `Fund the full identified need of ${fmtCr(TOTAL_NEED_CR, 0)}`, analysis: `The approved plan covers ${((DEFAULT_BUDGET_CR / TOTAL_NEED_CR) * 100).toFixed(0)}% of identified need. | The remainder is deferred, and the risk it carries is quantified rather than assumed away. | Use the Scenario Lab to test what a different ceiling buys.` })} />
        ); })()}

        {(() => { const col = vsBase.funded >= 0 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoCheck />} label="Projects Funded" value={fmtInt(portfolio.selected.length)} trend={vsBase.funded} color={col}
            subValues={[{ label: 'Deferred', value: fmtInt(portfolio.deferred.length) }, { label: 'Candidates', value: fmtInt(portfolio.selected.length + portfolio.deferred.length) }]}
            onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Projects Funded', value: String(portfolio.selected.length), unit: 'projects', trend: vsBase.funded, color: col, thresholds: { green: baseline.selected.length, amber: baseline.selected.length * 0.8 }, inverted: false, definition: 'Projects selected by the optimiser within the budget ceiling. Candidates are ranked by benefit-cost ratio — annualised risk retired per rupee committed — and funded until the money runs out.', subValues: [{ label: 'Funded', value: fmtInt(portfolio.selected.length) }, { label: 'Deferred', value: fmtInt(portfolio.deferred.length) }, { label: 'Baseline Funded', value: fmtInt(baseline.selected.length) }, { label: 'Committed', value: fmtCr(portfolio.spend, 1) }], target: `All ${fmtInt(portfolio.selected.length + portfolio.deferred.length)} candidates funded`, analysis: 'Selection is a transparent greedy knapsack, not a black box: a project is cut when it ranks below the line on value per rupee. | That means every deferral has a stateable reason. | Condition monitoring upgrades return the highest ratio and are funded first.' })} />
        ); })()}

        {(() => { const col = vsBase.retired >= 0 ? 'text-emerald-400' : 'text-red-400'; return (
          <KPICard icon={<IcoShield />} label="Risk Retired" value={portfolio.riskBoughtDown.toFixed(1)} unit=" ₹ Cr/yr" trend={vsBase.retired} color={col}
            subValues={[{ label: 'Of Candidate Risk', value: `${portfolio.riskReductionPct.toFixed(1)}%` }, { label: 'Per ₹ Cr Spent', value: `₹${(portfolio.riskBoughtDown / Math.max(portfolio.spend, 1)).toFixed(3)} Cr` }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'Risk Retired', value: portfolio.riskBoughtDown.toFixed(1), unit: '₹ Cr/yr', trend: vsBase.retired, color: col, thresholds: { green: baseline.riskBoughtDown, amber: baseline.riskBoughtDown * 0.8 }, inverted: false, definition: 'Annualised risk removed from the network by the funded portfolio. Computed by re-running the identical risk engine against each asset post-intervention, so the benefit is derived rather than assumed.', subValues: [{ label: 'Retired', value: fmtCr(portfolio.riskBoughtDown, 1) }, { label: 'Baseline', value: fmtCr(baseline.riskBoughtDown, 1) }, { label: 'Deferred Risk', value: fmtCr(portfolio.residualRisk, 1) }, { label: 'Benefit-Cost', value: `${(portfolio.riskBoughtDown * 12 / Math.max(portfolio.spend, 1)).toFixed(2)}×` }], target: `Match or exceed the ${fmtCr(baseline.riskBoughtDown, 1)} baseline`, analysis: 'Benefit is recomputed through the same PoF × CoF engine used on the Risk Cockpit — nothing is assumed. | Replacement resets asset age to near zero; refurbishment halves effective age. | This figure is the core of the regulatory justification pack.' })} />
        ); })()}

        {(() => { const col = vsBase.deferred <= 0 ? 'text-emerald-400' : 'text-red-400'; return (
          <KPICard icon={<IcoHourglass />} label="Deferred Risk" value={portfolio.residualRisk.toFixed(1)} unit=" ₹ Cr/yr" trend={-vsBase.deferred} color={col}
            subValues={[{ label: 'Projects', value: fmtInt(portfolio.deferred.length) }, { label: 'Unfunded Value', value: fmtCr(portfolio.deferred.reduce((s, c) => s + c.capex, 0), 0) }]}
            onClick={() => showKPIDetail({ icon: <IcoHourglass />, label: 'Deferred Risk', value: portfolio.residualRisk.toFixed(1), unit: '₹ Cr/yr', trend: -vsBase.deferred, color: col, thresholds: { green: baseline.residualRisk, amber: baseline.residualRisk * 1.3 }, inverted: true, definition: 'Annualised risk left on the network by projects that fell below the budget line. This is the cost of the funding gap, stated explicitly rather than absorbed silently.', subValues: [{ label: 'Deferred Projects', value: fmtInt(portfolio.deferred.length) }, { label: 'Unfunded Capital', value: fmtCr(portfolio.deferred.reduce((s, c) => s + c.capex, 0), 0) }, { label: 'Baseline Deferred', value: fmtCr(baseline.residualRisk, 1) }, { label: 'Worst Deferred', value: fmtCr(Math.max(...portfolio.deferred.map((c) => c.ariBefore), 0)) }], target: `No worse than the ${fmtCr(baseline.residualRisk, 1)} baseline`, analysis: 'Deferral is not free — this figure is what the network carries for another year. | The deferred table below lists the highest-risk unfunded assets. | Cutting the budget 20% is the fastest way to see this number move.' })} />
        ); })()}

        {(() => { const col = vsBase.saidi >= 0 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoClock />} label="Reliability Gain" value={Math.abs(portfolio.saidiDelta).toFixed(0)} unit=" SAIDI min/yr" trend={vsBase.saidi} color={col}
            subValues={[{ label: 'Basis', value: 'Risk-linked' }, { label: 'Baseline', value: `${Math.abs(baseline.saidiDelta).toFixed(0)} min` }]}
            onClick={() => showKPIDetail({ icon: <IcoClock />, label: 'Reliability Gain', value: Math.abs(portfolio.saidiDelta).toFixed(0), unit: 'SAIDI min/yr', trend: vsBase.saidi, color: col, thresholds: { green: Math.abs(baseline.saidiDelta), amber: Math.abs(baseline.saidiDelta) * 0.8 }, inverted: false, definition: 'Indicative improvement in System Average Interruption Duration Index arising from the funded portfolio. Derived from retired risk — as expected failures fall, so does expected outage duration.', subValues: [{ label: 'This Scenario', value: `${Math.abs(portfolio.saidiDelta).toFixed(0)} min` }, { label: 'Baseline', value: `${Math.abs(baseline.saidiDelta).toFixed(0)} min` }, { label: 'Risk Retired', value: fmtCr(portfolio.riskBoughtDown, 1) }, { label: 'Projects', value: fmtInt(portfolio.selected.length) }], target: 'Meet the regulatory reliability trajectory', analysis: 'This is an indicative linkage for demonstration — the delivery build calibrates the risk-to-SAIDI coefficient against TPCL outage history. | Reliability is the outcome regulators price, which is why it sits alongside the financial figures. | The ARR tab converts this into a submission.' })} />
        ); })()}

        {(() => { const u = portfolio.utilisation; const col = u >= 95 ? 'text-emerald-400' : u >= 75 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoScale />} label="Budget Utilisation" value={u.toFixed(1)} unit=" %" color={col}
            subValues={[{ label: 'Committed', value: fmtCr(portfolio.spend, 1) }, { label: 'Unallocated', value: fmtCr(Math.max(portfolio.budgetCr - portfolio.spend, 0), 1) }]}
            onClick={() => showKPIDetail({ icon: <IcoScale />, label: 'Budget Utilisation', value: u.toFixed(1), unit: '%', color: col, thresholds: { green: 95, amber: 75 }, inverted: false, definition: 'Share of the capital ceiling actually committed. Utilisation below 100% means the next candidate in the ranking would not fit within the remaining budget — the optimiser never part-funds a project.', subValues: [{ label: 'Committed', value: fmtCr(portfolio.spend, 1) }, { label: 'Ceiling', value: fmtCr(portfolio.budgetCr, 0) }, { label: 'Unallocated', value: fmtCr(Math.max(portfolio.budgetCr - portfolio.spend, 0), 1) }, { label: 'Next Project', value: fmtCr(portfolio.deferred[0]?.capex || 0) }], target: '95%+ of budget committed', analysis: 'A shortfall here is a lumpiness artefact, not waste: the next-ranked project is larger than the money left. | Raising the ceiling slightly can unlock a disproportionately valuable project. | The Scenario Lab makes that trade visible.' })} />
        ); })()}
      </div>

      <Tabs
        tabs={[
          { key: 'portfolio', label: 'Portfolio · Section I' },
          { key: 'scenarios', label: 'Scenario Lab · Section J' },
          { key: 'regulatory', label: 'Regulatory & ARR · Section K' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ═══ PORTFOLIO ══════════════════════════════════════════════════ */}
      {tab === 'portfolio' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.6fr) minmax(310px, 1fr)' }}>
          <Panel
            title="Funded portfolio" checkpoints="I.1 · I.2 · I.5"
            sub="Ranked by benefit-cost ratio — risk retired per rupee committed"
            bodyClass="p-0"
          >
            <div className="apm-scroll" style={{ maxHeight: 470 }}>
              <table className="apm-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Asset</th>
                    <th>Intervention</th>
                    <th className="num">AHI</th>
                    <th className="num">CAPEX</th>
                    <th className="num">Risk retired</th>
                    <th className="num">BCR</th>
                    <th className="num">IVS</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.selected.slice(0, 60).map((c, i) => (
                    <tr key={c.id}>
                      <td className="num" style={{ color: 'var(--app-text-faint)' }}>{i + 1}</td>
                      <td>
                        <div className="asset-id">{c.asset.id}</div>
                        <div className="text-[9.5px] truncate" style={{ color: 'var(--app-text-faint)', maxWidth: 140 }}>
                          {c.asset.substation}
                        </div>
                      </td>
                      <td>
                        <span className="apm-pill" style={{
                          background: c.intervention === 'replace' ? 'var(--app-danger-bg)' : c.intervention === 'refurbish' ? 'var(--app-warning-bg)' : 'var(--app-info-bg)',
                          color: c.intervention === 'replace' ? 'var(--app-danger)' : c.intervention === 'refurbish' ? 'var(--app-warning)' : 'var(--app-info)',
                        }}>
                          {c.interventionLabel}
                        </span>
                      </td>
                      <td className="num" style={{ color: healthBand(c.ahiBefore).color, fontWeight: 700 }}>
                        {c.ahiBefore.toFixed(0)}→{c.ahiAfter}
                      </td>
                      <td className="num">₹{c.capex.toFixed(2)}</td>
                      <td className="num" style={{ color: 'var(--app-success)', fontWeight: 700 }}>₹{c.riskAvoided.toFixed(2)}</td>
                      <td className="num">{c.bcr.toFixed(1)}×</td>
                      <td className="num" style={{ color: 'var(--app-text)', fontWeight: 700 }}>{c.ivs.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {portfolio.selected.length > 60 && (
              <div className="px-4 py-2.5 border-t border-app-border">
                <p className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                  Showing the top 60 of {fmtInt(portfolio.selected.length)} funded projects.
                </p>
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Budget allocation" checkpoints="I.3 · I.4 · I.6" sub="Committed capital by intervention type">
              {byIntervention.map((b, i) => (
                <BarRow
                  key={b.label}
                  label={b.label}
                  sublabel={`${fmtInt(b.n)} projects · retires ₹${b.risk.toFixed(1)} Cr/yr`}
                  pct={(b.capex / Math.max(portfolio.spend, 1)) * 100}
                  value={`₹${b.capex.toFixed(0)}`}
                  color={['#dc2626', '#d97706', '#0891b2'][i % 3]}
                />
              ))}
              <div className="mt-3 pt-3 border-t border-app-border space-y-1.5">
                {[
                  ['Committed', fmtCr(portfolio.spend, 1)],
                  ['Unallocated', fmtCr(Math.max(portfolio.budgetCr - portfolio.spend, 0), 1)],
                  ['Deferred value', fmtCr(portfolio.deferred.reduce((s, c) => s + c.capex, 0), 0)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between">
                    <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Deferred — highest risk left unfunded" checkpoints="I.7 · I.8"
                   sub="What falls below the budget line" bodyClass="p-0">
              <div className="apm-scroll" style={{ maxHeight: 210 }}>
                <table className="apm-table">
                  <thead>
                    <tr><th>Asset</th><th className="num">CAPEX</th><th className="num">Risk carried</th></tr>
                  </thead>
                  <tbody>
                    {[...portfolio.deferred].sort((a, b) => b.ariBefore - a.ariBefore).slice(0, 14).map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="asset-id">{c.asset.id}</div>
                          <div className="text-[9.5px] truncate" style={{ color: 'var(--app-text-faint)', maxWidth: 130 }}>{c.interventionLabel}</div>
                        </td>
                        <td className="num">₹{c.capex.toFixed(2)}</td>
                        <td className="num" style={{ color: 'var(--app-danger)', fontWeight: 700 }}>₹{c.ariBefore.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ═══ SCENARIO LAB ═══════════════════════════════════════════════ */}
      {tab === 'scenarios' && (
        <div className="space-y-4">
          <Panel title="Scenario controls" checkpoints="J.1 – J.6"
                 sub="Adjust the budget and watch the portfolio re-solve — nothing here is precomputed">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.4fr)' }}>
              <div>
                <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Preset scenarios</p>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                  {SCENARIOS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`apm-scenario-btn ${scenario === s.key ? 'is-active' : ''}`}
                      onClick={() => applyScenario(s)}
                    >
                      {s.label}
                      <small>{s.note} · {fmtCr(s.budget(DEFAULT_BUDGET_CR), 0)}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Capital budget</p>
                  <span className="text-[16px] font-bold" style={{ color: 'var(--app-info)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCr(budgetCr, 0)}
                  </span>
                </div>
                <input
                  type="range" min="20" max={BUDGET_MAX_CR} step="5" value={budgetCr}
                  className="apm-slider"
                  aria-label="Capital budget in crore"
                  onChange={(e) => { setBudgetCr(parseInt(e.target.value, 10)); setScenario('custom'); setOnlyInterventions(null); }}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>₹20 Cr</span>
                  <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>
                    Identified need {fmtCr(TOTAL_NEED_CR, 0)}
                  </span>
                </div>

                <div className="flex items-baseline justify-between mt-4 mb-2">
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Minimum criticality to qualify</p>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                    ACI {minCriticality}
                  </span>
                </div>
                <input
                  type="range" min="0" max="80" step="5" value={minCriticality}
                  className="apm-slider"
                  aria-label="Minimum criticality"
                  onChange={(e) => { setMinCriticality(parseInt(e.target.value, 10)); setScenario('custom'); }}
                />

                <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-app-border">
                  {[
                    ['Funded', fmtInt(portfolio.selected.length), `vs ${fmtInt(baseline.selected.length)} baseline`],
                    ['Risk retired', `₹${portfolio.riskBoughtDown.toFixed(0)}`, `${deltaVsBaseline >= 0 ? '+' : ''}${deltaVsBaseline.toFixed(1)} vs baseline`],
                    ['Deferred', `₹${portfolio.residualRisk.toFixed(0)}`, 'Cr/yr on network'],
                  ].map(([k, v, note]) => (
                    <div key={k}>
                      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{k}</p>
                      <p className="text-[15px] font-bold mt-0.5" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</p>
                      <p className="text-[9px]" style={{ color: deltaVsBaseline < 0 && k === 'Risk retired' ? 'var(--app-danger)' : 'var(--app-text-faint)' }}>{note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1.25fr) minmax(320px, 1fr)' }}>
            <Panel title="Scenario comparison" checkpoints="J.1 – J.6"
                   sub="Risk retired against risk left on the table, all six scenarios">
              <div style={{ height: 240 }}>
                <Bar
                  data={compChart}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: true, position: 'bottom', labels: { color: t.legendColor, font: { size: 9.5 }, boxWidth: 10, padding: 12 } },
                      tooltip: chartTooltip(),
                    },
                    scales: {
                      x: { stacked: true, grid: { display: false }, ticks: { color: t.tickColor, font: { size: 8.5 } } },
                      y: { stacked: true, grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 } }, beginAtZero: true },
                    },
                  }}
                />
              </div>
            </Panel>

            <Panel title="What changed against baseline" checkpoints="J.1"
                   sub={`${fmtCr(DEFAULT_BUDGET_CR, 0)} approved plan as the reference`}>
              <div className="space-y-2.5">
                {[
                  ['Budget', fmtCr(baseline.budgetCr, 0), fmtCr(portfolio.budgetCr, 0)],
                  ['Projects funded', fmtInt(baseline.selected.length), fmtInt(portfolio.selected.length)],
                  ['Projects deferred', fmtInt(baseline.deferred.length), fmtInt(portfolio.deferred.length)],
                  ['Risk retired ₹ Cr/yr', baseline.riskBoughtDown.toFixed(1), portfolio.riskBoughtDown.toFixed(1)],
                  ['Deferred risk ₹ Cr/yr', baseline.residualRisk.toFixed(1), portfolio.residualRisk.toFixed(1)],
                  ['SAIDI change min/yr', baseline.saidiDelta.toFixed(0), portfolio.saidiDelta.toFixed(0)],
                ].map(([k, was, now]) => {
                  const changed = was !== now;
                  return (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <span className="text-[10.5px] flex-1 min-w-0 truncate" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                      <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)', fontVariantNumeric: 'tabular-nums', textDecoration: changed ? 'line-through' : 'none' }}>
                        {was}
                      </span>
                      <span style={{ color: 'var(--app-text-faint)', fontSize: 10 }}>→</span>
                      <span className="text-[11.5px] font-bold w-16 text-right" style={{ color: changed ? 'var(--app-info)' : 'var(--app-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {now}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="apm-formula mt-4" style={{ fontSize: 11.5 }}>
                Cutting the budget 20% defers <span className="val">{fmtInt(
                  optimisePortfolio(candidates, DEFAULT_BUDGET_CR * 0.8, { minCriticality: 0 }).deferred.length -
                  baseline.deferred.length
                )}</span> further projects and leaves{' '}
                <span className="res">₹{(
                  optimisePortfolio(candidates, DEFAULT_BUDGET_CR * 0.8, { minCriticality: 0 }).residualRisk -
                  baseline.residualRisk
                ).toFixed(1)} Cr/yr</span> of additional risk on the network.
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ═══ REGULATORY & ARR ═══════════════════════════════════════════ */}
      {tab === 'regulatory' && <RegulatoryTab portfolio={portfolio} baseline={baseline} />}
    </div>
  );
}

/* ═══ Section K — ARR, tariff and wheeling impact ════════════════════════ */
function RegulatoryTab({ portfolio, baseline }) {
  /* The regulated-return model lives in engines/regulatory.js so that the
     Section P submission pack quotes figures identical to this screen. */
  const { RoE, interest: INTEREST, depreciation: DEPRECIATION } = ARR_PARAMS;
  const arrModel = computeARR(portfolio.spend);
  const {
    capex, equity, debt, returnOnEquity, interestCost,
    depreciation, arr: arrImpact, tariffPaise: tariffImpact,
  } = arrModel;

  const rows = [
    ['Capital added to regulated asset base', fmtCr(capex, 1), 'Funded portfolio this control period'],
    ['Equity component (30%)', fmtCr(equity, 1), `Return at ${(RoE * 100).toFixed(2)}% RoE`],
    ['Debt component (70%)', fmtCr(debt, 1), `Interest at ${(INTEREST * 100).toFixed(2)}%`],
    ['Return on equity', fmtCr(returnOnEquity, 2), 'Annual'],
    ['Interest on loan capital', fmtCr(interestCost, 2), 'Annual'],
    ['Depreciation', fmtCr(depreciation, 2), `At ${(DEPRECIATION * 100).toFixed(2)}% straight line`],
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(380px, 1.3fr) minmax(310px, 1fr)' }}>
        <Panel title="Aggregate Revenue Requirement impact" checkpoints="K.1 · K.5"
               sub="Revenue requirement arising from the funded investment portfolio">
          <div className="space-y-2">
            {rows.map(([k, v, note]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-1">
                <div className="min-w-0">
                  <span className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>{k}</span>
                  <p className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{note}</p>
                </div>
                <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t border-app-border">
              <span className="text-[12px] font-bold" style={{ color: 'var(--app-text)' }}>Total ARR impact</span>
              <span className="text-[16px] font-bold" style={{ color: 'var(--app-warning)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtCr(arrImpact, 2)} / yr
              </span>
            </div>
          </div>

          <div className="apm-formula mt-4">
            Tariff impact <span className="op">=</span> ARR <span className="val">₹{arrImpact.toFixed(2)} Cr</span>
            <span className="op">÷</span> sales <span className="val">{fmtInt(ARR_PARAMS.salesMU)} MU</span>
            <span className="op">=</span> <span className="res">{tariffImpact.toFixed(2)} paise / kWh</span>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Regulatory justification" checkpoints="K.4 · K.6"
                 sub="Risk reduction valuation supporting the submission">
            <div className="space-y-2.5">
              {[
                ['Risk retired', `₹${portfolio.riskBoughtDown.toFixed(1)} Cr/yr`, 'good'],
                ['Cost of the programme', `₹${portfolio.spend.toFixed(1)} Cr`, null],
                ['Benefit-cost ratio', `${(portfolio.riskBoughtDown * 12 / Math.max(portfolio.spend, 1)).toFixed(2)}×`, 'good'],
                ['Consumers protected', fmtInt(portfolio.selected.reduce((s, c) => s + c.asset.impact.consumers, 0)), null],
                ['Tariff impact', `${tariffImpact.toFixed(2)} p/kWh`, 'warn'],
                ['Reliability gain', `${Math.abs(portfolio.saidiDelta).toFixed(0)} SAIDI min/yr`, 'good'],
              ].map(([k, v, tone]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                  <span className="text-[12px] font-bold" style={{
                    color: tone === 'good' ? 'var(--app-success)' : tone === 'warn' ? 'var(--app-warning)' : 'var(--app-text)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{v}</span>
                </div>
              ))}
            </div>

            <button
              className="app-btn w-full mt-4 px-3 py-2.5 text-[11px]"
              type="button"
              onClick={() => window.alert(
                'Regulatory investment justification pack\n\n' +
                `Capital: ₹${portfolio.spend.toFixed(1)} Cr\n` +
                `ARR impact: ₹${arrImpact.toFixed(2)} Cr/yr\n` +
                `Tariff impact: ${tariffImpact.toFixed(2)} paise/kWh\n` +
                `Risk retired: ₹${portfolio.riskBoughtDown.toFixed(1)} Cr/yr\n\n` +
                'PDF and Excel export are wired to the reporting service in the full build (Checkpoints P.5, P.6).'
              )}
            >
              Export Justification Pack
            </button>
          </Panel>

          <SimulatedNote>
            The ARR model uses indicative MERC parameters (15.56% RoE, 70:30 debt-equity, 5.28% depreciation) against a
            4,850 MU sales base. Actual control-period parameters and the true sales base are confirmed during
            Blueprinting and drawn from SAP FICO via the Grid Data Hub.
          </SimulatedNote>
        </div>
      </div>
    </div>
  );
}
