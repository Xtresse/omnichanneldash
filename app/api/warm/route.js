// /api/warm — CRON PRE-WARM. Recomputes and caches the handful of common
// dashboard views so the first real click of the day serves a warm KV copy
// instead of paying the ~11s cold Shopify pull + buildDashboardData.
//
// Mirrors app/api/dashboard/route.js exactly: same fetch+build pipeline, same
// KV cache key format ("dash:v1:" + JSON.stringify({ q, granularity,
// compareMode })) and same setCachedData call — so a warmed entry is a cache
// HIT for the matching /api/dashboard request.
//
// Pre-warms the common presets at granularity "auto", compare "off". Resilient:
// one window's failure never throws the whole route — each is caught and
// reported per-window. Hit by a Vercel cron every 10 min (see vercel.json).

import { NextResponse } from "next/server";
import {
  fetchWindsorRows,
  fetchWindsorAllTimeLight,
  buildDashboardData,
} from "@/lib/windsor.js";
import { setCachedData } from "@/lib/dataCache.js";

// Cold pull can take ~11s; allow headroom since we warm several windows.
export const maxDuration = 60;
// Never serve a cached HTTP response for the warmer itself — it must run.
export const dynamic = "force-dynamic";

// Common views to keep warm. Granularity "auto" + compare "off" matches the
// dashboard's default client requests for these presets.
const WARM_PRESETS = ["last_7d", "last_30d", "last_3m", "last_6m", "last_12m"];

export async function GET() {
  const granularity = "auto";
  const compareMode = "off";

  // Fetch the all-time light pull ONCE and reuse it across every window — it's
  // window-independent and the single most expensive piece. If it fails, fall
  // back to [] per window (buildDashboardData tolerates an empty all-time set).
  let allTimeRows = [];
  let allTimeError = null;
  try {
    allTimeRows = await fetchWindsorAllTimeLight();
  } catch (err) {
    allTimeError = String(err?.message || err);
    allTimeRows = [];
  }

  const results = [];
  for (const preset of WARM_PRESETS) {
    const queryParams = { preset };
    // EXACT same cache key format as app/api/dashboard/route.js.
    const cacheKey =
      "dash:v1:" + JSON.stringify({ q: queryParams, granularity, compareMode });
    try {
      const raw = await fetchWindsorRows(queryParams);
      const data = buildDashboardData(raw, { ...queryParams, granularity }, allTimeRows);
      const payload = {
        ok: true,
        ...queryParams,
        granularity,
        compareMode,
        compare: null,
        ...data,
      };
      await setCachedData(cacheKey, payload);
      results.push({ preset, ok: true });
    } catch (err) {
      // One window's failure must not abort the rest.
      results.push({ preset, ok: false, error: String(err?.message || err) });
    }
  }

  const warmed = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    warmedAt: new Date().toISOString(),
    warmed,
    total: results.length,
    allTimeError,
    results,
  });
}
