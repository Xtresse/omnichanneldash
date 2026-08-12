#!/usr/bin/env node
// =============================================================================
// B2B PRODUCT-SPECIFIC ORDER TAGGING — DRY RUN
// =============================================================================
// Pulls real Shopify order + customer + line-item data, runs every distinct
// B2B customer's full paid order history through lib/firstOrderTags.js, and
// reports every order that WOULD change. Read-only — never calls tagsAdd /
// tagsRemove / any Shopify write mutation.
//
// Usage:
//   node --env-file=.env.local scripts/first-order-tags-dry-run.mjs --stage=laura
//   node --env-file=.env.local scripts/first-order-tags-dry-run.mjs --stage=full
//
// Stage "laura" = Laura Mann's territory only (the already-validated
//   proof-of-correctness pass — compare output against the reconciliation
//   table from the prior design/validation investigation).
// Stage "full"  = every B2B customer store-wide (the real backfill scope).
//
// Methodology:
//   1. Identify the customer-ID universe for this stage via a scoped Shopify
//      order search (cheap — tags/discount-codes/customer.id only).
//        - laura: tag:'Laura Mann'
//        - full:  every rep-name tag OR b2b/wholesale/adcs/rep/territory tag
//                 (a superset), then keep only customers with >=1 order that
//                 classifyChannel() actually calls 'B2B' (never ADCS-only).
//   2. For that customer set, fetch each customer's FULL order history (any
//      status, any channel, all time) via batched customer_id: OR-queries —
//      so a customer's occasional DTC order under the same customer.id is
//      still seen (chronology must be true "first ever", not "first B2B").
//   3. Run lib/firstOrderTags.js's computeCustomerTagPlan() +
//      detectFirstOrderCorrection() per customer.
//   4. Diff against CURRENT Shopify tags; report every order that would gain
//      a tag, plus every First-order correction (remove-and-relocate) case.
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  classifyChannel,
  parseOrderTags,
  toShopLocalISO,
  REPS,
} from '../lib/xtresseCore.js';
import { computeCustomerTagPlan, detectFirstOrderCorrection, isEligibleOrder } from '../lib/firstOrderTags.js';

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
const OUT_DIR = args.out || '/private/tmp/claude-501/-Users-samsood-Documents-GitHub-omnichanneldash/8b03307d-4c33-4d6b-8edf-8e0a5f6c9b38/scratchpad';

