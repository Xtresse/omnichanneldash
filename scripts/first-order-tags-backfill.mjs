#!/usr/bin/env node
// =============================================================================
// B2B PRODUCT-SPECIFIC ORDER TAGGING — BACKFILL (writes)
// =============================================================================
// Same universe/history-fetch/plan logic as first-order-tags-dry-run.mjs, but
// actually applies the corrections via tagsAdd/tagsRemove. Defaults to a
// dry-run (no writes) unless --apply is passed, so re-running this safely
// re-checks without risk.
//
// Usage:
//   node --env-file=.env.local scripts/first-order-tags-backfill.mjs --stage=laura            (dry run, log only)
//   node --env-file=.env.local scripts/first-order-tags-backfill.mjs --stage=laura --apply     (writes)
//   node --env-file=.env.local scripts/first-order-tags-backfill.mjs --stage=full --apply
//
// This is the ONE-TIME correction of orders that predate the live
// webhook+tag-tick (/api/shopify-webhook + /api/tag-tick). Re-runnable: every
// customer's plan is recomputed from scratch from their full order history
// each time, so running this twice just re-confirms an already-correct state
// (net-zero writes on a second pass).
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  classifyChannel,
  REPS,
} from '../lib/xtresseCore.js';
import { computeCustomerTagPlan, detectFirstOrderCorrection, FIRST_ORDER_TAG } from '../lib/firstOrderTags.js';

const API_VERSION = '2025-01';
const DEFAULT_STORE = 'ace1d0-26.myshopify.com';
const shopDomain = () => process.env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const STAGE = args.stage || 'laura';
const APPLY = Boolean(args.apply);
const OUT_DIR = args.out || '/private/tmp/claude-501/-Users-samsood-Documents-GitHub-omnichanneldash/8b03307d-4c33-4d6b-8edf-8e0a5f6c9b38/scratchpad';

// ---- minimal Shopify Admin GraphQL client (same shape as the dry-run script) --
let cachedToken = null;
async function getAccessToken() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (process.env.XVIE_INTERNAL_TOKEN) return process.env.XVIE_INTERNAL_TOKEN;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) return cachedToken.value;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.XVIE_INTERNAL_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.XVIE_INTERNAL_CLIENT_SECRET;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Shopify token exchange returned no access_token');
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 86400000) };
  return cachedToken.value;
}

async function adminGraphQL(query, variables, retries = 5) {
  const token = await getAccessToken();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) { cachedToken = null; throw new Error('Shopify 401'); }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status}`);
    const json = await res.json();
    if (json.errors) {
      const throttled = JSON.stringify(json.errors).includes('THROTTLED');
      if (throttled && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error('Shopify GraphQL errors: ' + JSON.stringify(json.errors).slice(0, 500));
    }
    const cost = json.extensions && json.extensions.cost;
    if (cost && cost.throttleStatus) {
      const { currentlyAvailable, restoreRate } = cost.throttleStatus;
      const requested = cost.requestedQueryCost || 0;
      if (currentlyAvailable < requested + 50) await new Promise((r) => setTimeout(r, 600));
    }
    return json.data;
  }
  throw new Error('Shopify GraphQL: exhausted retries');
}

const money = (set) => (set && set.shopMoney ? parseFloat(set.shopMoney.amount) || 0 : 0);
const numericId = (gid) => (gid ? String(gid).split('/').pop() : '');

const FULL_ORDER_FIELDS = `
  id name createdAt cancelledAt displayFinancialStatus tags discountCodes
  customer { id displayName }
  subtotalPriceSet { shopMoney { amount } }
  currentSubtotalPriceSet { shopMoney { amount } }
  shippingAddress { company }
  lineItems(first: 100) { edges { node { sku } } }
