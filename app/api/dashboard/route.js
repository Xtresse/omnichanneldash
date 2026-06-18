import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  fetchWindsorRows,
  buildDashboardData,
  buildCompareSnapshot,
  computeCompareWindow,
} from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import { getCachedEntry, setCachedData } from "@/lib/dataCache.js";
export const maxDuration = 60; // cold pull + background SWR refresh headroom

// 5-minute cache on the API. Browser still gets a fresh response per query
// (preset/from/to combinations cache independently).
export const revalidate = 300;

// Stale-while-revalidate thresholds for the shared (cross-instance) KV payload:
//   • FRESH_MS  — serve as-is, no refresh.
//   • MAX_AGE_MS — serve the stale copy INSTANTLY and refresh in the background
//     (Vercel waitUntil), so a user never waits on a cold Shopify pull once a
//     window has been computed once. The 10-min cron keeps common windows fresh
//     so they almost always fall in the FRESH band anyway.
// Older than MAX_AGE (or a true cache miss) → compute synchronously.
const FRESH_MS = 60 * 60 * 1000; // 60 min
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

const ALLOWED_PRESETS = new Set([
  "last_7d",
  "last_30d",
  "last_3m",
  "last_6m",
  "last_12m",
  "last_year",
  "this_year",
  "last_2years",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GRANULARITY = new Set(["auto", "day", "week", "biweek", "month"]);
const ALLOWED_COMPARE = new Set(["off", "prior", "yoy"]);

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const granularityParam = url.searchParams.get("granularity");
  const granularity = ALLOWED_GRANULARITY.has(granularityParam) ? granularityParam : "auto";
  const compareParam = url.searchParams.get("compare");
  const compareMode = ALLOWED_COMPARE.has(compareParam) ? compareParam : "off";

  let queryParams;
  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam)) {
    queryParams = { from: fromParam, to: toParam };
  } else {
    const preset = ALLOWED_PRESETS.has(presetParam) ? presetParam : "last_3m";
    queryParams = { preset };
  }

  // Compute the prior-comparison window only when explicit from/to dates
  // are provided (preset-only requests don't carry enough info; the client
  // always passes from/to, so this branch is the common path).
  const compareWindow =
    compareMode !== "off" && queryParams.from && queryParams.to
      ? computeCompareWindow(queryParams.from, queryParams.to, compareMode)
      : null;

  // Stable cache signature for this exact view (window + granularity + compare).
  const cacheKey =
    "dash:v1:" +
    JSON.stringify({ q: queryParams, granularity, compareMode });

  // Recompute the payload from source (window pull + the CACHED all-time pull,
  // so the dominant full-history cost is paid at most once an hour).
  const compute = async () => {
    const [raw, allTimeRows, compareRaw] = await Promise.all([
      fetchWindsorRows(queryParams),
      fetchAllTimeRowsCached(),
      compareWindow ? fetchWindsorRows(compareWindow) : Promise.resolve(null),
    ]);
    const data = buildDashboardData(raw, { ...queryParams, granularity }, allTimeRows);
    let compare = null;
    if (compareWindow && compareRaw) {
      const snapshot = buildCompareSnapshot(compareRaw, compareWindow);
      compare = { mode: compareMode, from: compareWindow.from, to: compareWindow.to, ...snapshot };
    }
    return { ok: true, ...queryParams, granularity, compareMode, compare, ...data };
  };

  try {
    const hit = await getCachedEntry(cacheKey);
    const age = hit ? Date.now() - hit.at : Infinity;

    // Fresh → serve as-is.
    if (hit && age <= FRESH_MS) {
      return NextResponse.json({ ...hit.data, cached: true, stale: false, cachedAt: hit.at });
    }

    // Stale but within max-age → serve INSTANTLY, refresh in the background so
    // the caller never blocks on a cold pull. waitUntil keeps the function
    // alive until the refresh + cache write settle (bounded by maxDuration).
    if (hit && age <= MAX_AGE_MS) {
      waitUntil(
        (async () => {
          try {
            const fresh = await compute();
            await setCachedData(cacheKey, fresh);
          } catch {
            /* background refresh is best-effort */
          }
        })()
      );
      return NextResponse.json({ ...hit.data, cached: true, stale: true, cachedAt: hit.at });
    }

    // Miss (or older than max-age) → compute synchronously, cache, return.
    const payload = await compute();
    await setCachedData(cacheKey, payload); // best-effort; never breaks the response
    return NextResponse.json({ ...payload, cached: false, stale: false });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
