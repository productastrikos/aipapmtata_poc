import React from 'react';

/* ─── CSS-variable reader ─────────────────────────────────── */
export function getCSSVar(name) {
  if (typeof document === 'undefined') return '';
  const el = document.body || document.documentElement;
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/* ─── Snapshot of all chart colour tokens for the current theme ─ */
export function getChartTokens() {
  return {
    tooltipBg:     getCSSVar('--app-chart-tooltip-bg'),
    tooltipBorder: getCSSVar('--app-chart-tooltip-border'),
    tooltipTitle:  getCSSVar('--app-text'),
    tooltipBody:   getCSSVar('--app-text-muted'),
    gridColor:     getCSSVar('--app-chart-grid'),
    tickColor:     getCSSVar('--app-text-faint'),
    tickMuted:     getCSSVar('--app-text-muted'),
    legendColor:   getCSSVar('--app-text'),
    success:       getCSSVar('--app-success'),
    warning:       getCSSVar('--app-warning'),
    danger:        getCSSVar('--app-danger'),
    info:          getCSSVar('--app-info'),
    accent:        getCSSVar('--app-accent'),
    accentBg:      getCSSVar('--app-accent-bg'),
    violet:        getCSSVar('--app-violet'),
    violetBg:      getCSSVar('--app-violet-bg'),
    successBar:    getCSSVar('--app-success-bar'),
    warningBar:    getCSSVar('--app-warning-bar'),
    dangerBar:     getCSSVar('--app-danger-bar'),
  };
}

/* ─── Standard Chart.js tooltip config ───────────────────── */
export function chartTooltip(extra = {}) {
  const t = getChartTokens();
  return {
    backgroundColor: t.tooltipBg,
    borderColor:     t.tooltipBorder,
    borderWidth:     1,
    titleColor:      t.tooltipTitle,
    bodyColor:       t.tooltipBody,
    padding:         8,
    ...extra,
  };
}

/* ─── Standard Chart.js scales config ────────────────────── */
export function chartScales(overrides = {}) {
  const t = getChartTokens();
  return {
    x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9 } }, ...(overrides.x || {}) },
    y: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9 } }, ...(overrides.y || {}) },
  };
}

/* ─── Dynamic palette — reads CSS vars on every access ───── */
function buildPalettes() {
  const t = getChartTokens();
  return {
    categorical: [t.accent, t.info, '#14b8a6', '#f59e0b', '#ec4899', '#6366f1', '#a3e635', '#94a3b8'],
    area: {
      cyan:    { border: '#3b7de8',  fill: 'rgba(59, 125, 232, 0.15)' },
      blue:    { border: '#3b7de8',  fill: 'rgba(59, 125, 232, 0.15)' },
      violet:  { border: '#8b5cf6',  fill: 'rgba(139, 92, 246, 0.12)' },
      pink:    { border: '#ec4899',  fill: 'rgba(236, 72, 153, 0.10)' },
      emerald: { border: '#10b981',  fill: 'rgba(16, 185, 129, 0.12)' },
      amber:   { border: '#f59e0b',  fill: 'rgba(245, 158, 11, 0.12)' },
      slate:   { border: t.tickMuted, fill: getCSSVar('--app-surface-soft') },
    },
  };
}

/* CHART_PALETTES — Proxy so every property access reads current theme */
export const CHART_PALETTES = new Proxy({}, {
  get(_, key) { return buildPalettes()[key]; },
});

const LABEL_BUILDERS = {
  '12H': (n) => Array.from({ length: n }, (_, i) => `${String(Math.round((i / Math.max(n - 1, 1)) * 12)).padStart(2, '0')}:00`),
  '24H': (n) => Array.from({ length: n }, (_, i) => `${String(Math.round((i / Math.max(n - 1, 1)) * 23)).padStart(2, '0')}:00`),
  '7D':  (n) => Array.from({ length: n }, (_, i) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7]),
  '30D': (n) => Array.from({ length: n }, (_, i) => `D${i + 1}`),
};

/* ─── Standardised timeframe presets ──────────────────────────
 * Only 12H / 24H / 7D / 30D are permitted across the application.
 * Each preset is paired to the *kind* of metric whose health is
 * actually affected on that horizon:
 *   realtime → fast-moving operational telemetry (intra-day shifts)
 *   ops      → daily operational KPIs (collection, fleet, intake)
 *   trend    → medium-term performance & ESG trends
 */
export const TIMEFRAME_OPTIONS = {
  // Realtime / intra-day operations (e.g. WTE power output, fleet activity)
  realtime:    [
    { value: '12H', label: '12H', points: 12, dataWindow: 12 },
    { value: '24H', label: '24H', points: 24, dataWindow: null },
  ],
  // Daily operations rolling into the week (collection coverage, vehicle activity)
  ops:         [
    { value: '24H', label: '24H', points: 24, dataWindow: null },
    { value: '7D',  label: '7D',  points: 7,  dataWindow: null },
  ],
  // Medium-term trends (citizen feedback, weekly intake, recycling rate)
  trend:       [
    { value: '7D',  label: '7D',  points: 7,  dataWindow: 7  },
    { value: '30D', label: '30D', points: 30, dataWindow: null },
  ],
  // Strategic / ESG indicators (carbon, landfill capacity, sustainability)
  strategic:   [
    { value: '30D', label: '30D', points: 30, dataWindow: null },
  ],
  // Aliases — keep older imports working with sensible defaults
  intradayOps: [
    { value: '12H', label: '12H', points: 12, dataWindow: 12 },
    { value: '24H', label: '24H', points: 24, dataWindow: null },
  ],
  dailyOps: [
    { value: '24H', label: '24H', points: 24, dataWindow: null },
    { value: '7D',  label: '7D',  points: 7,  dataWindow: null },
  ],
  weekly: [
    { value: '7D',  label: '7D',  points: 7,  dataWindow: 7  },
    { value: '30D', label: '30D', points: 30, dataWindow: null },
  ],
  monthly: [
    { value: '7D',  label: '7D',  points: 7,  dataWindow: 7  },
    { value: '30D', label: '30D', points: 30, dataWindow: null },
  ],
};

/**
 * Pill-style timeframe selector matching the dashboard card header style.
 * Background, borders and text colours all derive from the active theme
 * tokens so the control reads the same in light and dark mode.
 */
export function ChartTimeframeControl({ options, value, onChange }) {
  if (!options || options.length < 2) return null;
  return (
    <div
      className="app-timeframe-control inline-flex items-center"
      role="tablist"
      aria-label="Time range"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`app-timeframe-btn ${active ? 'is-active' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function getTimeframeOption(options, value) {
  return options.find((opt) => opt.value === value) || options[0];
}

export function buildTimeframeLabels(timeframe, points) {
  return (LABEL_BUILDERS[timeframe] || LABEL_BUILDERS['24H'])(points);
}

export function resampleSeries(base, points) {
  if (!Array.isArray(base) || base.length === 0) return [];
  if (base.length === points) return base;
  if (points === 1) return [base[base.length - 1]];
  return Array.from({ length: points }, (_, i) => {
    const pos = (i / (points - 1)) * (base.length - 1);
    const lo  = Math.floor(pos);
    const hi  = Math.min(base.length - 1, Math.ceil(pos));
    const mix = pos - lo;
    return parseFloat((base[lo] + (base[hi] - base[lo]) * mix).toFixed(2));
  });
}

