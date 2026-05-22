// Verify the rails registry exposes the scenario rails with the right
// schema shapes. We have to mock the Windsor + budget loaders since
// they're transitively imported — we just need the manifest + the
// run() functions to be addressable, not actually call Windsor.

// Stub the modules that would otherwise demand env vars.
import { Module } from "module";
const origResolve = Module._resolveFilename;
// Path alias `@/lib/...` is jsconfig-only; node doesn't understand it.
// Rewrite to relative paths.
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) {
    const rewritten = new URL(
      `../${request.slice(2)}`,
      `file://${parent.filename}`
    ).pathname;
    return origResolve.call(this, rewritten, parent, ...rest);
  }
  return origResolve.call(this, request, parent, ...rest);
};

// Direct import — we bypass dataset.js / windsor.js since they'd
// require env vars, but we DO want railManifest() so we can validate
// the shape returned to Claude.

const railsMod = await import("../lib/rails/rails.js").catch(async (e) => {
  // If the import fails because of the alias issue inside Next-only
  // ESM resolution, fall back to a structural test against the source.
  console.error("Could not import rails.js directly:", e?.message);
  process.exit(2);
});

const passed = [];
const failed = [];

function check(label, cond, detail) {
  if (cond) {
    passed.push(label);
    console.log(`  ✓ ${label}`);
  } else {
    failed.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

const names = railsMod.RAIL_NAMES;
const manifest = railsMod.railManifest();

console.log("=== Rail registry ===");
check("RAIL_NAMES is an array", Array.isArray(names));
check("Manifest length matches RAIL_NAMES", manifest.length === names.length);

const expected = [
  "list_rails",
  "get_kpis",
  "get_time_series",
  "get_product_family",
  "get_top_skus",
  "get_revenue_by_state",
  "get_discount_usage",
  "get_fulfillment_split",
  "get_customer_dynamics",
  "get_rep_performance",
  "get_budget_vs_actual",
  "get_variance",
  "get_reconciliation",
  "get_orders",
  // New scenario rails:
  "get_pacing",
  "run_scenario",
  "get_retention_metrics",
  "get_rep_activity",
];
for (const name of expected) {
  check(`Rail "${name}" registered`, names.includes(name));
}

console.log("\n=== Scenario rail shapes ===");
const byName = Object.fromEntries(manifest.map((r) => [r.name, r]));

// get_pacing
const pacing = byName.get_pacing;
check("get_pacing has description", pacing && pacing.description?.length > 50);
check(
  "get_pacing schema allows horizon enum",
  pacing?.input_schema?.properties?.horizon?.enum?.includes("eom")
);

// run_scenario
const scen = byName.run_scenario;
check("run_scenario has description", scen && scen.description?.length > 50);
check(
  "run_scenario schema accepts growthPct object",
  scen?.input_schema?.properties?.growthPct?.type === "object"
);
check(
  "run_scenario schema accepts familyGrowthPct",
  scen?.input_schema?.properties?.familyGrowthPct?.type === "object"
);
check(
  "run_scenario schema accepts retentionPct",
  scen?.input_schema?.properties?.retentionPct?.type === "object"
);
check(
  "run_scenario schema accepts repNewAccountsPerDay",
  scen?.input_schema?.properties?.repNewAccountsPerDay?.type === "object"
);
check(
  "run_scenario schema includes custom horizon option",
  scen?.input_schema?.properties?.horizon?.enum?.includes("custom")
);

// get_retention_metrics
const ret = byName.get_retention_metrics;
check(
  "get_retention_metrics schema includes period",
  ret?.input_schema?.properties?.period != null
);

// get_rep_activity
const ra = byName.get_rep_activity;
check(
  "get_rep_activity has trailingDays + horizon params",
  ra?.input_schema?.properties?.trailingDays != null &&
    ra?.input_schema?.properties?.horizon != null
);

// Every rail must have an input_schema with type=object.
for (const r of manifest) {
  check(
    `Rail "${r.name}" input_schema is type=object`,
    r.input_schema?.type === "object",
    JSON.stringify(r.input_schema)
  );
}

console.log("\n=== getRail() lookup ===");
check("getRail('run_scenario') returns def", railsMod.getRail("run_scenario") != null);
check("getRail('totally_made_up') returns null", railsMod.getRail("totally_made_up") == null);

console.log("\n=== Summary ===");
console.log(`  ${passed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
