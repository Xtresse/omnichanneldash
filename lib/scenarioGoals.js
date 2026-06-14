// =============================================================
// Scenario goals — company-level B2B product targets, Base vs Stretch
// =============================================================
// Source: "Xtressé June Sales Outlook & Rep Model" deck (June 2026).
// Base/stretch each tie to the headline B2B goal exactly:
//   Base    $1.2M  ·  Stretch  $1.4M
// Base case is Sam's override (gummies $1,032k / xvie $96k / serum $72k);
// stretch is the deck's product-mix stretch (85/8/7 applied to $1.4M).
//
// Keyed by calendar month (YYYY-MM, UTC bucketing, matching the rest of
// the dashboard). Add a new month here to extend the Actual-vs-Goal
// scenario toggle to that month; months without an entry fall back to the
// Sheet-backed per-rep goal sum.
//
// Basis note: these are B2B targets. The Actual-vs-Goal actuals sum all
// channels (B2B + DTC + ADCS); ADCS on these three families is small, but
// keep that in mind when reading % to goal.

export const SCENARIO_GOALS = {
  "2026-06": {
    base:    { Gummies: 1_032_000, XVIE: 96_000,  Serum: 72_000 }, // = $1.2M
    stretch: { Gummies: 1_190_000, XVIE: 112_000, Serum: 98_000 }, // = $1.4M
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
