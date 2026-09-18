# Astrikos S!aP — APM & AIP Demonstration Platform

Demo build for **Tata Power RFQ 4100067197** (Implementation of APM & AIP across Tata Power).

This is the Astrikos-side application the bidder demonstration runs on: a single-pane
S!aP interface covering both Asset Performance Management and Asset Investment Planning,
built against the asset population Tata Power published in RFQ §3.7.

---

## Quick start

```bash
npm install
npm run server     # demo API on :4174 — run this first, in its own terminal
npm start          # dev server on http://localhost:3000
npm run build      # production bundle
npm run serve      # serve the build on :4173, bound to every interface (VPN/LAN)
npm test           # runtime smoke tests — 23 across two suites
```

> Port 3000 may already be in use on this machine. Use `PORT=3001 npm start` if so.

**The API server is not optional for a full demo.** Sections M, N, O, P and Q persist
through it: configuration objects, the audit trail, integration runs, saved report
definitions, schedules and the service desk. Without it those screens say so on their
face rather than falling back to invented data — which is the correct behaviour, but it
is not the demo you want to give. The store is a single JSON file at
`server/data/store.json`; `POST /api/admin/reset` returns it to seed state between runs.

---

## The one thing that matters about this build

**The indices are computed, not stored.** Every AHI, ACI, PoF, CoF, ARI, RUL and
investment score on screen comes back from [src/engines/indices.js](src/engines/indices.js)
at render time. Change a health weight on the Health Workbench and the fleet distribution
on the Command Centre, the ranking on the Risk Cockpit, and the funded portfolio in the
Scenario Lab all move — because all three read the same store.

That is what makes the hard checkpoints demonstrable rather than assertable:

| Checkpoint | Demand | Where it lands |
|---|---|---|
| **C.7 / O.7** | Change a threshold, show the impact on the health score | Health Workbench → model configurator |
| **E.1** | `ARI = PoF × CoF` *with visible calculations* | Risk Cockpit → worked calculation panel |
| **D.2** | Two substations, identical health, different business impact | Health Workbench → Criticality tab |
| **J.2** | Budget reduced 20% | Investment Planning → Scenario Lab |
| **B.1** | Transformer → Bay → Feeder → RMU → Consumer | Asset Registry → hierarchy tree |

A hardcoded mock dies the moment an evaluator asks for a number you didn't rehearse.
**Do not replace these engines with lookup tables.**

---

## Screens

| Route | Screen | Checkpoint sections |
|---|---|---|
| `/` | Command Centre | H.1, H.3, C.10, E.8 |
| `/registry` | Asset Registry | B.1–B.8 |
| `/health` | Health Workbench (3 tabs) | C.1–C.10, D.1–D.9, F.1–F.9, O.2, O.7 |
| `/risk` | Risk Cockpit | E.1–E.8 |
| `/reliability` | Reliability Engineering (FMECA, RCM, work order) | G.1–G.8 |
| `/map` | Network Map | L.1–L.5 |
| `/investment` | Investment Planning (3 tabs) | I.1–I.8, J.1–J.6, K.1–K.6 |
| `/reporting` | Reporting & Analytics (4 tabs) | P.1–P.8 |
| `/integration` | Integration Console | M.1–M.8 |
| `/configure` | Configuration Studio (5 tabs) | O.1–O.8 |
| `/security` | Security & Administration (4 tabs) | N.1–N.10 |
| `/services` | Managed Services & Support (4 tabs) | Q.1–Q.8 |

Each panel carries a small checkpoint tag (e.g. `C.1 · C.2 · C.4 · C.8`) so evaluators
can follow their own rubric while you present. Strip the `.apm-checkpoint` class to ship.

---

## Verified demo numbers

Run `npm test` to re-assert these. They are deterministic — the dataset is seeded, so
figures are identical between rehearsal and the room.

