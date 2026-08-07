// /api/budget — Budget vs Rep Goals data, sourced from a Google Sheet.
// See lib/budgetSheet.js for the auth + setup notes.

import { NextResponse } from "next/server";
import { loadBudgetAndGoals } from "@/lib/budgetSheet";
import { readOverrides, mergeOverrides } from "@/lib/projectionsStore";

export const dynamic = "force-dynamic"; // overrides must reflect promptly after an edit

export async function GET() {
  try {
    const data = await loadBudgetAndGoals();
    // Overlay the editable Supabase overrides (Projections tab) onto the sheet
    // cube, so every consumer (Actual-vs-Goal card, PDF recap) reads the
    // adjusted Budget/Base/Stretch × gross/net targets automatically.
    const overrides = await readOverrides();
    const targets = data?.targets ? mergeOverrides(data.targets, overrides) : data?.targets;
    return NextResponse.json({ ok: true, ...data, targets });
  } catch (err) {
    console.error("[/api/budget] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), mode: "stub", budget: {}, repGoals: {}, reps: [] },
      { status: 200 } // graceful degrade — UI shows "live data unavailable"
    );
  }
}
