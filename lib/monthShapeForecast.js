// =============================================================================
// MONTH-SHAPE (final-week-lift) FORECAST  —  repo-local, data-driven
// =============================================================================
// Replaces the flat MTD run-rate month-end projection with an EMPIRICAL one:
// project the finish using the fraction of the month's net that HISTORICALLY
// lands by the current day-of-month, per channel, averaged over the last N
// closed months.
//
// Why: a flat run-rate assumes revenue is spread evenly, but B2B clusters into
// the back of the month (reorders + final-week close). Backtest on B2B net
// (Feb–Jun 2026, standing on day 25): the month-shape model predicts the close
// within ~3%, while the flat run-rate misses by ~14% (it reads "weak month"
// when the finish is on-track). This is Scott Stepe's "higher close rates in
// the final week / consistency over the past several months" — quantified.
//
// IMPORTANT (why NOT an account-level reorder model): a per-account "these
// accounts are due to reorder" projection was tested and rejected — only ~10%
// of "due" accounts actually reorder within the window (June cohort: 20 of 208).
// The aggregate month-shape is the honest predictor; the reorder-due list is an
// OUTREACH tool (who to call), not a revenue forecast. (Sam, 2026-07-25.)
//
// Pure computation over the canonical order rows + classifyChannel — no
// framework/server deps beyond the shared core.
// =============================================================================

import { classifyChannel } from "./xtresseCore.js";

const netOf = (r) =>
  Math.max(0, (Number(r.order_subtotal_price) || 0) - (Number(r.order_refunds_subtotal) || 0));
const chOf = (r) =>
  classifyChannel({ tagsRaw: r.order_tags, discountCodesRaw: r.order_discount_codes });
const ymdOf = (r) => String(r.order_created_at || "").slice(0, 10);

function daysInMonthOf(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Collapse line-item rows to one net per order (order fields repeat per line).
// Memoized by the input array's reference: the warm cron fetches allTimeRows
// ONCE and feeds the same array to buildDashboardData for every window, so
// this heavy dedup/classify pass runs a single time per request instead of
// once per warmed window (keeps the endpoint off the 60s function ceiling).
const _orderNetsCache = new WeakMap();
function orderNets(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const hit = _orderNetsCache.get(rows);
  if (hit) return hit;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = r.order_name || r.order_id;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const d = ymdOf(r);
    if (!d) continue;
    out.push({ d, ch: chOf(r), net: netOf(r) });
  }
  _orderNetsCache.set(rows, out);
  return out;
}

/**
 * Trailing-average fraction of each recent CLOSED month's net that had landed
 * by the day-of-month of `asOfYmd`, per channel.
 *
 * Returns { [channel]: { fraction, samples, perMonth:[{ym,f}], dayOfMonth } }.
 * `fraction` is null when there isn't enough history — callers fall back to the
 * flat run-rate in that case.
 */
export function completionFractions(allTimeRows, asOfYmd, lookbackMonths = 4, channels = ["B2B", "DTC"]) {
  const asOf = String(asOfYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return {};
  const curYm = asOf.slice(0, 7);
  const D = Number(asOf.slice(8, 10));

  // Accumulate full-month and through-day-D net per (month, channel).
  const acc = new Map(); // `${ym}|${ch}` -> { full, thru }
  for (const o of orderNets(allTimeRows)) {
    if (!channels.includes(o.ch)) continue;
    const ym = o.d.slice(0, 7);
    if (ym >= curYm) continue; // only months strictly before the current one (closed)
    const day = Number(o.d.slice(8, 10));
    const cap = Math.min(D, daysInMonthOf(ym)); // guard shorter months
    const k = `${ym}|${o.ch}`;
    if (!acc.has(k)) acc.set(k, { full: 0, thru: 0 });
    const a = acc.get(k);
    a.full += o.net;
    if (day <= cap) a.thru += o.net;
  }

  const out = {};
  for (const ch of channels) {
    const months = [
      ...new Set(
        [...acc.keys()].filter((k) => k.endsWith("|" + ch)).map((k) => k.split("|")[0])
      ),
    ]
      .sort()
      .reverse()
      .slice(0, lookbackMonths);
    const perMonth = [];
    for (const ym of months) {
      const a = acc.get(`${ym}|${ch}`);
      if (a && a.full > 0) perMonth.push({ ym, f: a.thru / a.full });
    }
    const fraction = perMonth.length ? perMonth.reduce((s, x) => s + x.f, 0) / perMonth.length : null;
    out[ch] = { fraction, samples: perMonth.length, perMonth, dayOfMonth: D };
  }
  return out;
}

/**
 * Month-end finish for one channel from its MTD actual and completion fraction.
 * Returns null when the fraction is missing/zero so the caller can fall back.
 */
export function monthShapeFinish(mtdActual, cfEntry) {
  const frac = cfEntry && Number(cfEntry.fraction);
  if (!frac || frac <= 0) return null;
  return Number(mtdActual || 0) / frac;
}
