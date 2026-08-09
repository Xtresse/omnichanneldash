// /api/tick — the live refresher. Runs every minute (vercel.json).
//
// Reconciles "live" with "fast" (Sam, 2026-08-08):
//
//   Shopify webhook  →  sets a dirty marker (milliseconds, no compute)
//   this tick        →  IF dirty, refreshes the live windows, clears the marker
//   page load        →  always served from cache, instantly
//
// Two properties make this cheap enough to run every minute, which the naive
// version ("just warm everything more often") is not — a full /api/warm run
// measured 114 s, so at 1-minute cadence it would never finish:
//
//   1. COALESCING. However many orders land in a minute, this does at most ONE
//      refresh. When nothing changed it does a single KV read and exits, so an
//      idle store costs essentially nothing.
//   2. DELTA PULLS. lib/liveRows.js re-pulls only the days that actually
//      changed and reuses cached history, so refreshing YTD costs about what
//      refreshing today costs — not the ~60 s a cold YTD pull takes.
//   3. TIERED CADENCE. today/mtd refresh every minute; qtd/ytd and the heat
//      map every 5. Doing all of it every minute took the tick to 19 s and
//      re-fired the CPU alert on 2026-08-08 — see lib/liveState.js.
//
// NO METRIC LOGIC HERE. Every number still comes from buildDashboardData()
// over an equivalent row set; this only decides when to recompute and what to
// store.

