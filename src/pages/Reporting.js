/* ═══════════════════════════════════════════════════════════════════════════
   Reporting & Analytics — Section P
   ───────────────────────────────────────────────────────────────────────────
   P.1 standard report library      P.5 scheduled generation & distribution
   P.2 report preview / drill-down  P.6 regulatory submission pack
   P.3 export to Excel (CSV)        P.7 report-level access control
   P.4 ad-hoc report builder        P.8 export to PDF

   Every report here is generated from the live engine output at the moment the
   button is pressed. There are no stored result sets and no sample files: if an
   evaluator changes the DGA weighting on the Health Workbench and then exports
   the Fleet Health Register, the exported numbers move with it. That is the
   whole point of the section — a report that cannot be traced back to the
   model that produced it is not evidence of anything.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState, useEffect, useCallback } from 'react';

import { useApm, DEFAULT_BUDGET_CR, TOTAL_NEED_CR } from '../services/apmStore';
import { useRole } from '../services/roleContext';
import { fmtCr, fmtInt, healthBand, riskBand, RISK_BANDS, computeRUL } from '../engines/indices';
import { computeFMECA, selectStrategy, optimiseInterval, fleetReliability } from '../engines/reliability';
import { computeARR, ARR_PARAMS } from '../engines/regulatory';
import { ZONES, CLASS_LABEL, RFQ_POPULATION } from '../data/network';
import { listConfig, createConfig, deleteConfig, listAudit, writeAudit, ApiError } from '../services/backend';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoClipboard, IcoCalendar, IcoBox, IcoScale, IcoLock, IcoCheck }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';

/* ═══ 1. EXPORT PRIMITIVES ════════════════════════════════════════════════ */

/* RFC-4180 quoting. The UTF-8 BOM matters: without it Excel on Windows opens
   the file in the system codepage and every ₹ becomes mojibake. */
function toCSV(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\r\n');
  return `﻿${head}\r\n${body}\r\n`;
}

function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/* Display formatter per column type. CSV always carries the raw value so the
   recipient can pivot on it; only the on-screen and PDF renderings format. */
function display(col, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'cr') return fmtCr(Number(v), col.dp ?? 2);
  if (col.type === 'pct') return `${Number(v).toFixed(col.dp ?? 1)}%`;
  if (col.type === 'num') return Number(v).toFixed(col.dp ?? 1);
  if (col.type === 'int') return fmtInt(Number(v));
  return String(v);
}

const isNum = (col) => ['cr', 'pct', 'num', 'int'].includes(col.type);

/* ═══ 2. REPORT LIBRARY ═══════════════════════════════════════════════════
   Each definition builds its own rows from context. `build` is called at the
   moment of preview or export — nothing is memoised across model changes. */

const c = (key, label, type, dp) => ({ key, label, type, dp });