```
Fleet                 6,149 modelled assets, scored in ~150 ms
Mean fleet AHI        67.4
Fleet risk exposure   ₹426 Cr/yr
Extreme-risk assets   18

Hero — TR-DSS-014 (Dharavi RS Transformer 2, 50 MVA 220/22 kV)
  AHI 62.8   ACI 84.5   PoF 5.47%/yr   CoF ₹16.03 Cr   ARI ₹0.88 Cr/yr
  RUL 7.4 yrs @ 93% confidence
  Dominant deduction: DGA −14.6 (matches the acetylene anomaly story)

Criticality pair — Checkpoint D.2
  TR-DSS-007 Bandra   AHI 62.8   ACI 94   ARI ₹1.08 Cr/yr
  TR-DSS-022 Mulund   AHI 62.8   ACI 28   ARI ₹0.30 Cr/yr
  Identical health, 3.6× risk separation

Weight sensitivity — Checkpoint C.7
  DGA weight 28% → 45% moves AHI 62.8 → 60.6

Portfolio — Checkpoint J.2
  FY27 budget ₹130 Cr → 270 of 566 candidates funded
  Cut 20% to ₹104 Cr → 209 funded, 61 projects deferred, +₹8.8 Cr/yr risk left on network
```

---

## KPI cards

KPI tiles use the template components unchanged: [KPICard](src/components/KPICard.js)
for the tile and [KPIDetailModal](src/components/KPIDetailModal.js) for the drill-down,
wired the same way [Dashboard.js](src/pages/Dashboard.js) wires them.

```jsx
const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
const showKPIDetail = (data) => setSelectedKPIDetail(data);

{selectedKPIDetail && (
  <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
)}

<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
  {(() => { const col = v >= 70 ? 'text-emerald-400' : 'text-amber-400'; return (
    <KPICard
      icon={<IcoShield />} label="Mean Fleet Health Index"
      value={v.toFixed(1)} unit=" / 100" trend={trend} color={col}
      subValues={[{ label: 'Band', value: band.label }]}
      onClick={() => showKPIDetail({
        icon: <IcoShield />, label: 'Mean Fleet Health Index',
        value: v.toFixed(1), unit: '/100', trend, color: col,
        thresholds: { green: 70, amber: 55 }, inverted: false,
        definition: '...', subValues: [...], target: '...', analysis: 'a | b | c',
      })} />
  ); })()}
</div>
```

Four things to keep right:

- **The modal's `value` must be numeric-leading.** `KPIDetailModal` runs
  `parseFloat(kpi.value)`, so pass `'67.4'` with a separate `unit: '/100'` — never
  `'67.4 / 100'`, which parses fine but breaks the target and average tiles.
- **`color` is a Tailwind `text-*` class and it outranks `thresholds`** for the RAG
  badge, because `deriveRag(kpi.color)` takes precedence inside the modal. Keep the
  colour expression and the thresholds consistent or the card and modal disagree.
- **Trends are real or absent.** Command Centre trends are a year-ago comparison derived
  inside the model's own degradation logic; Investment Planning trends compare the active
  scenario against the approved baseline. Where there is no honest basis the `trend` prop
  is omitted and `KPICard` simply hides the badge. Do not invent a percentage to fill it.
- **Six cards per page**, so the three-column grid fills cleanly — same as the
  template Dashboard.

The `analysis` string is split on `|` into bullet points in the modal's lower panel.

---

## Architecture

```
src/
  engines/indices.js     ← ALL the maths. AHI, ACI, PoF (Weibull), CoF, ARI,
                           RUL, investment value, portfolio optimiser.
                           Every function returns its working, not just its answer.
  data/network.js        ← Seeded synthetic fleet built to RFQ §3.7 volumetrics.
                           Replace with S!aP Konnect / GDH feeds — nothing above
                           this file needs to change.
  services/apmStore.js   ← Config store: health weights, criticality weights,
                           budget. The reason edits propagate across screens.
  engines/reliability.js ← FMECA (RPN = S x O x D), RCM strategy selection per
                           IEC 60300-3-11, interval optimisation, SAP PM payload.
  engines/advisories.js  ← Derives every alert and S!a advisory from live engine
                           output. Nothing in the advisory panel is authored prose.
  engines/regulatory.js  ← The MERC MYT return model. Lives in one place so the
                           Investment screen and the Section P submission pack
                           cannot quote different ARR figures.
  services/apmStore.js   ← Config store: health weights, criticality weights,
                           budget, plus the derived advisories and alerts.
  services/roleContext.js← RBAC. Four demo identities; every backend call carries
                           the active role, and the server checks it independently.
  services/backend.js    ← API client for the demo service on :4174.
  services/socket.js     ← Alert + advisory feed, sourced from the store.
  components/apmUi.js    ← Panel, BarRow, pills, Tabs, SimulatedNote.
                           KPI tiles use the template KPICard + KPIDetailModal
                           pair — do not substitute a bespoke stat component.
  components/Layout.js   ← Sidebar, header, search, alert + advisory panels.
  pages/                 ← The twelve screens.

server/
  index.js               ← Zero-dependency node:http router on :4174. Enforces the
                           write boundary by role — the UI hiding a button is not
                           the control, this is.
  store.js               ← JSON file persistence, audit trail, seed data.
  integrations.js        ← Ten labelled system simulators with real field mappings,
                           real validation and real rejection paths.
  data/store.json        ← Written at runtime, gitignored.
```

