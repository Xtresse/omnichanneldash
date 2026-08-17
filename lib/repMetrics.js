// =============================================================================
// Rep metric registry — the single definition of every per-rep number the
// dashboard ranks reps by.
// =============================================================================
// Sam (2026-08-03): every per-rep comparison on the Omni dashboard reads as a
// stack-ranked leaderboard, not a multi-line chart. That only stays consistent
// if there is ONE place that says what "New Serum Accts by rep" means. This is
// that place — <RepLeaderboard> renders whatever metrics it's handed, and
// President's Club reuses the same weighted-sales aggregator it always did.
//
// CRITICAL: nothing here computes anything new. Every accessor reads a field
// the server already put on a `repPerformance` row in lib/windsor.js:
//
//   { rep, territory, region, net, gross, orders, lastOrderAt,
//     newAccounts,            // = firstOrderGummy: orders carrying Shopify
//                             //   Flow's `b2b` + `first order` tags with a
//                             //   gummy line. Summing repNewAccountsMonthly
//                             //   over the window yields the same number —
//                             //   this is the metric the old "New Gummy
//                             //   Accounts By Rep" trend chart plotted.
//     productMix: {           // per family: Gummies | Serum | XVIE | Sachets
//       <family>: { newUnits, newDollars, existingUnits, existingDollars,
//                   newCusts, existingCusts } } }
//
// "newCusts" is a DISTINCT-ACCOUNT count (an account buying two units of its
// first serum is one new serum customer), matching the N·E columns in the rep
// detail table. "new" for Gummies = first-order-tagged; for the other families
// = the customer's first-ever purchase of that family lands in the window.

export const FIRST_TIME_WEIGHT = 0.6;
export const RETURNING_WEIGHT = 0.4;

export const FAMILIES = [
  { key: "Gummies", label: "Gummies" },
  { key: "Serum", label: "Serum" },
  { key: "XVIE", label: "XVIE" },
  { key: "Sachets", label: "Sachets" },
];

const slot = (r, fam) => (r && r.productMix && r.productMix[fam]) || {};

/**
 * Collapse a repPerformance row's productMix into per-family first-time /
 * returning dollars plus the rolled-up weighted total.
 *
 * Weighted Sales = First-Time × 60% + Returning × 40%, mirroring the
 * "P Club Rankings" tab in Sales Reporting Master Data v10.xlsx.
 */
export function aggregateRep(r) {
  let firstTime = 0;
  let returning = 0;
  const families = {};
  for (const f of FAMILIES) {
    const s = slot(r, f.key);
    const fNew = s.newDollars || 0;
    const fRet = s.existingDollars || 0;
    firstTime += fNew;
    returning += fRet;
    families[f.key] = {
      firstTime: Math.round(fNew),
      returning: Math.round(fRet),
      total: Math.round(fNew + fRet),
      newUnits: s.newUnits || 0,
      existingUnits: s.existingUnits || 0,
    };
  }
  const total = firstTime + returning;
  return {
    rep: r.rep,
    region: r.region,
    territory: r.territory,
    families,
    firstTime: Math.round(firstTime),
    returning: Math.round(returning),
    total: Math.round(total),
    weighted: Math.round(
      firstTime * FIRST_TIME_WEIGHT + returning * RETURNING_WEIGHT
    ),
  };
}

// ── President's Club eligibility ─────────────────────────────────────────────
// W-2 reps only; 1099 contractors (Lexi Cavaliere, Jim & Anne Weeks, Sevi
// McCutcheon, Krista Taylor, Ryan Masa) sit in the "1099" territory and are
// excluded. Managers / former reps without a quota are excluded by name —
// their historical orders still attribute to them in the rep detail table for
// accounting, they just don't rank.
export const ELIGIBLE_TERRITORIES = new Set(["Existing", "New"]);
export const PC_EXCLUDED_REPS = new Set([
  "Julie Fetter",   // now a manager
  "Becky Curry",    // now a manager
  "James Tuckett",  // departed 8/10/26 — see xtresse-1099-fence-set memory
]);

export function isPresidentsClubEligible(row, territory) {
  const t = territory || row.territory;
  return ELIGIBLE_TERRITORIES.has(t) && !PC_EXCLUDED_REPS.has(row.rep);
}

