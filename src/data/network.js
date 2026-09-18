/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — Demo network dataset
   ───────────────────────────────────────────────────────────────────────────
   Synthetic, but built to the asset population published in RFQ 4100067197
   §3.7 so the fleet counts on screen match the numbers TPCL wrote themselves.

   Generation is seeded, so every reload produces identical figures — a demo
   whose numbers drift between rehearsal and the room is worse than useless.

   DEMO DATA. Replace this module with S!aP Konnect feeds from the Grid Data
   Hub; nothing above it needs to change — the screens read the engines, and
   the engines read whatever this module returns.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Seeded PRNG (mulberry32) — deterministic across reloads ───────────── */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260917);
const between = (lo, hi) => lo + rnd() * (hi - lo);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ─── Licence-area zones (Mumbai distribution) ──────────────────────────── */
export const ZONES = [
  { id: 'Z1', name: 'Dharavi',  lat: 19.0380, lng: 72.8538 },
  { id: 'Z2', name: 'Bandra',   lat: 19.0596, lng: 72.8295 },
  { id: 'Z3', name: 'Andheri',  lat: 19.1136, lng: 72.8697 },
  { id: 'Z4', name: 'Borivali', lat: 19.2307, lng: 72.8567 },
  { id: 'Z5', name: 'Chembur',  lat: 19.0522, lng: 72.8994 },
  { id: 'Z6', name: 'Mulund',   lat: 19.1726, lng: 72.9425 },
];

/* ─── Published RFQ population (§3.7) ───────────────────────────────────── */
export const RFQ_POPULATION = {
  distributionSubstations: 36,
  consumerSubstations: 1120,
  powerTransformersDSS: 70,
  transformersCSS: 1072,
  circuitBreakers: 3527,
  isolators: 10223,
  rmus: 1480,
  fpis: 1302,
  frtus: 490,
  rtus: 36,
  initialLoadGB: 20000,
  dailyIncrementalGB: 15,
};

const MAKES = {
  power_transformer: ['BHEL', 'CGL', 'ABB', 'Siemens', 'TELK', 'Toshiba'],
  circuit_breaker: ['ABB', 'Siemens', 'Schneider', 'CGL', 'Hitachi Energy'],
  rmu: ['Schneider', 'ABB', 'Lucy Electric', 'Siemens'],
};

let seq = 0;
const nextId = (prefix) => `${prefix}-${String(++seq).padStart(5, '0')}`;

/* ─── Asset factory ─────────────────────────────────────────────────────── */
function makeAsset({ assetClass, idPrefix, zone, substation, tier, overrides = {} }) {
  const age = between(2, 38);
  const designLife = assetClass === 'power_transformer' ? 35 : assetClass === 'circuit_breaker' ? 28 : 25;

  // Condition degrades with age, with genuine spread — some old assets are
  // well maintained and some young ones are not.
  const wear = Math.min(age / designLife, 1.2) * between(0.6, 1.35);

  const readings =
    assetClass === 'power_transformer'
      ? {
          dga: Math.round(180 + wear * between(600, 2200)),
          oil: +(68 - wear * between(12, 36)).toFixed(1),
          thermal: Math.round(58 + wear * between(15, 48)),
          loading: Math.round(48 + between(0, 50) + wear * 10),
          maintenance: Math.round(between(2, 54)),
          pd: Math.round(20 + wear * between(150, 900)),
        }
      : assetClass === 'circuit_breaker'
      ? {
          operations: Math.round(300 + wear * between(1500, 7000)),
          contactWear: Math.round(3 + wear * between(10, 55)),
          gasPressure: +(6.8 - wear * between(0.4, 2.0)).toFixed(2),
          tripTime: Math.round(20 + wear * between(5, 32)),
          maintenance: Math.round(between(2, 44)),
        }
      : {
          insulation: +(12 - wear * between(2, 10)).toFixed(1),
          thermal: Math.round(38 + wear * between(10, 42)),
          operations: Math.round(120 + wear * between(300, 2600)),
          moisture: Math.round(30 + wear * between(10, 50)),
        };

  const consumers =
    tier === 'dss' ? Math.round(between(9000, 52000))
    : tier === 'css' ? Math.round(between(400, 4200))
    : Math.round(between(80, 1400));

  const replacementCost =
    assetClass === 'power_transformer' ? (tier === 'dss' ? between(4.2, 11.5) : between(0.35, 1.4))
    : assetClass === 'circuit_breaker' ? between(0.18, 0.95)
    : between(0.12, 0.6);

  return {
    id: overrides.id || nextId(idPrefix),
    name: overrides.name,
    assetClass,
    tier,
    zone: zone.name,
    zoneId: zone.id,
    substation,
    make: pick(MAKES[assetClass]),
    commissioned: new Date(Date.now() - age * 365.25 * 864e5).getFullYear(),
    age: +age.toFixed(1),
    designLife,
    rating:
      assetClass === 'power_transformer'
        ? tier === 'dss' ? `${pick([25, 40, 50, 63])} MVA · 220/22 kV` : `${pick([0.5, 0.63, 1.0, 1.6])} MVA · 22/0.44 kV`
        : assetClass === 'circuit_breaker' ? `${pick([22, 33, 132, 220])} kV`
        : `${pick([11, 22])} kV RMU`,
    lat: zone.lat + between(-0.022, 0.022),
    lng: zone.lng + between(-0.022, 0.022),
    readings,
    replacementCost: +replacementCost.toFixed(2),
    restorationDays: assetClass === 'power_transformer' ? (tier === 'dss' ? 14 : 3) : 2,
    degradationRate: +between(1.5, 3.8).toFixed(2),
    dataYears: Math.round(between(3, 10)),
    missingParams: rnd() > 0.85 ? 1 : 0,
    lifecycle: age > 32 ? 'End of life' : age > 22 ? 'Mature' : age > 8 ? 'In service' : 'Early life',
    impact: {
      consumers,
      kwhPerConsumerDay: +between(5.5, 14).toFixed(1),
      revenue: +(consumers * between(0.0009, 0.0022)).toFixed(2), // ₹ Cr/yr
      reliability: Math.round(between(4, 150)),
      safety: Math.round(between(8, 95)),
      environment: Math.round(between(6, 88)),
      redundancy: rnd() > 0.45,
    },
    ...overrides,
  };
}

