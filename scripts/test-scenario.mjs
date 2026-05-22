// Deterministic tests for the scenario math layer. Pure functions only —
// no Windsor, no API calls. Run via: `node --experimental-vm-modules
// scripts/test-scenario.mjs`. Exits non-zero on any failure.

import {
  resolveHorizon,
  windowStartFor,
  dailyRate,
  projectChannels,
  projectFamilies,
  projectRepActivity,
  buildScenarioSnapshot,
} from "../lib/rails/scenario.js";

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push({ label, actual, expected });
    console.log(`  ✗ ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

function near(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label} (${actual} ≈ ${expected})`);
  } else {
    failed += 1;
    failures.push({ label, actual, expected });
    console.log(`  ✗ ${label} expected ~${expected} got ${actual}`);
  }
}

function truthy(val, label) {
  if (val) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push({ label, actual: val });
    console.log(`  ✗ ${label} (got ${val})`);
  }
}

const FIXED_NOW = new Date(Date.UTC(2026, 4, 15, 12)); // 2026-05-15T12:00 UTC

console.log("\n=== dailyRate ===");
eq(dailyRate(0, 10), 0, "zero sum");
eq(dailyRate(1000, 10), 100, "1000 over 10 days");
eq(dailyRate(1000, 0), 0, "zero days returns 0 (no extrapolation)");
eq(dailyRate(1000, -1), 0, "negative days returns 0");

console.log("\n=== resolveHorizon (now=2026-05-15) ===");
const eom = resolveHorizon({ horizon: "eom", now: FIXED_NOW });
eq(eom.endDate, "2026-05-31", "EOM date for May 2026");
eq(eom.remainingDays, 16, "EOM remaining days from May 15");
const eoq = resolveHorizon({ horizon: "eoq", now: FIXED_NOW });
eq(eoq.endDate, "2026-06-30", "EOQ date (Q2 ends Jun 30)");
eq(eoq.remainingDays, 46, "EOQ remaining days from May 15");
const eoy = resolveHorizon({ horizon: "eoy", now: FIXED_NOW });
eq(eoy.endDate, "2026-12-31", "EOY date");
eq(eoy.remainingDays, 230, "EOY remaining days from May 15");
const custom = resolveHorizon({
  horizon: "custom",
  endDate: "2026-08-01",
  now: FIXED_NOW,
});
eq(custom.endDate, "2026-08-01", "custom honors endDate");
eq(custom.remainingDays, 78, "custom remaining days");

let threw = false;
try {
  resolveHorizon({ horizon: "custom", now: FIXED_NOW });
} catch {
  threw = true;
}
truthy(threw, "custom without endDate throws");

threw = false;
try {
  resolveHorizon({ horizon: "next_decade", now: FIXED_NOW });
} catch {
  threw = true;
}
truthy(threw, "unknown horizon throws");

console.log("\n=== windowStartFor ===");
eq(windowStartFor("eom", FIXED_NOW).toISOString().slice(0, 10), "2026-05-01", "EOM window start = 1st of month");
eq(windowStartFor("eoq", FIXED_NOW).toISOString().slice(0, 10), "2026-04-01", "EOQ window start = 1st of quarter");
eq(windowStartFor("eoy", FIXED_NOW).toISOString().slice(0, 10), "2026-01-01", "EOY window start = 1st of year");

console.log("\n=== projectChannels ===");
const result = projectChannels({
  actuals: { B2B: 100000, ADCS: 20000, DTC: 30000, completedDays: 10 },
  assumptions: { growthPct: { B2B: 0, ADCS: 0, DTC: 0 } },
  horizon: "eom",
  now: FIXED_NOW,
});
// Daily rates: B2B 10000, ADCS 2000, DTC 3000. Remaining = 16.
// Forward: B2B 160000, ADCS 32000, DTC 48000.
// Landing: 260000, 52000, 78000. Total = 390000.
eq(result.channels.B2B.dailyRate, 10000, "B2B daily rate");
eq(result.channels.B2B.forward, 160000, "B2B forward");
eq(result.channels.B2B.landing, 260000, "B2B landing");
eq(result.channels.DTC.dailyRate, 3000, "DTC daily rate");
eq(result.channels.DTC.forward, 48000, "DTC forward");
eq(result.channels.DTC.landing, 78000, "DTC landing");
eq(result.channels.total.landing, 390000, "total landing");
eq(result.channels.total.completedDays, 10, "completedDays passthrough");
eq(result.channels.total.remainingDays, 16, "remainingDays from horizon");

const withGrowth = projectChannels({
  actuals: { B2B: 100000, ADCS: 0, DTC: 30000, completedDays: 10 },
  assumptions: { growthPct: { B2B: 10, DTC: -50 } },
  horizon: "eom",
  now: FIXED_NOW,
});
// B2B forward: 10000 × 16 × 1.10 = 176000.
// DTC forward: 3000 × 16 × 0.50 = 24000.
eq(withGrowth.channels.B2B.forward, 176000, "B2B +10% growth");
eq(withGrowth.channels.DTC.forward, 24000, "DTC -50% growth");
eq(withGrowth.channels.B2B.landing, 276000, "B2B landing with growth");
eq(withGrowth.channels.DTC.landing, 54000, "DTC landing with churn");

// First-of-month edge case: zero completed days.
const dayZero = projectChannels({
  actuals: { B2B: 0, ADCS: 0, DTC: 0, completedDays: 0 },
  assumptions: {},
  horizon: "eom",
  now: FIXED_NOW,
});
eq(dayZero.channels.B2B.dailyRate, 0, "day 0: zero rate");
eq(dayZero.channels.B2B.forward, 0, "day 0: zero forward");
eq(dayZero.channels.total.landing, 0, "day 0: zero landing");

