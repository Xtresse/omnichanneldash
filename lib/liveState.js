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

// Periods that also get a precomputed leaderboard payload.
export const LIVE_LEADERBOARD_PERIODS = ["mtd", "qtd", "ytd"];

// Don't refresh more often than this even if webhooks are pouring in — the
// coalescing guarantee. One minute matches the cron cadence.
export const MIN_REFRESH_INTERVAL_MS = 55 * 1000;
