// =============================================================================
// BOX-INCLUSION PACKING RULES — shared detection logic
// =============================================================================
// Computes, for ONE order's line items, whether Xtressé's branded outer-box
// SKU needs to be added as a new $0 line item so Scale3PL/ShipBob packers
// don't have to remember the rule themselves.
//
// Built 2026-08-31 at Sam's request after Susie Mariboho (Scale3PL, client
// success — packs gummies/serum at the Huntington Beach warehouse) flagged a
// gap in an email thread with Sam:
//   - 3 bags of Hair Growth Gummies (X-GN-060CT-001) already gets a branded
//     box included on the order today.
//   - 2 bags does NOT reliably get one — Susie has to guess.
//   - Serum (X-FRC-30ML-001) orders don't get one either, and Sam confirmed
//     serum should ALWAYS ship in the branded box, no brown-box exception.
//   - Susie's own ask (8/31): "are you able to include the box on the order,
//     just like you do for the three-bag orders... apply the same logic to
//     the serum... this should also allow you to keep better track of the
//     branded boxes." I.e. stop relying on packers to remember SKU-specific
//     rules — bake it into the order itself.
//
// INVESTIGATION FINDINGS (2026-08-31, live Shopify Admin GraphQL, ~150 real
// orders inspected) — these correct two assumptions in the original ask:
//   1. Multi-bag gummy orders carry ONE line item with `quantity` set (e.g.
//      quantity: 3), NOT three separate quantity-1 line items. This module
//      sums quantity across any line items matching the gummy SKU, so it
//      handles either shape, but the single-line-with-quantity shape is what
//      real orders actually use.
//   2. The existing "3 bags -> box" behavior is NOT Shopify Flow and isn't
//      owned by this repo or any sibling repo (grepped omnichanneldash and
//      Sales-Rep-Dashboards, checked Notion — no hits). Order data strongly
//      suggests it's wired into the Recharge subscription/bundle config for
//      the DTC "3-Month Delivery" selling plan (box line items carry
//      rc_charge_id / rc_subscription_ids custom attributes and a $0 price,
//      sellingPlan: null, while the gummy line does carry a sellingPlan) —
//      i.e. it lives on the front-end/subscription-checkout side, which Sam
//      does not control from this repo. That is exactly why a backend
//      safety net (this module + the box-tick cron) is the right fix: it
//      catches every order regardless of which channel/mechanism created it,
//      the same reasoning that motivated lib/firstOrderTags.js.
//   3. Box SKU: TWO box products exist — XTR-SHPR-SIN ("DTC Outer Box Single
//      Wall") and XTR-SHPR-DBL ("DTC Outer Box Double Wall"). Live order
//      history shows a hard cutover: XTR-SHPR-DBL was used through
//      2026-08-19, then XTR-SHPR-SIN from 2026-08-19 onward — this matches
//      the known incident (double-wall went OOS at ShipBob-GA, both variants
//      are inventoryPolicy: DENY so an OOS double-wall add would hard-fail).
//      One later Scale3PL order (8/28) still used DBL, but EVERY Scale3PL
//      order from 8/30-8/31 (the most recent data) uses SIN — so as of this
//      writing SIN is the live, current default across channels/3PLs. DO NOT
//      assume this is permanent: if double-wall stock is replenished the
//      default may flip back, per Sam. See DEFAULT_BOX_SKU below.
//   4. No live example exists of a "serum triggers a box" order created
//      through the automatic path (every current box-having order also has
//      >=2 gummy bags) — there's no precedent to confirm against. Sam's
//      "always ships in the branded box, no brown-box exception" reply is
//      the source of truth here, and every observed serum+box order used
//      XTR-SHPR-SIN, so this module uses the same DEFAULT_BOX_SKU for both
//      triggers rather than inventing a second convention.
//
// This is pure logic — no Shopify I/O — mirroring lib/firstOrderTags.js's
// separation of concerns. Callers (app/api/box-tick/route.js) fetch the
// order and apply the plan via Shopify's Order Editing API.
// =============================================================================

