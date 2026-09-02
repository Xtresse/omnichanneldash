// /api/box-tick — the live corrector for the branded-box packing gap
// (lib/boxPackingRules.js).
//
// Same coalescing shape as /api/tick and /api/tag-tick, kept as its own cron
// so this work never competes with either of their CPU budgets — the exact
// reason /api/tag-tick was split out from /api/tick in the first place (see
// that route's header comment; it already tripped a CPU alert twice):
//
//   /api/shopify-webhook  ->  enqueues the new order's id, no compute
//   this tick (every 2m)  ->  IF any orders are queued, fetches each order's
//                              current line items and applies
//                              lib/boxPackingRules.js's plan via Shopify's
//                              Order Editing API
//
// Built 2026-08-31 per Sam, after Susie Mariboho (Scale3PL) flagged that
// packers can't be expected to remember which SKU combos need the branded
// outer box — see lib/boxPackingRules.js's header for the full spec + the
// investigation this implements.
//
// SAFETY GATE — LIVE as of 2026-08-31 per Sam's explicit go-ahead in chat
// ("let's push live"). Defaults ON now (BOX_TICK_LIVE unset or anything
// other than "0" == live); set BOX_TICK_LIVE=0 in Vercel as an emergency
// kill switch if this needs to be paused without a redeploy — flipping it
// back to dry-run-only still requires editing this file. Grow System bundle
// SKU (XTR-DTC-GMFR-02) is still deliberately out of scope — see
// lib/boxPackingRules.js — flag to Sam if it turns out to matter.
//
// RACE CONDITION WITH OFG (Order Fulfillment Guru) — RESOLVED (Sam, 8/31,
// confirmed via OFG's own app settings screen): OFG's Routing rules are
// configured with Trigger = "Run automatically when orders are created" and
// Delay = "Wait for 15 minutes" — OFG does not evaluate/apply routing rules
// AT ALL until 15 minutes after order creation. The "OFG:Routing rules
// match" tag some orders carry reflects that 15-minutes-later run, not
// something that happens within seconds of creation. This tick's cadence
// (90s floor, effectively ~2min) runs well inside that 15-minute window, so
// under normal operation this tick edits the order before OFG has touched
// it at all. The not-editable skip path below (EDITABLE_FULFILLMENT_STATUSES
// / userError handling) is kept as a defensive fallback for a late/delayed
// tick, not because the race is expected under normal operation.

import { NextResponse } from "next/server";
import { planBoxForOrder } from "@/lib/boxPackingRules.js";
import { getCachedData, setCachedData } from "@/lib/dataCache.js";
import {
  BOX_DIRTY_ORDERS_KEY,
  BOX_TICK_KEY,
  BOX_DIRTY_TTL_MS,
  BOX_TICK_TTL_MS,
  BOX_MIN_REFRESH_INTERVAL_MS,
} from "@/lib/liveBoxState.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_VERSION = "2025-01";
const shopDomain = () => process.env.SHOPIFY_STORE_DOMAIN || "ace1d0-26.myshopify.com";

// Only fetch/edit orders that haven't started fulfillment yet. Order Editing
// itself is the authoritative gate (it rejects edits on ineligible orders
// with a userError, handled below), so this is a fast-fail optimization to
// skip an obviously-too-late order before spending an edit-begin/commit
// round trip on it.
const EDITABLE_FULFILLMENT_STATUSES = new Set(["UNFULFILLED", "SCHEDULED"]);

let cachedToken = null;
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) return cachedToken.value;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.XVIE_INTERNAL_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.XVIE_INTERNAL_CLIENT_SECRET;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("Shopify token exchange returned no access_token");
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 86400000) };
  return cachedToken.value;
}

async function adminGraphQL(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { cachedToken = null; throw new Error("Shopify 401"); }
  if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("Shopify GraphQL errors: " + JSON.stringify(json.errors).slice(0, 500));
  return json.data;
}

const orderGid = (numericId) => `gid://shopify/Order/${numericId}`;

// Box product variant ids (2026-08-31 lookup, both ACTIVE, $0,
// inventoryPolicy DENY). Keyed by SKU so lib/boxPackingRules.js's
// DEFAULT_BOX_SKU choice is the only thing that needs to change if the
// single-wall/double-wall default flips again.
const BOX_VARIANT_ID = {
  "XTR-SHPR-SIN": "gid://shopify/ProductVariant/48684934955231",
  "XTR-SHPR-DBL": "gid://shopify/ProductVariant/48678578847967",
};

async function fetchOrderForPlan(orderId) {
  const query = `
    query BoxTickOrder($id: ID!) {
      order(id: $id) {
        id
        name
        cancelledAt
        displayFulfillmentStatus
        lineItems(first: 100) {
          edges { node { id sku quantity } }
        }
      }
    }`;
  const data = await adminGraphQL(query, { id: orderGid(orderId) });
  return data.order || null;
}

