// Shared keys/constants for the live (webhook-driven) refresh path.
// Kept in its own tiny module so the webhook receiver, the tick cron and the
// status endpoint can't drift on key names.

export const DIRTY_KEY = "live:v1:dirty";
export const TICK_KEY = "live:v1:lastTick";

// The dirty marker only has to survive until the next tick (60 s). A day of
// TTL is a generous backstop in case the cron is paused.
export const DIRTY_TTL_MS = 24 * 60 * 60 * 1000;
export const TICK_TTL_MS = 24 * 60 * 60 * 1000;

// Windows kept LIVE by the 1-minute tick. These are the ones the UI leads
// with — the headline KPIs (today), the goal pace and default leaderboard
// (mtd), and the two longer leaderboard periods (qtd, ytd). Everything else
// (last_week, last_90d, last_year, …) stays on the existing 10-minute warm.
//
// Refreshing qtd/ytd every minute is only affordable because lib/liveRows.js
// re-pulls just the changed days and reuses the cached history.
export const LIVE_PERIODS = ["today", "mtd", "qtd", "ytd"];

// ── Refresh cadence ─────────────────────────────────────────────────────────
// 2026-08-08, second CPU alert: refreshing ALL FOUR windows plus the heat map
// every single minute pushed the tick to 19 s. Against the 10-minute warm
// cron's 114 s that took continuous function CPU from ~19% to ~51% — a ~2.7x
// step, which is what re-fired the alert. The first spike was the KV ceiling;
// this one was self-inflicted by the live-refresh work.
//
// The fix is cadence, not caching. Split by how fast a number can actually
// move in a way anyone would notice:
//
//   FAST (every minute)  today, mtd — where a new order visibly moves the
//                        headline KPIs and the default leaderboard.
//   SLOW (every 5 min)   qtd, ytd and the heat map. A $2k order shifts a $7M
//                        YTD by 0.03% and cannot reorder the leaderboard; the
//                        heat map is a daily grid, so sub-day freshness is
//                        meaningless. Paying for that every 60 s bought
//                        nothing.
export const LIVE_PERIODS_FAST = ["today", "mtd"];
export const LIVE_PERIODS_SLOW = ["qtd", "ytd"];
export const SLOW_INTERVAL_MS = 5 * 60 * 1000;

// Periods that also get a precomputed leaderboard payload.
export const LIVE_LEADERBOARD_PERIODS = ["mtd", "qtd", "ytd"];

// Periods that also get a precomputed rep x day heat map. Built only on the
// SLOW cadence — a daily grid gains nothing from minute-level refresh, and
// this aggregation is what took the tick from ~7.5 s to ~19 s.
export const LIVE_HEATMAP_PERIODS = ["mtd", "qtd", "ytd"];

// Don't refresh more often than this even if webhooks are pouring in — the
// coalescing guarantee. One minute matches the cron cadence.
export const MIN_REFRESH_INTERVAL_MS = 55 * 1000;
