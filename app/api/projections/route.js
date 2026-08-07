// /api/projections — editable target OVERRIDES that overlay the Google-Sheet
// budget cube (Budget / Base / Stretch, gross + net, per channel × product ×
// month). Persisted in Supabase (lib/projectionsStore). Gated by the dashboard
// password (middleware), so anon-key writes are safe.

import { NextResponse } from "next/server";
import { readOverrides, upsertOverride, deleteOverride, projectionsConfigured } from "@/lib/projectionsStore";
import { loadBudgetAndGoals } from "@/lib/budgetSheet";

export const dynamic = "force-dynamic";

// Current overrides + the sheet cube (so the editor shows sheet defaults and
// which cells have been adjusted).
export async function GET() {
  const overrides = await readOverrides();
  let sheet = null;
  try {
    const d = await loadBudgetAndGoals();
    sheet = d?.targets?.company || null;
  } catch (e) {
    console.error("[/api/projections] sheet load failed:", e?.message || e);
  }
  return NextResponse.json({ ok: true, configured: projectionsConfigured(), overrides, sheet });
}

// Upsert one row, or a batch via { rows: [...] }.
export async function POST(request) {
  try {
    const body = await request.json();
    if (Array.isArray(body?.rows)) {
      const saved = [];
      for (const row of body.rows) saved.push(await upsertOverride(row));
      return NextResponse.json({ ok: true, saved });
    }
    const saved = await upsertOverride(body);
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 200 });
  }
}

// Revert a channel × product × month back to the sheet value.
export async function DELETE(request) {
  try {
    const body = await request.json();
    await deleteOverride(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 200 });
  }
}
