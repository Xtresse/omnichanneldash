// Shared keys/constants for the live product-tag correction path
// (First order / First Gummy / First Serum / First XVIE — lib/firstOrderTags.js).
// Mirrors lib/liveState.js's dirty-marker pattern but tracks a SET of
// customer ids instead of a date, since tag correction is per-customer.

export const TAG_DIRTY_CUSTOMERS_KEY = "live:v1:tagDirtyCustomers";
export const TAG_TICK_KEY = "live:v1:tagLastTick";

// Survive comfortably past the tag-tick cadence in case the cron is paused.
export const TAG_DIRTY_TTL_MS = 24 * 60 * 60 * 1000;
export const TAG_TICK_TTL_MS = 24 * 60 * 60 * 1000;

// Don't run the tag-tick more often than this even under a burst of webhooks.
export const TAG_MIN_REFRESH_INTERVAL_MS = 90 * 1000;

// Topics that can change which order should hold a First-X tag for a
// customer: a new order (obviously), an update (financial status can flip
// PENDING -> PAID after the fact), and a refund (can zero out net and make a
// previously-eligible order ineligible).
export const TAG_RELEVANT_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
]);