async function applyBoxPlan(order, plan) {
  const variantId = BOX_VARIANT_ID[plan.addSku];
  if (!variantId) throw new Error(`No known variant id for box SKU ${plan.addSku}`);

  const begin = await adminGraphQL(
    `mutation BoxEditBegin($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { id lineItems(first: 100) { edges { node { id sku } } } }
        userErrors { field message }
      }
    }`,
    { id: order.id }
  );
  const beginErrs = begin.orderEditBegin?.userErrors || [];
  if (beginErrs.length) throw new Error(`orderEditBegin userErrors on ${order.name}: ${JSON.stringify(beginErrs)}`);
  const calc = begin.orderEditBegin?.calculatedOrder;
  const calculatedOrderId = calc?.id;
  if (!calculatedOrderId) throw new Error(`orderEditBegin returned no calculatedOrder for ${order.name}`);

  // "correct" plans first zero out the wrong-SKU box line — matched by SKU
  // against the CALCULATED order's line items, not the raw order-level line
  // item id, since the two ids aren't guaranteed to match (see box-SKU
  // correction session notes).
  if (plan.action === "correct") {
    const calcLineItems = (calc.lineItems?.edges || []).map((e) => e.node);
    const wrongLine = calcLineItems.find((li) => li.sku === plan.removeSku);
    if (!wrongLine) throw new Error(`orderEditBegin calculatedOrder has no line item for SKU ${plan.removeSku} on ${order.name}`);

    const setQty = await adminGraphQL(
      `mutation BoxEditSetQty($id: ID!, $lineItemId: ID!, $quantity: Int!) {
        orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { id: calculatedOrderId, lineItemId: wrongLine.id, quantity: 0 }
    );
    const setQtyErrs = setQty.orderEditSetQuantity?.userErrors || [];
    if (setQtyErrs.length) throw new Error(`orderEditSetQuantity userErrors on ${order.name}: ${JSON.stringify(setQtyErrs)}`);
  }

  const add = await adminGraphQL(
    `mutation BoxEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`,
    { id: calculatedOrderId, variantId, quantity: plan.quantity }
  );
  const addErrs = add.orderEditAddVariant?.userErrors || [];
  if (addErrs.length) throw new Error(`orderEditAddVariant userErrors on ${order.name}: ${JSON.stringify(addErrs)}`);

  const staffNote =
    plan.action === "correct"
      ? `box-tick: corrected ${plan.removeSku} -> ${plan.addSku} (${plan.reason})`
      : `box-tick: added ${plan.addSku} (${plan.reason})`;
  const commit = await adminGraphQL(
    `mutation BoxEditCommit($id: ID!, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
        order { id }
        userErrors { field message }
      }
    }`,
    { id: calculatedOrderId, staffNote }
  );
  const commitErrs = commit.orderEditCommit?.userErrors || [];
  if (commitErrs.length) throw new Error(`orderEditCommit userErrors on ${order.name}: ${JSON.stringify(commitErrs)}`);
}

export async function GET(request) {
  const started = Date.now();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const live = process.env.BOX_TICK_LIVE !== "0";

  const [dirtyHit, tickHit] = await Promise.all([
    getCachedData(BOX_DIRTY_ORDERS_KEY, BOX_DIRTY_TTL_MS).catch(() => null),
    getCachedData(BOX_TICK_KEY, BOX_TICK_TTL_MS).catch(() => null),
  ]);
  const dirty = dirtyHit?.data || null;
  const ids = dirty?.ids || [];

  if (!ids.length && !force) {
    return NextResponse.json({ ok: true, ran: false, reason: "clean", ms: Date.now() - started });
  }

  const lastTick = tickHit?.data || null;
  const since = lastTick?.at ? Date.now() - new Date(lastTick.at).getTime() : Infinity;
  if (!force && since < BOX_MIN_REFRESH_INTERVAL_MS) {
    return NextResponse.json({
      ok: true,
      ran: false,
      reason: "coalesced",
      sinceLastMs: since,
      pending: ids.length,
      ms: Date.now() - started,
    });
  }

  // Claim before work — same reasoning as /api/tag-tick's claim-before-work
  // comment: clear the queue now so orders touched by a NEW webhook during
  // this run aren't lost (they'll re-enqueue and get picked up next tick).
  await setCachedData(BOX_DIRTY_ORDERS_KEY, { ids: [], lastAt: new Date().toISOString() });
  await setCachedData(BOX_TICK_KEY, { at: new Date().toISOString() });

  const applied = [];
  const skipped = [];
  const errors = [];

  for (const orderId of ids) {
    try {
      const order = await fetchOrderForPlan(orderId);
      if (!order) {
        skipped.push({ orderId, reason: "not-found" });
        continue;
      }
      const lineItems = (order.lineItems?.edges || []).map((e) => e.node);
      const plan = planBoxForOrder({
        id: order.id,
        name: order.name,
        cancelledAt: order.cancelledAt,
        lineItems,
      });
      if (!plan) {
        skipped.push({ orderId, order: order.name, reason: "no-action-needed" });
        continue;
      }
      if (!EDITABLE_FULFILLMENT_STATUSES.has(order.displayFulfillmentStatus)) {
        skipped.push({
          orderId,
          order: order.name,
          reason: "not-editable",
          displayFulfillmentStatus: order.displayFulfillmentStatus,
          wouldAdd: plan.addSku,
        });
        continue;
      }

      if (!live) {
        applied.push({ orderId, order: order.name, dryRun: true, plan });
        continue;
      }

      await applyBoxPlan(order, plan);
      applied.push({ orderId, order: order.name, dryRun: false, plan });
    } catch (e) {
      errors.push({ orderId, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    ran: true,
    live,
    ordersChecked: ids.length,
    applied,
    skipped,
    errors,
    ms: Date.now() - started,
  });
}

export async function POST(request) {
  return GET(request);
}