console.log("\n=== projectFamilies ===");
const famResult = projectFamilies({
  familyActuals: [
    { family: "Gummies", B2B: 50000, ADCS: 0, DTC: 10000 },
    { family: "Serum", B2B: 20000, ADCS: 0, DTC: 5000 },
    { family: "XVIE", B2B: 5000, ADCS: 0, DTC: 0 },
  ],
  completedDays: 10,
  channelGrowthPct: { B2B: 10, DTC: 0 },
  horizon: "eom",
  now: FIXED_NOW,
});
// Gummies total = 60000, rate = 6000, blended growth = (50000/60000)*10 + (10000/60000)*0 = 8.33...
// Forward = 6000 × 16 × 1.0833 ≈ 104000
eq(famResult.families[0].family, "Gummies", "first family is Gummies");
near(famResult.families[0].growthPct, 8.3, 0.1, "Gummies blended growth ~8.3");
near(famResult.families[0].forward, 104000, 100, "Gummies forward");
eq(famResult.families[0].actualToDate, 60000, "Gummies actual to date");

// Family override.
const famOverride = projectFamilies({
  familyActuals: [{ family: "Serum", B2B: 25000, ADCS: 0, DTC: 0 }],
  completedDays: 10,
  channelGrowthPct: { B2B: 10 },
  familyGrowthPct: { Serum: -25 },
  horizon: "eom",
  now: FIXED_NOW,
});
// Rate = 2500, override = -25, forward = 2500 × 16 × 0.75 = 30000
eq(famOverride.families[0].forward, 30000, "Serum family override -25% wins over channel +10");
eq(famOverride.families[0].growthPct, -25, "explicit family growth honored");

console.log("\n=== projectRepActivity ===");
const repResult = projectRepActivity({
  trailingByRep: {
    "Amy Pierre": { newAccounts: 6, days: 30 },
    "Megan Gilbert": { newAccounts: 3, days: 30 },
    "Heidi Fisher": { newAccounts: 0, days: 30 },
  },
  overridesPerDay: { "Megan Gilbert": 0.5 }, // override above trailing
  horizon: "eom",
  now: FIXED_NOW,
});
// Amy: 6/30 = 0.2/d × 16 = 3.2 → 3
// Megan override: 0.5 × 16 = 8
// Heidi: 0
eq(repResult.reps.length, 3, "all reps returned");
const amy = repResult.reps.find((r) => r.rep === "Amy Pierre");
eq(amy.trailingRatePerDay, 0.2, "Amy trailing rate");
eq(amy.usedRatePerDay, 0.2, "Amy uses trailing (no override)");
eq(amy.overrideApplied, false, "Amy not overridden");
eq(amy.projectedNewAccounts, 3, "Amy forecast");
const megan = repResult.reps.find((r) => r.rep === "Megan Gilbert");
eq(megan.usedRatePerDay, 0.5, "Megan uses override");
eq(megan.overrideApplied, true, "Megan override flag");
eq(megan.projectedNewAccounts, 8, "Megan forecast with override");
eq(repResult.totalProjectedNewAccounts, 11, "total projected");
// Sorted descending: Megan (8) → Amy (3) → Heidi (0)
eq(repResult.reps[0].rep, "Megan Gilbert", "sorted by projection desc");

console.log("\n=== buildScenarioSnapshot ===");
const snap = buildScenarioSnapshot({
  dashboardData: {
    kpis: {
      b2bNetSales: 150000,
      adcsNetSales: 10000,
      dtcNetSales: 25000,
    },
    productFamily: [
      { family: "Gummies", B2B: 80000, ADCS: 0, DTC: 10000 },
      { family: "Serum", B2B: 30000, ADCS: 0, DTC: 5000 },
    ],
    repNewAccountsMonthly: [
      { month: "2026-05", label: "May", "Amy Pierre": 5, "Megan Gilbert": 2 },
    ],
    repeatRate: [
      { month: "2026-04", label: "Apr", B2B: 60, DTC: 40 },
      { month: "2026-05", label: "May", B2B: 65, DTC: 45 },
    ],
  },
  windowDates: { from: "2026-05-01", to: "2026-05-14" },
  assumptions: { growthPct: { B2B: 5, DTC: 0 } },
  horizon: "eom",
  now: FIXED_NOW,
});
// completedDays = 14 (May 1 → May 14 inclusive)
eq(snap.completedDays, 14, "completedDays from window");
eq(snap.remainingDays, 16, "remainingDays from horizon");
eq(snap.horizon, "eom", "horizon passthrough");
truthy(snap.channels.B2B.landing > 150000, "B2B landing > actual");
eq(snap.channels.B2B.actualToDate, 150000, "B2B actual to date");
truthy(Array.isArray(snap.families), "families array");
eq(snap.families.length, 2, "two families");
truthy(Array.isArray(snap.reps.reps), "reps array");
eq(snap.retention.latest.B2B, 65, "latest B2B retention");
eq(snap.retention.latest.DTC, 45, "latest DTC retention");
eq(snap.retention.windowAvg.B2B, 62.5, "B2B retention window avg");
eq(snap.retention.windowAvg.DTC, 42.5, "DTC retention window avg");

// Custom horizon honored.
const customSnap = buildScenarioSnapshot({
  dashboardData: { kpis: {}, productFamily: [], repNewAccountsMonthly: [] },
  windowDates: { from: "2026-05-01", to: "2026-05-14" },
  assumptions: {},
  horizon: "eom",
  now: FIXED_NOW,
});
eq(customSnap.endDate, "2026-05-31", "snapshot.endDate honored");

console.log("\n=== Summary ===");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(" •", f.label);
  process.exit(1);
}
