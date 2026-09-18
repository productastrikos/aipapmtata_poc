/* Shared presentation primitives for the APM / AIP screens.
   Thin wrappers over the existing --app-* token system — no new colour
   decisions are made here, so both themes keep working. */

import React from 'react';
import { healthBand, riskBand } from '../engines/indices';

/* ─── Panel ─────────────────────────────────────────────────────────────── */
export function Panel({ title, sub, checkpoints, right, children, className = '', bodyClass = '', style }) {
  return (
    <div className={`bg-app-panel border border-app-border rounded-xl flex flex-col ${className}`} style={style}>
      {(title || right) && (
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-app-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="apm-card-title">{title}</span>
              {checkpoints && <span className="apm-checkpoint">{checkpoints}</span>}
            </div>
            {sub && <p className="apm-card-sub">{sub}</p>}
          </div>
          {right && <div className="flex-shrink-0">{right}</div>}
        </div>
      )}
      <div className={`flex-1 min-h-0 ${bodyClass || 'p-4'}`}>{children}</div>
    </div>
  );
}

/* ─── Page header ───────────────────────────────────────────────────────── */
export function PageHead({ eyebrow, title, sub, right }) {
  return (
    <div className="flex items-end gap-4 flex-wrap mb-4">
      <div className="min-w-0 flex-1">
        <p className="apm-eyebrow">{eyebrow}</p>
        <h1 className="text-[19px] font-bold tracking-tight mt-1" style={{ color: 'var(--app-text)' }}>{title}</h1>
        {sub && <p className="text-[11.5px] mt-1" style={{ color: 'var(--app-text-faint)', maxWidth: '76ch' }}>{sub}</p>}
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  );
}

/* ─── Health / risk pills ───────────────────────────────────────────────── */
export function HealthPill({ ahi }) {
  const b = healthBand(ahi);
  return (
    <span className="apm-pill" style={{ background: `${b.color}1f`, color: b.color, border: `1px solid ${b.color}55` }}>
      <span className="dot" style={{ background: b.color }} />
      {b.label}
    </span>
  );
}

export function RiskPill({ ari }) {
  const b = riskBand(ari);
  return (
    <span className="apm-pill" style={{ background: `${b.color}1f`, color: b.color, border: `1px solid ${b.color}55` }}>
      <span className="dot" style={{ background: b.color }} />
      {b.label}
    </span>
  );
}

/* ─── Horizontal bar used by the contribution waterfall ─────────────────── */
export function BarRow({ label, sublabel, pct, value, color }) {
  return (
    <div className="apm-waterfall-row">
      <div className="min-w-0">
        <div className="apm-waterfall-label truncate">{label}</div>
        {sublabel && <div className="text-[9.5px] truncate" style={{ color: 'var(--app-text-faint)' }}>{sublabel}</div>}
      </div>
      <div className="apm-waterfall-track">
        <div className="apm-waterfall-fill" style={{ width: `${Math.max(Math.min(pct, 100), 0)}%`, background: color }} />
      </div>
      <div className="apm-waterfall-value">{value}</div>
    </div>
  );
}

/* ─── Tab strip ─────────────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="apm-tabs mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`apm-tab ${active === t.key ? 'is-active' : ''}`}
          onClick={() => onChange(t.key)}
          type="button"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Demo-data disclosure ──────────────────────────────────────────────────
   Shown wherever a screen represents something that is simulated rather than
   connected. The playbook is explicit about this: a utility that catches a
   bidder overstating connectivity discounts everything else they showed. */
export function SimulatedNote({ children }) {
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-start gap-2"
      style={{ background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)' }}
    >
      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="var(--app-warning)" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>{children}</p>
    </div>
  );
}
