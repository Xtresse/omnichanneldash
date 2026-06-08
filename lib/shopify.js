// Thin adapter over the canonical shared core (lib/xtresseCore.js).
// All revenue/date/tag logic lives in the core so every dashboard ties.
// Exports consumed by the sales-data aggregation layer (lib/salesData.js):
//   hasShopifyCreds, fetchShopifyRows({preset,from,to}), fetchShopifyAllTimeLight
import { hasShopifyCreds, fetchShopifyRows as coreRows, fetchShopifyAllRows } from './xtresseCore.js';
import { resolvePresetRange } from './presets.mjs';
export { hasShopifyCreds };

// Resolve a preset to [from, to]. Delegates to the canonical resolver in
// lib/presets.mjs (the single source of truth shared with the API route's
// allow-list) so presets like all_time / ytd / last_year / mtd no longer
// silently collapse to a 90-day window. Unknown presets throw there; we
// default a missing preset to last_3m to preserve the prior ~90-day behavior
// for callers that pass neither dates nor a preset.
function presetRange(preset) {
  return resolvePresetRange(preset || 'last_3m');
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
