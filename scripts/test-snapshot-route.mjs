// Test the /api/scenario/snapshot Next.js route handler directly.
// Builds a fake Request, calls POST(), asserts the JSON shape.

import { POST } from "../app/api/scenario/snapshot/route.js";

function makeRequest(body) {
  return {
    async json() {
      return body;
    },
  };
}

async function callRoute(body) {
  const res = await POST(makeRequest(body));
  return { status: res.status, json: await res.json() };
}

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

console.log("=== Snapshot route: defaults ===");
{
  const { status, json } = await callRoute({});
  ok("status 200", status === 200 || status === undefined);
  ok("ok=true", json.ok === true);
  ok("default horizon = eom", json.horizon === "eom");
  ok("has endDate", typeof json.endDate === "string");
  ok("has channels block", json.channels?.B2B?.landing != null);
  ok("has families", Array.isArray(json.families));
  ok("has reps block", json.reps?.reps != null);
  ok("retention block", json.retention?.latest != null);
  ok("repActivityTrailing30 included", json.repActivityTrailing30?.reps != null);
  ok("generatedAt timestamp", typeof json.generatedAt === "string");
  ok("assumptions echoed", json.assumptions?.growthPct != null);
}

console.log("\n=== Snapshot route: with growth assumptions ===");
{
  const { json } = await callRoute({
    horizon: "eom",
    growthPct: { B2B: 15, ADCS: 0, DTC: -10 },
    retentionPct: { DTC: 50 },
  });
  ok("growth B2B = 15", json.channels.B2B.growthPct === 15);
  ok("growth DTC = -10", json.channels.DTC.growthPct === -10);
  ok("retention DTC = 50", json.channels.DTC.retentionPct === 50);
}

console.log("\n=== Snapshot route: input sanitization ===");
{
  // Out-of-range growth gets clamped, not rejected.
  const { json } = await callRoute({
    horizon: "eom",
    growthPct: { B2B: 99999 }, // should clamp to 500
  });
  ok("absurd growth clamped to 500", json.channels.B2B.growthPct === 500);

  const { json: j2 } = await callRoute({
    horizon: "eom",
    growthPct: { B2B: -99 }, // clamp to -90
  });
  ok("negative growth clamped to -90", j2.channels.B2B.growthPct === -90);

  const { json: j3 } = await callRoute({
    horizon: "eom",
    growthPct: { B2B: "not-a-number" },
  });
  ok("garbage growth defaults to 0", j3.channels.B2B.growthPct === 0);
}

console.log("\n=== Snapshot route: family override ===");
{
  const { json } = await callRoute({
    horizon: "eom",
    familyGrowthPct: { Gummies: 30 },
  });
  const gummy = json.families.find((f) => f.family === "Gummies");
  ok("Gummies family override applied", gummy?.growthPct === 30);
}

console.log("\n=== Snapshot route: rep override ===");
{
  const { json } = await callRoute({
    horizon: "eom",
    repNewAccountsPerDay: { "Amy Pierre": 0.75 },
  });
  const amy = json.reps.reps.find((r) => r.rep === "Amy Pierre");
  ok("Amy override applied", amy?.overrideApplied === true);
  ok("Amy uses 0.75/d", amy?.usedRatePerDay === 0.75);
}

console.log("\n=== Snapshot route: rep override with bad value clamped ===");
{
  const { json } = await callRoute({
    horizon: "eom",
    repNewAccountsPerDay: { "Amy Pierre": 99 }, // clamp to 10
  });
  const amy = json.reps.reps.find((r) => r.rep === "Amy Pierre");
  ok("rep override clamped to 10", amy?.usedRatePerDay === 10);
}

console.log("\n=== Snapshot route: custom horizon validation ===");
{
  const { status, json } = await callRoute({ horizon: "custom" });
  ok("custom without endDate rejected", json.ok === false);
  ok("status 400", status === 400);

  const { json: bad } = await callRoute({
    horizon: "custom",
    endDate: "not-a-date",
  });
  ok("custom with bad endDate rejected", bad.ok === false);

  const { json: good } = await callRoute({
    horizon: "custom",
    endDate: "2027-06-30",
  });
  ok("custom with valid endDate accepted", good.ok === true);
  ok("custom endDate echoed", good.endDate === "2027-06-30");
}

console.log("\n=== Snapshot route: horizon variants ===");
{
  for (const h of ["eom", "eoq", "eoy"]) {
    const { json } = await callRoute({ horizon: h });
    ok(`${h} returns ok`, json.ok === true);
    ok(`${h} horizon echoed`, json.horizon === h);
  }
}

console.log("\n=== Summary ===");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
