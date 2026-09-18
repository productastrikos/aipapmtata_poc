/* ═══════════════════════════════════════════════════════════════════════════
   Regulated-return model — Section K, reused by Section P
   ───────────────────────────────────────────────────────────────────────────
   Capital enters the regulated asset base, earns a return, depreciates, and
   the resulting revenue requirement is spread across the sales base to give a
   paise-per-unit tariff impact.

   This lives in one module because the Investment screen and the regulatory
   report pack must quote identical figures. An evaluator who finds the ARR on
   the submission pack disagreeing with the ARR on the planning screen has
   found a reason to distrust both.

   Parameters are indicative MERC MYT values for demonstration. The delivery
   build takes them from the approved tariff order for the control period.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ARR_PARAMS = {
  RoE: 0.1556,          // MERC-approved return on equity
  debtShare: 0.70,      // 70:30 debt-equity
  interest: 0.0925,     // weighted average cost of debt
  depreciation: 0.0528, // straight-line rate for distribution assets
  salesMU: 4850,        // million units sold per year across the licence area

  /* Wheeling — Checkpoint K.3. Open-access consumers pay to use the wires
     without buying the power, so the network cost recovered through the
     wheeling charge is allocated separately from the retail tariff. */
  wheeledMU: 890,       // million units wheeled for open-access consumers
  wireShare: 0.62,      // share of ARR attributable to the wires business
};

export function computeARR(capexCr, params = ARR_PARAMS) {
  const { RoE, debtShare, interest, depreciation, salesMU, wheeledMU, wireShare } = params;

  const equity = capexCr * (1 - debtShare);
  const debt = capexCr * debtShare;

  const returnOnEquity = equity * RoE;
  const interestCost = debt * interest;
  const depreciationCharge = capexCr * depreciation;
  const arr = returnOnEquity + interestCost + depreciationCharge;

  // ₹ Cr → paise per kWh across the sales base
  const tariffPaise = (arr * 1e7) / (salesMU * 1e6) * 100;

  /* Wheeling impact — Checkpoint K.3.

     Only the wires-business share of the revenue requirement is recoverable
     through the wheeling charge, and it is spread across wheeled units rather
     than total sales. Both denominators matter: spreading the whole ARR over
     total sales (the retail tariff impact above) and spreading the wires share
     over wheeled units give materially different per-unit figures, and quoting
     the first as though it were the second is a common way to understate what
     an open-access consumer actually sees. */
  const wireARR = arr * wireShare;
  const wheelingPaise = (wireARR * 1e7) / (wheeledMU * 1e6) * 100;

  // Share of the network's energy that moves under open access
  const wheeledShare = wheeledMU / (salesMU + wheeledMU);

  return {
    capex: capexCr,
    equity, debt,
    returnOnEquity, interestCost,
    depreciation: depreciationCharge,
    arr,
    tariffPaise,
    wireARR,
    wheelingPaise,
    wheeledShare,
    params,
  };
}
