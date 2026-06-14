// =============================================================
// Scenario goals — NET-SALES product targets, by channel, Base vs Stretch
// =============================================================
// All figures are NET sales (gross − discounts − returns).
// Source: "Xtressé June Sales Outlook & Rep Model" deck (June 2026).
//
// Goals are stored BY PRODUCT and BY CHANNEL (B2B / DTC):
//   B2B  — Base $1.2M / Stretch $1.4M (deck mix 85/8/7; base is Sam's
//          override: gummies $1,032k / xvie $96k / serum $72k).
//   DTC  — $120k/mo flat (90% gummies = $108k, 10% serum = $12k), applied
//          to both scenarios.
// Combined (All): Base $1.32M · Stretch $1.52M.
//
// Keyed by calendar month (YYYY-MM, UTC bucketing). Add a new month here to
// extend the Actual-vs-Goal scenario toggle; months without an entry fall
// back to the Sheet-backed per-rep goal sum.

// B2B net goals by scenario (deck base/stretch; base = Sam's override).
const B2B = {
  base:    { Gummies: 1_032_000, XVIE: 96_000,  Serum: 72_000 }, // $1.2M
  stretch: { Gummies: 1_190_000, XVIE: 112_000, Serum: 98_000 }, // $1.4M
};
// DTC net goal — flat $120k/mo (90% gummies / 10% serum), same both scenarios.
const DTC = { Gummies: 108_000, XVIE: 0, Serum: 12_000 };

export const SCENARIO_GOALS = {
  "2026-06": {
    base:    { B2B: B2B.base,    DTC }, // All = $1.32M
    stretch: { B2B: B2B.stretch, DTC }, // All = $1.52M
  },
};

export const SCENARIOS = [
  { key: "base", label: "Base" },
  { key: "stretch", label: "Stretch" },
];

// Channel filter for the Actual-vs-Goal section.
export const GOAL_CHANNELS = [
  { key: "All", label: "All" },
  { key: "B2B", label: "B2B" },
  { key: "DTC", label: "DTC" },
];

/** Whether scenario (base/stretch) goals exist for a given YYYY-MM. */
export function hasScenarioGoals(ym) {
  return !!(ym && SCENARIO_GOALS[ym]);
}

/**
 * Goal $ for a (month, scenario, product, channel); 0 when not defined.
 * channel: "B2B" | "DTC" | "All" (All = B2B + DTC).
 */
export function scenarioGoalFor(ym, scenario, product, channel = "All") {
  const s = SCENARIO_GOALS?.[ym]?.[scenario];
  if (!s) return 0;
  const b2b = Number(s.B2B?.[product] || 0);
  const dtc = Number(s.DTC?.[product] || 0);
  if (channel === "B2B") return b2b;
  if (channel === "DTC") return dtc;
  return b2b + dtc;
}
