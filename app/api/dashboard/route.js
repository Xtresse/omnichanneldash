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
import { loadCosts } from "@/lib/costsSheet.js";
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
const RELATIVE_DATE = /^today(-(\d+))?$/;
const DAY_MS = 86400000;
const ALLOWED_GRANULARITY = new Set(["auto", "day", "week", "biweek", "month"]);
const ALLOWED_COMPARE = new Set(["off", "prior", "yoy"]);

// Accepts an absolute YYYY-MM-DD or a relative token ("today", "today-N").
// Returns null for anything else so callers can distinguish "not provided"
// from "malformed" instead of silently drifting onto a different window.
function resolveDateParam(value) {
  if (!value) return null;
  if (ISO_DATE.test(value)) return value;
  const m = RELATIVE_DATE.exec(value);
  if (!m) return null;
  const offsetDays = m[2] ? parseInt(m[2], 10) : 0;
  return new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const granularityParam = url.searchParams.get("granularity");
  const granularity = ALLOWED_GRANULARITY.has(granularityParam) ? granularityParam : "auto";
  const compareParam = url.searchParams.get("compare");
  const compareMode = ALLOWED_COMPARE.has(compareParam) ? compareParam : "off";

  const fromResolved = resolveDateParam(fromParam);
  const toResolved = resolveDateParam(toParam);

  let queryParams;
  if (fromResolved && toResolved) {
    queryParams = { from: fromResolved, to: toResolved };
  } else if (fromParam || toParam) {
    // A from/to was attempted but didn't resolve — fail loudly instead of
    // silently substituting a different (much wider) preset window, which
    // previously made `to=today` quietly return ~last_3m data.
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid from/to. Use YYYY-MM-DD or "today"/"today-N". Got from=${fromParam ?? ""} to=${toParam ?? ""}`,
      },
      { status: 400 }
    );
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
  // v3 (2026-07-15): key bumps orphan pre-fix KV payloads (KV is cross-deploy;
  // FRESH_MS would otherwise serve them up to 60 min). v2 = b2b-beats-hasDtcSku
  // fix; v3 = channel decision delegated to the canonical classifyChannel
  // (which also un-broke the JSON-encoded discount-code B2B patterns).
  const cacheKey =
    "dash:v3:" +
    JSON.stringify({ q: queryParams, granularity, compareMode });

  // Recompute the payload from source (window pull + the CACHED all-time pull,
  // so the dominant full-history cost is paid at most once an hour).
  const compute = async () => {
    const [raw, allTimeRows, compareRaw, costs] = await Promise.all([
      fetchWindsorRows(queryParams),
      fetchAllTimeRowsCached(),
      compareWindow ? fetchWindsorRows(compareWindow) : Promise.resolve(null),
      loadCosts().catch(() => null), // sheet costs — never block the dashboard
    ]);
    const data = buildDashboardData(raw, { ...queryParams, granularity }, allTimeRows, costs);
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
