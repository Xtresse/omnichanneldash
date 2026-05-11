// /api/budget — Budget vs Rep Goals data, sourced from a Google Sheet.
// See lib/budgetSheet.js for the auth + setup notes.

import { NextResponse } from "next/server";
import { loadBudgetAndGoals } from "@/lib/budgetSheet";

export const revalidate = 600; // 10 min cache

export async function GET() {
  try {
    const data = await loadBudgetAndGoals();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[/api/budget] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), mode: "stub", budget: {}, repGoals: {}, reps: [] },
      { status: 200 } // graceful degrade — UI shows "live data unavailable"
    );
  }
}
