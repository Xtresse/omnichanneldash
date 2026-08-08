// /api/leaderboard — PRECOMPUTED rep rankings for a period (MTD/QTD/YTD).
//
// Why this exists (2026-08-08 CPU incident):
// The rep leaderboard used to call /api/dashboard for its window and throw
// away ~99% of the response. For YTD that response is 6.75 MB — 87% of it the
// raw `orders` array (10k rows) that the leaderboard never looks at. That
// payload had grown past the 1 MB KV value ceiling, so it stopped caching and
// every YTD request became a full ~60 s recompute.
//
// This route returns ONLY `repPerformance` — ~50 KB instead of 6.75 MB. It
// caches comfortably, it's cheap to ship, and /api/warm precomputes all three
// periods every 10 minutes so a click almost always lands on a warm copy.
//
// NO METRIC LOGIC LIVES HERE. The rankings come from buildDashboardData()'s
// `repPerformance` exactly as before — this route only decides what to pull,
// what to keep, and what to cache.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import { getCachedEntry, setCachedData } from "@/lib/dataCache.js";
import { periodRange, leaderboardCacheKey } from "@/lib/periodWindows.js";

export const maxDuration = 300; // a cold YTD build needs more than 60 s
export const revalidate = 300;

// Stale-while-revalidate, same shape as /api/dashboard:
//   ≤ FRESH  → serve as-is
//   ≤ MAX    → serve the stale copy INSTANTLY, refresh in the background
//   older    → compute synchronously
// The 10-minute cron keeps all three periods inside FRESH, so in practice
// users get an instant hit and the data is never more than ~10 min old.
const FRESH_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the small leaderboard payload for a window.
 *
 * Reuses the full dashboard payload when a copy is already cached for the same
 * window (common: the user is sitting on that range, or the warmer just ran) —
 * slicing repPerformance out of it costs nothing and avoids a second identical
 * Shopify pull + aggregate.
 */
export async function computeLeaderboard(from, to, dashboardEntry) {
  if (dashboardEntry?.data?.repPerformance) {
    return {
      from,
      to,
      repPerformance: dashboardEntry.data.repPerformance,
      generatedAt: new Date(dashboardEntry.at).toISOString(),
      source: "dashboard-cache",
    };
  }
  const q = { from, to };
  const [raw, allTimeRows] = await Promise.all([
    fetchWindsorRows(q),
    fetchAllTimeRowsCached(),
  ]);
  const data = buildDashboardData(raw, { ...q, granularity: "auto" }, allTimeRows);
  return {
    from,
    to,
    repPerformance: data.repPerformance || [],
    generatedAt: new Date().toISOString(),
    source: "computed",
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let from;
  let to;
  if (period) {
    const range = periodRange(period);
    if (!range) {
      return NextResponse.json(
        { ok: false, error: `Unknown period "${period}". Use mtd, qtd or ytd.` },
        { status: 400 }
      );
    }
    [from, to] = range;
  } else if (ISO_DATE.test(fromParam || "") && ISO_DATE.test(toParam || "")) {
    from = fromParam;
    to = toParam;
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide ?period=mtd|qtd|ytd or ?from=YYYY-MM-DD&to=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const key = leaderboardCacheKey(from, to);
  // Same key format /api/dashboard uses, so we can reuse a warm full payload.
  const dashKey =
    "dash:v4:" +
    JSON.stringify({ q: { from, to }, granularity: "auto", compareMode: "off" });

  const compute = async () => {
    const dash = await getCachedEntry(dashKey);
    const fresh = dash && Date.now() - dash.at <= FRESH_MS ? dash : null;
    return { ok: true, ...(await computeLeaderboard(from, to, fresh)) };
  };

  try {
    const hit = await getCachedEntry(key);
    const age = hit ? Date.now() - hit.at : Infinity;

    if (hit && age <= FRESH_MS) {
      return NextResponse.json({ ...hit.data, cached: true, stale: false, cachedAt: hit.at });
    }

    if (hit && age <= MAX_AGE_MS) {
      waitUntil(
        (async () => {
          try {
            await setCachedData(key, await compute());
          } catch {
            /* background refresh is best-effort */
          }
        })()
      );
      return NextResponse.json({ ...hit.data, cached: true, stale: true, cachedAt: hit.at });
    }

    const payload = await compute();
    await setCachedData(key, payload);
    return NextResponse.json({ ...payload, cached: false, stale: false });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
