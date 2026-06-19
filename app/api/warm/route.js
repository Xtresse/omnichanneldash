// /api/warm — CRON PRE-WARM. Recomputes and caches the dashboard views behind
// every quick-pick button so the first real click serves a warm KV copy
// instead of paying the cold Shopify pull + buildDashboardData.
//
// CRITICAL: the client (FilterBar) resolves every preset to explicit from/to
// dates (anchored in Eastern Time) and ALWAYS sends from/to — never `preset`.
// So a warmed entry only HITS if it's keyed by the SAME from/to the client
// computes. This route therefore mirrors FilterBar's ET date math exactly and
// keys each entry as "dash:v1:" + JSON.stringify({ q:{from,to}, granularity,
// compareMode }) — identical to app/api/dashboard/route.js.
//
// The expensive all-time history pull is fetched ONCE (via the cached getter,
// which also refreshes the shared "dash:v1:alltime" entry) and reused across
// every window. Window pulls run with a small concurrency cap so we don't
// hammer Shopify. Resilient: one window's failure never aborts the rest.
// Hit by a Vercel cron every 10 min (see vercel.json).

import { NextResponse } from "next/server";
import {
  fetchWindsorRows,
  buildDashboardData,
} from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import { setCachedData } from "@/lib/dataCache.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic"; // the warmer must always run

// ── ET-anchored date helpers (mirror components/FilterBar.jsx) ───────────────
const ET_TZ = "America/New_York";
const pad = (n) => String(n).padStart(2, "0");
const etTodayD = () => {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return new Date(s + "T00:00:00");
};
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };

// FilterBar's "All time" anchor — keep in sync (components/FilterBar.jsx).
const ALL_TIME_START = "2024-01-01";

// Every quick-pick window the client can request, resolved to from/to exactly
// as FilterBar does. lastNd(n) = N days inclusive of today (matches the client's
// addDays(t, -(n-1)) form). last_7/180/365d are warmed per the brief even
// though they're not all FilterBar buttons today.
function warmWindows() {
  const t = etTodayD();
  const q = Math.floor(t.getMonth() / 3);
  const sm = startOfMonth(t);
  const lmEnd = addDays(sm, -1);
  const ws = startOfWeek(t);
  const lastNd = (n) => [ymd(addDays(t, -(n - 1))), ymd(t)];
  return [
    { label: "today", from: ymd(t), to: ymd(t) },
    { label: "this_week", from: ymd(ws), to: ymd(t) },
    { label: "last_week", from: ymd(addDays(ws, -7)), to: ymd(addDays(ws, -1)) },
    { label: "mtd", from: ymd(sm), to: ymd(t) },
    { label: "last_month", from: ymd(startOfMonth(lmEnd)), to: ymd(lmEnd) },
    { label: "qtd", from: ymd(new Date(t.getFullYear(), q * 3, 1)), to: ymd(t) },
    { label: "ytd", from: ymd(startOfYear(t)), to: ymd(t) },
    { label: "last_year", from: ymd(new Date(t.getFullYear() - 1, 0, 1)), to: ymd(new Date(t.getFullYear() - 1, 11, 31)) },
    { label: "last_7d", from: lastNd(7)[0], to: lastNd(7)[1] },
    { label: "last_30d", from: lastNd(30)[0], to: lastNd(30)[1] },
    { label: "last_90d", from: lastNd(90)[0], to: lastNd(90)[1] },
    { label: "last_180d", from: lastNd(180)[0], to: lastNd(180)[1] },
    { label: "last_365d", from: lastNd(365)[0], to: lastNd(365)[1] },
    // All time — the biggest, slowest window. Warm it so SWR serves it instant.
    // Its raw rows ARE the all-time rows, so we reuse them (no second full pull).
    { label: "all_time", from: ALL_TIME_START, to: ymd(t), allTime: true },
  ];
}

// Run async tasks with a small concurrency cap (protects Shopify rate limits).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET() {
  const granularity = "auto";
  const compareMode = "off";

  // Fetch (and refresh) the all-time history ONCE; reuse across every window.
  let allTimeRows = [];
  let allTimeError = null;
  try {
    allTimeRows = await fetchAllTimeRowsCached();
  } catch (err) {
    allTimeError = String(err?.message || err);
    allTimeRows = [];
  }

  const windows = warmWindows();
  const results = await mapLimit(windows, 4, async (w) => {
    const queryParams = { from: w.from, to: w.to };
    // EXACT same cache key format as app/api/dashboard/route.js.
    const cacheKey =
      "dash:v1:" + JSON.stringify({ q: queryParams, granularity, compareMode });
    try {
      // For the all-time window the raw rows ARE the all-time rows we already
      // pulled — reuse them instead of a second full-history Shopify pull. If
      // that pull failed (empty), skip rather than cache an empty all-time view.
      let raw;
      if (w.allTime) {
        if (!allTimeRows.length) {
          return { label: w.label, from: w.from, to: w.to, ok: false, error: "all-time rows unavailable" };
        }
        raw = allTimeRows;
      } else {
        raw = await fetchWindsorRows(queryParams);
      }
      const data = buildDashboardData(raw, { ...queryParams, granularity }, allTimeRows);
      const payload = {
        ok: true,
        ...queryParams,
        granularity,
        compareMode,
        compare: null,
        ...data,
      };
      const status = await setCachedData(cacheKey, payload);
      return { label: w.label, from: w.from, to: w.to, ok: !!status?.ok, status };
    } catch (err) {
      return { label: w.label, from: w.from, to: w.to, ok: false, error: String(err?.message || err) };
    }
  });

  const warmed = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    warmedAt: new Date().toISOString(),
    warmed,
    total: results.length,
    allTimeError,
    allTimeRows: Array.isArray(allTimeRows) ? allTimeRows.length : 0,
    results,
  });
}