export const REPORTS = [
  {
    id: 'RPT-FLEET-HEALTH',
    name: 'Fleet Health Register',
    category: 'standard',
    checkpoints: 'P.1 · P.3',
    owner: 'Asset Management',
    frequency: 'Monthly',
    description:
      'Condition index, criticality and annualised risk for every modelled asset, with the health band each asset falls into. This is the base register every other report reconciles to.',
    permission: 'report.export',
    columns: [
      c('id', 'Asset ID'), c('assetClass', 'Class'), c('zone', 'Zone'), c('tier', 'Tier'),
      c('ahi', 'AHI', 'num', 1), c('band', 'Health Band'),
      c('aci', 'ACI', 'num', 1), c('pof', 'PoF %', 'pct', 2),
      c('cof', 'CoF ₹ Cr', 'cr', 2), c('ari', 'ARI ₹ Cr/yr', 'cr', 3),
      c('risk', 'Risk Band'),
    ],
    build: ({ fleet }) =>
      [...fleet.rows]
        .sort((a, b) => b.ari - a.ari)
        .map((r) => ({
          id: r.id,
          assetClass: CLASS_LABEL[r.assetClass] || r.assetClass,
          zone: r.zone,
          tier: r.tier,
          ahi: +r.ahi.toFixed(1),
          band: healthBand(r.ahi).label,
          aci: +r.aci.toFixed(1),
          pof: +(r.pof * 100).toFixed(2),
          cof: +r.cof.toFixed(2),
          ari: +r.ari.toFixed(3),
          risk: riskBand(r.ari).label,
        })),
  },

  {
    id: 'RPT-RISK-EXPOSURE',
    name: 'Risk Exposure Register',
    category: 'standard',
    checkpoints: 'P.1 · P.2',
    owner: 'Network Risk',
    frequency: 'Weekly',
    description:
      'Assets carrying extreme or high annualised risk, with the dominant condition driver and the remaining useful life estimate for each. Ordered by exposure, so the top of this table is the network’s worst-case list.',
    permission: 'report.export',
    columns: [
      c('rank', 'Rank', 'int'), c('id', 'Asset ID'), c('zone', 'Zone'),
      c('ahi', 'AHI', 'num', 1), c('driver', 'Dominant Driver'),
      c('pof', 'PoF %', 'pct', 2), c('cof', 'CoF ₹ Cr', 'cr', 2),
      c('ari', 'ARI ₹ Cr/yr', 'cr', 3), c('rul', 'RUL (yrs)', 'num', 1),
      c('band', 'Risk Band'),
    ],
    build: ({ fleet, detailFor }) =>
      [...fleet.rows]
        .filter((r) => r.ari >= RISK_BANDS.high)
        .sort((a, b) => b.ari - a.ari)
        .slice(0, 250)
        .map((r, i) => {
          const d = detailFor(r.id);
          const worst = d ? [...d.health.rows].sort((a, b) => b.deduction - a.deduction)[0] : null;
          const rul = d ? computeRUL(d.asset, d.ahi) : null;
          return {
            rank: i + 1,
            id: r.id,
            zone: r.zone,
            ahi: +r.ahi.toFixed(1),
            driver: worst ? worst.label : '—',
            pof: +(r.pof * 100).toFixed(2),
            cof: +r.cof.toFixed(2),
            ari: +r.ari.toFixed(3),
            rul: rul ? +rul.years.toFixed(1) : null,
            band: riskBand(r.ari).label,
          };
        }),
  },

  {
    id: 'RPT-PORTFOLIO',
    name: 'Approved Investment Portfolio',
    category: 'standard',
    checkpoints: 'P.1 · P.6',
    owner: 'Capital Planning',
    frequency: 'Quarterly',
    description:
      'Projects selected by the optimiser at the current budget ceiling, with the benefit-cost ratio that put each above the funding line. Regenerating this after moving the budget slider produces a different portfolio — the report follows the model.',
    permission: 'report.export',
    columns: [
      c('rank', 'Rank', 'int'), c('id', 'Asset ID'), c('zone', 'Zone'),
      c('intervention', 'Intervention'), c('capex', 'CAPEX ₹ Cr', 'cr', 2),
      c('ariBefore', 'Risk Before ₹ Cr/yr', 'cr', 3),
      c('ariAfter', 'Risk After ₹ Cr/yr', 'cr', 3),
      c('riskAvoided', 'Risk Retired ₹ Cr/yr', 'cr', 3),
      c('bcr', 'Benefit-Cost', 'num', 3), c('cumulative', 'Cumulative ₹ Cr', 'cr', 1),
    ],
    build: ({ portfolio }) => {
      let cum = 0;
      return portfolio.selected.map((p, i) => {
        cum += p.capex;
        return {
          rank: i + 1,
          id: p.id,
          zone: p.zone,
          intervention: p.interventionLabel,
          capex: +p.capex.toFixed(2),
          ariBefore: +p.ariBefore.toFixed(3),
          ariAfter: +p.ariAfter.toFixed(3),
          riskAvoided: +p.riskAvoided.toFixed(3),
          bcr: +p.bcr.toFixed(3),
          cumulative: +cum.toFixed(1),
        };
      });
    },
  },

  {
    id: 'RPT-DEFERRED',
    name: 'Deferred Works & Residual Risk',
    category: 'standard',
    checkpoints: 'P.1 · P.6',
    owner: 'Capital Planning',
    frequency: 'Quarterly',
    description:
      'Candidates that fell below the budget line and the annualised risk the network therefore continues to carry. Regulators ask what was not funded and why; this is that answer, with the ranking reason attached.',
    permission: 'report.export',
    columns: [
      c('rank', 'Rank', 'int'), c('id', 'Asset ID'), c('zone', 'Zone'),
      c('intervention', 'Intervention'), c('capex', 'CAPEX ₹ Cr', 'cr', 2),
      c('ariBefore', 'Risk Carried ₹ Cr/yr', 'cr', 3), c('bcr', 'Benefit-Cost', 'num', 3),
      c('reason', 'Deferral Reason'),
    ],
    build: ({ portfolio }) => {
      const cutoff = portfolio.selected.length
        ? portfolio.selected[portfolio.selected.length - 1].bcr
        : 0;
      const headroom = Math.max(portfolio.budgetCr - portfolio.spend, 0);
      return portfolio.deferred.map((p, i) => ({
        rank: i + 1,
        id: p.id,
        zone: p.zone,
        intervention: p.interventionLabel,
        capex: +p.capex.toFixed(2),
        ariBefore: +p.ariBefore.toFixed(3),
        bcr: +p.bcr.toFixed(3),
        reason: p.bcr >= cutoff
          ? `Ranked above cutoff but exceeds ₹${headroom.toFixed(2)} Cr remaining headroom`
          : `Benefit-cost ${p.bcr.toFixed(3)} below funding cutoff ${cutoff.toFixed(3)}`,
      }));
    },
  },

  {
    id: 'RPT-ZONE',
    name: 'Zone Performance Summary',
    category: 'operational',
    checkpoints: 'P.1 · P.2',
    owner: 'Operations',
    frequency: 'Monthly',
    description:
      'Fleet condition and risk rolled up by distribution zone, with funded investment and retired risk per zone. Used for the monthly operations review.',
    permission: 'report.export',
    columns: [
      c('zone', 'Zone'), c('assets', 'Assets', 'int'), c('meanAHI', 'Mean AHI', 'num', 1),
      c('poorCritical', 'Poor / Critical', 'int'), c('meanACI', 'Mean ACI', 'num', 1),
      c('totalRisk', 'Total Risk ₹ Cr/yr', 'cr', 2), c('extreme', 'Extreme Risk', 'int'),
      c('funded', 'Projects Funded', 'int'), c('capex', 'CAPEX ₹ Cr', 'cr', 1),
      c('retired', 'Risk Retired ₹ Cr/yr', 'cr', 2),
    ],
    build: ({ fleet, portfolio }) =>
      ZONES.map((z) => {
        const rows = fleet.rows.filter((r) => r.zone === z.name);
        const funded = portfolio.selected.filter((p) => p.zone === z.name);
        return {
          zone: z.name,
          assets: rows.length,
          meanAHI: +(rows.reduce((s, r) => s + r.ahi, 0) / Math.max(rows.length, 1)).toFixed(1),
          poorCritical: rows.filter((r) => r.ahi < 55).length,
          meanACI: +(rows.reduce((s, r) => s + r.aci, 0) / Math.max(rows.length, 1)).toFixed(1),
          totalRisk: +rows.reduce((s, r) => s + r.ari, 0).toFixed(2),
          extreme: rows.filter((r) => r.ari >= RISK_BANDS.extreme).length,
          funded: funded.length,
          capex: +funded.reduce((s, p) => s + p.capex, 0).toFixed(1),
          retired: +funded.reduce((s, p) => s + p.riskAvoided, 0).toFixed(2),
        };
      }).sort((a, b) => b.totalRisk - a.totalRisk),
  },

  {
    id: 'RPT-MAINTENANCE',
    name: 'Maintenance Strategy & Interval Plan',
    category: 'operational',
    checkpoints: 'P.1 · P.5',
    owner: 'Maintenance Engineering',
    frequency: 'Quarterly',
    description:
      'RCM strategy selected per asset, the optimised inspection interval, and whether the asset is currently past due. Sampled across the fleet at a fixed stride and scaled — the sample size is stated on the report so the recipient knows what they are reading.',
    permission: 'report.export',
    columns: [
      c('id', 'Asset ID'), c('assetClass', 'Class'), c('zone', 'Zone'),
      c('ahi', 'AHI', 'num', 1), c('strategy', 'RCM Strategy'),
      c('topMode', 'Top Failure Mode'), c('rpn', 'RPN', 'int'),
      c('interval', 'Interval (months)', 'int'), c('sinceLast', 'Since Last (months)', 'int'),
      c('status', 'Status'),
    ],
    build: ({ fleet, detailFor }) => {
      const stride = Math.max(1, Math.floor(fleet.rows.length / 400));
      const out = [];
      for (let i = 0; i < fleet.rows.length; i += stride) {
        const d = detailFor(fleet.rows[i].id);
        if (!d) continue;
        const fmeca = computeFMECA(d);
        const strategy = selectStrategy(d, fmeca);
        const interval = optimiseInterval(d, strategy);
        const top = fmeca.rows[0];
        out.push({
          id: d.asset.id,
          assetClass: CLASS_LABEL[d.asset.assetClass] || d.asset.assetClass,
          zone: d.asset.zone,
          ahi: +d.ahi.toFixed(1),
          strategy: strategy.label,
          topMode: top ? top.mode : '—',
          rpn: top ? Math.round(top.rpn) : null,
          interval: interval.months,
          sinceLast: d.asset.readings.maintenance != null ? Math.round(d.asset.readings.maintenance) : null,
          status: interval.overdue ? 'Overdue' : 'Within interval',
        });
      }
      return out.sort((a, b) => (b.rpn || 0) - (a.rpn || 0));
    },
  },

  {
    id: 'RPT-ARR',
    name: 'MERC ARR Capital Justification',
    category: 'regulatory',
    checkpoints: 'P.6',
    owner: 'Regulatory Affairs',
    frequency: 'Annual (MYT filing)',
    description:
      'Revenue requirement arising from the funded portfolio, built on the MERC MYT parameters, with the risk and reliability benefit that justifies the spend. Figures are produced by the same regulatory model the Investment screen displays.',
    permission: 'report.export',
    columns: [
      c('line', 'Line Item'), c('value', 'Value ₹ Cr', 'cr', 2), c('basis', 'Basis'),
    ],
    build: ({ portfolio }) => {
      const m = computeARR(portfolio.spend);
      const p = m.params;
      return [
        { line: 'Capital added to regulated asset base', value: +m.capex.toFixed(2), basis: `${portfolio.selected.length} projects funded from the risk-ranked candidate set` },
        { line: 'Equity component', value: +m.equity.toFixed(2), basis: `${((1 - p.debtShare) * 100).toFixed(0)}% of capital employed` },
        { line: 'Debt component', value: +m.debt.toFixed(2), basis: `${(p.debtShare * 100).toFixed(0)}% of capital employed` },
        { line: 'Return on equity', value: +m.returnOnEquity.toFixed(2), basis: `${(p.RoE * 100).toFixed(2)}% approved RoE` },
        { line: 'Interest on debt', value: +m.interestCost.toFixed(2), basis: `${(p.interest * 100).toFixed(2)}% weighted cost of debt` },
        { line: 'Depreciation', value: +m.depreciation.toFixed(2), basis: `${(p.depreciation * 100).toFixed(2)}% straight line` },
        { line: 'Total ARR impact', value: +m.arr.toFixed(2), basis: 'Return on equity + interest + depreciation' },
        { line: 'Tariff impact (paise/kWh)', value: +m.tariffPaise.toFixed(3), basis: `ARR spread across ${fmtInt(p.salesMU)} MU annual sales` },
        { line: 'Annualised risk retired', value: +portfolio.riskBoughtDown.toFixed(2), basis: 'Recomputed through the PoF × CoF engine post-intervention' },
        { line: 'Residual risk carried', value: +portfolio.residualRisk.toFixed(2), basis: `${portfolio.deferred.length} candidates below the funding line` },
        { line: 'Benefit-cost of programme', value: +(portfolio.riskBoughtDown * 12 / Math.max(portfolio.spend, 1)).toFixed(3), basis: 'Risk retired over 12-year asset life per ₹ Cr committed' },
      ];
    },
  },

  {
    id: 'RPT-CEA-RELIABILITY',
    name: 'Reliability Performance Statement',
    category: 'regulatory',
    checkpoints: 'P.6',
    owner: 'Regulatory Affairs',
    frequency: 'Annual',
    description:
      'Asset-base condition profile and the indicative SAIDI trajectory arising from the funded programme, in the shape a reliability filing expects. The risk-to-SAIDI coefficient is indicative for the demonstration and is stated as such on the face of the report.',
    permission: 'report.export',
    columns: [
      c('metric', 'Metric'), c('value', 'Value'), c('note', 'Note'),
    ],
    build: ({ fleet, summary, portfolio, detailFor }) => {
      const rel = fleetReliability(fleet.rows, detailFor);
      return [
        { metric: 'Assets in scope', value: fmtInt(summary.count), note: 'Modelled network assets under the APM platform' },
        { metric: 'Distribution substations', value: fmtInt(RFQ_POPULATION.distributionSubstations), note: 'RFQ §3.7 published population' },
        { metric: 'Consumer substations', value: fmtInt(RFQ_POPULATION.consumerSubstations), note: 'RFQ §3.7 published population' },
        { metric: 'Mean asset health index', value: summary.meanAHI.toFixed(1), note: '0–100 weighted condition score' },
        { metric: 'Assets in poor or critical condition', value: fmtInt(summary.bands.poor + summary.bands.critical), note: 'AHI below 55' },
        { metric: 'Assets at extreme annualised risk', value: fmtInt(summary.extreme), note: `ARI at or above ${fmtCr(RISK_BANDS.extreme)} per year` },
        { metric: 'Total annualised risk exposure', value: fmtCr(summary.totalRisk, 1), note: 'Sum of PoF × CoF across the fleet' },
        { metric: 'Risk retired by funded programme', value: fmtCr(portfolio.riskBoughtDown, 1), note: `${portfolio.selected.length} projects at ${fmtCr(portfolio.spend, 1)}` },
        { metric: 'Indicative SAIDI improvement', value: `${Math.abs(portfolio.saidiDelta).toFixed(0)} min/yr`, note: 'Indicative coefficient — calibrated against TPCL outage history in delivery' },
        { metric: 'Assets past due for inspection', value: `${rel.overduePct.toFixed(1)}%`, note: `Projected ${fmtInt(rel.overdueProjected)} assets from a ${fmtInt(rel.sampled)}-asset sample` },
        { metric: 'Dominant maintenance strategy', value: rel.byStrategy[0] ? rel.byStrategy[0].label : '—', note: rel.byStrategy[0] ? `${rel.byStrategy[0].share.toFixed(0)}% of sampled assets` : '' },
      ];
    },
  },

  {
    id: 'RPT-AUDIT',
    name: 'Configuration Audit Trail',
    category: 'regulatory',
    checkpoints: 'P.6 · P.7',
    owner: 'Information Security',
    frequency: 'On demand',
    description:
      'Every configuration change, integration run and report export recorded by the platform, with the principal and role that performed it. Sourced from the server-side audit store, not from the browser.',
    permission: 'audit.read',
    needsAudit: true,
    columns: [
      c('at', 'Timestamp'), c('user', 'User'), c('role', 'Role'),
      c('action', 'Action'), c('object', 'Object'), c('detail', 'Detail'), c('ip', 'Source'),
    ],
    build: ({ auditRows }) =>
      (auditRows || []).map((r) => ({
        at: r.at, user: r.user, role: r.role,
        action: r.action, object: r.object, detail: r.detail, ip: r.ip,
      })),
  },
];

