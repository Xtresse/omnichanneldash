// lib/historyRows.js
//
// Assembles the FULL-history Windsor-shaped row set the omni dashboard
// aggregates (lib/windsor.js aggregateOrders / buildDashboardData), but reads
// CLOSED calendar quarters from the committed data/history-base.json instead of
// re-pulling them from Shopify on every cold render. Only the OPEN quarter (and
// any closed quarter not yet frozen) is fetched live.
//
// This is a drop-in replacement for the all-time pull (previously
// fetchShopifyAllRows('2024-01-01') via fetchShopifyAllTimeLight): it shards the
// exact same way (calendar quarters from 2024-01-01, inclusive bare-date
// created_at, status:any) and calls the core's own fetchShopifyRows() per
// window, so the assembled row multiset is IDENTICAL to a pure live pull —
// closed quarters simply come off disk. The core (lib/xtresseCore.js) is left
// byte-for-byte untouched; all repo-specific freezing lives here, exactly like
// xtresse-leadershipdash keeps it in lib/historyRows.js rather than the core.
//
// zlib is imported here, so this module (like lib/allTimeCache.js) is SERVER
// ONLY — reach it from allTimeCache.js / rails, never from a client component.
//
// Numbers are unchanged by construction: frozen rows are the stored output of
// the same fetchShopifyRows() call for a window whose orders are final, so
// (frozen closed quarters ∪ live open quarter) === (live full pull). Verified
// by scripts/materialize-history.mjs --verify.

import zlib from "node:zlib";
import { fetchShopifyRows, shopLocalDate } from "./xtresseCore.js";
import { staticQuarter } from "./historyStatic.js";

export const HISTORY_FROM = "2024-01-01";

// Inclusive [from,to] calendar-quarter windows, byte-for-byte the boundaries the
// core's quarterShards() produces (Q1 Jan1-Mar31, Q2 Apr1-Jun30, …) so adjacent
// windows neither gap nor overlap under Shopify's inclusive bare-date compare.
// `closed` matches the core's shard intent exactly: the whole quarter ends
// before the first day of the CURRENT month, so its orders are final (modulo the
// small late-refund drift quantified in the perf commit — re-materialize a
// just-closed quarter to re-tie).
export function quarterWindows(
  fromISO = HISTORY_FROM,
  todayISO = shopLocalDate(new Date().toISOString())
) {
  const start = new Date(fromISO + "T00:00:00Z");
  const end = new Date(todayISO + "T00:00:00Z");
  const curMonthStart = todayISO.slice(0, 7) + "-01";
  const out = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1));
    const lo = cur.toISOString().slice(0, 10);
    const hi = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    const y = cur.getUTCFullYear();
    const qNum = Math.floor(cur.getUTCMonth() / 3) + 1;
    out.push({ key: `${y}Q${qNum}`, from: lo, to: hi, closed: hi < curMonthStart });
    cur = next;
  }
  return out;
}

const unzipRows = (p) => JSON.parse(zlib.gunzipSync(Buffer.from(p.z, "base64")).toString());

// Split an inclusive [from,to] window into ~10-day sub-windows. Shopify
// evaluates bare-date created_at inclusively in the shop TZ, so every calendar
// day belongs to exactly one chunk: consecutive inclusive day-windows
// ([a,b],[b+1,c],…) neither gap nor overlap, regardless of month boundaries.
// Union of the chunk pulls === the single-window pull, so the row multiset is
// unchanged; concurrency just overlaps the otherwise-sequential cursor pages.
// Finer than leadership's month shards (the task's ~10-day suggestion) because
// the open quarter can span two busy closed-then-current months (e.g. Jul+Aug).
export function tenDayWindows(from, to) {
  const DAY = 86400000;
  const lo = new Date(from + "T00:00:00Z").getTime();
  const hi = new Date(to + "T00:00:00Z").getTime();
  if (!(lo <= hi)) return [{ from, to }];
  const out = [];
  for (let s = lo; s <= hi; s += 10 * DAY) {
    const e = Math.min(s + 9 * DAY, hi);
    out.push({
      from: new Date(s).toISOString().slice(0, 10),
      to: new Date(e).toISOString().slice(0, 10),
    });
  }
  return out;
}

// The OPEN quarter is the only live pull left, and a single quarter-wide cursor
// is sequential (~40s for a busy quarter). 10-day-shard it and fetch the chunks
// concurrently so the wall-clock collapses toward the slowest single chunk,
// while the rows stay identical (see tenDayWindows). Mirrors the proven
// leadership fetchWindowSharded / Sales-Rep-Dashboards _fetchWindowSharded.
async function fetchWindowSharded(from, to) {
  const wins = tenDayWindows(from, to);
  if (wins.length <= 1) return fetchShopifyRows({ from, to });
  const parts = await Promise.all(wins.map((w) => fetchShopifyRows({ from: w.from, to: w.to })));
  return parts.flat();
}

// Full-history rows with closed quarters served from the frozen bundle. Shards
// are fetched concurrently (Promise.all) just like the core did; the only live
// pull left is the open quarter, 10-day-sharded so it isn't the long pole.
export async function fetchShopifyAllRowsFrozen() {
  const wins = quarterWindows();
  const parts = await Promise.all(
    wins.map(async (w) => {
      // Only a fully-closed quarter is eligible to read from disk; the open
      // quarter (or a just-closed quarter not yet re-materialized) fetches live.
      if (w.closed) {
        const frozen = staticQuarter(w.key);
        if (frozen && frozen.z) return unzipRows(frozen);
      }
      return fetchWindowSharded(w.from, w.to);
    })
  );
  const rows = [];
  for (const part of parts) for (const r of part) rows.push(r);
  return rows;
}
