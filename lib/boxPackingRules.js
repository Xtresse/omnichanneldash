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

// Current production default. Flipped back to double-wall by Sam on
// 2026-09-01 after merging real physical inventory into XTR-SHPR-DBL on
// ShipBob's side (single-wall had been the default since 8/19 while
// double-wall was OOS — see lib/boxPackingRules.js history / CLAUDE.md for
// that context). Both Shopify variants are now inventoryPolicy: CONTINUE,
// so an add won't hard-fail even if stock dips again.
export const DEFAULT_BOX_SKU = BOX_SKU_DOUBLE_WALL;

// Below this bag count, gummies ship in a bubble poly mailer (Susie's
// original breakdown, confirmed correct by Sam) — no box.
const GUMMY_BOX_THRESHOLD = 2;

// Six bags fit in one box (Sam, 2026-09-05: "only use two boxes ever if the
// order is more than 6 bags of gummies. 6 bags of gummies fit in 1 box").
// So 2-6 bags -> 1 box, 7-12 -> 2, 13-18 -> 3. This replaces the old
// "at most one box, ever" scope and is what makes the plan a RECONCILE to a
// target count rather than a one-shot add — see planBoxForOrder.
export const GUMMY_BAGS_PER_BOX = 6;

// How many boxes this order should end up with. Serum alone still ships in a
// single branded box regardless of bag count (Sam, 8/28).
export function boxesForOrder(gummyQty, hasSerum) {
  const needsForGummies = gummyQty >= GUMMY_BOX_THRESHOLD;
  if (!needsForGummies && !hasSerum) return 0;
  return Math.max(1, Math.ceil(gummyQty / GUMMY_BAGS_PER_BOX));
}

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
// Returns null when no action is needed, otherwise one of two shapes
// (both carry `action` so callers can branch):
//   { action: "add",     addSku, quantity: 1, reason: "gummy-2plus" | "serum" | "gummy-2plus+serum" }
//   { action: "correct", removeSku, removeQty, addSku, quantity, reason: "wrong-box-sku" }
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
//
// CORRECTION PASS (added 2026-09-01/02, Sam): the "3+ bags -> box" behavior
// this module was built to backstop (see file header, finding #2) lives on
// the Recharge subscription/checkout side, outside this repo. That means an
// order can arrive ALREADY carrying a box — added by Recharge's own config
// at checkout, before this tick ever sees it — using whatever SKU is
// hardcoded THERE, independent of this module's DEFAULT_BOX_SKU. Order
// #17307 (created 2026-09-02, over an hour after DEFAULT_BOX_SKU flipped to
// double-wall here) proved this: it arrived with XTR-SHPR-SIN already
// attached, and the old add-only logic correctly no-op'd on it (alreadyHasBox
// was true) — so flipping the default here alone never touches Recharge-
// attached boxes. Since this repo can't reach Recharge's checkout config,
// the fix is a backend correction pass: if a box IS present but its SKU
// doesn't match the current DEFAULT_BOX_SKU, swap it — same reasoning as the
// gap-fill case (this file's header): catch every order regardless of which
// mechanism created it, so a stale front-end SKU can't strand an order at a
// 3PL that's OOS on that variant.
// 2026-09-05 (Sam): the plan is now a RECONCILE to a target box count, not a
// one-shot add. Two live bugs made that necessary, both found on order
// #17425:
//   1. Two overlapping runs each added a box, because "does it already have
//      one" was evaluated against a read that was already stale by the time
//      the edit committed. 97 orders since 8/1 ended up with more than one
//      box, 104 boxes in total — the likely driver of XTR-SHPR-DBL sitting
//      at -83 at Scale3PL, since the box SKU is tracked:false and nothing
//      flagged the drift.
//   2. The old "correct" action added the right SKU but left the wrong one
//      behind, so ~60 orders carry XTR-SHPR-SIN *and* XTR-SHPR-DBL.
// Reconciling to a target fixes both by construction: a second concurrent
// run sees the target already met and no-ops, and every box line on the
// order is zeroed before the correct one is added, so a stray SKU or a
// duplicate line can't survive the pass.
export function planBoxForOrder(order) {
  if (!order || order.cancelledAt) return null;

  const lineItems = order.lineItems || [];
  const boxLines = lineItems.filter((li) => BOX_SKUS.has(li.sku) && Number(li.quantity) > 0);
  const currentQty = boxLines.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);

  const gummyQty = lineItemQty(lineItems, GUMMY_BAG_SKU);
  const hasSerum = lineItemQty(lineItems, SERUM_SKU) > 0;
  const targetQty = boxesForOrder(gummyQty, hasSerum);

  // This module has never stripped a box off an order that doesn't warrant
  // one (a lone gummy bag) — the ShipBob box-cleanup task owns that case.
  // Keeping it that way so the two don't fight over the same line.
  if (targetQty === 0) return null;

  const alreadyRight =
    boxLines.length === 1 && boxLines[0].sku === DEFAULT_BOX_SKU && currentQty === targetQty;
  if (alreadyRight) return null;

  const reason =
    boxLines.length === 0
      ? hasSerum && gummyQty < GUMMY_BOX_THRESHOLD
        ? "gap-fill:serum"
        : "gap-fill:gummy"
      : currentQty !== targetQty
      ? "box-count"
      : "wrong-box-sku";

  return {
    action: "reconcile",
    // Every box SKU currently on the order gets zeroed before the add, which
    // is what clears duplicate lines of the SAME sku (#17425 carried two
    // separate XTR-SHPR-DBL lines, so matching one line by SKU wasn't enough).
    removeSkus: [...new Set(boxLines.map((li) => li.sku))],
    currentQty,
    addSku: DEFAULT_BOX_SKU,
    quantity: targetQty,
    reason,
    gummyQty,
    hasSerum,
  };
}
