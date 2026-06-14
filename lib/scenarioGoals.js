// =============================================================
// Scenario goals — company-level NET-SALES product targets, Base vs Stretch
// =============================================================
// All figures are NET sales (gross − discounts − returns), B2B + DTC.
// Source: "Xtressé June Sales Outlook & Rep Model" deck (June 2026).
//
// June 2026 build-up per product = B2B target + DTC target:
//   B2B  — Base $1.2M / Stretch $1.4M (deck mix 85/8/7; base is Sam's
//          override: gummies $1,032k / xvie $96k / serum $72k).
//   DTC  — $120k/mo flat (90% gummies = $108k, 10% serum = $12k), applied
//          to both scenarios.
// So totals: Base $1.32M · Stretch $1.52M (now they tie to the all-channel
// net actuals this section already sums, instead of B2B-only).
//
// Keyed by calendar month (YYYY-MM, UTC bucketing). Add a new month here to
// extend the Actual-vs-Goal scenario toggle; months without an entry fall
// back to the Sheet-backed per-rep goal sum.

// DTC net goal — June 2026 ($120k: 90% gummies / 10% serum).
const DTC_JUNE = { Gummies: 108_000, XVIE: 0, Serum: 12_000 };

export const SCENARIO_GOALS = {
  "2026-06": {
    base: {
      Gummies: 1_032_000 + DTC_JUNE.Gummies, // 1,140,000
      XVIE:    96_000    + DTC_JUNE.XVIE,     //    96,000
      Serum:   72_000    + DTC_JUNE.Serum,    //    84,000
    }, // = $1.32M
    stretch: {
      Gummies: 1_190_000 + DTC_JUNE.Gummies, // 1,298,000
      XVIE:    112_000   + DTC_JUNE.XVIE,     //   112,000
      Serum:   98_000    + DTC_JUNE.Serum,    //   110,000
    }, // = $1.52M
  },
};

export const SCENARIOS = [
  { key: "base", label: "Base" },
  { key: "stretch", label: "Stretch" },
];

/** Whether scenario (base/stretch) goals exist for a given YYYY-MM. */
export function hasScenarioGoals(ym) {
  return !!(ym && SCENARIO_GOALS[ym]);
}

/** Goal $ for a (month, scenario, product); 0 when not defined. */
export function scenarioGoalFor(ym, scenario, product) {
  return Number(SCENARIO_GOALS?.[ym]?.[scenario]?.[product] || 0);
}
