// /api/territory — read model + manual-entry write for the /territory page.
// GET: latest snapshot + recent diff history + pending manual entries.
// POST: create/update a manual entry (generates its TERRITORY_OVERRIDES
// snippet — see lib/territoryStore.js buildOverrideSnippet).

import { NextResponse } from "next/server";
import {
  readLatestSnapshot,
  readSnapshotHistory,
  readManualEntries,
  upsertManualEntry,
} from "@/lib/territoryStore.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const [latest, history, manualEntries] = await Promise.all([
    readLatestSnapshot(),
    readSnapshotHistory(30),
    readManualEntries(),
  ]);
  return NextResponse.json({ latest, history, manualEntries });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const saved = await upsertManualEntry(body);
    return NextResponse.json({ ok: true, entry: saved });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