// ---- minimal Shopify Admin GraphQL client (plumbing only — no classification
// logic here; all classification/family/tag rules are imported above) -------
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
      const wait = 1000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait));
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
    // Respect cost throttling proactively.
    const cost = json.extensions && json.extensions.cost;
    if (cost && cost.throttleStatus) {
      const { currentlyAvailable, restoreRate } = cost.throttleStatus;
      const requested = cost.requestedQueryCost || 0;
      if (currentlyAvailable < requested + 50) {
        await new Promise((r) => setTimeout(r, 600));
      }
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

// Map a raw Shopify order node -> the shape lib/firstOrderTags.js expects.
function toDetectionOrder(node) {
  const sub = money(node.subtotalPriceSet);
  const curSub = money(node.currentSubtotalPriceSet);
  const isCancelled = Boolean(node.cancelledAt);
  // Same convention as xtresseCore.js orderToRows: cancelled/voided orders
  // force refundsSubtotal = full subtotal (net -> 0), because Shopify does
  // not always emit a refund delta for a Net-Terms void.
  const refundsSubtotal = isCancelled ? sub : Math.max(0, sub - curSub);
  const lis = (node.lineItems && node.lineItems.edges) || [];
  return {
    id: numericId(node.id),
    name: node.name,
    customerId: numericId(node.customer && node.customer.id),
    customerName: (node.customer && node.customer.displayName) || '',
    company: (node.shippingAddress && node.shippingAddress.company) || '',
    createdAt: toShopLocalISO(node.createdAt),
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

// ---- Stage 1: identify the customer-ID universe ----------------------------
async function identifyCustomerUniverse(stage) {
  if (stage === 'laura') {
    console.error('[stage=laura] scoping query: tag:\'Laura Mann\'');
    const nodes = await fetchOrdersByQuery(`status:any tag:'Laura Mann'`, `id customer { id }`);
    const ids = new Set(nodes.map((n) => numericId(n.customer && n.customer.id)).filter(Boolean));
    console.error(`[stage=laura] ${nodes.length} orders -> ${ids.size} distinct customers`);
    return ids;
  }

  // full: superset of every rep-name tag + generic B2B signal tags/ADCS.
  const repTagParts = Object.keys(REPS).map((r) => `tag:'${r}'`);
  const signalParts = [...repTagParts, 'tag:b2b', 'tag:wholesale', 'tag:adcs', 'tag:rep', 'tag:territory'];
  const q = `status:any (${signalParts.join(' OR ')})`;
  console.error('[stage=full] scoping query (B2B-signal superset)...');
  const nodes = await fetchOrdersByQuery(q, `id tags discountCodes customer { id }`);
  console.error(`[stage=full] ${nodes.length} signal orders fetched, classifying channel per order...`);

  const b2bCustomerIds = new Set();
  const adcsOnlyCandidate = new Set();
  const perCustomerChannels = new Map(); // customerId -> Set(channels)
  for (const n of nodes) {
    const cid = numericId(n.customer && n.customer.id);
    if (!cid) continue;
    const channel = classifyChannel({ tagsRaw: n.tags, discountCodesRaw: n.discountCodes });
    if (!perCustomerChannels.has(cid)) perCustomerChannels.set(cid, new Set());
    perCustomerChannels.get(cid).add(channel);
  }
  for (const [cid, channels] of perCustomerChannels) {
    if (channels.has('B2B')) b2bCustomerIds.add(cid);
    else if (channels.has('ADCS')) adcsOnlyCandidate.add(cid);
  }
  console.error(
    `[stage=full] ${perCustomerChannels.size} distinct customers touched the signal query -> ` +
    `${b2bCustomerIds.size} confirmed B2B (classifyChannel), ${adcsOnlyCandidate.size} ADCS-only excluded`
  );
  return b2bCustomerIds;
}

// ---- Stage 2: full order history per customer, batched ---------------------
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

// ---- Reporting ---------------------------------------------------------------
function buildReport(byCustomer) {
  const changes = []; // one row per (order, change)
  let firstOrderAdditions = 0;
  let firstOrderCorrections = 0; // remove+relocate pairs
  let firstGummyAdditions = 0;
  let firstSerumAdditions = 0;
  let firstXvieAdditions = 0;
  let customersWithAnyChange = 0;

  for (const [customerId, orders] of byCustomer) {
    const plan = computeCustomerTagPlan(orders);
    const correction = detectFirstOrderCorrection(orders, plan);
    const byId = new Map(orders.map((o) => [o.id, o]));
    let customerChanged = false;

    for (const [orderId, adds] of plan.tagsToAdd) {
      const o = byId.get(orderId);
      const alreadyHas = new Set((o.tags || []).map((t) => t.toLowerCase()));
      const netAdds = adds.filter((t) => !alreadyHas.has(t.toLowerCase()));
      if (netAdds.length === 0) continue;
      customerChanged = true;
      for (const t of netAdds) {
        if (t === 'First order') {
          // Only counts as a bare "addition" if it's not also a correction pair
          // (correction pairs are counted separately below to avoid double count).
          if (!correction.removals.length) firstOrderAdditions++;
        } else if (t === 'First Gummy') firstGummyAdditions++;
        else if (t === 'First Serum') firstSerumAdditions++;
        else if (t === 'First XVIE') firstXvieAdditions++;
      }
      changes.push({
        customerId,
        customerName: o.customerName,
        company: o.company,
        orderName: o.name,
        orderCreatedAt: o.createdAt,
        currentTags: o.tags,
        proposedAdditions: netAdds,
        proposedRemovals: [],
        reason: netAdds.map((t) =>
          t === 'First order'
            ? 'earliest eligible paid order for this customer'
            : `earliest eligible paid order containing a ${t.replace('First ', '')} SKU`
        ),
      });
    }

    if (correction.removals.length) {
      firstOrderCorrections += correction.removals.length;
      customerChanged = true;
      const correctOrder = plan.firstOrderId ? byId.get(plan.firstOrderId) : null;
      for (const rem of correction.removals) {
        const o = byId.get(rem.orderId);
        const netVal = (o.subtotal - o.refundsSubtotal).toFixed(2);
        let why;
        if (!isEligibleOrder(o)) {
          why =
            `currently tagged "First order" but is $${o.subtotal.toFixed(2)}` +
            (o.cancelledAt ? ' / VOIDED' : '') +
            ` (net $${netVal}) — not an eligible order`;
        } else {
          why = `currently tagged "First order" but is NOT the customer's earliest eligible paid order`;
        }
        if (correction.addition) {
          why += ` — real first paid order is ${(byId.get(correction.addition.orderId) || {}).name}`;
        } else if (correctOrder) {
          why += ` — correct order (${correctOrder.name}, ${correctOrder.createdAt.slice(0, 10)}) is already tagged "First order" correctly; this is a duplicate/stray tag to remove`;
        } else {
          why += ` — customer has no eligible paid order anywhere in their history`;
        }
        changes.push({
          customerId,
          customerName: o.customerName,
          company: o.company,
          orderName: o.name,
          orderCreatedAt: o.createdAt,
          currentTags: o.tags,
          proposedAdditions: [],
          proposedRemovals: ['First order'],
          reason: [why],
        });
      }
    }

    if (customerChanged) customersWithAnyChange++;
  }

  changes.sort((a, b) => String(a.orderCreatedAt).localeCompare(String(b.orderCreatedAt)));

  return {
    summary: {
      customersProcessed: byCustomer.size,
      ordersProcessed: [...byCustomer.values()].reduce((s, arr) => s + arr.length, 0),
      customersWithAnyChange,
      firstOrderAdditions,
      firstOrderCorrections,
      firstGummyAdditions,
      firstSerumAdditions,
      firstXvieAdditions,
      totalOrderLevelChanges: changes.length,
    },
    changes,
  };
}

// ---- Main --------------------------------------------------------------------
async function main() {
  console.error(`=== First-order/product tagging DRY RUN — stage=${STAGE} ===`);
  const t0 = Date.now();
  const customerIds = await identifyCustomerUniverse(STAGE);
  const byCustomer = await fetchFullHistoryForCustomers(customerIds);
  const report = buildReport(byCustomer);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = `${OUT_DIR}/dry-run-${STAGE}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.error(`\n=== SUMMARY (stage=${STAGE}) ===`);
  console.error(JSON.stringify(report.summary, null, 2));
  console.error(`\nFull report written to ${outPath}`);
  console.error(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
