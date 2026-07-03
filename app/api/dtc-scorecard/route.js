// /api/dtc-scorecard — weekly DTC growth scorecard, sourced from the
// Google Sheet Jose/Sam maintain. See lib/dtcScorecardSheet.js for layout
// notes and env overrides.

import { NextResponse } from "next/server";
import { loadDtcScorecard } from "@/lib/dtcScorecardSheet";

export const revalidate = 600; // 10 min cache — matches /api/budget

export async function GET() {
  try {
    const data = await loadDtcScorecard();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[/api/dtc-scorecard] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), mode: "stub", weeks: [], sections: [] },
      { status: 200 } // graceful degrade — UI shows "live data unavailable"
    );
  }
}