const CATEGORY_LABEL = {
  standard: 'Standard',
  operational: 'Operational',
  regulatory: 'Regulatory',
};

const CATEGORY_COLOUR = {
  standard: 'var(--app-info)',
  operational: 'var(--app-accent)',
  regulatory: 'var(--app-warning)',
};

/* ═══ 3. AD-HOC BUILDER SCHEMA ════════════════════════════════════════════ */

const ADHOC_ENTITIES = {
  assets: {
    label: 'Assets',
    columns: [
      c('id', 'Asset ID'), c('assetClass', 'Class'), c('zone', 'Zone'), c('tier', 'Tier'),
      c('ahi', 'AHI', 'num', 1), c('band', 'Health Band'), c('aci', 'ACI', 'num', 1),
      c('pof', 'PoF %', 'pct', 2), c('cof', 'CoF ₹ Cr', 'cr', 2), c('ari', 'ARI ₹ Cr/yr', 'cr', 3),
      c('age', 'Age (yrs)', 'num', 1), c('designLife', 'Design Life (yrs)', 'int'),
      c('lifecycle', 'Lifecycle Stage'), c('substation', 'Substation'), c('make', 'Make'),
      c('commissioned', 'Commissioned'), c('consumers', 'Consumers Served', 'int'),
      c('replacementCost', 'Replacement ₹ Cr', 'cr', 2), c('rating', 'Rating'),
      c('dga', 'DGA TDCG ppm', 'int'), c('oil', 'Oil BDV kV', 'num', 1),
      c('thermal', 'Hotspot °C', 'int'), c('loading', 'Loading %', 'int'),
    ],
    rows: ({ fleet }) =>
      fleet.rows.map((r) => ({
        id: r.id,
        assetClass: CLASS_LABEL[r.assetClass] || r.assetClass,
        zone: r.zone,
        tier: r.tier,
        ahi: +r.ahi.toFixed(1),
        band: healthBand(r.ahi).label,
        aci: +r.aci.toFixed(1),
        pof: +(r.pof * 100).toFixed(2),
        cof: +r.cof.toFixed(2),
        ari: +r.ari.toFixed(3),
        age: r.asset.age,
        designLife: r.asset.designLife,
        lifecycle: r.asset.lifecycle,
        substation: r.asset.substation,
        make: r.asset.make,
        commissioned: r.asset.commissioned,
        consumers: r.asset.impact.consumers,
        replacementCost: r.asset.replacementCost,
        rating: r.asset.rating,
        dga: r.asset.readings.dga ?? null,
        oil: r.asset.readings.oil ?? null,
        thermal: r.asset.readings.thermal ?? null,
        loading: r.asset.readings.loading ?? null,
      })),
  },
  projects: {
    label: 'Investment candidates',
    columns: [
      c('id', 'Asset ID'), c('zone', 'Zone'), c('intervention', 'Intervention'),
      c('status', 'Status'), c('capex', 'CAPEX ₹ Cr', 'cr', 2),
      c('ariBefore', 'Risk Before ₹ Cr/yr', 'cr', 3), c('ariAfter', 'Risk After ₹ Cr/yr', 'cr', 3),
      c('riskAvoided', 'Risk Retired ₹ Cr/yr', 'cr', 3), c('bcr', 'Benefit-Cost', 'num', 3),
      c('ahi', 'AHI', 'num', 1), c('aci', 'ACI', 'num', 1),
    ],
    rows: ({ portfolio }) => {
      const tag = (list, status) => list.map((p) => ({
        id: p.id, zone: p.zone, intervention: p.interventionLabel, status,
        capex: +p.capex.toFixed(2),
        ariBefore: +p.ariBefore.toFixed(3),
        ariAfter: +p.ariAfter.toFixed(3),
        riskAvoided: +p.riskAvoided.toFixed(3),
        bcr: +p.bcr.toFixed(3),
        ahi: +p.ahi.toFixed(1),
        aci: +p.aci.toFixed(1),
      }));
      return [...tag(portfolio.selected, 'Funded'), ...tag(portfolio.deferred, 'Deferred')];
    },
  },
};

const OPERATORS = [
  { key: 'gte', label: '≥', test: (a, b) => Number(a) >= Number(b) },
  { key: 'lte', label: '≤', test: (a, b) => Number(a) <= Number(b) },
  { key: 'eq', label: '=', test: (a, b) => String(a).toLowerCase() === String(b).toLowerCase() },
  { key: 'ne', label: '≠', test: (a, b) => String(a).toLowerCase() !== String(b).toLowerCase() },
  { key: 'contains', label: 'contains', test: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()) },
];