`;

async function fetchOrdersByQuery(q, fields = FULL_ORDER_FIELDS) {
  const query = `
    query Orders($q: String!, $cursor: String) {
      orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${fields} } }
      }
    }`;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 400; i++) {
    const data = await adminGraphQL(query, { q, cursor });
    const conn = data.orders;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

function toDetectionOrder(node) {
  const sub = money(node.subtotalPriceSet);
  const curSub = money(node.currentSubtotalPriceSet);
  const isCancelled = Boolean(node.cancelledAt);
  const refundsSubtotal = isCancelled ? sub : Math.max(0, sub - curSub);
  const lis = (node.lineItems && node.lineItems.edges) || [];
  return {
    id: numericId(node.id),
    gid: node.id,
    name: node.name,
    customerId: numericId(node.customer && node.customer.id),
    customerName: (node.customer && node.customer.displayName) || '',
    company: (node.shippingAddress && node.shippingAddress.company) || '',
    createdAt: node.createdAt,
    cancelledAt: node.cancelledAt || null,
    financialStatus: node.displayFinancialStatus || '',
    subtotal: sub,
    refundsSubtotal,
    lineItemSkus: lis.map((e) => e.node.sku).filter(Boolean),
    tags: Array.isArray(node.tags) ? node.tags : [],
    discountCodes: Array.isArray(node.discountCodes) ? node.discountCodes : [],
  };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function identifyCustomerUniverse(stage) {
  if (stage === 'laura') {
    console.error("[stage=laura] scoping query: tag:'Laura Mann'");
    const nodes = await fetchOrdersByQuery(`status:any tag:'Laura Mann'`, `id customer { id }`);
    const ids = new Set(nodes.map((n) => numericId(n.customer && n.customer.id)).filter(Boolean));
    console.error(`[stage=laura] ${nodes.length} orders -> ${ids.size} distinct customers`);
    return ids;
  }
  const repTagParts = Object.keys(REPS).map((r) => `tag:'${r}'`);
  const signalParts = [...repTagParts, 'tag:b2b', 'tag:wholesale', 'tag:adcs', 'tag:rep', 'tag:territory'];
  const q = `status:any (${signalParts.join(' OR ')})`;
  console.error('[stage=full] scoping query (B2B-signal superset)...');
  const nodes = await fetchOrdersByQuery(q, `id tags discountCodes customer { id }`);
  console.error(`[stage=full] ${nodes.length} signal orders fetched, classifying channel per order...`);
  const b2bCustomerIds = new Set();
  const perCustomerChannels = new Map();
  for (const n of nodes) {
    const cid = numericId(n.customer && n.customer.id);
    if (!cid) continue;
    const channel = classifyChannel({ tagsRaw: n.tags, discountCodesRaw: n.discountCodes });
    if (!perCustomerChannels.has(cid)) perCustomerChannels.set(cid, new Set());
    perCustomerChannels.get(cid).add(channel);
  }
  for (const [cid, channels] of perCustomerChannels) if (channels.has('B2B')) b2bCustomerIds.add(cid);
  console.error(`[stage=full] ${perCustomerChannels.size} distinct customers -> ${b2bCustomerIds.size} confirmed B2B`);
  return b2bCustomerIds;
}

async function fetchFullHistoryForCustomers(customerIds) {
  const ids = [...customerIds];
  const batches = chunk(ids, 30);
  console.error(`[history] fetching full order history for ${ids.length} customers in ${batches.length} batches...`);
  const byCustomer = new Map();
  let done = 0;
  for (const batch of batches) {
    const q = `status:any (${batch.map((id) => `customer_id:${id}`).join(' OR ')})`;
    const nodes = await fetchOrdersByQuery(q);
    for (const n of nodes) {
      const o = toDetectionOrder(n);
      if (!o.customerId) continue;
      if (!byCustomer.has(o.customerId)) byCustomer.set(o.customerId, []);
      byCustomer.get(o.customerId).push(o);
    }
    done += batch.length;
    if (done % 300 === 0 || done === ids.length) console.error(`[history] ...${done}/${ids.length} customers`);
  }
  return byCustomer;
}

async function tagsAdd(orderGid, tags) {
  const mutation = `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
  const data = await adminGraphQL(mutation, { id: orderGid, tags });
  const errs = data.tagsAdd?.userErrors || [];
  if (errs.length) throw new Error(`tagsAdd userErrors on ${orderGid}: ${JSON.stringify(errs)}`);
}
async function tagsRemove(orderGid, tags) {
  const mutation = `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;
  const data = await adminGraphQL(mutation, { id: orderGid, tags });
  const errs = data.tagsRemove?.userErrors || [];
  if (errs.length) throw new Error(`tagsRemove userErrors on ${orderGid}: ${JSON.stringify(errs)}`);
}

async function main() {
  console.error(`=== First-order/product tagging BACKFILL — stage=${STAGE} apply=${APPLY} ===`);
  const t0 = Date.now();
  const customerIds = await identifyCustomerUniverse(STAGE);
  const byCustomer = await fetchFullHistoryForCustomers(customerIds);

  const log = [];
  let additions = 0, removals = 0, customersChanged = 0, writeErrors = 0;

  for (const [customerId, orders] of byCustomer) {
    const plan = computeCustomerTagPlan(orders);
    const correction = detectFirstOrderCorrection(orders, plan);
    const byId = new Map(orders.map((o) => [o.id, o]));
    let changed = false;

    for (const [orderId, adds] of plan.tagsToAdd) {
      const o = byId.get(orderId);
      if (!o) continue;
      const already = new Set((o.tags || []).map((t) => t.toLowerCase()));
      const netAdds = adds.filter((t) => !already.has(t.toLowerCase()));
      if (!netAdds.length) continue;
      changed = true;
      additions += netAdds.length;
      log.push({ customerId, customerName: o.customerName, company: o.company, order: o.name, action: 'add', tags: netAdds });
      if (APPLY) {
        try { await tagsAdd(o.gid, netAdds); }
        catch (e) { writeErrors++; log.push({ customerId, order: o.name, action: 'ERROR', error: String(e.message || e) }); }
      }
    }

    for (const rem of correction.removals) {
      const o = byId.get(rem.orderId);
      if (!o) continue;
      changed = true;
      removals++;
      log.push({ customerId, customerName: o.customerName, company: o.company, order: o.name, action: 'remove', tags: [FIRST_ORDER_TAG] });
      if (APPLY) {
        try { await tagsRemove(o.gid, [FIRST_ORDER_TAG]); }
        catch (e) { writeErrors++; log.push({ customerId, order: o.name, action: 'ERROR', error: String(e.message || e) }); }
      }
    }

    if (changed) customersChanged++;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = `${OUT_DIR}/backfill-${STAGE}-${APPLY ? 'applied' : 'dryrun'}.json`;
  writeFileSync(outPath, JSON.stringify({ summary: { customersProcessed: byCustomer.size, customersChanged, additions, removals, writeErrors, applied: APPLY }, log }, null, 2));

  console.error(`\n=== SUMMARY (stage=${STAGE}, apply=${APPLY}) ===`);
  console.error(JSON.stringify({ customersProcessed: byCustomer.size, customersChanged, additions, removals, writeErrors }, null, 2));
  console.error(`Full log written to ${outPath}`);
  console.error(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!APPLY) console.error('\n(DRY RUN — no writes made. Re-run with --apply to write.)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
