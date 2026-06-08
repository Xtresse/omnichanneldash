// Canonical preset → [from, to] resolver for the dashboard HTTP path.
//
// Why this file exists: presets used to be defined in THREE places that
// drifted apart —
//   1. lib/shopify.js#presetRange   (only last_7d/30d/3m/6m/12m; everything
//      else silently fell through `map[preset] || 90` to a 90-DAY window)
//   2. app/api/dashboard/route.js ALLOWED_PRESETS (advertised last_year,
//      this_year, last_2years — none of which presetRange could resolve)
//   3. components/FilterBar.jsx PRESETS (today, this_week, mtd, ytd,
//      last_month, qtd, all_time, last_90d, last_year — the values the
//      defensive `refresh()` fallback can post back as `?preset=`)
// Any preset in (2) or (3) that wasn't in (1) resolved to 90 days of data
// while claiming to be e.g. "all_time" — a latent-correctness bug that bit
// the defensive fallback path and any direct /api/dashboard?preset= consumer.
//
// This module is the single source of truth. Semantics mirror FilterBar.jsx
// (calendar windows for today/week/month/quarter/year; trailing-N-days for
// the last_* spans). Pure + dependency-free so it runs under bare `node`
// for the unit check in tests/presets.test.mjs. UTC math keeps it
// deterministic and matches the server (lib/rails/period.js is also UTC).

const DAY_MS = 86400000;

// Earliest date with Shopify data (matches FilterBar.jsx ALL_TIME_START and
// lib/shopify.js#fetchShopifyAllTimeLight). Safely <= the oldest order so
// `all_time` captures the full history (~5.9k orders).
export const ALL_TIME_START = "2024-01-01";

const ymd = (d) => d.toISOString().slice(0, 10);
const utcMidnightToday = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const endOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const startOfQuarter = (d) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
const startOfYear = (d) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
// Week starts Monday (matches FilterBar.jsx startOfWeek).
const startOfWeekMon = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));

// Each resolver takes the UTC "today" anchor and returns [from, to] (ISO).
const RESOLVERS = {
  today:       (t) => [ymd(t), ymd(t)],
  this_week:   (t) => [ymd(startOfWeekMon(t)), ymd(t)],
  last_week:   (t) => { const ws = startOfWeekMon(t); return [ymd(addDays(ws, -7)), ymd(addDays(ws, -1))]; },
  mtd:         (t) => [ymd(startOfMonth(t)), ymd(t)],
  last_month:  (t) => { const lm = addDays(startOfMonth(t), -1); return [ymd(startOfMonth(lm)), ymd(endOfMonth(lm))]; },
  qtd:         (t) => [ymd(startOfQuarter(t)), ymd(t)],
  ytd:         (t) => [ymd(startOfYear(t)), ymd(t)],
  this_year:   (t) => [ymd(startOfYear(t)), ymd(t)],            // alias of ytd
  last_year:   (t) => { const y = t.getUTCFullYear() - 1; return [`${y}-01-01`, `${y}-12-31`]; },
  last_7d:     (t) => [ymd(addDays(t, -6)), ymd(t)],
  last_30d:    (t) => [ymd(addDays(t, -29)), ymd(t)],
  last_90d:    (t) => [ymd(addDays(t, -89)), ymd(t)],
  last_3m:     (t) => [ymd(addDays(t, -89)), ymd(t)],           // trailing 90d (preserves old presetRange intent)
  last_6m:     (t) => [ymd(addDays(t, -179)), ymd(t)],
  last_12m:    (t) => [ymd(addDays(t, -364)), ymd(t)],
  last_2years: (t) => [ymd(addDays(t, -729)), ymd(t)],          // trailing 730d (parallels last_12m)
  all_time:    (t) => [ALL_TIME_START, ymd(t)],
};

// Every preset name this module can resolve.
export const PRESET_NAMES = Object.keys(RESOLVERS);

// The set the /api/dashboard route accepts. Anything not here is normalized
// to a default by the route rather than silently mis-resolved.
export const ALLOWED_API_PRESETS = new Set(PRESET_NAMES);

// The exact preset values the FilterBar UI can emit (button order). Used by
// the unit check to guarantee every UI preset resolves to a real window.
export const FILTERBAR_PRESET_VALUES = [
  "today", "this_week", "last_week", "mtd", "last_month",
  "qtd", "ytd", "last_year", "last_30d", "last_90d", "all_time",
];

/**
 * Resolve a preset name to [from, to] (ISO YYYY-MM-DD).
 * Throws on an unknown preset so callers fail loudly instead of silently
 * serving the wrong window — that's the whole point of this file.
 * @param {string} preset
 * @param {Date} [now] optional UTC-midnight anchor for deterministic tests
 */
export function resolvePresetRange(preset, now) {
  const key = String(preset || "").toLowerCase().trim();
  const fn = RESOLVERS[key];
  if (!fn) {
    throw new Error(`Unknown preset "${preset}". Allowed: ${PRESET_NAMES.join(", ")}`);
  }
  return fn(now instanceof Date ? now : utcMidnightToday());
}
