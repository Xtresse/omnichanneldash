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

// The dashboard has no DTC/B2B Shopify history before this, so a prior window
// that lands entirely before it isn't a real comparison — it's a wall of
// "new vs …". YTD's prior year (2025) is the case this guards.
const DATA_FLOOR = "2026-03-31";

/**
 * The period to compare each rep against, for the summary trend. The comparison
 * must match the SHAPE of the window, to-date:
 *
 *   MTD  → same calendar days of the prior month   ("Aug")
 *   QTD  → same span from the PRIOR quarter's start ("Q2")
 *   YTD  → same span from Jan 1 of the prior year   ("'25")
 *   range→ the equal-length span immediately before ("prior")
 *
 * `period` is AUTHORITATIVE and must be passed for the presets: during the first
 * month of a quarter, MTD and QTD produce byte-identical [from,to] windows (e.g.
 * Jul 1–15 is both), and Q1's QTD window equals YTD's — so the shape genuinely
 * cannot be recovered from dates alone. When `period` is absent (a direct API
 * hit with only from/to), we fall back to inferring the shape from the dates.
 * `comparable` is false when the prior window predates DATA_FLOOR, so the client
 * can omit the trend rather than show a meaningless one (e.g. YTD vs 2025).
 */
function priorWindow(from, to, period) {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  const fM = f.getUTCMonth();
  const fD = f.getUTCDate();
  const sameMonth = f.getUTCFullYear() === t.getUTCFullYear() && fM === t.getUTCMonth();
  const span = Math.round((t - f) / 86400000) + 1;
  const withFloor = (o) => ({ ...o, comparable: o.priorTo >= DATA_FLOOR });

  // Prior year, same span from Jan 1 — clamped so it can't spill past Dec 31.
  const ytd = () => {
    const py = f.getUTCFullYear() - 1;
    const pf = Date.UTC(py, 0, 1);
    const priorTo = Math.min(pf + (span - 1) * 86400000, Date.UTC(py, 11, 31));
    return withFloor({ priorFrom: iso(pf), priorTo: iso(priorTo), priorLabel: `'${String(py).slice(2)}` });
  };
  // Prior quarter, same span from its start — clamped to the prior quarter's
  // last day so a longer current quarter can't bleed into the current one.
  const qtd = () => {
    let py = f.getUTCFullYear();
    let pm = fM - 3;
    if (pm < 0) { pm += 12; py -= 1; }
    const pf = Date.UTC(py, pm, 1);
    const priorTo = Math.min(pf + (span - 1) * 86400000, Date.UTC(py, pm + 3, 0));
    return withFloor({ priorFrom: iso(pf), priorTo: iso(priorTo), priorLabel: `Q${Math.floor(pm / 3) + 1}` });
  };
  // Same calendar days of the prior month.
  const mtd = () => {
    const py = fM === 0 ? f.getUTCFullYear() - 1 : f.getUTCFullYear();
    const pm = (fM + 11) % 12;
    const lastOfPrior = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
    const dom = Math.min(t.getUTCDate(), lastOfPrior);
    const mm = String(pm + 1).padStart(2, "0");
    return withFloor({ priorFrom: `${py}-${mm}-01`, priorTo: `${py}-${mm}-${String(dom).padStart(2, "0")}`, priorLabel: MONTH_ABBR[pm] });
  };
  // Equal-length window immediately before this one.
  const rangePrior = () => {
    const pt = f.getTime() - 86400000;
    return withFloor({ priorFrom: iso(pt - (span - 1) * 86400000), priorTo: iso(pt), priorLabel: "prior" });
  };

  // Preset period wins (dates alone can't disambiguate MTD/QTD/YTD in a
  // quarter's or year's first month).
  if (period === "ytd") return ytd();
  if (period === "qtd") return qtd();
  if (period === "mtd") return mtd();
  if (period === "range") return rangePrior();
  // Fallback: infer from the dates (direct from/to call, no period).
  if (fD === 1 && fM === 0 && !sameMonth) return ytd();
  if (fD === 1 && fM % 3 === 0 && !sameMonth) return qtd();
  if (fD === 1 && sameMonth) return mtd();
  return rangePrior();
}

/**
 * @param {object} [pre] rows/allTimeRows the caller ALREADY has. /api/tick has
 *   just fetched both for this window, and re-fetching + re-aggregating them
 *   here is what made the slow tick do ~7 aggregations instead of 4.
 */
export async function computeHeatMap(from, to, pre = {}, period) {
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
  const { priorFrom, priorTo, priorLabel, comparable } = priorWindow(from, to, period);
  const priorByRep = {};
  try {
    // buildDashboardData does NOT filter rows by from/to — the caller passes
    // pre-windowed rows. Rather than a second Shopify pull (this route is
    // CPU-sensitive — see the 2026-08-08 incident), slice the all-time rows we
    // ALREADY have down to the prior window, then aggregate that.
    //
    // order_created_at is already shop-local, and buildDashboardData's dayKey
    // extracts its date directly on the production (UTC) host — so slice the
    // date off the same way. Running shopLocalDate() here re-converted a naive
    // shop-local string and disagreed with the grid's own bucketing.
    const priorRows = allTimeRows.filter((r) => {
      const d = (r.order_created_at || "").slice(0, 10);
      return d && d >= priorFrom && d <= priorTo;
    });
    const priorData = buildDashboardData(priorRows, { from: priorFrom, to: priorTo, granularity: "day" }, allTimeRows);
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
    priorComparable: comparable,
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
  // Explicit from/to wins (the client resolves the window in the shop timezone —
  // never trust a server-recomputed date). `period` is still read: it carries
  // the SHAPE for the prior-window trend, which dates alone can't recover during
  // the first month of a quarter/year (MTD and QTD are the same window then).
  if (ISO_DATE.test(fromParam || "") && ISO_DATE.test(toParam || "")) {
    from = fromParam;
    to = toParam;
  } else if (period) {
    const range = periodRange(period);
    if (!range) {
      return NextResponse.json(
        { ok: false, error: `Unknown period "${period}". Use mtd, qtd or ytd.` },
        { status: 400 }
      );
    }
    [from, to] = range;
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide ?period=mtd|qtd|ytd or ?from=YYYY-MM-DD&to=YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const shape = period || "auto"; // cache/prior-window shape token

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

  const key = heatmapCacheKey(from, to, shape);
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
            await setCachedData(key, await computeHeatMap(from, to, {}, period));
          } catch {
            /* background refresh is best-effort */
          }
        })()
      );
      return NextResponse.json({ ...hit.data, cached: true, stale: true, cachedAt: hit.at });
    }

    const payload = await computeHeatMap(from, to, {}, period);
    await setCachedData(key, payload);
    return NextResponse.json({ ...payload, cached: false, stale: false });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
