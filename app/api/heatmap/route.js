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

// Ramp transactions are cached for the WIDEST window (year-to-date) and every
// narrower window is sliced out of that one pull.
//
// 2026-08-09: pulling Ramp per window took the slow tick from 21.7 s to 101 s
// — mtd, qtd and ytd each walking their own paginated transaction list, and
// ytd's is the whole year. Since mtd and qtd are strict subsets of ytd, that
// was the same rows fetched three times. One cached pull covers all three.
//
// 60 min TTL: card transactions settle over hours, so a daily grid cannot
// meaningfully change faster, and the wide pull is the single most expensive
// thing in the slow tick.
const RAMP_TTL_MS = 60 * 60 * 1000;
const rampCacheKey = (from, to) => `ramp:v1:${from}|${to}`;

async function fetchRampTransactionsCached(from, to) {
  const key = rampCacheKey(from, to);
  try {
    const hit = await getCachedEntry(key);
    if (hit && Date.now() - hit.at <= RAMP_TTL_MS && Array.isArray(hit.data)) {
      return hit.data;
    }
  } catch {
    /* cache miss → live pull */
  }
  const txns = await fetchRampTransactions(from, to);
  await setCachedData(key, txns).catch(() => {});
  return txns;
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
    // Widen to the start of `from`'s year so mtd/qtd/ytd all share ONE cached
    // pull. A window starting before that (custom range) falls back to its own.
    const yearStart = `${from.slice(0, 4)}-01-01`;
    const wideFrom = from >= yearStart ? yearStart : from;
    const [userIdToRep, wideTxns] = await Promise.all([
      buildUserIdToRep(),
      fetchRampTransactionsCached(wideFrom, to),
    ]);
    // Slice the shared pull down to the requested window.
    const txns =
      wideFrom === from
        ? wideTxns
        : wideTxns.filter((t) => {
            const d = String(t.at || "").slice(0, 10);
            return d && d >= from && d <= to;
          });
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

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The period to compare each rep against, for the "vs last month" trend in the
 * summary. A month-anchored window (MTD / a full month, from = the 1st) compares
 * to the SAME calendar days of the prior month (a fair pace read — "through day 5
 * of Sep vs day 5 of Aug"); any other window compares to the equal-length span
 * immediately before it.
 */
function priorWindow(from, to) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  if (f.getUTCDate() === 1) {
    const py = f.getUTCMonth() === 0 ? f.getUTCFullYear() - 1 : f.getUTCFullYear();
    const pm = (f.getUTCMonth() + 11) % 12;
    const lastOfPrior = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
    const dom = Math.min(t.getUTCDate(), lastOfPrior);
    const mm = String(pm + 1).padStart(2, "0");
    return { priorFrom: `${py}-${mm}-01`, priorTo: `${py}-${mm}-${String(dom).padStart(2, "0")}`, priorLabel: MONTH_ABBR[pm] };
  }
  const span = Math.round((t - f) / 86400000) + 1;
  const pt = new Date(f.getTime() - 86400000);
  const pf = new Date(pt.getTime() - (span - 1) * 86400000);
  return { priorFrom: iso(pf), priorTo: iso(pt), priorLabel: "prior" };
}

/**
 * @param {object} [pre] rows/allTimeRows the caller ALREADY has. /api/tick has
 *   just fetched both for this window, and re-fetching + re-aggregating them
 *   here is what made the slow tick do ~7 aggregations instead of 4.
 */
export async function computeHeatMap(from, to, pre = {}) {
  const [rows, allTimeRows, spend] = await Promise.all([
    pre.rows ? Promise.resolve(pre.rows) : fetchWindowRowsLive(from, to, {}).then((r) => r.rows),
    pre.allTimeRows ? Promise.resolve(pre.allTimeRows) : fetchAllTimeRowsCached(),
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

  // Per-rep prior-period net for the trend, from the already-fetched all-time
  // rows (no extra pull). Same buildDashboardData path, so the numbers tie.
  const { priorFrom, priorTo, priorLabel } = priorWindow(from, to);
  const priorByRep = {};
  try {
    const priorData = buildDashboardData(allTimeRows, { from: priorFrom, to: priorTo, granularity: "day" }, allTimeRows);
    for (const row of priorData.repSalesMonthly || []) {
      for (const [k, v] of Object.entries(row)) {
        if (k === "month" || k === "label") continue;
        priorByRep[k] = (priorByRep[k] || 0) + (Number(v) || 0);
      }
    }
  } catch { /* trend is best-effort — a rep just shows no comparison */ }
  grid.rows = grid.rows.map((r) => ({ ...r, priorNet: Math.round(priorByRep[r.rep] || 0) }));

  return {
    ok: true,
    ...grid,
    priorLabel,
    priorWindow: { from: priorFrom, to: priorTo },
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
