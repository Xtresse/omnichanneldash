// =============================================================================
// Live row cache — incremental (delta) refresh of a window's raw Shopify rows.
// =============================================================================
// Sam (2026-08-08): the numbers should be essentially live, without going back
// to the uncached per-request pulls that caused the 4× CPU spike.
//
// The expensive part of refreshing a window is the Shopify PULL, not the
// aggregation. A YTD pull walks ~10k orders and takes ~60 s; re-aggregating
// those same rows in JS is a few hundred ms. So the trick is to stop
// re-pulling history we already have.
//
// This module caches a window's RAW rows alongside how far they're known-good
// (`coveredThrough`). A refresh then pulls only [coveredThrough .. today] —
// normally a single day, a handful of orders — splices it over the cached
// rows, and hands the merged set to the SAME buildDashboardData() as before.
//
// NO METRIC LOGIC LIVES HERE. This decides what to fetch and what to keep in
// memory; every number is still computed by buildDashboardData() from an
// equivalent row set.
//
// Correctness notes:
//   • The delta ALWAYS re-pulls the coveredThrough day itself, never
//     coveredThrough+1. That day was captured mid-flight and is partial.
//   • Splicing drops every cached row on/after the delta's start date before
//     concatenating, so edits, refunds, cancellations and deletions inside the
//     delta range are reflected — a vanished order simply isn't in the re-pull.
//   • A refund or edit to an OLDER order is outside a today-only delta, so the
//     webhook records that order's date as `dirtyFrom` and the delta widens to
//     start there instead. Still far cheaper than a full re-pull.
//   • The pull uses `status:any`, so cancelled orders come back and net to 0
//     exactly as they do on the full path.

import { shopLocalDate } from "./xtresseCore.js";
import { getCachedData, setCachedData } from "./dataCache.js";

// windsor.js is imported lazily (inside the fetch path) rather than at module
// load. It pulls in the ZIP geo dataset via a bundler alias, which makes this
// module unimportable outside Next — and the splice logic below is exactly the
// part that most needs to be unit-testable in isolation.
async function windsor() {
  return import("./windsor.js");
}

// How long a cached row set may be extended by deltas before it's rebuilt from
// scratch. This is a DRIFT BOUND, not a performance knob: if the splice logic
// were ever subtly wrong, the error can only live this long before a clean
// full pull replaces it. 30 min costs one full pull per live window per half
// hour and keeps deltas cheap in between.
//
// Second, independent corrector: /api/warm still does FULL pulls every 10 min
// and writes the same aggregate keys, so a bad delta can't sit in front of
// users for long even before the rebuild.
const ROWS_TTL_MS = 30 * 60 * 1000;

const rowsKey = (from, to) => `rows:v1:${from}|${to}`;

/** Shop-local calendar day for a row, matching how windows are bucketed. */
function rowDay(r) {
  const iso = r?.order_created_at;
  if (!iso) return null;
  try {
    return shopLocalDate(iso);
  } catch {
    return null;
  }
}

/**
 * Drop every base row dated on/after `fromDay`, then append the fresh rows.
 * Rows with an unparseable date are kept — they can't be matched to a day, so
 * dropping them would lose data the full path would have counted.
 */
export function spliceRows(baseRows, deltaRows, fromDay) {
  const kept = [];
  for (const r of baseRows) {
    const d = rowDay(r);
    if (d && d >= fromDay) continue; // superseded by the re-pull
    kept.push(r);
  }
  return kept.concat(deltaRows);
}

/**
 * Rows for [from, to], refreshed incrementally where possible.
 *
 * @param {string} from        window start (YYYY-MM-DD)
 * @param {string} to          window end (YYYY-MM-DD)
 * @param {object} opts
 * @param {string} [opts.dirtyFrom]  earliest order date known to have changed;
 *                                   widens the delta so old edits are caught
 * @param {boolean} [opts.force]     ignore the cache and do a full pull
 * @returns {Promise<{rows: Array, mode: string, pulledFrom: string|null}>}
 */
export async function fetchWindowRowsLive(from, to, { dirtyFrom, force } = {}) {
  const { fetchWindsorRows } = await windsor();

  if (force) {
    const rows = await fetchWindsorRows({ from, to });
    await setCachedData(rowsKey(from, to), { rows, coveredThrough: to });
    return { rows, mode: "full", pulledFrom: from };
  }

  let hit = null;
  try {
    hit = await getCachedData(rowsKey(from, to), ROWS_TTL_MS);
  } catch {
    /* treat a cache error as a miss */
  }

  const cached = hit?.data;
  if (!Array.isArray(cached?.rows) || !cached?.coveredThrough) {
    const rows = await fetchWindsorRows({ from, to });
    await setCachedData(rowsKey(from, to), { rows, coveredThrough: to });
    return { rows, mode: "full", pulledFrom: from };
  }

  // Re-pull from the coveredThrough day (partial when captured), pulled back
  // further if a webhook told us an older order changed. Never before `from` —
  // that's outside this window.
  let deltaFrom = cached.coveredThrough;
  if (dirtyFrom && dirtyFrom < deltaFrom) deltaFrom = dirtyFrom;
  if (deltaFrom < from) deltaFrom = from;

  if (deltaFrom > to) {
    return { rows: cached.rows, mode: "cached", pulledFrom: null };
  }

  const delta = await fetchWindsorRows({ from: deltaFrom, to });
  const merged = spliceRows(cached.rows, delta, deltaFrom);
  await setCachedData(rowsKey(from, to), { rows: merged, coveredThrough: to });
  return { rows: merged, mode: "delta", pulledFrom: deltaFrom };
}

/** Today in the shop timezone — the default delta anchor. */
export const shopToday = () => shopLocalDate(new Date().toISOString());