// ── The metric registry ──────────────────────────────────────────────────────
// unit: "currency" → $ formatting; "count" → integer formatting.
// note: shown under the leaderboard so the definition is never ambiguous.
export const REP_METRICS = {
  net: {
    key: "net",
    label: "Net Sales",
    unit: "currency",
    value: (r) => r.net || 0,
    note: "Subtotal after discounts, before shipping and tax, less refunds. B2B only — DTC and ADCS are excluded upstream by the channel classifier.",
  },
  gross: {
    key: "gross",
    label: "Gross Sales",
    unit: "currency",
    value: (r) => r.gross || 0,
    note: "Subtotal before discounts and returns. B2B only.",
  },
  orders: {
    key: "orders",
    label: "Orders",
    unit: "count",
    suffix: "orders",
    value: (r) => r.orders || 0,
    note: "Distinct B2B orders attributed to the rep — one row per order, so an order with six line items counts once.",
  },
  newGummyAccts: {
    key: "newGummyAccts",
    label: "New Gummy Accts",
    unit: "count",
    suffix: "accts",
    value: (r) => r.newAccounts || 0,
    note: "Orders carrying Shopify Flow's `b2b` + `first order` tags with a gummy line — the same figure the old New Gummy Accounts By Rep trend chart plotted, totalled over the period.",
  },
  newSerumAccts: {
    key: "newSerumAccts",
    label: "New Serum Accts",
    unit: "count",
    suffix: "accts",
    value: (r) => slot(r, "Serum").newCusts || 0,
    note: "Distinct accounts whose first-ever Serum purchase falls inside the period. Matches the Serum “N” column in the rep detail table.",
  },
  newXvieAccts: {
    key: "newXvieAccts",
    label: "New XVIE Accts",
    unit: "count",
    suffix: "accts",
    value: (r) => slot(r, "XVIE").newCusts || 0,
    note: "Distinct accounts whose first-ever XVIE purchase falls inside the period. Matches the XVIE “N” column in the rep detail table.",
  },
  serumNet: {
    key: "serumNet",
    label: "Serum $",
    unit: "currency",
    value: (r) =>
      (slot(r, "Serum").newDollars || 0) + (slot(r, "Serum").existingDollars || 0),
    note: "Net Serum dollars — new plus returning accounts.",
  },
  xvieNet: {
    key: "xvieNet",
    label: "XVIE $",
    unit: "currency",
    value: (r) =>
      (slot(r, "XVIE").newDollars || 0) + (slot(r, "XVIE").existingDollars || 0),
    note: "Net XVIE dollars — new plus returning accounts.",
  },
  gummyNet: {
    key: "gummyNet",
    label: "Gummy $",
    unit: "currency",
    value: (r) =>
      (slot(r, "Gummies").newDollars || 0) +
      (slot(r, "Gummies").existingDollars || 0),
    note: "Net Gummy dollars — new plus returning accounts. Sachets roll into Gummies in the rep detail table but are their own family here.",
  },
  weighted: {
    key: "weighted",
    label: "Weighted Sales",
    unit: "currency",
    value: (r) => aggregateRep(r).weighted,
    note: "First-Time × 60% + Returning × 40%, summed across Gummies, Serum, XVIE and Sachets — the President's Club ranking metric.",
  },
  firstTime: {
    key: "firstTime",
    label: "First-Time $",
    unit: "currency",
    value: (r) => aggregateRep(r).firstTime,
    note: "Dollars from accounts buying a given family for the first time, summed across all four families.",
  },
  returning: {
    key: "returning",
    label: "Returning $",
    unit: "currency",
    value: (r) => aggregateRep(r).returning,
    note: "Dollars from accounts that had already bought the family before, summed across all four families.",
  },
};

/** Resolve an ordered list of metric keys into their definitions. */
export function resolveMetrics(keys) {
  return (keys || [])
    .map((k) => REP_METRICS[k])
    .filter(Boolean);
}

// The metric set the main Sales By Rep leaderboard offers — every per-rep
// comparison the section used to spread across a spaghetti chart and a
// wide table, now rankable from one control.
export const SALES_BY_REP_METRICS = [
  "net",
  "gross",
  "orders",
  "newGummyAccts",
  "newSerumAccts",
  "newXvieAccts",
  "gummyNet",
  "serumNet",
  "xvieNet",
];

// President's Club ranks on weighted sales, with its two components available
// as alternate rankings.
export const PRESIDENTS_CLUB_METRICS = ["weighted", "firstTime", "returning"];
