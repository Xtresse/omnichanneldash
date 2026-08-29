// lib/historyStatic.js
//
// Frozen, committed order history for CLOSED calendar quarters (2024-01-01 →
// the last elapsed quarter). Orders from a closed quarter never change (modulo
// the small late-refund drift quantified in the perf commit — see the
// re-materialize ritual below), so re-pulling them from Shopify — or even
// holding them in KV via lib/allTimeCache.js, which evicts by TTL/recency and
// then pays a ~37s quarter-sharded full-history re-pull on the next cold
// rebuild — is pure waste on a low-traffic app.
//
// data/history-base.json is a map { "<YYYY>Q<n>": { z: "<gzip+base64 rows>" } }
// where the rows are the EXACT output of the shared core's fetchShopifyRows()
// for that quarter window (lib/xtresseCore.js — left byte-for-byte untouched).
// A closed quarter therefore reads straight from the bundle: no Shopify call,
// no KV, no eviction — instant. Only the OPEN quarter (and any closed quarter
// not yet frozen) still fetches live.
//
// Pattern mirrors xtresse-leadershipdash/lib/historyStatic.js and
// Sales-Rep-Dashboards/lib/historyStatic.js (both proven in prod).
//
// Regenerate when a quarter closes:
//   node --env-file=.env.local scripts/materialize-history.mjs
// then commit data/history-base.json. A quarter absent from the file simply
// falls back to the live fetch, so a stale/missing file degrades safely to the
// prior behaviour (slow) — NEVER to wrong numbers.

import STATIC from "../data/history-base.json" with { type: "json" };

/** Frozen chunk for a closed quarter key (e.g. "2025Q3"), or null to fetch live. */
export function staticQuarter(key) {
  return STATIC && Object.prototype.hasOwnProperty.call(STATIC, key)
    ? STATIC[key]
    : null;
}

/** Keys present in the frozen file — for diagnostics / warm probes. */
export function staticQuarterKeys() {
  return STATIC ? Object.keys(STATIC) : [];
}
