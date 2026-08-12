// /api/tag-tick — the live corrector for product-family order tags
// ("First order" / "First Gummy" / "First Serum" / "First XVIE").
//
// Same coalescing shape as /api/tick, kept as its own cron so this work never
// competes with the dashboard-refresh tick's carefully-tuned CPU budget (see
// lib/liveState.js — that one already tripped a CPU alert twice from doing
// too much per minute):
//
//   /api/shopify-webhook  ->  enqueues the customer id, no compute
//   this tick (every 2m)  ->  IF any customers are queued, recomputes each
//                              customer's full tag plan and applies the diff
//
// Correctness over speed: lib/firstOrderTags.js recomputes a customer's
// entire chronological tag plan from their FULL order history every time
// (not an incremental patch), so a duplicate/delayed run is a safe no-op —
// tagsAdd/tagsRemove only fire for the actual diff against current Shopify
// tags. See lib/firstOrderTags.js's header comment for the full spec this
// implements, and scripts/first-order-tags-backfill.mjs for the one-time
// correction of pre-existing orders (this route only ever sees customers
// touched by a webhook AFTER it went live).

import { NextResponse } from "next/server";
import {
  computeCustomerTagPlan,
  detectFirstOrderCorrection,
  FIRST_ORDER_TAG,
} from "@/lib/firstOrderTags.js";
import { getCachedData, setCachedData } from "@/lib/dataCache.js";
import {
  TAG_DIRTY_CUSTOMERS_KEY,
  TAG_TICK_KEY,
  TAG_DIRTY_TTL_MS,
  TAG_TICK_TTL_MS,
  TAG_MIN_REFRESH_INTERVAL_MS,
} from "@/lib/liveTagState.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_VERSION = "2025-01";
const shopDomain = () => process.env.SHOPIFY_STORE_DOMAIN || "ace1d0-26.myshopify.com";

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

const money = (set) => (set && set.shopMoney ? parseFloat(set.shopMoney.amount) || 0 : 0);
const numericId = (gid) => (gid ? String(gid).split("/").pop() : "");

const ORDER_FIELDS = `
  id name createdAt cancelledAt displayFinancialStatus tags
  purchasingEntity { __typename ... on PurchasingCompany { location { id name } } }
  subtotalPriceSet { shopMoney { amount } }
  currentSubtotalPriceSet { shopMoney { amount } }
  lineItems(first: 100) { edges { node { sku } } }
`;

function toDetectionOrder(node, customerId) {
  const sub = money(node.subtotalPriceSet);
  const curSub = money(node.currentSubtotalPriceSet);
  const isCancelled = Boolean(node.cancelledAt);
  const refundsSubtotal = isCancelled ? sub : Math.max(0, sub - curSub);
  const lis = (node.lineItems && node.lineItems.edges) || [];
  const locationId =
    node.purchasingEntity && node.purchasingEntity.__typename === "PurchasingCompany" && node.purchasingEntity.location
      ? numericId(node.purchasingEntity.location.id)
      : null;
  // CompanyLocation id when available, else customer.id — see the "Identity
  // key" note atop lib/firstOrderTags.js. A pooled/reseller account (one
  // customer.id, many real physical locations) splits correctly here.
  const identityKey = locationId ? `loc:${locationId}` : `cust:${customerId}`;
  return {
    id: numericId(node.id), // matches lib/firstOrderTags.js's plan keying
    gid: node.id, // tagsAdd/tagsRemove need the GID, kept separately
    name: node.name,
    customerId,
    identityKey,
    createdAt: node.createdAt,
    cancelledAt: node.cancelledAt || null,
    financialStatus: node.displayFinancialStatus || "",
    subtotal: sub,
    refundsSubtotal,
    lineItemSkus: lis.map((e) => e.node.sku).filter(Boolean),
    tags: Array.isArray(node.tags) ? node.tags : [],
  };
}

