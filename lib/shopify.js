// Thin adapter over the canonical shared core (lib/xtresseCore.js).
// All revenue/date/tag logic lives in the core so every dashboard ties.
// Exports kept for backwards-compat with windsor.js:
//   hasShopifyCreds, fetchShopifyRows({preset,from,to}), fetchShopifyAllTimeLight
import { hasShopifyCreds, fetchShopifyRows as coreRows, fetchShopifyAllRows } from './xtresseCore.js';
export { hasShopifyCreds };

function presetRange(preset) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const map = { last_7d: 7, last_30d: 30, last_3m: 90, last_6m: 180, last_12m: 365 };
  const days = map[preset] || 90;
  const d = new Date(today); d.setDate(d.getDate() - days);
  return [d.toISOString().slice(0, 10), to];
}

export async function fetchShopifyRows({ preset, from, to } = {}) {
  let lo = from, hi = to;
  if (!(lo && hi)) [lo, hi] = presetRange(preset);
  return coreRows({ from: lo, to: hi });
}

// All-time light pull — core's full pull is already fast (sharded) + cached.
export async function fetchShopifyAllTimeLight() {
  return fetchShopifyAllRows('2024-01-01');
}
