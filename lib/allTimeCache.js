// Server-only cache for the full-history ("all-time") Shopify pull.
//
// The all-time pull is window-INDEPENDENT, so re-running it for every window
// was pure waste. Two layers now guard it:
//   1. CLOSED calendar quarters are served from the committed
//      data/history-base.json (frozen path — fetchShopifyAllRowsFrozen in
//      lib/historyRows.js). A cold render no longer re-pulls ~2 years of
//      orders that never move; only the OPEN quarter is fetched live, and that
//      pull is itself 10-day-sharded so a single sequential cursor isn't the
//      long pole.
//   2. The assembled full-history rows are still cached ONCE in KV under a long
//      TTL and reused across every window and serverless instance, so warm
//      reads stay instant. gzip + the size-guard come for free via
//      setCachedData. Any miss/failure falls straight back to the (now frozen)
//      live path, so behavior degrades gracefully.
//
// Row multiset — and therefore every buildDashboardData figure — is IDENTICAL
// to the old fetchShopifyAllRows() full pull (frozen closed quarters ∪ live
// open quarter === live full pull). Verified by
// scripts/materialize-history.mjs --verify.
//
// This lives in its OWN module (not windsor.js) on purpose: windsor.js is
// imported by client components (SalesExplorer) for pure helpers, and both
// dataCache.js and lib/historyRows.js pull in node:zlib — which must never end
// up in a client bundle. Only server routes / the SSR page import this file.

import { fetchShopifyAllRowsFrozen } from "./historyRows.js";
import { getCachedData, setCachedData } from "./dataCache.js";

const ALLTIME_CACHE_KEY = "dash:v1:alltime";
const ALLTIME_TTL_MS = 60 * 60 * 1000; // 60 min

export async function fetchAllTimeRowsCached() {
  try {
    const hit = await getCachedData(ALLTIME_CACHE_KEY, ALLTIME_TTL_MS);
    if (hit && Array.isArray(hit.data)) return hit.data;
  } catch {
    /* fall through to live pull */
  }
  const rows = await fetchShopifyAllRowsFrozen();
  try {
    await setCachedData(ALLTIME_CACHE_KEY, rows);
  } catch {
    /* best-effort cache write */
  }
  return rows;
}
