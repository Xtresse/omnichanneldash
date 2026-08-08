// Pacific-anchored MTD / QTD / YTD window resolution — ONE definition shared
// by the leaderboard client, /api/leaderboard and the /api/warm cron.
//
// These three used to each carry their own copy of this date math. That's a
// silent-cache-miss waiting to happen: cache keys are the literal from/to
// strings, so a one-day drift between the warmer and the caller means the
// warmed entry is never read and every request pays a cold compute.
//
// "Today" must resolve in the SHOP timezone (America/Los_Angeles) — the same
// zone xtresseCore buckets orders in. A browser-local or UTC anchor rolls the
// date forward for an ET viewer in the evening and pulls a different day.
//
// Pure date math only: no node builtins, safe to import from a client
// component.

export const SHOP_TZ = "America/Los_Angeles";

export const shopTodayStr = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const shopTodayD = () => new Date(shopTodayStr() + "T00:00:00");

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

export const PERIOD_KEYS = ["mtd", "qtd", "ytd"];

/** Resolve a period key to [from, to] ISO dates, or null if unrecognized. */
export function periodRange(key, today = shopTodayD()) {
  const t = today;
  if (key === "today") return [ymd(t), ymd(t)];
  if (key === "mtd") return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
  if (key === "qtd") {
    const q = Math.floor(t.getMonth() / 3);
    return [ymd(new Date(t.getFullYear(), q * 3, 1)), ymd(t)];
  }
  if (key === "ytd") return [ymd(new Date(t.getFullYear(), 0, 1)), ymd(t)];
  return null;
}

/** Cache key for a precomputed leaderboard window. */
export const leaderboardCacheKey = (from, to) =>
  `lb:v1:${JSON.stringify({ from, to })}`;

/** Cache key for a precomputed rep × day heat map window. */
export const heatmapCacheKey = (from, to) =>
  `hm:v1:${JSON.stringify({ from, to })}`;

/**
 * Cache key for a full dashboard payload. MUST stay byte-identical to the
 * string app/api/dashboard/route.js builds — a mismatch means the warmer and
 * the tick write entries the request path never reads, which is exactly the
 * silent-miss failure that produced the 2026-08-08 CPU spike.
 */
export const dashboardCacheKey = (from, to, granularity = "auto", compareMode = "off") =>
  "dash:v4:" + JSON.stringify({ q: { from, to }, granularity, compareMode });