/* ═══ HERO ASSETS ═══════════════════════════════════════════════════════════
   Hand-authored so every scripted demo beat lands on a story we wrote
   deliberately. The ACI pair below is the scenario the checkpoint sheet asks
   for by name: identical health, materially different business impact. */

/* Tuned so the hero lands mid-Fair band with dissolved gas as the clear
   dominant deduction — that is the story the acetylene anomaly tells, and it
   leaves genuine remaining life for the RUL beat to forecast. */
const heroReadings = { dga: 1450, oil: 47, thermal: 79, loading: 76, maintenance: 22, pd: 310 };

const HERO_ASSETS = [
  /* The golden-thread asset — Act 3 through Act 8 of the run sheet */
  makeAsset({
    assetClass: 'power_transformer', idPrefix: 'TR', zone: ZONES[0],
    substation: 'Dharavi Receiving Station', tier: 'dss',
    overrides: {
      id: 'TR-DSS-014',
      name: 'Dharavi RS — Transformer 2',
      hero: true,
      make: 'BHEL', commissioned: 1998, age: 27.4, designLife: 35,
      rating: '50 MVA · 220/22 kV',
      readings: heroReadings,
      replacementCost: 8.60, restorationDays: 14,
      degradationRate: 2.4, dataYears: 9, missingParams: 0,
      lifecycle: 'Mature',
      anomaly: { param: 'dga', since: 'March 2026', note: 'Acetylene (C₂H₂) trending up 38% over 6 months — indicative of low-energy arcing' },
      impact: { consumers: 41200, kwhPerConsumerDay: 9.8, revenue: 62.40, reliability: 128, safety: 78, environment: 64, redundancy: false },
    },
  }),

  /* ACI comparison pair — identical readings, so identical AHI by construction */
  makeAsset({
    assetClass: 'power_transformer', idPrefix: 'TR', zone: ZONES[1],
    substation: 'Bandra Receiving Station', tier: 'dss',
    overrides: {
      id: 'TR-DSS-007',
      name: 'Bandra RS — Transformer 1',
      hero: true, pairKey: 'A',
      make: 'ABB', commissioned: 1999, age: 27.4, designLife: 35,
      rating: '63 MVA · 220/22 kV',
      readings: { ...heroReadings },
      replacementCost: 9.80, restorationDays: 14,
      degradationRate: 2.4, dataYears: 9, missingParams: 0,
      lifecycle: 'Mature',
      note: 'Feeds Lilavati-side hospital load and the Bandra-Kurla industrial ring. No N-1 available.',
      impact: { consumers: 48000, kwhPerConsumerDay: 11.2, revenue: 84.00, reliability: 165, safety: 94, environment: 71, redundancy: false },
    },
  }),
  makeAsset({
    assetClass: 'power_transformer', idPrefix: 'TR', zone: ZONES[5],
    substation: 'Mulund Consumer Substation 22', tier: 'dss',
    overrides: {
      id: 'TR-DSS-022',
      name: 'Mulund CSS 22 — Transformer 1',
      hero: true, pairKey: 'B',
      make: 'CGL', commissioned: 1999, age: 27.4, designLife: 35,
      rating: '25 MVA · 220/22 kV',
      readings: { ...heroReadings },
      replacementCost: 5.20, restorationDays: 14,
      degradationRate: 2.4, dataYears: 9, missingParams: 0,
      lifecycle: 'Mature',
      note: 'Residential feeder group only. Adjacent CSS provides N-1 backfeed within 40 minutes.',
      impact: { consumers: 3200, kwhPerConsumerDay: 6.1, revenue: 4.80, reliability: 38, safety: 31, environment: 24, redundancy: true },
    },
  }),
];

/* ═══ FLEET GENERATION ══════════════════════════════════════════════════════
   Modelled individually: DSS power transformers, CSS transformers, circuit
   breakers and RMUs. Isolators, FPIs, FRTUs and RTUs are carried as fleet
   counts only — they have no condition model in this demo build. */
