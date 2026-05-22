// /api/scenario/snapshot — server-side scenario snapshot for the
// /scenarios UI. The page sends the current horizon + assumption
// values, this endpoint pulls trailing actuals from Windsor (via
// the same rail dataset loader), runs buildScenarioSnapshot, and
// returns the structured projection.
//
// Kept separate from the chat route so the UI can re-render the
// projection cards without spending a Claude tool call on every
// slider tweak. The same math runs inside the run_scenario rail so
// the chat and the UI cards stay perfectly aligned.

import { NextResponse } from "next/server";
import { newRequestCtx } from "@/lib/rails/dataset.js";
import { runRail } from "@/lib/rails/rails.js";

const HORIZONS = new Set(["eom", "eoq", "eoy", "custom"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function clampNum(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function sanitizeAssumptions(input = {}) {
  const out = {};
  if (input.growthPct && typeof input.growthPct === "object") {
    const g = {};
    for (const ch of ["B2B", "ADCS", "DTC"]) {
      const v = clampNum(input.growthPct[ch], -90, 500);
      if (v != null) g[ch] = v;
    }
    if (Object.keys(g).length) out.growthPct = g;
  }
  if (input.familyGrowthPct && typeof input.familyGrowthPct === "object") {
    const f = {};
    for (const fam of ["Gummies", "Serum", "XVIE", "Sachets"]) {
      const v = clampNum(input.familyGrowthPct[fam], -90, 500);
      if (v != null) f[fam] = v;
    }
    if (Object.keys(f).length) out.familyGrowthPct = f;
  }
  if (input.retentionPct && typeof input.retentionPct === "object") {
    const r = {};
    for (const ch of ["B2B", "ADCS", "DTC"]) {
      const v = clampNum(input.retentionPct[ch], 0, 100);
      if (v != null) r[ch] = v;
    }
    if (Object.keys(r).length) out.retentionPct = r;
  }
  if (
    input.repNewAccountsPerDay &&
    typeof input.repNewAccountsPerDay === "object"
  ) {
    const r = {};
    for (const [k, v] of Object.entries(input.repNewAccountsPerDay)) {
      const n = clampNum(v, 0, 10);
      if (n != null) r[k] = n;
    }
    if (Object.keys(r).length) out.repNewAccountsPerDay = r;
  }
  return out;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const horizon = HORIZONS.has(body?.horizon) ? body.horizon : "eom";
  const endDate = body?.endDate;
  if (horizon === "custom" && (!endDate || !ISO_DATE.test(endDate))) {
    return NextResponse.json(
      { ok: false, error: "horizon=custom requires endDate=YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const trailingDays = clampNum(body?.trailingDays, 7, 180);
  const assumptions = sanitizeAssumptions(body || {});

  try {
    const ctx = newRequestCtx();
    // Run two rails in sequence on the same ctx so they share the
    // Windsor fetch: the scenario itself (which the run_scenario rail
    // builds in full) and a separate trailing-30 rep-activity table
    // that the UI's rep slider list seeds itself from. Both reuse the
    // same dataset under the hood thanks to ctx-level memoization.
    const scenario = await runRail(
      "run_scenario",
      {
        horizon,
        endDate,
        trailingDays: trailingDays || undefined,
        ...assumptions,
      },
      ctx
    );
    const repActivity = await runRail(
      "get_rep_activity",
      { trailingDays: 30, horizon: horizon === "custom" ? "custom" : horizon, endDate },
      ctx
    );

    return NextResponse.json({
      ok: true,
      horizon,
      endDate: scenario.endDate,
      todayDate: scenario.todayDate,
      remainingDays: scenario.remainingDays,
      completedDays: scenario.completedDays,
      trailingWindow: scenario.trailingWindow,
      assumptions: scenario.assumptions,
      channels: scenario.channels,
      families: scenario.families,
      familiesTotal: scenario.familiesTotal,
      reps: scenario.reps,
      retention: scenario.retention,
      repActivityTrailing30: repActivity,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
