/* ═══════════════════════════════════════════════════════════════════════════
   S!aP demo backend — integration simulators (Section M)
   ───────────────────────────────────────────────────────────────────────────
   These are SIMULATORS, and the UI says so out loud. What makes them worth
   demonstrating rather than faking in the browser: the Integration Console
   makes a genuine HTTP round trip to this service, gets a real payload back
   with real latency, and real schema validation actually rejects malformed
   records. The field mappings below are the ones that go into the BRD.

   Section M asks for four things per interface — ingestion, mapping, error
   handling and reconciliation. Every handler returns all four.
   ═══════════════════════════════════════════════════════════════════════════ */

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const iso = (offsetMins = 0) => new Date(Date.now() - offsetMins * 60000).toISOString();

/* ─── Interface catalogue ───────────────────────────────────────────────── */
const SYSTEMS = {
  gdh: {
    key: 'gdh',
    name: 'Grid Data Hub',
    vendor: 'TPCL indigenous',
    domain: 'Unified historical & real-time asset data',
    method: 'REST / OAuth2',
    direction: 'Inbound',
    cadence: 'Near real-time (5 min)',
    mapping: [
      ['gdh.asset_uid',        'asset.id',                 'string',  'Primary key'],
      ['gdh.equip_class',      'asset.assetClass',         'enum',    'Mapped via class lookup'],
      ['gdh.substation_name',  'asset.substation',         'string',  ''],
      ['gdh.commission_dt',    'asset.commissioned',       'date',    'ISO-8601 → year'],
      ['gdh.rating_mva',       'asset.rating',             'decimal', 'Composed with voltage class'],
      ['gdh.dga_tdcg_ppm',     'asset.readings.dga',       'integer', 'Total dissolved combustible gas'],
      ['gdh.oil_bdv_kv',       'asset.readings.oil',       'decimal', 'IEC 60156'],
      ['gdh.winding_hotspot_c','asset.readings.thermal',   'integer', ''],
      ['gdh.load_pct_rated',   'asset.readings.loading',   'integer', ''],
    ],
  },
  sap_pm: {
    key: 'sap_pm',
    name: 'SAP Plant Maintenance',
    vendor: 'SAP',
    domain: 'Maintenance history, work orders',
    method: 'REST via GDH / BAPI',
    direction: 'Bi-directional',
    cadence: 'Event-driven',
    mapping: [
      ['AUFNR',   'workOrder.orderNumber',   'string',  'SAP order number'],
      ['EQUNR',   'workOrder.assetId',       'string',  'Equipment number'],
      ['AUART',   'workOrder.orderType',     'enum',    'PM01 corrective / PM02 preventive'],
      ['PRIOK',   'workOrder.priority',      'enum',    '1 Very high … 4 Low'],
      ['KTEXT',   'workOrder.description',   'string',  '40 char limit'],
      ['GSTRP',   'workOrder.scheduledStart','date',    ''],
      ['ILART',   'workOrder.activityType',  'enum',    'Maintenance activity type'],
    ],
  },
  sap_mm: {
    key: 'sap_mm',
    name: 'SAP Material Management',
    vendor: 'SAP',
    domain: 'Spares, inventory, procurement',
    method: 'Flat file (CSV) / SFTP',
    direction: 'Inbound',
    cadence: 'Nightly batch',
    mapping: [
      ['MATNR', 'material.code',        'string',  'Material number'],
      ['MAKTX', 'material.description', 'string',  ''],
      ['LABST', 'material.onHand',      'decimal', 'Unrestricted stock'],
      ['MEINS', 'material.uom',         'enum',    'Base unit of measure'],
      ['WERKS', 'material.plant',       'string',  ''],
      ['DISPO', 'material.mrpDeck',     'string',  'MRP controller'],
    ],
  },
  sap_fico: {
    key: 'sap_fico',
    name: 'SAP FICO',
    vendor: 'SAP',
    domain: 'CAPEX / OPEX, budgets, WIP',
    method: 'REST via GDH',
    direction: 'Inbound',
    cadence: 'Daily',
    mapping: [
      ['POSID',  'budget.wbsElement',   'string',  'WBS element'],
      ['WTGES',  'budget.approved',     'decimal', '₹, converted to Cr'],
      ['WLJHR',  'budget.fiscalYear',   'integer', ''],
      ['ISTBUC', 'budget.committed',    'decimal', 'Actual + commitment'],
      ['KOSTL',  'budget.costCentre',   'string',  ''],
    ],
  },
  gis: {
    key: 'gis',
    name: 'GIS',
    vendor: 'Esri',
    domain: 'Asset location & network topology',
    method: 'Flat file / REST feature service',
    direction: 'Inbound',
    cadence: 'Weekly',
    mapping: [
      ['OBJECTID',   'asset.gisId',      'integer', ''],
      ['SHAPE@XY',   'asset.lat/lng',    'geometry','WGS-84, reprojected from EPSG:32643'],
      ['FEEDER_ID',  'asset.feederId',   'string',  ''],
      ['DIVISION',   'asset.zone',       'string',  ''],
    ],
  },
  scada: {
    key: 'scada',
    name: 'OSI SCADA',
    vendor: 'OSI',
    domain: 'Real-time operational telemetry',
    method: 'MongoDB / Cassandra reader',
    direction: 'Inbound',
    cadence: 'Streaming (30 s)',
    mapping: [
      ['point_id',   'telemetry.tag',      'string',  ''],
      ['ts_utc',     'telemetry.timestamp','datetime','UTC → IST at presentation'],
      ['value',      'telemetry.value',    'decimal', ''],
      ['quality',    'telemetry.quality',  'enum',    'GOOD / SUSPECT / BAD'],
    ],
  },
  adms: {
    key: 'adms',
    name: 'ADMS',
    vendor: 'Schneider Electric',
    domain: 'Network operations, switching state',
    method: 'MS SQL reader',
    direction: 'Inbound',
    cadence: 'Near real-time',
    mapping: [
      ['DeviceKey',   'network.deviceId',    'string',  ''],
      ['SwitchState', 'network.switchState', 'enum',    'OPEN / CLOSED'],
      ['OutageId',    'network.outageRef',   'string',  ''],
      ['CustomersOut','network.customersOut','integer', 'Feeds consequence model'],
    ],
  },
  cyme: {
    key: 'cyme',
    name: 'CYME DIST',
    vendor: 'Eaton',
    domain: 'Load-flow & network planning',
    method: 'REST via GDH',
    direction: 'Inbound',
    cadence: 'On planning cycle',
    mapping: [
      ['StudyId',     'planning.studyId',     'string',  ''],
      ['FeederId',    'planning.feederId',    'string',  ''],
      ['PeakLoadKVA', 'planning.peakLoadKva', 'decimal', ''],
      ['VoltDropPct', 'planning.voltDropPct', 'decimal', 'Constraint for AIP'],
      ['ThermalPct',  'planning.thermalPct',  'decimal', 'Constraint for AIP'],
    ],
  },
  historian: {
    key: 'historian',
    name: 'Process Historian',
    vendor: 'AVEVA PI',
    domain: 'Long-horizon sensor history',
    method: 'REST / PI Web API',
    direction: 'Inbound',
    cadence: 'Hourly rollup',
    mapping: [
      ['WebId',       'sensor.tagId',     'string',   ''],
      ['Timestamp',   'sensor.timestamp', 'datetime', ''],
      ['Value',       'sensor.value',     'decimal',  ''],
      ['UnitsAbbrev', 'sensor.uom',       'string',   ''],
    ],
  },
  api_gateway: {
    key: 'api_gateway',
    name: 'API Gateway',
    vendor: 'Astrikos S!aP Konnect',
    domain: 'Outbound API surface for third parties',
    method: 'REST / OAuth2 + mTLS',
    direction: 'Outbound',
    cadence: 'On demand',
    mapping: [
      ['/v1/assets',          'Asset register',      'GET',  'Paged, 500/page'],
      ['/v1/assets/{id}/ahi', 'Health index',        'GET',  'Includes contribution breakdown'],
      ['/v1/assets/{id}/ari', 'Risk index',          'GET',  'PoF, CoF and working'],
      ['/v1/portfolio',       'Investment register', 'GET',  'Scenario-scoped'],
      ['/v1/workorders',      'Work order push',     'POST', 'Forwards to SAP PM'],
    ],
  },
};

