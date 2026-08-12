// =============================================================================
// B2B PRODUCT-SPECIFIC ORDER TAGGING — shared detection logic
// =============================================================================
// Computes, for a customer's full order history, which order should carry
// "First order" and which order(s) should carry "First Gummy" / "First Serum"
// / "First XVIE".
//
// Design & validation: investigated + spot-validated against Laura Mann's
// full 115-customer territory before this module was written (see the
// 2026-08-11 dry-run report). Confirmed decisions baked in here (Sam Sood,
// CEO):
//   - Identity key = the caller's grouping key for `orders` passed into
//     computeCustomerTagPlan() — this module is agnostic to what that key
//     means, it just treats one call's `orders` as one identity's full
//     history. As of 2026-08-11 the identity callers should use is: a B2B
//     order's `purchasingEntity` CompanyLocation id when present, else
//     Shopify customer.id. Originally this was customer.id alone, but that
//     broke for pooled/reseller ordering accounts — e.g. Premiere Aesthetic
//     Solutions places orders for many distinct physical clinics through one
//     shared Shopify customer record (ordering@premiereaestheticsolutions.com),
//     so grouping by customer.id merged genuinely different practices'
//     histories and would have stripped a real new clinic's earned "First
//     order" tag because a DIFFERENT clinic ordered a year earlier under the
//     same pooled account. CompanyLocation id is the same location-grain
//     identity already used elsewhere in this codebase for exactly this
//     reason (see lib/constants.js and the credit-memo app's per-location
//     model) — reuse it here rather than inventing a second convention.
//   - Eligible order = paid, non-$0, non-voided, net-of-refunds > 0. BLANKET
//     rule — $0 orders never count, including the Nova Vita XVIE trial
//     program ("if they did not pay for it it's not a paid order," no
//     special-casing).
//   - Chronological, per product family, oldest paid order wins the tag for
//     that family — independently per family, so one order can legitimately
//     earn multiple "First X" tags at once (e.g. a bundle order that is
//     genuinely the customer's first order and contains both a gummy and a
//     serum SKU gets "First order" + "First Gummy" + "First Serum" together).
//   - Replaces the existing Shopify-Flow-based "First order" tag (unauditable,
//     confirmed broken live — see #12694/#12702) and the old "serum"/
//     "First FR order" tags (also Flow-based, confirmed unreliable — fired
//     inconsistently depending on SKU variant). This module does not read or
//     depend on any of those tags; it recomputes everything from scratch off
//     real paid-order history.
//
// This is pure logic — no Shopify I/O. Callers (the dry-run script today, a
// webhook handler + backfill batch job later) are responsible for fetching
// order data and (eventually) calling tagsAdd/tagsRemove.
// =============================================================================

import { familiesFor } from './constants.js';

// Only these three families ever get a "First X" tag. Sachets and anything
// else familiesFor() can return are deliberately excluded — Sam's spec named
// exactly three new tags.
export const TAG_FAMILIES = ['Gummies', 'Serum', 'XVIE'];

export const FAMILY_TAG_NAME = {
  Gummies: 'First Gummy',
  Serum: 'First Serum',
  XVIE: 'First XVIE',
};

export const FIRST_ORDER_TAG = 'First order';

// ---- Eligibility --------------------------------------------------------
// Financial statuses that represent real, captured payment. PENDING /
// AUTHORIZED / PARTIALLY_PAID / EXPIRED orders have not (yet, or ever)
// actually been paid, so they cannot set a "first" flag even if their
// nominal subtotal is > 0 — matches Sam's "if they did not pay for it it's
// not a paid order" ruling literally, not just for the $0 case it was asked
// about.
const PAID_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED']);

