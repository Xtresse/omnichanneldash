// Server-only cache for the expensive full-history ("all-time") Shopify pull.
//
// The all-time pull (fetchShopifyAllRows('2024-01-01') under
// fetchWindsorAllTimeLight) is the single most expensive piece of a cold
// dashboard request — and it's window-INDEPENDENT, so re-running it for every
// window was pure waste. We cache it ONCE in KV under its own key with a long
// TTL and reuse it across every window and serverless instance. gzip + the
// size-guard come for free via setCachedData. Any miss/failure falls straight
// back to the live pull, so behavior degrades gracefully to the old path.
//
// This lives in its OWN module (not windsor.js) on purpose: windsor.js is
// imported by client components (SalesExplorer) for pure helpers, and
// dataCache.js pulls in node:zlib — which must never end up in a client
// bundle. Only server routes / the SSR page import this file.

import { fetchWindsorAllTimeLight } from "./windsor.js";
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
  const rows = await fetchWindsorAllTimeLight();
  try {
    await setCachedData(ALLTIME_CACHE_KEY, rows);
  } catch {
    /* best-effort cache write */
  }
  return rows;
}