import { NextResponse } from "next/server";
import { buildDashboardData } from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import { fetchWindowRowsLive } from "@/lib/liveRows.js";
import { getCachedData, setCachedData } from "@/lib/dataCache.js";
import { loadCosts } from "@/lib/costsSheet.js";
import {
  periodRange,
  leaderboardCacheKey,
  dashboardCacheKey,
  heatmapCacheKey,
} from "@/lib/periodWindows.js";
import { computeHeatMap } from "../heatmap/route.js";
import {
  DIRTY_KEY,
  TICK_KEY,
  DIRTY_TTL_MS,
  TICK_TTL_MS,
  LIVE_PERIODS_FAST,
  LIVE_PERIODS_SLOW,
  SLOW_INTERVAL_MS,
  LIVE_LEADERBOARD_PERIODS,
  LIVE_HEATMAP_PERIODS,
  MIN_REFRESH_INTERVAL_MS,
} from "@/lib/liveState.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const started = Date.now();
  const url = new URL(request.url);
  // ?force=1 refreshes even when no webhook has fired — used to verify the
  // path end-to-end and to recover if a webhook delivery was ever missed.
  const force = url.searchParams.get("force") === "1";

  const [dirtyHit, tickHit] = await Promise.all([
    getCachedData(DIRTY_KEY, DIRTY_TTL_MS).catch(() => null),
    getCachedData(TICK_KEY, TICK_TTL_MS).catch(() => null),
  ]);
  const dirty = dirtyHit?.data || null;
  const lastTick = tickHit?.data || null;

  // Nothing changed → the cheap path. One KV read, no Shopify, no aggregation.
  if (!dirty && !force) {
    return NextResponse.json({
      ok: true,
      refreshed: false,
      reason: "clean",
      lastTickAt: lastTick?.at || null,
      ms: Date.now() - started,
    });
  }

  // Coalescing guard: a burst of webhooks must not turn into a refresh each.
  const since = lastTick?.at ? Date.now() - new Date(lastTick.at).getTime() : Infinity;
  if (!force && since < MIN_REFRESH_INTERVAL_MS) {
    return NextResponse.json({
      ok: true,
      refreshed: false,
      reason: "coalesced",
      sinceLastMs: since,
      pending: dirty?.pending || 0,
      ms: Date.now() - started,
    });
  }

  const dirtyFrom = dirty?.dirtyFrom || null;

  // Claim the slot BEFORE doing any work. The cron fires every minute but a
  // cold rebuild can run longer than that; if the timestamp were only written
  // at the end, the next tick would see a stale lastTick, decide it was clear
  // to run, and stampede a second full rebuild on top of the first.
  const claimedAt = new Date().toISOString();
  await setCachedData(TICK_KEY, {
    at: claimedAt,
    running: true,
    lastSlowAt: lastTick?.lastSlowAt || null,
    results: lastTick?.results || [],
  }).catch(() => {});

  // Clear the marker BEFORE recomputing. A webhook that lands mid-refresh then
  // re-dirties, and the next tick picks it up — safe. Clearing afterwards
  // would swallow that change entirely.
  await setCachedData(DIRTY_KEY, null).catch(() => {});

  const [allTimeRows, costs] = await Promise.all([
    fetchAllTimeRowsCached(),
    loadCosts().catch(() => null),
  ]);

  // Only fold the expensive windows (and the heat map) in every SLOW_INTERVAL.
  // Doing them every minute is what took the tick to 19 s and re-fired the CPU
  // alert; they gain nothing from minute-level freshness.
  const lastSlowAt = lastTick?.lastSlowAt ? new Date(lastTick.lastSlowAt).getTime() : 0;
  const doSlow = force || Date.now() - lastSlowAt >= SLOW_INTERVAL_MS;
  const periods = doSlow
    ? [...LIVE_PERIODS_FAST, ...LIVE_PERIODS_SLOW]
    : LIVE_PERIODS_FAST;

  const results = [];
  for (const period of periods) {
    const range = periodRange(period);
    if (!range) continue;
    const [from, to] = range;
    try {
      const { rows, mode, pulledFrom } = await fetchWindowRowsLive(from, to, {
        dirtyFrom,
      });
      const data = buildDashboardData(
        rows,
        { from, to, granularity: "auto" },
        allTimeRows,
        costs
      );
      const payload = {
        ok: true,
        from,
        to,
        granularity: "auto",
        compareMode: "off",
        compare: null,
        ...data,
      };
      const dash = await setCachedData(dashboardCacheKey(from, to), payload);

      let lb = null;
      if (LIVE_LEADERBOARD_PERIODS.includes(period)) {
        lb = await setCachedData(leaderboardCacheKey(from, to), {
          ok: true,
          from,
          to,
          repPerformance: data.repPerformance || [],
          generatedAt: new Date().toISOString(),
          source: "tick",
        });
      }
      // Precompute the rep × day heat map off the SAME rows — one extra
      // aggregation at daily granularity, no extra Shopify pull.
      let hm = null;
      if (doSlow && LIVE_HEATMAP_PERIODS.includes(period)) {
        try {
          hm = await setCachedData(
            heatmapCacheKey(from, to),
            await computeHeatMap(from, to, { rows, allTimeRows })
          );
        } catch {
          /* the heat map must never take the tick down */
        }
      }

      results.push({
        period,
        from,
        to,
        mode,
        pulledFrom,
        rows: rows.length,
        dashOk: !!dash?.ok,
        dashParts: dash?.parts || 1,
        lbOk: lb ? !!lb.ok : null,
        hmOk: hm ? !!hm.ok : null,
      });
    } catch (err) {
      // One window failing must not abort the rest, and must not lose the
      // dirty marker — re-dirty so the next tick retries this window.
      results.push({ period, from, to, ok: false, error: String(err?.message || err) });
      await setCachedData(DIRTY_KEY, {
        dirtyFrom: dirtyFrom || from,
        pending: 1,
        lastTopic: "tick-retry",
        lastAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  const at = new Date().toISOString();
  await setCachedData(TICK_KEY, {
    at,
    lastSlowAt: doSlow ? at : lastTick?.lastSlowAt || null,
    ms: Date.now() - started,
    results,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    refreshed: true,
    trigger: force ? "force" : "webhook",
    cadence: doSlow ? "fast+slow" : "fast",
    dirtyFrom,
    pending: dirty?.pending || 0,
    at,
    ms: Date.now() - started,
    results,
  });
}