// `order` shape expected by this module (caller maps Shopify data into this):
//   {
//     id: string,                 // stable identifier (Shopify order GID or numeric id)
//     name: string,                // "#12702" — for reporting only
//     customerId: string,
//     createdAt: string,           // ISO, sortable
//     cancelledAt: string|null,
//     financialStatus: string,     // Shopify displayFinancialStatus
//     subtotal: number,            // order_subtotal_price (gross, pre-refund)
//     refundsSubtotal: number,     // order_refunds_subtotal (0 for a normal
//                                   // uncancelled order with no refunds; forced
//                                   // to the full subtotal for cancelled/voided
//                                   // orders — same convention as xtresseCore's
//                                   // orderToRows, so net auto-zeroes for voids)
//     lineItemSkus: string[],      // every line-item SKU on the order
//     tags: string[],              // CURRENT Shopify tags, for reporting/diffing only
//   }

export function orderNet(order) {
  const sub = Number(order.subtotal) || 0;
  const refunds = Number(order.refundsSubtotal) || 0;
  return sub - refunds;
}

export function isEligibleOrder(order) {
  if (order.cancelledAt) return false;
  if (!PAID_STATUSES.has(order.financialStatus)) return false;
  return orderNet(order) > 0;
}

// Families genuinely present on an order (union across line items),
// restricted to the three tag-eligible families and composite-SKU-aware
// (e.g. a Grow System line item counts as both Gummies and Serum).
export function familiesOnOrder(order) {
  const set = new Set();
  for (const sku of order.lineItemSkus || []) {
    for (const f of familiesFor(sku)) {
      if (TAG_FAMILIES.includes(f)) set.add(f);
    }
  }
  return set;
}

// ---- Core chronological walk --------------------------------------------
// `orders` = ALL of one customer's orders, any status, any order. Sorted
// internally — caller does not need to pre-sort.
//
// Returns:
//   {
//     firstOrderId: string|null,     // order that SHOULD carry "First order"
//     familyFirstOrderId: { Gummies, Serum, XVIE } -> orderId|null,
//     tagsToAdd: Map<orderId, string[]>,  // computed additions, oldest-first order
//     eligibleCount: number,
//   }
export function computeCustomerTagPlan(orders) {
  const sorted = [...orders].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );
  const eligible = sorted.filter(isEligibleOrder);

  const tagsToAdd = new Map();
  const seenFamily = new Set();
  const familyFirstOrderId = { Gummies: null, Serum: null, XVIE: null };
  let firstOrderId = null;

  for (const o of eligible) {
    const adds = [];

    if (firstOrderId === null) {
      firstOrderId = o.id;
      adds.push(FIRST_ORDER_TAG);
    }

    const families = familiesOnOrder(o);
    for (const f of TAG_FAMILIES) {
      if (families.has(f) && !seenFamily.has(f)) {
        seenFamily.add(f);
        familyFirstOrderId[f] = o.id;
        adds.push(FAMILY_TAG_NAME[f]);
      }
    }

    if (adds.length) tagsToAdd.set(o.id, adds);
  }

  return { firstOrderId, familyFirstOrderId, tagsToAdd, eligibleCount: eligible.length };
}

// ---- Correction detection (the #12694/#12702 class of bug) --------------
// Compares the computed-correct "First order" placement against whichever
// order(s) CURRENTLY carry the tag in Shopify (should normally be zero or
// one, but the live bug shows it can be wrong). Returns:
//   {
//     removals: [{ orderId, orderName }],   // currently tagged, shouldn't be
//     addition: { orderId, orderName }|null // should be tagged, currently isn't
//   }
// `currentlyTagged` = orders (any status) whose `tags` array already
// contains "First order" (case-insensitive).
export function detectFirstOrderCorrection(orders, plan) {
  const isTaggedFirstOrder = (o) =>
    (o.tags || []).some((t) => /^first order$/i.test(String(t).trim()));

  const currentlyTagged = orders.filter(isTaggedFirstOrder);
  const removals = currentlyTagged
    .filter((o) => o.id !== plan.firstOrderId)
    .map((o) => ({ orderId: o.id, orderName: o.name }));

  let addition = null;
  if (plan.firstOrderId) {
    const correctOrder = orders.find((o) => o.id === plan.firstOrderId);
    if (correctOrder && !isTaggedFirstOrder(correctOrder)) {
      addition = { orderId: correctOrder.id, orderName: correctOrder.name };
    }
  }

  return { removals, addition };
}