The API is deliberately dependency-free (`node:http`, `node:fs`) for the same reason the
static server is: a demo venue with no internet and a locked-down laptop must still be
able to run this from a copied folder.

**Calibration note:** risk bands and the FY27 budget are derived from the data, not
picked as round numbers. `RISK_BANDS` sits at the measured p50/p90/p99 of the fleet ARI
distribution, and `DEFAULT_BUDGET_CR` is 62% of identified capital need. If you change
the asset base or intervention costs, both follow automatically — the scenario controls
keep working.

---

## Honesty guardrails — keep these

The [`SimulatedNote`](src/components/apmUi.js) banners mark everything that is simulated
rather than connected (asset master data, the RUL model, the ARR parameters). Buttons
that would post to SAP or export a pack say so plainly in their dialog.

Leave these in. A utility that catches a bidder overstating connectivity discounts
everything else you showed — and Section M explicitly tests integration behaviour.
Show a real API round-trip to a labelled simulator, and say the word "simulator" out loud.

---

## What the backend actually does

Sections M, N, O, P and Q are the ones where a client-side mock would be transparently
hollow, so they are not mocked:

- **Section M** — `POST /api/integration/:system/ingest` runs real field mapping and real
  validation over generated records and returns accepted/rejected counts with field-level
  reasons. The SAP MM feed is deliberately seeded with records missing `MEINS`, so the
  rejection path can be demonstrated on demand rather than described. `POST
  /api/integration/sap_pm/work-order` returns a BAPI-shaped 201 with an order number, and a
  422 when a mandatory field is absent.
- **Section N** — every write checks the role server-side. Switch to Regulatory Auditor and
  the same request that succeeded as Administrator returns 403. The audit trail is written
  by the server, not the browser, so clearing site data does not erase it.
- **Section O** — asset classes, health models, dashboards, business rules and alarms are
  created through the API, persisted, audited, and evaluated against the live fleet.
- **Section P** — saved report definitions and schedules persist. Report *content* is
  generated in the browser from the live engines at the moment of export, which is the
  point: change a weighting, re-export, and the numbers have moved.
- **Section Q** — the service desk is a real store. SLA status is computed against the wall
  clock on every render, so an open ticket's headroom genuinely shrinks while the page is
  open, and a ticket raised during the demo survives a reload.

---

## Exports — Section P

Excel export writes RFC-4180 CSV with a UTF-8 byte-order mark, which is what stops Excel
on Windows turning every `₹` into mojibake. Columns carry **raw numeric values**, not
formatted strings, so the recipient can pivot on them immediately.

PDF export goes through the browser's own print pipeline against the `@media print` block
in [src/index.css](src/index.css) — no PDF library is bundled, and what prints is exactly
the table that was generated. Long reports cap at 400 rows for print and say so on the
face of the document.

Every export writes an audit entry naming the report, principal, role, format and row
count before the file reaches disk.

---

## Still to do

- **Live data binding** — `src/data/network.js` is a seeded synthetic fleet built to RFQ
  §3.7 volumetrics. Replacing it with S!aP Konnect / GDH feeds is the one change that
  turns this from a demonstration into a deployment; nothing above that file moves.
- **SSO** — role switching is a demo affordance. Delivery takes identity from TPCL Active
  Directory over SSO with MFA, and the audit trail then carries the real principal.
- **Mail transport** — report schedules are registered and persisted but nothing is sent
  at the scheduled time. The Scheduling tab states this plainly.
- **ITSM federation** — the service desk is standalone. Delivery federates it with TPCL's
  incumbent service-management tool so one ticket exists, not two.
- **Regulatory templates** — the Section P pack is filing-*shaped*, not filing-*ready*.
  The arithmetic and derivations are real; the MERC submission formats and sign-off
  workflow are configured during delivery.