export const GUMMY_BAG_SKU = "X-GN-060CT-001"; // Hair Growth Gummies, single bag
export const SERUM_SKU = "X-FRC-30ML-001"; // FR Concentrate Serum, single bottle

// Both are real, active, $0 products (DENY inventory policy — an add fails
// outright if the chosen SKU is OOS rather than overselling silently).
export const BOX_SKU_SINGLE_WALL = "XTR-SHPR-SIN";
export const BOX_SKU_DOUBLE_WALL = "XTR-SHPR-DBL";
export const BOX_SKUS = new Set([BOX_SKU_SINGLE_WALL, BOX_SKU_DOUBLE_WALL]);

// Current production default per finding #3 above. Confirmed correct by
// Sam (2026-08-31). If double-wall stock is ever replenished and the
// front-end default flips back to XTR-SHPR-DBL, revisit this constant.
export const DEFAULT_BOX_SKU = BOX_SKU_SINGLE_WALL;

// Below this bag count, gummies ship in a bubble poly mailer (Susie's
// original breakdown, confirmed correct by Sam) — no box.
const GUMMY_BOX_THRESHOLD = 2;

function lineItemQty(lineItems, sku) {
  return (lineItems || [])
    .filter((li) => li.sku === sku)
    .reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);
}

// `order` shape expected by this module:
//   {
//     id: string,                 // for reporting only
//     name: string,                // "#17049" — for reporting only
//     cancelledAt: string|null,
//     lineItems: [{ sku: string, quantity: number }],
//   }
//
// Returns null when no action is needed (already has a box, or doesn't
// qualify), otherwise:
//   { addSku: string, quantity: 1, reason: "gummy-2plus" | "serum" | "gummy-2plus+serum" }
//
// Deliberately narrow scope, matching exactly what Susie/Sam asked for:
//   - Adds AT MOST one box line item, and only when the order has NONE
//     already (any box SKU counts — this is a gap-filler/safety-net, not a
//     replacement for whatever already adds boxes for 3+ bag orders today,
//     so it never double-adds or fights that mechanism).
//   - Does NOT attempt to replicate that mechanism's box-COUNT scaling for
//     bulk orders (e.g. some real 6- and 12-bag orders show 1 box, others
//     show 2 or 4 — the existing scaling behavior is inconsistent across
//     examples and its cause wasn't identified; see rollout report). This
//     module only ever asks "does this order need a first box," never "how
//     many."
//   - >=2 gummy bags subsumes the >=3 case on purpose (Sam, 8/28: "2 bags of
//     gummies: same as 3 bags — branded box"). A 3+ order that already
//     picked up a box via the existing mechanism is a no-op here; one that
//     somehow didn't gets caught by this same rule.
//   - Any serum line item (regardless of gummy count) qualifies, per Sam's
//     8/28 reply: "Serum: always ships in the branded box, no brown-box
//     exception."
//   - Composite/bundle SKUs (e.g. the DTC "Grow System" bundle,
//     XTR-DTC-GMFR-02, which bundles a gummy+serum into ONE non-decomposable
//     line item per lib/constants.js) are NOT matched here — this module
//     only looks at the literal single-unit SKUs Susie named. Flagged as an
//     open question for Sam in the rollout report, not guessed at.
export function planBoxForOrder(order) {
  if (!order || order.cancelledAt) return null;

  const lineItems = order.lineItems || [];
  const alreadyHasBox = lineItems.some((li) => BOX_SKUS.has(li.sku));
  if (alreadyHasBox) return null;

  const gummyQty = lineItemQty(lineItems, GUMMY_BAG_SKU);
  const hasSerum = lineItemQty(lineItems, SERUM_SKU) > 0;
  const needsForGummies = gummyQty >= GUMMY_BOX_THRESHOLD;

  if (!needsForGummies && !hasSerum) return null;

  const reason =
    needsForGummies && hasSerum
      ? "gummy-2plus+serum"
      : needsForGummies
      ? "gummy-2plus"
      : "serum";

  return { addSku: DEFAULT_BOX_SKU, quantity: 1, reason, gummyQty, hasSerum };
}
