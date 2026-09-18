/* ═══════════════════════════════════════════════════════════════════════════
   Digital twin and bulk upload — Checkpoints B.4 and B.8
   ───────────────────────────────────────────────────────────────────────────
   Two capabilities the registry was asserting rather than showing.

   DigitalTwin renders the equipment itself, with each component coloured by the
   condition parameter that actually describes it — the radiator bank takes its
   colour from the hotspot reading, the tank from oil quality, the bushings from
   partial discharge. Hovering a component says which parameter drives it and
   what that parameter is reading now, so the picture is a view onto the data
   rather than a decoration beside it.

   BulkUpload parses real CSV, applies real validation rules, and rejects rows
   with the field, the value and the rule that failed. The rejection path is the
   part worth demonstrating: anyone can show a file uploading.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState, useRef } from 'react';
import { linScore, paramsFor, healthBand } from '../engines/indices';
import { CLASS_LABEL, ZONES, ASSET_BY_ID } from '../data/network';

/* ═══ 1. DIGITAL TWIN — B.4 ═══════════════════════════════════════════════ */

/* Which condition parameter governs which physical component. This mapping is
   the whole point of the twin: an engineer looking at a hot radiator bank
   should be able to name the reading that made it hot. */
const TWIN_PARTS = {
  power_transformer: [
    { id: 'conservator', label: 'Conservator & Buchholz', param: 'oil', note: 'Oil volume, breather and gas relay' },
    { id: 'tank', label: 'Main tank & core', param: 'dga', note: 'Dissolved gas in the insulating oil' },
    { id: 'radiators', label: 'Radiator bank', param: 'thermal', note: 'Cooling capacity against winding hotspot' },
    { id: 'hvBushing', label: 'HV bushings', param: 'pd', note: 'Partial discharge at the HV terminations' },
    { id: 'lvBushing', label: 'LV bushings', param: 'pd', note: 'Partial discharge at the LV terminations' },
    { id: 'tapChanger', label: 'On-load tap changer', param: 'maintenance', note: 'Contact wear accrues with operations since overhaul' },
    { id: 'windings', label: 'Windings', param: 'loading', note: 'Loading against nameplate rating' },
  ],
  circuit_breaker: [
    { id: 'interrupter', label: 'Interrupter chamber', param: 'contactWear', note: 'Contact erosion from switching duty' },
    { id: 'tank', label: 'SF6 enclosure', param: 'gasPressure', note: 'Gas density against the lockout threshold' },
    { id: 'mechanism', label: 'Operating mechanism', param: 'tripTime', note: 'Trip coil timing against specification' },
    { id: 'hvBushing', label: 'Line bushings', param: 'operations', note: 'Cumulative operation count' },
    { id: 'lvBushing', label: 'Load bushings', param: 'operations', note: 'Cumulative operation count' },
    { id: 'tapChanger', label: 'Control cubicle', param: 'maintenance', note: 'Months since last service' },
  ],
  rmu: [
    { id: 'tank', label: 'Switchgear enclosure', param: 'insulation', note: 'Insulation resistance' },
    { id: 'radiators', label: 'Busbar chamber', param: 'thermal', note: 'Enclosure temperature' },
    { id: 'hvBushing', label: 'Incomer', param: 'operations', note: 'Switching operations' },
    { id: 'lvBushing', label: 'Outgoing ways', param: 'operations', note: 'Switching operations' },
    { id: 'mechanism', label: 'Moisture ingress', param: 'moisture', note: 'Relative humidity inside the enclosure' },
  ],
};

function scoreColour(score) {
  if (score == null) return '#475569';
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#65a30d';
  if (score >= 55) return '#d97706';
  if (score >= 40) return '#ea580c';
  return '#dc2626';
}

