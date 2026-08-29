// /api/territory-tick — periodic pull of the live territory map from
// Sales-Rep-Dashboards, diffed and stored so /territory always shows
// current data instead of a static workbook that quietly drifts out of
// sync (see the 2026-08-28 session that built this: wrong FL panhandle
// owner, a departed rep still showing up, a new 1099 never wired in).
//
// Coalesced like /api/tag-tick: skip unless enough time has passed since
// the last capture, or ?force=1 with TERRITORY_TICK_TOKEN. Unlike tag-tick
// there's no dirty-queue — this is a periodic pull, not webhook-driven.
//
// On fetch failure, insert an error row but carry the last-good
// state_map/zip_detail forward so /territory never shows a hole.

import { NextResponse } from "next/server";
import { fetchTerritoryExport, territoryClientConfigured } from "@/lib/territoryClient.js";
import {
  readLatestSnapshot,
  readLatestGoodSnapshot,
  insertSnapshot,
  diffSnapshots,
  readManualEntries,
  markManualEntryApplied,
} from "@/lib/territoryStore.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_REFRESH_INTERVAL_MS = Number(process.env.TERRITORY_MIN_REFRESH_INTERVAL_MS) || 15 * 60 * 1000;

export async function GET(request) {
  const started = Date.now();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  if (force) {
    const token = url.searchParams.get("token");
    const expected = process.env.TERRITORY_TICK_TOKEN;
    if (!expected || token !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const last = await readLatestSnapshot();
  const since = last?.captured_at ? Date.now() - new Date(last.captured_at).getTime() : Infinity;
  if (!force && since < MIN_REFRESH_INTERVAL_MS) {
    return NextResponse.json({ ok: true, ran: false, reason: "coalesced", sinceLastMs: since, ms: Date.now() - started });
  }

  if (!territoryClientConfigured()) {
    return NextResponse.json({ ok: false, ran: false, reason: "not_configured", ms: Date.now() - started });
  }

  const prevGood = await readLatestGoodSnapshot();

  let exportData;
  let fetchError = null;
  try {
    exportData = await fetchTerritoryExport();
  } catch (e) {
    fetchError = String(e?.message || e);
  }

  let saved;
  if (fetchError) {
    // Carry the last-good map forward so reads never see a hole.
    saved = await insertSnapshot({
      status: "error",
      error_message: fetchError,
      state_map: prevGood?.state_map || {},
      zip_detail: prevGood?.zip_detail || {},
      rep_roster: prevGood?.rep_roster || [],
      meta: prevGood?.meta || {},
      diff_summary: null,
      changed: false,
    });
  } else {
    const diff = diffSnapshots(prevGood, { state_map: exportData.stateMap, zip_detail: exportData.zipDetail });
    const changed = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
    saved = await insertSnapshot({
      status: "ok",
      error_message: null,
      source_generated_at: exportData.meta?.generatedAt || null,
      state_map: exportData.stateMap,
      zip_detail: exportData.zipDetail,
      rep_roster: exportData.currentReps || [],
      meta: exportData.meta || {},
      diff_summary: prevGood ? diff : null, // null on the very first (seed) snapshot
      changed: prevGood ? changed : true,
    });

    // Auto-detect manual entries that now resolve to their declared rep_slug
    // in the fresh pull — close the loop without needing write access to
    // the sibling repo (see lib/territoryStore.js buildOverrideSnippet).
    const pending = (await readManualEntries()).filter(
      (e) => e.status !== "applied_upstream" && e.rep_slug
    );
    for (const entry of pending) {
      const resolvesForState = (entry.states || []).every(
        (s) => exportData.stateMap?.[s]?.rep === entry.rep_slug
      );
      const resolvesForZip = (entry.zip_prefixes || []).every((z3) => {
        for (const zips of Object.values(exportData.zipDetail || {})) {
          if (zips[z3]) return zips[z3].rep === entry.rep_slug;
        }
        return false;
      });
      const hasAnyCriteria = (entry.states || []).length || (entry.zip_prefixes || []).length;
      if (hasAnyCriteria && resolvesForState && resolvesForZip) {
        await markManualEntryApplied(entry.id).catch(() => {});
      }
    }
  }

  return NextResponse.json({
    ok: !fetchError,
    ran: true,
    status: saved.status,
    changed: saved.changed,
    diffCounts: saved.diff_summary
      ? {
          added: saved.diff_summary.added?.length || 0,
          removed: saved.diff_summary.removed?.length || 0,
          changed: saved.diff_summary.changed?.length || 0,
        }
      : null,
    error: fetchError,
    ms: Date.now() - started,
  });
}

export async function POST(request) {
  return GET(request);
}