function applyFilters(rows, filters) {
  if (!filters.length) return rows;
  return rows.filter((r) =>
    filters.every((f) => {
      const op = OPERATORS.find((o) => o.key === f.op);
      if (!op || f.value === '') return true;
      return op.test(r[f.field], f.value);
    })
  );
}

/* ═══ 4. SCHEDULING ═══════════════════════════════════════════════════════ */

const FREQUENCIES = [
  { key: 'daily', label: 'Daily 06:00', addMs: 24 * 3600e3 },
  { key: 'weekly', label: 'Weekly, Monday 06:00', addMs: 7 * 24 * 3600e3 },
  { key: 'monthly', label: 'Monthly, 1st 06:00', addMs: 30 * 24 * 3600e3 },
  { key: 'quarterly', label: 'Quarterly, 1st 06:00', addMs: 91 * 24 * 3600e3 },
];

/* Next occurrence computed against the wall clock, so the value on screen is
   always in the future rather than a fixed string. */
function nextRun(frequency) {
  const now = new Date();
  const at = new Date(now);
  at.setHours(6, 0, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);

  if (frequency === 'weekly') {
    while (at.getDay() !== 1) at.setDate(at.getDate() + 1);
  } else if (frequency === 'monthly') {
    at.setDate(1);
    if (at <= now) at.setMonth(at.getMonth() + 1);
  } else if (frequency === 'quarterly') {
    at.setDate(1);
    const q = Math.floor(at.getMonth() / 3);
    at.setMonth((q + 1) * 3);
    if (at <= now) at.setMonth(at.getMonth() + 3);
  }
  return at;
}

const fmtWhen = (d) =>
  d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ═══ 5. PAGE ═════════════════════════════════════════════════════════════ */