function generateFleet() {
  const assets = [...HERO_ASSETS];

  const dssNames = ZONES.flatMap((z) =>
    Array.from({ length: 6 }, (_, i) => ({ zone: z, name: `${z.name} Receiving Station ${i + 1}` }))
  );

  // 70 DSS power transformers (3 already authored as heroes)
  for (let i = 0; i < RFQ_POPULATION.powerTransformersDSS - 3; i++) {
    const site = dssNames[i % dssNames.length];
    assets.push(makeAsset({ assetClass: 'power_transformer', idPrefix: 'TR', zone: site.zone, substation: site.name, tier: 'dss' }));
  }

  // 1,072 CSS distribution transformers
  for (let i = 0; i < RFQ_POPULATION.transformersCSS; i++) {
    const zone = ZONES[i % ZONES.length];
    assets.push(makeAsset({ assetClass: 'power_transformer', idPrefix: 'TX', zone, substation: `${zone.name} CSS ${Math.floor(i / ZONES.length) + 1}`, tier: 'css' }));
  }

  // 3,527 circuit breakers
  for (let i = 0; i < RFQ_POPULATION.circuitBreakers; i++) {
    const zone = ZONES[i % ZONES.length];
    assets.push(makeAsset({ assetClass: 'circuit_breaker', idPrefix: 'CB', zone, substation: `${zone.name} CSS ${Math.floor(i / ZONES.length) + 1}`, tier: 'bay' }));
  }

  // 1,480 ring main units
  for (let i = 0; i < RFQ_POPULATION.rmus; i++) {
    const zone = ZONES[i % ZONES.length];
    assets.push(makeAsset({ assetClass: 'rmu', idPrefix: 'RMU', zone, substation: `${zone.name} CSS ${Math.floor(i / ZONES.length) + 1}`, tier: 'rmu' }));
  }

  return assets;
}

export const ASSETS = generateFleet();
export const ASSET_BY_ID = ASSETS.reduce((m, a) => { m[a.id] = a; return m; }, {});
export const HERO_ID = 'TR-DSS-014';

export const CLASS_LABEL = {
  power_transformer: 'Power Transformer',
  circuit_breaker: 'Circuit Breaker',
  rmu: 'Ring Main Unit',
};

/* ═══ HIERARCHY — Transformer → Bay → Feeder → RMU → Consumer ═══════════════
   Checkpoint B.1 names this chain explicitly, so the registry renders it as
   an actual navigable tree rather than a flat asset list. */
export function buildHierarchy(assetId) {
  const asset = ASSET_BY_ID[assetId];
  if (!asset) return null;

  const r = mulberry32(assetId.split('').reduce((s, c) => s + c.charCodeAt(0), 0));
  const bayCount = asset.tier === 'dss' ? 4 : 2;

  return {
    label: asset.substation,
    type: 'Substation',
    meta: `${asset.zone} zone`,
    children: [
      {
        label: `${asset.id} — ${asset.rating}`,
        type: 'Transformer',
        meta: `${asset.make} · commissioned ${asset.commissioned}`,
        assetId: asset.id,
        children: Array.from({ length: bayCount }, (_, b) => ({
          label: `Bay ${String(b + 1).padStart(2, '0')}`,
          type: 'Bay',
          meta: `${Math.round(11 + r() * 11)} kV switchgear`,
          children: Array.from({ length: 2 }, (_, f) => ({
            label: `Feeder F-${b + 1}${f + 1}`,
            type: 'Feeder',
            meta: `${(3 + r() * 9).toFixed(1)} km · ${Math.round(180 + r() * 900)} A`,
            children: Array.from({ length: 2 }, (_, u) => ({
              label: `RMU-${b + 1}${f + 1}${u + 1}`,
              type: 'RMU',
              meta: `${Math.round(2 + r() * 4)}-way ring main unit`,
              children: [
                {
                  label: `Consumer group ${b + 1}${f + 1}${u + 1}`,
                  type: 'Consumer',
                  meta: `${Math.round(asset.impact.consumers / (bayCount * 4))} connections · ${r() > 0.7 ? 'Mixed commercial' : 'Residential'}`,
                  children: [],
                },
              ],
            })),
          })),
        })),
      },
    ],
  };
}

/* ─── Historical health trend (Section C.5) ─────────────────────────────── */
export function healthHistory(asset, currentAHI, points = 20) {
  const r = mulberry32(asset.id.split('').reduce((s, c) => s + c.charCodeAt(0), 7));
  const years = 5;
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    const yearsAgo = years * (1 - t);
    const drift = currentAHI + yearsAgo * asset.degradationRate;
    return {
      label: `${(new Date().getFullYear() - Math.round(yearsAgo))}`,
      value: +Math.min(drift + (r() - 0.5) * 2.4, 100).toFixed(1),
    };
  });
}

/* Alerts and S!a advisories are generated from live engine output in
   src/engines/advisories.js and surfaced through apmStore — they are not
   authored here. Hand-written advisory text drifts from what the engines
   actually compute, which is precisely the inconsistency an evaluator finds
   by cross-checking two screens. */