/* ─── Record generators ─────────────────────────────────────────────────── */
function records(systemKey, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    switch (systemKey) {
      case 'gdh':
        out.push({
          gdh_asset_uid: `TR-DSS-${String(Math.floor(rnd(1, 71))).padStart(3, '0')}`,
          gdh_equip_class: 'POWER_TRANSFORMER',
          gdh_substation_name: pick(['Dharavi RS', 'Bandra RS', 'Andheri RS', 'Borivali RS', 'Chembur RS', 'Mulund RS']),
          gdh_dga_tdcg_ppm: Math.round(rnd(200, 2300)),
          gdh_oil_bdv_kv: +rnd(28, 66).toFixed(1),
          gdh_winding_hotspot_c: Math.round(rnd(58, 104)),
          gdh_load_pct_rated: Math.round(rnd(48, 112)),
          gdh_reading_ts: iso(Math.round(rnd(1, 300))),
        });
        break;
      case 'sap_pm':
        out.push({
          AUFNR: String(4000000000 + Math.floor(rnd(1, 999999))),
          EQUNR: `TR-DSS-${String(Math.floor(rnd(1, 71))).padStart(3, '0')}`,
          AUART: pick(['PM01', 'PM02']),
          PRIOK: String(Math.floor(rnd(1, 5))),
          KTEXT: pick(['DGA sampling — quarterly', 'Oil filtration', 'Bushing thermography', 'OLTC inspection']),
          GSTRP: iso(-Math.round(rnd(1, 60)) * 1440).slice(0, 10),
        });
        break;
      case 'sap_mm':
        out.push({
          MATNR: String(100000 + Math.floor(rnd(1, 89999))),
          MAKTX: pick(['Transformer oil MIN 60L', 'HV bushing 220kV', 'OLTC contact set', 'Silica gel 5kg', 'Buchholz relay']),
          LABST: +rnd(0, 140).toFixed(1),
          MEINS: pick(['EA', 'L', 'KG']),
          WERKS: pick(['1100', '1200']),
        });
        break;
      case 'sap_fico':
        out.push({
          POSID: `C-FY27-${String(Math.floor(rnd(100, 999)))}`,
          WTGES: +rnd(0.4, 24).toFixed(2),
          WLJHR: 2027,
          ISTBUC: +rnd(0, 18).toFixed(2),
          KOSTL: pick(['CC-T&D-01', 'CC-T&D-04', 'CC-CAP-02']),
        });
        break;
      case 'gis':
        out.push({
          OBJECTID: 40000 + Math.floor(rnd(1, 9999)),
          LAT: +rnd(19.02, 19.25).toFixed(6),
          LON: +rnd(72.82, 72.95).toFixed(6),
          FEEDER_ID: `F-${Math.floor(rnd(100, 999))}`,
          DIVISION: pick(['Dharavi', 'Bandra', 'Andheri', 'Borivali', 'Chembur', 'Mulund']),
        });
        break;
      case 'scada':
        out.push({
          point_id: `SCADA.${pick(['MW', 'MVAR', 'AMPS', 'TEMP'])}.${Math.floor(rnd(1000, 9999))}`,
          ts_utc: iso(Math.round(rnd(0, 30))),
          value: +rnd(0, 480).toFixed(2),
          quality: Math.random() > 0.06 ? 'GOOD' : pick(['SUSPECT', 'BAD']),
        });
        break;
      case 'adms':
        out.push({
          DeviceKey: `CB-${Math.floor(rnd(1000, 4500))}`,
          SwitchState: pick(['OPEN', 'CLOSED']),
          OutageId: Math.random() > 0.8 ? `OUT-${Math.floor(rnd(1000, 9999))}` : null,
          CustomersOut: Math.random() > 0.8 ? Math.floor(rnd(20, 4200)) : 0,
        });
        break;
      case 'cyme':
        out.push({
          StudyId: `STU-FY27-${Math.floor(rnd(10, 99))}`,
          FeederId: `F-${Math.floor(rnd(100, 999))}`,
          PeakLoadKVA: Math.round(rnd(800, 9800)),
          VoltDropPct: +rnd(1.2, 7.8).toFixed(2),
          ThermalPct: +rnd(41, 108).toFixed(1),
        });
        break;
      case 'historian':
        out.push({
          WebId: `P1-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          Timestamp: iso(Math.round(rnd(0, 1440))),
          Value: +rnd(10, 400).toFixed(3),
          UnitsAbbrev: pick(['°C', 'ppm', 'kV', 'A']),
        });
        break;
      default:
        out.push({ endpoint: pick(['/v1/assets', '/v1/portfolio', '/v1/workorders']), status: 200, ms: Math.round(rnd(40, 320)) });
    }
  }
  return out;
}

/* ─── Schema validation — real, and it really rejects ───────────────────── */
function validate(systemKey, rows) {
  const rejected = [];
  const accepted = [];

  rows.forEach((row, i) => {
    const errors = [];

    if (systemKey === 'gdh') {
      if (row.gdh_oil_bdv_kv != null && row.gdh_oil_bdv_kv < 30) {
        errors.push({ field: 'gdh_oil_bdv_kv', rule: 'range(30..80)', got: row.gdh_oil_bdv_kv, note: 'Below IEC 60156 serviceable minimum — quarantined for lab re-test' });
      }
      if (row.gdh_load_pct_rated != null && row.gdh_load_pct_rated > 110) {
        errors.push({ field: 'gdh_load_pct_rated', rule: 'range(0..110)', got: row.gdh_load_pct_rated, note: 'Exceeds nameplate + 10% tolerance' });
      }
    }

    if (systemKey === 'sap_mm') {
      // Deliberate, documented failure mode: MM extracts arrive without a UoM
      // on free-text materials. This is the error-handling demo (Checkpoint M).
      if (!row.MEINS || row.LABST == null) {
        errors.push({ field: 'MEINS', rule: 'required', got: row.MEINS || null, note: 'Base unit of measure missing on free-text material' });
      }
      if (row.LABST != null && row.LABST < 0) {
        errors.push({ field: 'LABST', rule: 'min(0)', got: row.LABST, note: 'Negative unrestricted stock' });
      }
    }

    if (systemKey === 'scada' && row.quality && row.quality !== 'GOOD') {
      errors.push({ field: 'quality', rule: 'enum(GOOD)', got: row.quality, note: 'Non-GOOD quality flag — excluded from condition scoring' });
    }

    if (errors.length) rejected.push({ row: i + 1, key: row.gdh_asset_uid || row.MATNR || row.point_id || row.DeviceKey || `row-${i + 1}`, errors });
    else accepted.push(row);
  });

  return { accepted, rejected };
}

/* ─── Run one ingestion cycle ───────────────────────────────────────────── */
function ingest(systemKey, requested) {
  const sys = SYSTEMS[systemKey];
  if (!sys) return null;

  // sap_mm is seeded with records that will fail validation, so the error
  // path is demonstrable on demand rather than by luck.
  const n = Math.max(1, Math.min(requested || 25, 200));
  const rows = records(systemKey, n);
  if (systemKey === 'sap_mm') {
    for (let i = 0; i < Math.min(3, rows.length); i++) delete rows[i * 3 % rows.length].MEINS;
  }

  const { accepted, rejected } = validate(systemKey, rows);

  return {
    system: sys.key,
    systemName: sys.name,
    startedAt: iso(0),
    durationMs: Math.round(rnd(180, 1400)),
    requested: n,
    received: rows.length,
    accepted: accepted.length,
    rejected: rejected.length,
    rejections: rejected.slice(0, 12),
    sample: rows.slice(0, 5),
    mapping: sys.mapping,
    reconciliation: {
      sourceCount: rows.length,
      targetCount: accepted.length,
      variance: rows.length - accepted.length,
      variancePct: rows.length ? +(((rows.length - accepted.length) / rows.length) * 100).toFixed(2) : 0,
      status: rejected.length === 0 ? 'BALANCED' : 'VARIANCE — quarantined for review',
    },
  };
}

/* ─── SAP PM work-order push (Checkpoint G.8) ───────────────────────────── */
function pushWorkOrder(payload) {
  const required = ['EQUNR', 'AUART', 'PRIOK', 'KTEXT'];
  const missing = required.filter((f) => !payload || !payload[f]);

  if (missing.length) {
    return {
      ok: false,
      status: 422,
      response: {
        TYPE: 'E',
        ID: 'IW',
        NUMBER: '083',
        MESSAGE: `Mandatory field(s) missing: ${missing.join(', ')}`,
        MESSAGE_V1: missing[0],
      },
    };
  }

  if (String(payload.KTEXT).length > 40) {
    return {
      ok: false,
      status: 422,
      response: {
        TYPE: 'E', ID: 'IW', NUMBER: '112',
        MESSAGE: 'Short text exceeds 40 characters (SAP KTEXT limit)',
        MESSAGE_V1: String(payload.KTEXT).length,
      },
    };
  }

  const orderNumber = String(4000000000 + Math.floor(rnd(100000, 999999)));
  return {
    ok: true,
    status: 201,
    response: {
      TYPE: 'S',
      ID: 'IW',
      NUMBER: '080',
      MESSAGE: `Order ${orderNumber} created`,
      AUFNR: orderNumber,
      EQUNR: payload.EQUNR,
      AUART: payload.AUART,
      PRIOK: payload.PRIOK,
      GSTRP: payload.GSTRP || iso(-7 * 1440).slice(0, 10),
      OBJNR: `OR${orderNumber}`,
      SYSTEM: 'SAP ECC 6.0 EHP8 (simulated)',
    },
  };
}

function catalogue() {
  return Object.values(SYSTEMS).map((s) => ({
    key: s.key, name: s.name, vendor: s.vendor, domain: s.domain,
    method: s.method, direction: s.direction, cadence: s.cadence,
    mappingCount: s.mapping.length,
  }));
}

module.exports = { SYSTEMS, ingest, pushWorkOrder, catalogue };
