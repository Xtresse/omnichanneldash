// Shared keys/constants for the live box-inclusion correction path
// (lib/boxPackingRules.js). Mirrors lib/liveTagState.js's dirty-marker
// pattern, but tracks a SET of ORDER ids rather than customer ids — a box
// decision only needs the one order's own line items, not any purchase
// history, so there's no per-customer fetch/aggregation step here.

export const BOX_DIRTY_ORDERS_KEY = "live:v1:boxDirtyOrders";
export const BOX_TICK_KEY = "live:v1:boxLastTick";

// Survive comfortably past the box-tick cadence in case the cron is paused.
export const BOX_DIRTY_TTL_MS = 24 * 60 * 60 * 1000;
export const BOX_TICK_TTL_MS = 24 * 60 * 60 * 1000;

// Don't run the box-tick more often than this even under a burst of webhooks.
export const BOX_MIN_REFRESH_INTERVAL_MS = 90 * 1000;

// Only orders/create matters here — this is a creation-time gap-filler, not
// an ongoing corrector. (Deliberately narrower than TAG_RELEVANT_TOPICS in
// lib/liveTagState.js, which also reacts to updates/cancellations/refunds
// because "who should hold First order" can change after the fact; whether
// an order needs a box is decided once, at creation, off its line items.)
export const BOX_RELEVANT_TOPICS = new Set(["orders/create"]);