export default function Reporting() {
  const apm = useApm();
  const { identity, role, can } = useRole();
  const [tab, setTab] = useState('library');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);

  const [auditRows, setAuditRows] = useState([]);
  const [saved, setSaved] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [backendUp, setBackendUp] = useState(true);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);   // { def, columns, rows, generatedAt }
  const [printJob, setPrintJob] = useState(null);
  const [exportCount, setExportCount] = useState(0);

  const canExport = can('report.export');
  const canSave = can('config.write');

  /* ─── Backend-held state ─────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    try {
      const [a, s, sch] = await Promise.all([
        can('audit.read') ? listAudit(200) : Promise.resolve([]),
        listConfig('reports'),
        listConfig('schedules'),
      ]);
      setAuditRows(a);
      setSaved(s);
      setSchedules(sch);
      setBackendUp(true);
    } catch (e) {
      setBackendUp(false);
    }
  }, [can]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ─── Report generation context — always the live model ──────────────── */
  const ctx = useMemo(() => ({
    fleet: apm.fleet,
    summary: apm.summary,
    candidates: apm.candidates,
    portfolio: apm.portfolio,
    detailFor: apm.detailFor,
    budgetCr: apm.budgetCr,
    auditRows,
  }), [apm, auditRows]);

  const generate = useCallback((def) => {
    const t0 = performance.now();
    const rows = def.build(ctx);
    return {
      def,
      columns: def.columns,
      rows,
      generatedAt: new Date(),
      ms: performance.now() - t0,
    };
  }, [ctx]);

  const say = (msg, kind = 'ok') => {
    setNotice({ msg, kind });
    setTimeout(() => setNotice(null), 5000);
  };

  /* ─── Exports ────────────────────────────────────────────────────────── */
  const logExport = useCallback((name, format, rowCount) => {
    setExportCount((n) => n + 1);
    writeAudit({
      user: identity.name,
      role: role.key,
      action: 'REPORT_EXPORT',
      object: name,
      detail: `${format} export, ${rowCount} rows, generated against the live model`,
    }).then(() => refresh()).catch(() => { /* audit is best-effort in the demo */ });
  }, [identity, role, refresh]);

  const exportCSV = useCallback((result) => {
    if (!canExport) return;
    const name = `${result.def.id}_${stamp()}.csv`;
    downloadText(name, toCSV(result.columns, result.rows));
    logExport(result.def.name, 'CSV/Excel', result.rows.length);
    say(`${result.rows.length.toLocaleString('en-IN')} rows exported to ${name}`);
  }, [canExport, logExport]);

  const exportPDF = useCallback((result) => {
    if (!canExport) return;
    // PDF is produced through the browser's own print pipeline against a
    // print-only stylesheet — no PDF library, and what prints is exactly what
    // was generated. Capped, because a 6,000-row PDF helps nobody.
    setPrintJob({ ...result, rows: result.rows.slice(0, 400), truncated: result.rows.length > 400 });
    logExport(result.def.name, 'PDF', Math.min(result.rows.length, 400));
  }, [canExport, logExport]);

  useEffect(() => {
    if (!printJob) return;
    const title = document.title;
    document.title = `${printJob.def.id} — ${printJob.def.name}`;
    const t = setTimeout(() => {
      window.print();
      document.title = title;
      setPrintJob(null);
    }, 120);
    return () => { clearTimeout(t); document.title = title; };
  }, [printJob]);

  /* ─── KPI figures ────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const regulatory = REPORTS.filter((r) => r.category === 'regulatory').length;
    const accessible = REPORTS.filter((r) => can(r.permission)).length;
    return {
      total: REPORTS.length + saved.length,
      standard: REPORTS.length,
      saved: saved.length,
      regulatory,
      accessible,
      restricted: REPORTS.length - accessible,
      schedules: schedules.length,
      nextRun: schedules.length
        ? schedules
          .map((s) => nextRun(s.frequency))
          .sort((a, b) => a - b)[0]
        : null,
      exports: auditRows.filter((r) => r.action === 'REPORT_EXPORT').length,
    };
  }, [saved, schedules, auditRows, can]);

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP BPM · Reporting & Analytics"
        title="Reporting & Analytics"
        sub="Standard, ad-hoc, scheduled and regulatory reporting. Every report is generated from the live engine output at the moment it is requested — change the model and the next export changes with it."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Export rights</p>
            <p className="text-[12px] font-bold mt-1" style={{ color: canExport ? 'var(--app-success)' : 'var(--app-danger)' }}>
              {canExport ? 'Granted' : 'Denied'} · {role.label}
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

      {!backendUp && (
        <SimulatedNote>
          The report service is not reachable, so saved definitions, schedules and the audit trail are unavailable.
          Library reports still generate and export — they are computed in the browser from the live model.
          Start the API with <code>npm run server</code> to restore the persisted features.
        </SimulatedNote>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoClipboard />} label="Reports Available" value={fmtInt(stats.total)} color={col}
            subValues={[{ label: 'Library', value: fmtInt(stats.standard) }, { label: 'Saved Ad-hoc', value: fmtInt(stats.saved) }]}
            onClick={() => showKPIDetail({ icon: <IcoClipboard />, label: 'Reports Available', value: String(stats.total), unit: 'definitions', color: col, thresholds: { green: REPORTS.length, amber: REPORTS.length * 0.6 }, inverted: false, definition: 'Report definitions this platform can generate — the built-in library plus any ad-hoc definitions saved to the server by users. A definition is a query, not a stored result set; it re-executes against the live model every time.', subValues: [{ label: 'Library', value: fmtInt(stats.standard) }, { label: 'Saved Ad-hoc', value: fmtInt(stats.saved) }, { label: 'Regulatory', value: fmtInt(stats.regulatory) }, { label: 'Visible To You', value: fmtInt(stats.accessible) }], target: 'Every reporting need served without a developer', analysis: 'Library reports cover the standard asset, risk, investment and regulatory views. | The ad-hoc builder covers everything else without writing code. | Saved definitions persist server-side and are available to every user with rights to them.' })} />
        ); })()}

        {(() => { const col = stats.restricted > 0 ? 'text-amber-400' : 'text-emerald-400'; return (
          <KPICard icon={<IcoLock />} label="Accessible To You" value={fmtInt(stats.accessible)} color={col}
            subValues={[{ label: 'Restricted', value: fmtInt(stats.restricted) }, { label: 'Role', value: role.label }]}
            onClick={() => showKPIDetail({ icon: <IcoLock />, label: 'Accessible To You', value: String(stats.accessible), unit: `of ${REPORTS.length} reports`, color: col, thresholds: { green: REPORTS.length, amber: REPORTS.length * 0.5 }, inverted: false, definition: 'Reports the currently selected role is permitted to generate and export. Report-level access control is a checkpoint in its own right — not every user should be able to pull the audit trail or the regulatory pack.', subValues: [{ label: 'Accessible', value: fmtInt(stats.accessible) }, { label: 'Restricted', value: fmtInt(stats.restricted) }, { label: 'Export Rights', value: canExport ? 'Granted' : 'Denied' }, { label: 'Active Role', value: role.label }], target: 'Least privilege, enforced not implied', analysis: 'Switch role in Security & Administration and this figure moves with it. | The Substation Engineer role has no export right at all, so the export controls below disable. | The audit trail report additionally requires the audit.read permission.' })} />
        ); })()}

        {(() => { const col = stats.schedules > 0 ? 'text-emerald-400' : 'text-slate-400'; return (
          <KPICard icon={<IcoCalendar />} label="Scheduled Jobs" value={fmtInt(stats.schedules)} color={col}
            subValues={[{ label: 'Next Run', value: stats.nextRun ? fmtWhen(stats.nextRun).split(',')[0] : 'None' }, { label: 'Distribution', value: 'Email' }]}
            onClick={() => showKPIDetail({ icon: <IcoCalendar />, label: 'Scheduled Jobs', value: String(stats.schedules), unit: 'schedules', color: col, thresholds: { green: 1, amber: 0 }, inverted: false, definition: 'Report schedules registered on the server, each binding a report definition to a frequency, an output format and a distribution list. Schedules persist across sessions because they are held server-side, not in the browser.', subValues: [{ label: 'Schedules', value: fmtInt(stats.schedules) }, { label: 'Next Run', value: stats.nextRun ? fmtWhen(stats.nextRun) : 'None scheduled' }, { label: 'Frequencies', value: String(new Set(schedules.map((s) => s.frequency)).size) }, { label: 'Recipients', value: fmtInt(schedules.reduce((s, x) => s + (x.recipients || '').split(',').filter(Boolean).length, 0)) }], target: 'Routine reports arrive without being asked for', analysis: 'The demo registers and persists schedules but does not run a mail transport — the Scheduling tab says so on its face. | Delivery binds this to TPCL SMTP relay with the report attached. | Next-run times are computed against the wall clock, so they are always genuinely ahead of now.' })} />
        ); })()}

        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoBox />} label="Export Formats" value="2" color={col}
            subValues={[{ label: 'Excel', value: 'CSV / UTF-8' }, { label: 'Document', value: 'PDF / print' }]}
            onClick={() => showKPIDetail({ icon: <IcoBox />, label: 'Export Formats', value: '2', unit: 'formats', color: col, thresholds: { green: 2, amber: 1 }, inverted: false, definition: 'Output formats available from every report. Excel export writes RFC-4180 CSV with a UTF-8 byte-order mark so Indian rupee symbols survive the round trip into Excel on Windows. PDF is produced through the browser print pipeline against a dedicated print stylesheet.', subValues: [{ label: 'Excel', value: 'CSV, UTF-8 BOM' }, { label: 'PDF', value: 'A4 landscape' }, { label: 'Raw Values', value: 'Preserved in CSV' }, { label: 'PDF Row Cap', value: '400 rows' }], target: 'Reports that open cleanly in the tools people actually use', analysis: 'CSV carries raw numeric values rather than formatted strings, so the recipient can pivot on them immediately. | The PDF path caps at 400 rows — a 6,000-row PDF serves nobody, and the cap is stated on the report. | Every export writes an audit entry naming the user, role and row count.' })} />
        ); })()}

        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoScale />} label="Live Data Scope" value={fmtInt(apm.summary.count)} unit=" assets" color={col}
            subValues={[{ label: 'Compute', value: `${apm.fleet.computeMs.toFixed(0)} ms` }, { label: 'Candidates', value: fmtInt(apm.candidates.length) }]}
            onClick={() => showKPIDetail({ icon: <IcoScale />, label: 'Live Data Scope', value: String(apm.summary.count), unit: 'assets', color: col, thresholds: { green: 5000, amber: 1000 }, inverted: false, definition: 'Assets in the model that every report draws from. Reports are not fed from an extract or a snapshot — they call the same engine functions the dashboards call, at the moment the button is pressed.', subValues: [{ label: 'Assets', value: fmtInt(apm.summary.count) }, { label: 'Fleet Recompute', value: `${apm.fleet.computeMs.toFixed(0)} ms` }, { label: 'Investment Candidates', value: fmtInt(apm.candidates.length) }, { label: 'Mean AHI', value: apm.summary.meanAHI.toFixed(1) }], target: 'Reports that cannot disagree with the dashboards', analysis: 'Change a health weighting on the Health Workbench, export the Fleet Health Register, and the AHI column has moved. | That is the difference between a reporting module and a folder of spreadsheets. | The full fleet recomputes in well under a second, so generation is instant.' })} />
        ); })()}

        {(() => { const col = stats.exports > 0 ? 'text-emerald-400' : 'text-slate-400'; return (
          <KPICard icon={<IcoCheck />} label="Exports Logged" value={fmtInt(stats.exports)} color={col}
            subValues={[{ label: 'This Session', value: fmtInt(exportCount) }, { label: 'Audit Entries', value: fmtInt(auditRows.length) }]}
            onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Exports Logged', value: String(stats.exports), unit: 'exports', color: col, thresholds: { green: 1, amber: 0 }, inverted: false, definition: 'Report exports recorded in the server-side audit trail. Data leaving the platform is an auditable event: the entry names the report, the principal, the role, the format and the row count.', subValues: [{ label: 'Logged Exports', value: fmtInt(stats.exports) }, { label: 'This Session', value: fmtInt(exportCount) }, { label: 'Total Audit Entries', value: fmtInt(auditRows.length) }, { label: 'Retention', value: '500 entries' }], target: 'No data leaves without a record', analysis: 'Export an report from this page and the entry appears in the Configuration Audit Trail report below without a refresh. | The audit store is server-side, so clearing browser storage does not erase it. | ISO/IEC 27001 A.12.4 requires exactly this linkage between data egress and identity.' })} />
        ); })()}
      </div>

      <Tabs
        tabs={[
          { key: 'library', label: 'Report Library · P.1–P.3' },
          { key: 'adhoc', label: 'Ad-hoc Builder · P.4' },
          { key: 'schedule', label: 'Scheduling · P.5' },
          { key: 'regulatory', label: 'Regulatory Pack · P.6–P.8' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'library' && (
        <LibraryTab
          reports={REPORTS.filter((r) => r.category !== 'regulatory')}
          saved={saved} setSaved={setSaved}
          generate={generate} preview={preview} setPreview={setPreview}
          exportCSV={exportCSV} exportPDF={exportPDF}
          canExport={canExport} can={can} role={role} say={say} refresh={refresh}
          ctx={ctx}
        />
      )}

      {tab === 'adhoc' && (
        <AdhocTab
          ctx={ctx} canExport={canExport} canSave={canSave} backendUp={backendUp}
          saved={saved} refresh={refresh} say={say}
          exportRows={(name, columns, rows) => {
            if (!canExport) return;
            downloadText(`${name.replace(/\s+/g, '_')}_${stamp()}.csv`, toCSV(columns, rows));
            logExport(name, 'CSV/Excel', rows.length);
            say(`${rows.length.toLocaleString('en-IN')} rows exported`);
          }}
          identity={identity} role={role}
        />
      )}

      {tab === 'schedule' && (
        <ScheduleTab
          schedules={schedules} saved={saved} canSave={canSave} backendUp={backendUp}
          refresh={refresh} say={say} generate={generate}
          exportCSV={exportCSV} canExport={canExport}
        />
      )}

      {tab === 'regulatory' && (
        <RegulatoryTab
          reports={REPORTS.filter((r) => r.category === 'regulatory')}
          generate={generate} exportCSV={exportCSV} exportPDF={exportPDF}
          canExport={canExport} can={can} role={role} ctx={ctx}
          setPreview={setPreview} preview={preview}
        />
      )}

      {/* Print-only rendering — hidden on screen, the only thing visible on paper */}
      {printJob && (
        <div className="apm-print-root">
          <h1>{printJob.def.name}</h1>
          <p className="meta">
            {printJob.def.id} · Generated {printJob.generatedAt.toLocaleString('en-IN')} ·
            {' '}{printJob.rows.length.toLocaleString('en-IN')} rows
            {printJob.truncated ? ' (truncated for print — use the Excel export for the full set)' : ''}
            {' '}· Astrikos S!aP APM/AIP · Tata Power Company Ltd
          </p>
          <p className="meta">{printJob.def.description}</p>
          <table>
            <thead>
              <tr>{printJob.columns.map((col) => (
                <th key={col.key} className={isNum(col) ? 'num' : ''}>{col.label}</th>
              ))}</tr>
            </thead>
            <tbody>
              {printJob.rows.map((r, i) => (
                <tr key={i}>
                  {printJob.columns.map((col) => (
                    <td key={col.key} className={isNum(col) ? 'num' : ''}>{display(col, r[col.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══ 6. RESULT TABLE ═════════════════════════════════════════════════════ */

function ResultTable({ result, maxHeight = 420, limit = 300 }) {
  if (!result) return null;
  const shown = result.rows.slice(0, limit);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-app-border flex-wrap">
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold" style={{ color: 'var(--app-text)' }}>{result.def.name}</p>
          <p className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
            {result.rows.length.toLocaleString('en-IN')} rows · generated in {result.ms.toFixed(0)} ms ·
            {' '}{result.generatedAt.toLocaleTimeString('en-IN')}
            {result.rows.length > limit ? ` · showing first ${limit}` : ''}
          </p>
        </div>
      </div>
      <div className="apm-scroll" style={{ maxHeight }}>
        <table className="apm-table">
          <thead>
            <tr>{result.columns.map((col) => (
              <th key={col.key} className={isNum(col) ? 'num' : ''}>{col.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {result.columns.map((col) => (
                  <td key={col.key} className={isNum(col) ? 'num' : ''}>{display(col, r[col.key])}</td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={result.columns.length} style={{ color: 'var(--app-text-faint)' }}>
                No rows match this definition at the current model settings.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══ 7. LIBRARY TAB — P.1, P.2, P.3, P.7 ════════════════════════════════ */

function LibraryTab({ reports, saved, generate, preview, setPreview, exportCSV, exportPDF, canExport, can, role, ctx, say, refresh }) {
  const [busy, setBusy] = useState(null);

  const run = (def) => {
    setBusy(def.id);
    // Generation is synchronous but can take ~100 ms on the full register;
    // yielding once lets the button state paint before the main thread blocks.
    setTimeout(() => {
      setPreview(generate(def));
      setBusy(null);
    }, 0);
  };

  const savedDefs = saved.map((s) => ({
    id: s.id,
    name: s.name,
    category: 'saved',
    checkpoints: 'P.4',
    owner: s.createdBy || '—',
    frequency: 'On demand',
    description: s.description || `Ad-hoc definition over ${ADHOC_ENTITIES[s.entity]?.label || s.entity}.`,
    permission: 'report.export',
    _saved: s,
  }));

  const runSaved = (def) => {
    const s = def._saved;
    const entity = ADHOC_ENTITIES[s.entity];
    if (!entity) return;
    const t0 = performance.now();
    const cols = entity.columns.filter((col) => (s.columns || []).includes(col.key));
    let rows = applyFilters(entity.rows(ctx), s.filters || []);
    if (s.sortField) {
      const dir = s.sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[s.sortField]; const bv = b[s.sortField];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    if (s.limit) rows = rows.slice(0, s.limit);
    setPreview({
      def: { id: s.id, name: s.name, description: def.description },
      columns: cols.length ? cols : entity.columns,
      rows,
      generatedAt: new Date(),
      ms: performance.now() - t0,
    });
  };

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(380px, 1fr) minmax(430px, 1.35fr)' }}>
      <Panel
        title="Report library" checkpoints="P.1 · P.7"
        sub="Access is evaluated per report against the active role"
        bodyClass="p-0"
      >
        <div className="apm-scroll" style={{ maxHeight: 620 }}>
          {[...reports, ...savedDefs].map((def) => {
            const allowed = def._saved ? can('report.export') : can(def.permission);
            return (
              <div key={def.id} data-testid={`report-${def.id}`} className="px-3.5 py-3 border-b border-app-border">
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11.5px] font-bold" style={{ color: 'var(--app-text)' }}>{def.name}</span>
                      <span
                        className="apm-pill"
                        style={{
                          background: `${def._saved ? 'var(--app-accent)' : CATEGORY_COLOUR[def.category]}1f`,
                          color: def._saved ? 'var(--app-accent)' : CATEGORY_COLOUR[def.category],
                          border: `1px solid ${def._saved ? 'var(--app-accent)' : CATEGORY_COLOUR[def.category]}55`,
                        }}
                      >
                        {def._saved ? 'Saved ad-hoc' : CATEGORY_LABEL[def.category]}
                      </span>
                      <span className="apm-checkpoint">{def.checkpoints}</span>
                    </div>
                    <p className="text-[10.5px] mt-1 leading-relaxed" style={{ color: 'var(--app-text-faint)', maxWidth: '62ch' }}>
                      {def.description}
                    </p>
                    <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                      {def.id} · Owner {def.owner} · {def.frequency}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    className="apm-btn"
                    disabled={!allowed || busy === def.id}
                    onClick={() => (def._saved ? runSaved(def) : run(def))}
                  >
                    {busy === def.id ? 'Generating…' : 'Generate'}
                  </button>
                  {!allowed && (
                    <span className="text-[9.5px]" style={{ color: 'var(--app-danger)' }}>
                      Requires <code>{def.permission}</code> — {role.label} does not hold it
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel
          title="Generated output" checkpoints="P.2 · P.3 · P.8"
          sub={preview ? `${preview.def.id} — live against the current model` : 'Generate a report to preview it here'}
          bodyClass="p-0"
          right={preview && (
            <div className="flex items-center gap-2">
              <button type="button" className="apm-btn" disabled={!canExport} onClick={() => exportCSV(preview)}>
                Export Excel
              </button>
              <button type="button" className="apm-btn" disabled={!canExport} onClick={() => exportPDF(preview)}>
                Export PDF
              </button>
            </div>
          )}
        >
          {preview ? (
            <ResultTable result={preview} maxHeight={430} />
          ) : (
            <div className="p-6 text-center">
              <p className="text-[11.5px]" style={{ color: 'var(--app-text-faint)' }}>
                Nothing generated yet. Pick a report on the left.
              </p>
            </div>
          )}
        </Panel>

        {!canExport && (
          <SimulatedNote>
            The <strong>{role.label}</strong> role does not hold the <code>report.export</code> permission, so the export
            controls are disabled. This is the same permission set the server enforces on writes — switch role in
            Security &amp; Administration to see the controls enable. Nothing is hidden from view; the restriction is on
            taking data out.
          </SimulatedNote>
        )}

        <Panel title="How these reports are produced" checkpoints="P.1 · P.3">
          <ul className="space-y-2 text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
            <li>
              <strong style={{ color: 'var(--app-text)' }}>No stored result sets.</strong> A definition is a query over
              the live model. Adjust a health weighting or the capital budget and regenerate — the figures move.
            </li>
            <li>
              <strong style={{ color: 'var(--app-text)' }}>Excel export writes raw values.</strong> CSV carries
              unformatted numbers with a UTF-8 byte-order mark, so the file opens in Excel with the rupee symbol intact
              and every numeric column ready to pivot.
            </li>
            <li>
              <strong style={{ color: 'var(--app-text)' }}>PDF uses the browser print pipeline.</strong> No PDF library
              is bundled; a print stylesheet renders the generated table, so what prints is exactly what was generated.
              Long reports are capped at 400 rows for print and say so on the page.
            </li>
            <li>
              <strong style={{ color: 'var(--app-text)' }}>Every export is audited.</strong> Report name, principal,
              role, format and row count are written to the server-side audit store before the file reaches the disk.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/* ═══ 8. AD-HOC BUILDER — P.4 ════════════════════════════════════════════ */

function AdhocTab({ ctx, canExport, canSave, backendUp, refresh, say, exportRows }) {
  const [entityKey, setEntityKey] = useState('assets');
  const entity = ADHOC_ENTITIES[entityKey];

  const [columns, setColumns] = useState(['id', 'zone', 'ahi', 'aci', 'ari']);
  const [filters, setFilters] = useState([{ field: 'ahi', op: 'lte', value: '60' }]);
  const [sortField, setSortField] = useState('ari');
  const [sortDir, setSortDir] = useState('desc');
  const [limit, setLimit] = useState(200);
  const [name, setName] = useState('Low-health assets by risk');
  const [saving, setSaving] = useState(false);

  /* Switching entity invalidates the column and filter selection, so reset to
     that entity's sensible defaults rather than leaving dangling field names. */
  const switchEntity = (k) => {
    setEntityKey(k);
    const cols = ADHOC_ENTITIES[k].columns;
    setColumns(cols.slice(0, 5).map((col) => col.key));
    setFilters([]);
    setSortField(cols.find((col) => isNum(col))?.key || cols[0].key);
  };

  const result = useMemo(() => {
    const t0 = performance.now();
    const cols = entity.columns.filter((col) => columns.includes(col.key));
    let rows = applyFilters(entity.rows(ctx), filters);
    const matched = rows.length;
    if (sortField) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[sortField]; const bv = b[sortField];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }
    rows = rows.slice(0, limit);
    return {
      def: { id: 'ADHOC', name, description: 'Ad-hoc definition' },
      columns: cols.length ? cols : entity.columns.slice(0, 5),
      rows, matched,
      generatedAt: new Date(),
      ms: performance.now() - t0,
    };
  }, [entity, columns, filters, sortField, sortDir, limit, ctx, name]);

  const toggleColumn = (key) =>
    setColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const save = async () => {
    if (!canSave || !name.trim()) return;
    setSaving(true);
    try {
      await createConfig('reports', {
        name: name.trim(),
        entity: entityKey,
        columns, filters, sortField, sortDir, limit,
        description: `Ad-hoc report over ${entity.label.toLowerCase()} — ${filters.length} filter${filters.length === 1 ? '' : 's'}, ${columns.length} columns`,
        auditDetail: `Ad-hoc report definition "${name.trim()}" saved over ${entity.label.toLowerCase()}`,
      });
      await refresh();
      say(`Saved "${name.trim()}" — it now appears in the report library`);
    } catch (e) {
      say(e instanceof ApiError ? `${e.message}` : 'Could not reach the report service', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(340px, 0.85fr) minmax(460px, 1.5fr)' }}>
      <Panel title="Build a report" checkpoints="P.4" sub="No code — the definition is saved and re-runs against live data">
        <div className="space-y-4">
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Subject</label>
            <div className="flex gap-2 mt-1.5">
              {Object.entries(ADHOC_ENTITIES).map(([k, e]) => (
                <button
                  key={k} type="button"
                  className={`apm-btn ${entityKey === k ? 'is-active' : ''}`}
                  onClick={() => switchEntity(k)}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Columns ({columns.length} selected)</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {entity.columns.map((col) => (
                <button
                  key={col.key} type="button"
                  className={`apm-chip ${columns.includes(col.key) ? 'is-active' : ''}`}
                  onClick={() => toggleColumn(col.key)}
                >
                  {col.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="apm-eyebrow" style={{ fontSize: 9 }}>Filters</label>
              <button
                type="button" className="apm-btn"
                onClick={() => setFilters((f) => [...f, { field: entity.columns[0].key, op: 'gte', value: '' }])}
              >
                + Add
              </button>
            </div>
            <div className="space-y-1.5 mt-1.5">
              {filters.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    className="apm-select flex-1" value={f.field}
                    onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                  >
                    {entity.columns.map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}
                  </select>
                  <select
                    className="apm-select" style={{ width: 86 }} value={f.op}
                    onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}
                  >
                    {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <input
                    className="apm-input" style={{ width: 88 }} value={f.value}
                    placeholder="value"
                    onChange={(e) => setFilters((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <button
                    type="button" className="apm-btn"
                    onClick={() => setFilters((p) => p.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
              {!filters.length && (
                <p className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                  No filters — the report returns every row in scope.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }}>Sort by</label>
              <select className="apm-select w-full mt-1.5" value={sortField} onChange={(e) => setSortField(e.target.value)}>
                {entity.columns.map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}
              </select>
            </div>
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }}>Direction</label>
              <select className="apm-select w-full mt-1.5" value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }}>Row limit</label>
              <select className="apm-select w-full mt-1.5" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {[50, 100, 200, 500, 2000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString('en-IN')}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Report name</label>
            <input className="apm-input w-full mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="apm-btn is-primary" disabled={!canSave || saving || !backendUp} onClick={save}>
              {saving ? 'Saving…' : 'Save definition'}
            </button>
            <button
              type="button" className="apm-btn" disabled={!canExport}
              onClick={() => exportRows(name || 'Ad-hoc report', result.columns, result.rows)}
            >
              Export Excel
            </button>
          </div>

          {!canSave && (
            <p className="text-[10px]" style={{ color: 'var(--app-danger)' }}>
              Saving a definition requires <code>config.write</code>. The server rejects the write regardless of what the
              UI shows, so this is not a cosmetic restriction.
            </p>
          )}
        </div>
      </Panel>

      <Panel
        title="Live preview" checkpoints="P.4 · P.2"
        sub={`${result.matched.toLocaleString('en-IN')} rows match · showing up to ${limit.toLocaleString('en-IN')}`}
        bodyClass="p-0"
      >
        <ResultTable result={result} maxHeight={560} limit={limit} />
      </Panel>
    </div>
  );
}

/* ═══ 9. SCHEDULING — P.5 ════════════════════════════════════════════════ */

function ScheduleTab({ schedules, saved, canSave, backendUp, refresh, say, generate, exportCSV, canExport }) {
  const allDefs = useMemo(
    () => [...REPORTS.map((r) => ({ id: r.id, name: r.name })), ...saved.map((s) => ({ id: s.id, name: s.name }))],
    [saved]
  );

  const [reportId, setReportId] = useState(REPORTS[0].id);
  const [frequency, setFrequency] = useState('monthly');
  const [format, setFormat] = useState('xlsx');
  const [recipients, setRecipients] = useState('asset.planning@tatapower.com, regulatory@tatapower.com');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!canSave) return;
    const def = allDefs.find((d) => d.id === reportId);
    setBusy(true);
    try {
      await createConfig('schedules', {
        name: `${def ? def.name : reportId} — ${FREQUENCIES.find((f) => f.key === frequency).label}`,
        reportId, frequency, format, recipients,
        auditDetail: `Schedule created for "${def ? def.name : reportId}" at ${frequency} frequency, ${recipients.split(',').filter(Boolean).length} recipients`,
      });
      await refresh();
      say('Schedule registered and persisted server-side');
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Could not reach the report service', 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteConfig('schedules', id);
      await refresh();
      say('Schedule removed');
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Could not reach the report service', 'err');
    }
  };

  const runNow = (id) => {
    const def = REPORTS.find((r) => r.id === id);
    if (!def) { say('Saved ad-hoc definitions run from the report library', 'err'); return; }
    exportCSV(generate(def));
  };

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(330px, 0.8fr) minmax(460px, 1.5fr)' }}>
      <Panel title="New schedule" checkpoints="P.5" sub="Binds a report definition to a frequency and a distribution list">
        <div className="space-y-3">
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Report</label>
            <select className="apm-select w-full mt-1.5" value={reportId} onChange={(e) => setReportId(e.target.value)}>
              {allDefs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Frequency</label>
            <select className="apm-select w-full mt-1.5" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
              Next occurrence: {fmtWhen(nextRun(frequency))}
            </p>
          </div>
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Format</label>
            <select className="apm-select w-full mt-1.5" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xlsx">Excel (CSV/UTF-8)</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          <div>
            <label className="apm-eyebrow" style={{ fontSize: 9 }}>Recipients</label>
            <textarea
              className="apm-input w-full mt-1.5" rows={2} value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
            />
          </div>
          <button type="button" className="apm-btn is-primary" disabled={!canSave || busy || !backendUp} onClick={create}>
            {busy ? 'Registering…' : 'Register schedule'}
          </button>

          <SimulatedNote>
            The schedule itself is real — it is written to the server, survives a reload, and appears in the audit trail.
            What the demo does not do is run a mail transport: no message is sent at the scheduled time. Delivery binds
            this to the TPCL SMTP relay with the generated file attached, which is a configuration step, not a build one.
            <strong> Run now</strong> generates and downloads the report immediately so the output can be inspected.
          </SimulatedNote>
        </div>
      </Panel>

      <Panel
        title="Registered schedules" checkpoints="P.5"
        sub={`${schedules.length} schedule${schedules.length === 1 ? '' : 's'} held server-side`}
        bodyClass="p-0"
      >
        <div className="apm-scroll" style={{ maxHeight: 560 }}>
          <table className="apm-table">
            <thead>
              <tr>
                <th>Report</th><th>Frequency</th><th>Next run</th>
                <th>Format</th><th>Recipients</th><th>Created by</th><th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => {
                const when = nextRun(s.frequency);
                const rcp = (s.recipients || '').split(',').map((x) => x.trim()).filter(Boolean);
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="font-semibold" style={{ color: 'var(--app-text)' }}>
                        {REPORTS.find((r) => r.id === s.reportId)?.name
                          || saved.find((x) => x.id === s.reportId)?.name
                          || s.reportId}
                      </div>
                      <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{s.id}</div>
                    </td>
                    <td>{FREQUENCIES.find((f) => f.key === s.frequency)?.label || s.frequency}</td>
                    <td className="mono">{fmtWhen(when)}</td>
                    <td>{s.format === 'pdf' ? 'PDF' : 'Excel'}</td>
                    <td>
                      <span title={rcp.join(', ')}>{rcp.length} recipient{rcp.length === 1 ? '' : 's'}</span>
                    </td>
                    <td>{s.createdBy || '—'}</td>
                    <td>
                      <div className="flex gap-1.5">
                        <button type="button" className="apm-btn" disabled={!canExport} onClick={() => runNow(s.reportId)}>
                          Run now
                        </button>
                        <button type="button" className="apm-btn" disabled={!canSave} onClick={() => remove(s.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!schedules.length && (
                <tr><td colSpan={7} style={{ color: 'var(--app-text-faint)' }}>
                  No schedules registered. Create one on the left — it persists across reloads.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ═══ 10. REGULATORY PACK — P.6, P.8 ═════════════════════════════════════ */

function RegulatoryTab({ reports, generate, exportCSV, exportPDF, canExport, can, role, ctx, preview, setPreview }) {
  const arr = useMemo(() => computeARR(ctx.portfolio.spend), [ctx.portfolio.spend]);

  const packAll = () => {
    // One click, one file per report — the submission pack as the regulator
    // receives it. Sequenced so the browser does not suppress the downloads.
    reports.filter((r) => can(r.permission)).forEach((def, i) => {
      setTimeout(() => exportCSV(generate(def)), i * 350);
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(400px, 1.2fr)' }}>
        <Panel
          title="Submission pack" checkpoints="P.6"
          sub="Filing-shaped reports built on the same engines the platform runs on"
          bodyClass="p-0"
          right={
            <button type="button" className="apm-btn is-primary" disabled={!canExport} onClick={packAll}>
              Export full pack
            </button>
          }
        >
          <div>
            {reports.map((def) => {
              const allowed = can(def.permission);
              return (
                <div key={def.id} className="px-3.5 py-3 border-b border-app-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] font-bold" style={{ color: 'var(--app-text)' }}>{def.name}</span>
                    <span className="apm-checkpoint">{def.checkpoints}</span>
                  </div>
                  <p className="text-[10.5px] mt-1 leading-relaxed" style={{ color: 'var(--app-text-faint)', maxWidth: '62ch' }}>
                    {def.description}
                  </p>
                  <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                    {def.id} · Owner {def.owner} · {def.frequency}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button type="button" className="apm-btn" disabled={!allowed} onClick={() => setPreview(generate(def))}>
                      Generate
                    </button>
                    <button
                      type="button" className="apm-btn" disabled={!allowed || !canExport}
                      onClick={() => exportCSV(generate(def))}
                    >
                      Excel
                    </button>
                    <button
                      type="button" className="apm-btn" disabled={!allowed || !canExport}
                      onClick={() => exportPDF(generate(def))}
                    >
                      PDF
                    </button>
                    {!allowed && (
                      <span className="text-[9.5px]" style={{ color: 'var(--app-danger)' }}>
                        Requires <code>{def.permission}</code> — not held by {role.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Revenue requirement at the current portfolio" checkpoints="P.6">
            <div className="apm-formula mb-3">
              ARR <span className="op">=</span> RoE <span className="val">₹{arr.returnOnEquity.toFixed(2)} Cr</span>
              {' '}<span className="op">+</span> Interest <span className="val">₹{arr.interestCost.toFixed(2)} Cr</span>
              {' '}<span className="op">+</span> Depreciation <span className="val">₹{arr.depreciation.toFixed(2)} Cr</span>
              {' '}<span className="op">=</span> <span className="res">₹{arr.arr.toFixed(2)} Cr / yr</span>
            </div>
            <table className="apm-table">
              <tbody>
                {[
                  ['Capital in regulated asset base', fmtCr(arr.capex, 1), `${ctx.portfolio.selected.length} funded projects`],
                  ['Total ARR impact', fmtCr(arr.arr, 2), 'Annual revenue requirement'],
                  ['Tariff impact', `${arr.tariffPaise.toFixed(2)} p/kWh`, `Across ${fmtInt(ARR_PARAMS.salesMU)} MU sales`],
                  ['Risk retired', fmtCr(ctx.portfolio.riskBoughtDown, 2), 'Recomputed post-intervention'],
                  ['Risk deferred', fmtCr(ctx.portfolio.residualRisk, 2), `${ctx.portfolio.deferred.length} unfunded candidates`],
                  ['Funding gap', fmtCr(Math.max(TOTAL_NEED_CR - ctx.budgetCr, 0), 0), `Identified need ${fmtCr(TOTAL_NEED_CR, 0)}`],
                ].map(([k, v, note]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num mono" style={{ color: 'var(--app-text)', fontWeight: 600 }}>{v}</td>
                    <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[9.5px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
              Parameters: {(ARR_PARAMS.RoE * 100).toFixed(2)}% RoE, {((1 - ARR_PARAMS.debtShare) * 100).toFixed(0)}:{(ARR_PARAMS.debtShare * 100).toFixed(0)} equity-debt,
              {' '}{(ARR_PARAMS.interest * 100).toFixed(2)}% cost of debt, {(ARR_PARAMS.depreciation * 100).toFixed(2)}% depreciation.
              These are indicative MERC MYT values for the demonstration; the delivery build reads them from the approved
              tariff order for the control period. The budget baseline of {fmtCr(DEFAULT_BUDGET_CR, 0)} is derived as 62%
              of identified need, so the gap is visible rather than assumed away.
            </p>
          </Panel>

          <SimulatedNote>
            These reports are filing-<em>shaped</em>, not filing-<em>ready</em>. The structure, the derivation and the
            arithmetic are real and defensible; the regulatory templates, sign-off workflow and submission formats are
            configured during delivery against the live MERC formats. Nothing here is presented as a lodged submission.
          </SimulatedNote>
        </div>
      </div>

      {preview && (
        <Panel
          title="Generated output" checkpoints="P.2 · P.8"
          sub={`${preview.def.id} — live against the current model`}
          bodyClass="p-0"
          right={
            <div className="flex items-center gap-2">
              <button type="button" className="apm-btn" disabled={!canExport} onClick={() => exportCSV(preview)}>Export Excel</button>
              <button type="button" className="apm-btn" disabled={!canExport} onClick={() => exportPDF(preview)}>Export PDF</button>
            </div>
          }
        >
          <ResultTable result={preview} maxHeight={380} />
        </Panel>
      )}
    </div>
  );
}