export function DigitalTwin({ asset, health }) {
  const [hover, setHover] = useState(null);

  const parts = useMemo(() => {
    const defs = TWIN_PARTS[asset.assetClass] || TWIN_PARTS.power_transformer;
    const params = paramsFor(asset.assetClass);
    return defs.map((d) => {
      const param = params.find((p) => p.key === d.param);
      const raw = asset.readings[d.param];
      const score = param && raw != null ? linScore(raw, param.good, param.bad) : null;
      return {
        ...d,
        param,
        raw,
        score,
        colour: scoreColour(score),
        unit: param ? param.unit : '',
      };
    });
  }, [asset]);

  const byId = useMemo(() => Object.fromEntries(parts.map((p) => [p.id, p])), [parts]);
  const fill = (id) => (byId[id] ? byId[id].colour : '#475569');
  const active = hover ? byId[hover] : null;

  const partProps = (id) => ({
    fill: fill(id),
    fillOpacity: hover === id ? 0.95 : 0.72,
    stroke: hover === id ? '#e2e8f0' : fill(id),
    strokeWidth: hover === id ? 1.8 : 0.8,
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    style: { cursor: 'pointer', transition: 'fill-opacity 0.15s' },
  });

  const band = healthBand(health.ahi);

  return (
    <div>
      <div className="flex gap-3 flex-wrap">
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <svg viewBox="0 0 260 200" style={{ width: '100%', height: 'auto', maxHeight: 230 }} role="img"
               aria-label={`Digital twin schematic of ${asset.id}`}>
            {/* Plinth */}
            <rect x="24" y="176" width="212" height="6" rx="1" fill="#1e293b" stroke="#334155" strokeWidth="0.8" />

            {/* Radiator bank — left */}
            <g {...partProps('radiators')}>
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={30 + i * 9} y="78" width="6" height="86" rx="1.5" />
              ))}
            </g>
            {/* Radiator bank — right */}
            <g {...partProps('radiators')}>
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={188 + i * 9} y="78" width="6" height="86" rx="1.5" />
              ))}
            </g>

            {/* Main tank */}
            <rect x="74" y="72" width="112" height="94" rx="4" {...partProps('tank')} />

            {/* Windings inside the tank */}
            <g {...partProps('windings')}>
              <rect x="88" y="90" width="18" height="58" rx="2" />
              <rect x="121" y="90" width="18" height="58" rx="2" />
              <rect x="154" y="90" width="18" height="58" rx="2" />
            </g>

            {/* Conservator */}
            <g {...partProps('conservator')}>
              <rect x="92" y="44" width="76" height="18" rx="9" />
            </g>
            <line x1="130" y1="62" x2="130" y2="72" stroke="#64748b" strokeWidth="2" />

            {/* HV bushings */}
            <g {...partProps('hvBushing')}>
              {[92, 112].map((x) => (
                <g key={x}>
                  <rect x={x - 4} y="20" width="8" height="24" rx="2" />
                  <ellipse cx={x} cy="18" rx="7" ry="3" />
                </g>
              ))}
            </g>

            {/* LV bushings */}
            <g {...partProps('lvBushing')}>
              {[152, 170].map((x) => (
                <g key={x}>
                  <rect x={x - 3} y="26" width="6" height="18" rx="2" />
                  <ellipse cx={x} cy="24" rx="5.5" ry="2.5" />
                </g>
              ))}
            </g>

            {/* Tap changer / mechanism cabinet */}
            <g {...partProps(byId.tapChanger ? 'tapChanger' : 'mechanism')}>
              <rect x="186" y="118" width="22" height="48" rx="2" />
            </g>

            {/* Interrupter / mechanism marker for non-transformer classes */}
            {byId.interrupter && (
              <g {...partProps('interrupter')}>
                <circle cx="130" cy="119" r="15" />
              </g>
            )}

            {/* Labels */}
            <text x="130" y="194" textAnchor="middle" fontSize="8" fill="var(--app-text-faint)">
              {asset.rating}
            </text>
          </svg>
        </div>

        <div style={{ flex: '1 1 210px', minWidth: 200 }}>
          <div
            className="rounded-lg px-3 py-2 mb-2"
            style={{ background: `${band.color}14`, border: `1px solid ${band.color}44` }}
          >
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Live condition</p>
            <p className="text-[19px] font-bold mono" style={{ color: band.color }}>
              {health.ahi.toFixed(1)}
              <span className="text-[10px] font-semibold ml-1.5">{band.label}</span>
            </p>
          </div>

          <div
            className="rounded-lg px-3 py-2"
            style={{
              background: 'var(--app-surface-soft)',
              border: `1px solid ${active ? active.colour : 'var(--app-border)'}`,
              minHeight: 92,
            }}
          >
            {active ? (
              <>
                <p className="text-[11px] font-bold" style={{ color: active.colour }}>{active.label}</p>
                <p className="text-[9.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
                  {active.note}
                </p>
                <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                  <span className="text-[14px] font-bold mono" style={{ color: 'var(--app-text)' }}>
                    {active.raw != null ? active.raw : '—'}
                  </span>
                  <span className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{active.unit}</span>
                  {active.score != null && (
                    <span className="text-[10px] mono ml-auto" style={{ color: active.colour }}>
                      {active.score.toFixed(0)}/100
                    </span>
                  )}
                </div>
                {active.param && (
                  <p className="text-[9px] mt-1 mono" style={{ color: 'var(--app-text-faint)' }}>
                    good ≤ {active.param.good} · bad ≥ {active.param.bad} · weight {(active.param.weight * 100).toFixed(0)}%
                  </p>
                )}
              </>
            ) : (
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
                Hover a component. Each one is coloured by the condition parameter that governs it, so the schematic is
                a view onto the same readings the health index is computed from — not an illustration beside them.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-app-border">
        {parts.map((p) => (
          <button
            key={p.id + p.label}
            type="button"
            className="apm-chip"
            style={{
              borderColor: hover === p.id ? p.colour : 'var(--app-border)',
              color: hover === p.id ? p.colour : 'var(--app-text-faint)',
            }}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
          >
            <span style={{ color: p.colour }}>●</span> {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══ 2. BULK UPLOAD — B.8 ════════════════════════════════════════════════ */

/* The validation rules are the deliverable here. A bulk-upload demo that
   accepts everything proves nothing; what a utility needs to see is what
   happens to the row where someone typed the oil BDV in millivolts. */

const UPLOAD_COLUMNS = [
  { key: 'assetId', label: 'assetId', required: true, rule: 'Pattern PREFIX-NNNNN, unique within the file and not already registered' },
  { key: 'assetClass', label: 'assetClass', required: true, rule: `One of ${Object.keys(CLASS_LABEL).join(', ')}` },
  { key: 'zone', label: 'zone', required: true, rule: `One of ${ZONES.map((z) => z.name).join(', ')}` },
  { key: 'substation', label: 'substation', required: true, rule: 'Free text, 3–60 characters' },
  { key: 'make', label: 'make', required: true, rule: 'Free text, 2–40 characters' },
  { key: 'commissioned', label: 'commissioned', required: true, rule: 'Integer year between 1950 and the current year' },
  { key: 'designLife', label: 'designLife', required: true, rule: 'Integer 5–60 years' },
  { key: 'rating', label: 'rating', required: true, rule: 'Free text nameplate rating' },
  { key: 'replacementCost', label: 'replacementCost', required: true, rule: 'Numeric ₹ Cr, greater than 0 and below 100' },
  { key: 'dga', label: 'dga', required: false, rule: 'Transformers only. Numeric ppm TDCG, 0–10000' },
  { key: 'oil', label: 'oil', required: false, rule: 'Transformers only. Numeric kV BDV per IEC 60156, 5–90' },
  { key: 'thermal', label: 'thermal', required: false, rule: 'Numeric °C, 20–160' },
  { key: 'loading', label: 'loading', required: false, rule: 'Numeric % of rated, 0–200' },
];

const TEMPLATE_ROWS = [
  'TR-DSS-101,power_transformer,Dharavi,Dharavi Receiving Station,BHEL,2004,35,50 MVA · 220/22 kV,8.40,620,58,71,68',
  'TR-DSS-102,power_transformer,Bandra,Bandra Receiving Station,ABB,1996,35,63 MVA · 220/22 kV,9.80,1880,41,92,84',
  'CB-2201,circuit_breaker,Andheri,Andheri Switching Station,Siemens,2011,28,220 kV,0.62,,,63,',
];

export function buildTemplate() {
  return `${UPLOAD_COLUMNS.map((c) => c.label).join(',')}\r\n${TEMPLATE_ROWS.join('\r\n')}\r\n`;
}

/* Minimal RFC-4180 reader — handles quoted fields and embedded commas, which
   is the difference between a parser and a split(','). */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function validateUpload(text) {
  const grid = parseCSV(text);
  if (!grid.length) {
    return { header: [], accepted: [], rejected: [], fatal: 'The file is empty.' };
  }

  const header = grid[0].map((h) => h.trim());
  const missing = UPLOAD_COLUMNS.filter((c) => c.required && !header.includes(c.label)).map((c) => c.label);
  if (missing.length) {
    return {
      header, accepted: [], rejected: [],
      fatal: `Header is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the expected shape.`,
    };
  }

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const seen = new Set();
  const accepted = [];
  const rejected = [];
  const thisYear = new Date().getFullYear();

  grid.slice(1).forEach((cells, i) => {
    const lineNo = i + 2;   // 1-based, plus the header
    const get = (k) => (idx[k] != null ? (cells[idx[k]] || '').trim() : '');
    const errors = [];
    const fail = (field, value, rule) => errors.push({ field, value: value === '' ? '(empty)' : value, rule });

    const id = get('assetId');
    if (!id) fail('assetId', id, 'Required');
    else if (!/^[A-Z]{2,4}(-[A-Z0-9]+)+$/.test(id)) fail('assetId', id, 'Must match PREFIX-SEGMENT, uppercase');
    else if (seen.has(id)) fail('assetId', id, 'Duplicate within this file');
    else if (ASSET_BY_ID[id]) fail('assetId', id, 'Already present in the register — use the update interface');
    seen.add(id);

    const cls = get('assetClass');
    if (!CLASS_LABEL[cls]) fail('assetClass', cls, `Must be one of ${Object.keys(CLASS_LABEL).join(', ')}`);

    const zone = get('zone');
    if (!ZONES.some((z) => z.name === zone)) fail('zone', zone, 'Not a known distribution zone');

    const sub = get('substation');
    if (sub.length < 3 || sub.length > 60) fail('substation', sub, 'Between 3 and 60 characters');

    const make = get('make');
    if (make.length < 2 || make.length > 40) fail('make', make, 'Between 2 and 40 characters');

    const commissioned = num(get('commissioned'));
    if (commissioned === null || !Number.isInteger(commissioned)) fail('commissioned', get('commissioned'), 'Integer year required');
    else if (commissioned < 1950 || commissioned > thisYear) fail('commissioned', String(commissioned), `Between 1950 and ${thisYear}`);

    const life = num(get('designLife'));
    if (life === null) fail('designLife', get('designLife'), 'Numeric years required');
    else if (life < 5 || life > 60) fail('designLife', String(life), 'Between 5 and 60 years');

    if (!get('rating')) fail('rating', '', 'Required');

    const cost = num(get('replacementCost'));
    if (cost === null) fail('replacementCost', get('replacementCost'), 'Numeric ₹ Cr required');
    else if (cost <= 0 || cost >= 100) fail('replacementCost', String(cost), 'Must be greater than 0 and below 100 ₹ Cr');

    /* Condition parameters are class-conditional: a DGA reading on a circuit
       breaker is a mapping error, not a value error, and should be caught as one. */
    const dga = num(get('dga'));
    if (get('dga') !== '') {
      if (cls !== 'power_transformer') fail('dga', get('dga'), 'Dissolved gas applies to transformers only');
      else if (dga === null || dga < 0 || dga > 10000) fail('dga', get('dga'), 'Numeric ppm between 0 and 10000');
    }

    const oil = num(get('oil'));
    if (get('oil') !== '') {
      if (cls !== 'power_transformer') fail('oil', get('oil'), 'Oil BDV applies to transformers only');
      else if (oil === null || oil < 5 || oil > 90) fail('oil', get('oil'), 'kV per IEC 60156, between 5 and 90 — check the unit');
    }

    const thermal = num(get('thermal'));
    if (get('thermal') !== '' && (thermal === null || thermal < 20 || thermal > 160)) {
      fail('thermal', get('thermal'), 'Numeric °C between 20 and 160');
    }

    const loading = num(get('loading'));
    if (get('loading') !== '' && (loading === null || loading < 0 || loading > 200)) {
      fail('loading', get('loading'), 'Numeric % of rated between 0 and 200');
    }

    const record = {
      line: lineNo, assetId: id, assetClass: cls, zone, substation: sub, make,
      commissioned, designLife: life, rating: get('rating'), replacementCost: cost,
      dga, oil, thermal, loading,
    };

    if (errors.length) rejected.push({ ...record, errors });
    else accepted.push(record);
  });

  return { header, accepted, rejected, fatal: null, total: accepted.length + rejected.length };
}

export function BulkUpload({ onClose, onCommit, canWrite, roleLabel }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef(null);

  const download = () => {
    const blob = new Blob([`﻿${buildTemplate()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'asset_register_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const readFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '').replace(/^﻿/, '');
      setText(content);
      setResult(validateUpload(content));
    };
    reader.readAsText(f);
  };

  const validate = () => setResult(validateUpload(text.replace(/^﻿/, '')));

  const loadSample = () => {
    /* Deliberately includes the failure modes a real TPCL extract produces:
       a duplicate ID, an oil reading in the wrong unit, a DGA value on a
       breaker, an out-of-range commissioning year and a missing cost. */
    const sample = [
      UPLOAD_COLUMNS.map((c) => c.label).join(','),
      'TR-DSS-101,power_transformer,Dharavi,Dharavi Receiving Station,BHEL,2004,35,50 MVA · 220/22 kV,8.40,620,58,71,68',
      'TR-DSS-102,power_transformer,Bandra,Bandra Receiving Station,ABB,1996,35,63 MVA · 220/22 kV,9.80,1880,41,92,84',
      'TR-DSS-102,power_transformer,Bandra,Bandra Receiving Station,ABB,1996,35,63 MVA · 220/22 kV,9.80,1880,41,92,84',
      'TR-DSS-103,power_transformer,Mulund,Mulund CSS 41,CGL,2009,35,25 MVA · 220/22 kV,6.10,940,47000,74,77',
      'CB-9901,circuit_breaker,Andheri,Andheri Switching Station,Siemens,2011,28,220 kV,0.62,880,,63,',
      'TR-DSS-104,power_transformer,Chembur,Chembur RS,BHEL,2041,35,40 MVA · 220/22 kV,7.20,510,61,66,59',
      'TR-DSS-105,power_transformer,Worli,Worli RS,ABB,2001,35,50 MVA · 220/22 kV,,700,55,70,72',
      'TR-DSS-014,power_transformer,Dharavi,Dharavi Receiving Station,BHEL,1998,35,50 MVA · 220/22 kV,8.60,1450,47,79,76',
    ].join('\r\n');
    setText(sample);
    setResult(validateUpload(sample));
  };

  const commit = async () => {
    if (!result || !result.accepted.length || !canWrite) return;
    setCommitting(true);
    try {
      await onCommit(result.accepted);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(2,6,23,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Bulk asset upload"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-app-panel border border-app-border rounded-xl w-full flex flex-col"
        style={{ maxWidth: 940, maxHeight: '90vh' }}
      >
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-app-border">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="apm-card-title">Bulk asset upload</span>
              <span className="apm-checkpoint">B.8</span>
            </div>
            <p className="apm-card-sub">
              Staged validation — nothing is committed until the rejections have been seen
            </p>
          </div>
          <button type="button" className="apm-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="p-4 overflow-y-auto apm-scroll" style={{ maxHeight: 'calc(90vh - 130px)' }}>
          <div className="flex gap-2 flex-wrap mb-3">
            <button type="button" className="apm-btn" onClick={download}>Download template</button>
            <button type="button" className="apm-btn" onClick={() => fileRef.current && fileRef.current.click()}>
              Choose CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={readFile} style={{ display: 'none' }} />
            <button type="button" className="apm-btn" onClick={loadSample}>Load sample extract</button>
            <button type="button" className="apm-btn is-primary" onClick={validate} disabled={!text.trim()}>
              Validate
            </button>
          </div>

          <textarea
            className="apm-input w-full mono"
            style={{ minHeight: 110, fontSize: 10.5, lineHeight: 1.5 }}
            placeholder="Paste CSV here, choose a file, or load the sample extract…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {result && result.fatal && (
            <div
              className="rounded-lg px-3 py-2 mt-3 text-[11px]"
              style={{ background: 'var(--app-danger-bg)', border: '1px solid var(--app-danger-border)', color: 'var(--app-danger)' }}
            >
              {result.fatal}
            </div>
          )}

          {result && !result.fatal && (
            <>
              <div className="grid grid-cols-3 gap-3 mt-3">
                {[
                  ['Rows read', result.total, 'var(--app-text)'],
                  ['Accepted', result.accepted.length, 'var(--app-success)'],
                  ['Rejected', result.rejected.length, result.rejected.length ? 'var(--app-danger)' : 'var(--app-text-faint)'],
                ].map(([k, v, colour]) => (
                  <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                    <p className="apm-eyebrow" style={{ fontSize: 9 }}>{k}</p>
                    <p className="text-[19px] font-bold mono" style={{ color: colour }}>{v}</p>
                  </div>
                ))}
              </div>

              {result.rejected.length > 0 && (
                <div className="mt-3">
                  <p className="apm-eyebrow mb-1.5" style={{ fontSize: 9, color: 'var(--app-danger)' }}>
                    Rejected rows — field, value and the rule that failed
                  </p>
                  <div className="apm-scroll" style={{ maxHeight: 220, border: '1px solid var(--app-border)', borderRadius: 8 }}>
                    <table className="apm-table">
                      <thead>
                        <tr><th>Line</th><th>Asset</th><th>Field</th><th>Value</th><th>Rule</th></tr>
                      </thead>
                      <tbody>
                        {result.rejected.flatMap((r) =>
                          r.errors.map((e, i) => (
                            <tr key={`${r.line}-${e.field}-${i}`}>
                              <td className="num mono">{r.line}</td>
                              <td className="asset-id">{r.assetId || '—'}</td>
                              <td className="mono text-[10px]" style={{ color: 'var(--app-danger)' }}>{e.field}</td>
                              <td className="mono text-[10px]">{e.value}</td>
                              <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{e.rule}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.accepted.length > 0 && (
                <div className="mt-3">
                  <p className="apm-eyebrow mb-1.5" style={{ fontSize: 9, color: 'var(--app-success)' }}>
                    Accepted rows — ready to stage
                  </p>
                  <div className="apm-scroll" style={{ maxHeight: 160, border: '1px solid var(--app-border)', borderRadius: 8 }}>
                    <table className="apm-table">
                      <thead>
                        <tr><th>Line</th><th>Asset</th><th>Class</th><th>Zone</th><th>Substation</th><th className="num">Commissioned</th></tr>
                      </thead>
                      <tbody>
                        {result.accepted.map((r) => (
                          <tr key={r.assetId}>
                            <td className="num mono">{r.line}</td>
                            <td className="asset-id">{r.assetId}</td>
                            <td className="text-[10px]">{CLASS_LABEL[r.assetClass]}</td>
                            <td className="text-[10px]">{r.zone}</td>
                            <td className="text-[10px]">{r.substation}</td>
                            <td className="num">{r.commissioned}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <details className="mt-3">
            <summary className="text-[10.5px] cursor-pointer" style={{ color: 'var(--app-info)' }}>
              Validation rules applied ({UPLOAD_COLUMNS.length} columns)
            </summary>
            <table className="apm-table mt-2">
              <thead><tr><th>Column</th><th>Required</th><th>Rule</th></tr></thead>
              <tbody>
                {UPLOAD_COLUMNS.map((c) => (
                  <tr key={c.key}>
                    <td className="mono text-[10px]" style={{ color: 'var(--app-text)' }}>{c.label}</td>
                    <td className="text-[10px]">{c.required ? 'Yes' : 'Conditional'}</td>
                    <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{c.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-app-border flex-wrap">
          <button
            type="button" className="apm-btn is-primary"
            disabled={!result || !!result.fatal || !result.accepted.length || !canWrite || committing}
            onClick={commit}
          >
            {committing ? 'Staging…' : `Stage ${result && result.accepted ? result.accepted.length : 0} accepted rows`}
          </button>
          <button type="button" className="apm-btn" onClick={onClose}>Cancel</button>
          {!canWrite && (
            <span className="text-[10px]" style={{ color: 'var(--app-danger)' }}>
              {roleLabel} cannot commit an upload — <code>config.write</code> required, enforced server-side
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
