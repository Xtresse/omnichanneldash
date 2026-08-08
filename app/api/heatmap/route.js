// /api/heatmap — precomputed rep × day grid (net sales + Ramp T&E spend).
//
// Same shape as /api/leaderboard, and deliberately so: small cached payload,
// stale-while-revalidate, refreshed by the crons rather than recomputed per
// request. The 2026-08-08 CPU incident came from exactly the opposite pattern,
// so this never walks raw orders on a page load.
//
// Sales come from buildDashboardData() at granularity "day" over rows served
// by the live delta cache, so the numbers match the rest of the dashboard and
// the pull is incremental.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { buildDashboardData } from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import { fetchWindowRowsLive } from "@/lib/liveRows.js";
import { getCachedEntry, setCachedData } from "@/lib/dataCache.js";
import { periodRange, heatmapCacheKey } from "@/lib/periodWindows.js";
import { buildHeatMap, spendByRepDay } from "@/lib/heatmap.js";
import { RAMP_CONFIGURED, fetchRampUsers, fetchRampTransactions } from "@/lib/ramp.js";
import { REPS } from "@/lib/reps.js";

export const maxDuration = 300;
export const revalidate = 300;

const FRESH_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Map Ramp user ids → rep names by normalized full name.
 *
 * Verified against live Ramp on 2026-08-08: 21 of 34 roster reps match. The 13
 * that don't are the 1099 contractors (plus Ryan Masa) — they don't carry
 * company cards, so having no Ramp user is correct, not a mapping failure.
 */
async function buildUserIdToRep() {
  const users = await fetchRampUsers();
  const repByNorm = Object.fromEntries(Object.keys(REPS).map((r) => [norm(r), r]));
  const out = {};
  for (const u of users) {
    const rep = repByNorm[norm(u.name)];
    if (rep) out[u.id] = rep;
  }
  return out;
}

/** Pull Ramp spend, degrading to "unavailable" rather than failing the panel. */
async function loadSpend(from, to) {
  if (!RAMP_CONFIGURED) {
    return {
      grid: {},
      available: false,
      reason: "no-credentials",
      detail: "RAMP_CLIENT_ID / RAMP_CLIENT_SECRET are not set on this deployment.",
    };
  }
  try {
    const [userIdToRep, txns] = await Promise.all([
      buildUserIdToRep(),
      fetchRampTransactions(from, to),
    ]);
    return {
      grid: spendByRepDay(txns, userIdToRep),
      available: true,
      reason: null,
      detail: null,
      mappedUsers: Object.keys(userIdToRep).length,
    };
  } catch (e) {
    const is403 = e?.status === 403 || /403/.test(String(e?.message || ""));
    return {
      grid: {},
      available: false,
      reason: is403 ? "missing-scope" : "error",
      detail: is403
        ? "Ramp OAuth app is missing the transactions:read scope (HTTP 403). Users read fine; spend cannot."
        : String(e?.message || e),
    };
  }
}

export async function computeHeatMap(from, to) {
  const [{ rows }, allTimeRows, spend] = await Promise.all([
    fetchWindowRowsLive(from, to, {}),
    fetchAllTimeRowsCached(),
    loadSpend(from, to),
  ]);
  // granularity "day" → repSalesMonthly is bucketed per calendar day.
  const data = buildDashboardData(rows, { from, to, granularity: "day" }, allTimeRows);
  const grid = buildHeatMap({
    repSalesDaily: data.repSalesMonthly || [],
    spendGrid: spend.grid,
    from,
    to,
    spendAvailable: spend.available,
  });
  return {
    ok: true,
    ...grid,
    spend: { available: spend.available, reason: spend.reason, detail: spend.detail },
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

  // A very wide window would render thousands of columns; cap it so nobody can
  // ask for a grid that's neither useful nor cheap.
  const spanDays =
    Math.round(
      (new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000
    ) + 1;
  if (spanDays > 400) {
    return NextResponse.json(
      { ok: false, error: `Window too wide for a daily grid (${spanDays} days, max 400).` },
      { status: 400 }
    );
  }

  const key = heatmapCacheKey(from, to);
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
            await setCachedData(key, await computeHeatMap(from, to));
          } catch {
            /* background refresh is best-effort */
          }
        })()
      );
      return NextResponse.json({ ...hit.data, cached: true, stale: true, cachedAt: hit.at });
    }

    const payload = await computeHeatMap(from, to);
    await setCachedData(key, payload);
    return NextResponse.json({ ...payload, cached: false, stale: false });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