async function fetchCustomerOrders(customerId) {
  const query = `
    query CustomerOrders($q: String!, $cursor: String) {
      orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${ORDER_FIELDS} } }
      }
    }`;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const data = await adminGraphQL(query, { q: `status:any customer_id:${customerId}`, cursor });
    const conn = data.orders;
    for (const e of conn.edges) out.push(toDetectionOrder(e.node, customerId));
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

async function tagsAdd(orderGid, tags) {
  const mutation = `
    mutation TagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`;
  const data = await adminGraphQL(mutation, { id: orderGid, tags });
  const errs = data.tagsAdd?.userErrors || [];
  if (errs.length) throw new Error(`tagsAdd userErrors on ${orderGid}: ${JSON.stringify(errs)}`);
}

async function tagsRemove(orderGid, tags) {
  const mutation = `
    mutation TagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
    }`;
  const data = await adminGraphQL(mutation, { id: orderGid, tags });
  const errs = data.tagsRemove?.userErrors || [];
  if (errs.length) throw new Error(`tagsRemove userErrors on ${orderGid}: ${JSON.stringify(errs)}`);
}

// Apply computeCustomerTagPlan()'s output for one customer's orders,
// returning what actually changed. Mirrors the diffing logic in
// scripts/first-order-tags-dry-run.mjs's buildReport(), but WRITES.
async function applyPlanForCustomer(orders) {
  const plan = computeCustomerTagPlan(orders);
  const correction = detectFirstOrderCorrection(orders, plan);
  const byId = new Map(orders.map((o) => [o.id, o])); // o.id is numericId — matches plan's keys
  const applied = [];

  // Additions (including the correct "First order" placement, which is
  // already part of plan.tagsToAdd for the correct order).
  for (const [orderId, adds] of plan.tagsToAdd) {
    const o = byId.get(orderId);
    if (!o) continue;
    const already = new Set((o.tags || []).map((t) => t.toLowerCase()));
    const netAdds = adds.filter((t) => !already.has(t.toLowerCase()));
    if (!netAdds.length) continue;
    await tagsAdd(o.gid, netAdds);
    applied.push({ order: o.name, added: netAdds, removed: [] });
  }

  // Removals — stray "First order" tags on the wrong order(s).
  for (const rem of correction.removals) {
    const o = byId.get(rem.orderId);
    if (!o) continue;
    await tagsRemove(o.gid, [FIRST_ORDER_TAG]);
    applied.push({ order: o.name, added: [], removed: [FIRST_ORDER_TAG] });
  }

  return applied;
}

export async function GET(request) {
  const started = Date.now();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  const [dirtyHit, tickHit] = await Promise.all([
    getCachedData(TAG_DIRTY_CUSTOMERS_KEY, TAG_DIRTY_TTL_MS).catch(() => null),
    getCachedData(TAG_TICK_KEY, TAG_TICK_TTL_MS).catch(() => null),
  ]);
  const dirty = dirtyHit?.data || null;
  const ids = dirty?.ids || [];

  if (!ids.length && !force) {
    return NextResponse.json({ ok: true, ran: false, reason: "clean", ms: Date.now() - started });
  }

  const lastTick = tickHit?.data || null;
  const since = lastTick?.at ? Date.now() - new Date(lastTick.at).getTime() : Infinity;
  if (!force && since < TAG_MIN_REFRESH_INTERVAL_MS) {
    return NextResponse.json({
      ok: true,
      ran: false,
      reason: "coalesced",
      sinceLastMs: since,
      pending: ids.length,
      ms: Date.now() - started,
    });
  }

  // Claim before work — clear the queue now so customers touched by a NEW
  // webhook during this run aren't lost (they'll re-enqueue and get picked
  // up next tick), same reasoning as /api/tick's claim-before-work comment.
  await setCachedData(TAG_DIRTY_CUSTOMERS_KEY, { ids: [], lastAt: new Date().toISOString() });
  await setCachedData(TAG_TICK_KEY, { at: new Date().toISOString() });

  const results = [];
  const errors = [];
  for (const customerId of ids) {
    try {
      const orders = await fetchCustomerOrders(customerId);
      // Split this customer's orders by identityKey before computing a plan —
      // a pooled/reseller customer.id can span multiple real locations, and
      // each needs its own independent "First order"/family-tag history.
      const byIdentity = new Map();
      for (const o of orders) {
        if (!byIdentity.has(o.identityKey)) byIdentity.set(o.identityKey, []);
        byIdentity.get(o.identityKey).push(o);
      }
      for (const [identityKey, group] of byIdentity) {
        const applied = await applyPlanForCustomer(group);
        if (applied.length) results.push({ customerId, identityKey, applied });
      }
    } catch (e) {
      errors.push({ customerId, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    ran: true,
    customersChecked: ids.length,
    customersChanged: results.length,
    changes: results,
    errors,
    ms: Date.now() - started,
  });
}

export async function POST(request) {
  return GET(request);
}
