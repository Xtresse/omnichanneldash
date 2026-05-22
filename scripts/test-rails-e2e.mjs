// End-to-end test for the scenario rails. Run with the
// dataset-stub-loader.mjs loader, which replaces lib/rails/dataset.js
// with an in-memory fake so we exercise the real rail code paths
// without a Windsor key.

import { runRail, railManifest } from "../lib/rails/rails.js";
import { newRequestCtx } from "../lib/rails/dataset.js";

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

const ctx = newRequestCtx();

console.log("=== get_pacing (default eom) ===");
{
  const out = await runRail("get_pacing", {}, ctx);
  ok("returns period block", out?.period?.from && out?.period?.to);
  ok("horizon = eom", out.horizon === "eom");
  ok("has endDate", typeof out.endDate === "string");
  ok("completedDays is a number", isFiniteNum(out.completedDays));
  ok("remainingDays is a number", isFiniteNum(out.remainingDays));
  ok("channels.B2B.landing exists", isFiniteNum(out.channels.B2B.landing));
  ok("channels.ADCS.landing exists", isFiniteNum(out.channels.ADCS.landing));
  ok("channels.DTC.landing exists", isFiniteNum(out.channels.DTC.landing));
  ok("channels.total.landing exists", isFiniteNum(out.channels.total.landing));
  ok("familiesTotal present", out.familiesTotal?.landing != null);
  ok("note string present", typeof out.note === "string");
}

console.log("\n=== get_pacing (eoq) ===");
{
  const out = await runRail("get_pacing", { horizon: "eoq" }, ctx);
  ok("horizon = eoq", out.horizon === "eoq");
  ok("endDate is a quarter-end month", /-(03|06|09|12)-\d{2}$/.test(out.endDate));
}

console.log("\n=== run_scenario (baseline + growth) ===");
{
  const baseline = await runRail("run_scenario", { horizon: "eom" }, ctx);
  ok("baseline returns channels", baseline?.channels?.B2B?.landing != null);
  ok("baseline families array", Array.isArray(baseline.families));
  ok("baseline reps block", baseline.reps?.reps != null);
  ok("baseline retention block", baseline.retention?.latest != null);

  const grown = await runRail(
    "run_scenario",
    { horizon: "eom", growthPct: { B2B: 10, DTC: 5, ADCS: 0 } },
    ctx
  );
  ok(
    "growth increases B2B landing vs baseline",
    grown.channels.B2B.landing >= baseline.channels.B2B.landing
  );
  ok(
    "growth assumption echoed",
    grown.channels.B2B.growthPct === 10
  );

  const shrunk = await runRail(
    "run_scenario",
    { horizon: "eom", growthPct: { B2B: -50 } },
    ctx
  );
  ok(
    "-50% growth reduces B2B forward",
    shrunk.channels.B2B.forward < baseline.channels.B2B.forward
  );
}

console.log("\n=== run_scenario (family override) ===");
{
  const out = await runRail(
    "run_scenario",
    {
      horizon: "eom",
      growthPct: { B2B: 0, ADCS: 0, DTC: 0 },
      familyGrowthPct: { Gummies: 25 },
    },
    ctx
  );
  const gummy = out.families.find((f) => f.family === "Gummies");
  const serum = out.families.find((f) => f.family === "Serum");
  ok("Gummies override applied", gummy?.growthPct === 25);
  ok("Serum unaffected (blended=0)", serum?.growthPct === 0);
}

console.log("\n=== run_scenario (rep override) ===");
{
  const out = await runRail(
    "run_scenario",
    {
      horizon: "eom",
      repNewAccountsPerDay: { "Amy Pierre": 0.5 },
    },
    ctx
  );
  const amy = out.reps.reps.find((r) => r.rep === "Amy Pierre");
  ok("Amy override applied", amy?.overrideApplied === true);
  ok("Amy uses override rate", amy?.usedRatePerDay === 0.5);
}

console.log("\n=== run_scenario (custom horizon) ===");
{
  const out = await runRail(
    "run_scenario",
    { horizon: "custom", endDate: "2027-12-31" },
    ctx
  );
  ok("custom endDate honored", out.endDate === "2027-12-31");
  ok("remainingDays > 365 for next year", out.remainingDays > 365);
}

console.log("\n=== get_retention_metrics ===");
{
  const out = await runRail("get_retention_metrics", {}, ctx);
  ok("has period", out?.period?.from);
  ok("repeatRate array", Array.isArray(out.repeatRate));
  ok("latest object", out.latest?.B2B != null);
  ok("windowAverage object", out.windowAverage?.B2B != null);
  ok("newVsReturning array", Array.isArray(out.newVsReturning));
  ok("subscriptionVsOneTime array", Array.isArray(out.subscriptionVsOneTime));
}

console.log("\n=== get_rep_activity ===");
{
  const out = await runRail("get_rep_activity", { trailingDays: 30 }, ctx);
  ok("trailingDays echoed", out.trailingDays === 30);
  ok("horizon set", out.horizon === "eom");
  ok("reps array", Array.isArray(out.reps));
  const amy = out.reps.find((r) => r.rep === "Amy Pierre");
  ok("Amy in rep list", amy != null);
  ok("Amy has positive trailing count", amy && amy.trailingNewAccounts > 0);
  ok("totalProjectedNewAccounts non-negative", out.totalProjectedNewAccounts >= 0);
}

console.log("\n=== Error paths ===");
{
  let threw = false;
  try {
    await runRail("nonsense_rail", {}, ctx);
  } catch (e) {
    threw = /Unknown rail/i.test(String(e.message));
  }
  ok("unknown rail throws Unknown rail", threw);
}

console.log("\n=== Existing rails still work ===");
{
  const out = await runRail("get_kpis", { period: { preset: "mtd" } }, ctx);
  ok("get_kpis returns totals", out?.totals?.netSales != null);
  ok("get_kpis returns channels", out?.channels?.B2B?.netSales != null);

  const ts = await runRail("get_time_series", { period: { preset: "mtd" } }, ctx);
  ok("get_time_series returns series", Array.isArray(ts.series));

  const list = await runRail("list_rails", {}, ctx);
  ok("list_rails returns >= 18 rails", Array.isArray(list) && list.length >= 18);
}

console.log("\n=== Summary ===");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
