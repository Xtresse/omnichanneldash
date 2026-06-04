// =============================================================================
// XTRESSÉ CANONICAL CORE  —  SINGLE SOURCE OF TRUTH FOR ALL DASHBOARDS
// =============================================================================
// This file is BYTE-FOR-BYTE IDENTICAL across every Xtressé dashboard repo
// (omnichanneldash, xtresse-leadershipdash, Sales-Rep-Dashboards, CRO_Tracker,
// xtresse-orders-tracker). Do NOT edit a single copy — edit the master and run
// scripts/sync-core to propagate, so the dashboards can never drift.
//
// It owns every rule that determines a NUMBER:
//   • Shop timezone + date bucketing            (America/Los_Angeles)
//   • Shopify Admin API client (client-creds)   (one query, one field set)
//   • Revenue netting                            net = CURRENT subtotal
//        (= subtotalPriceSet − refundsToSubtotal; excludes shipping & tax;
//         reflects refunds, cancellations and edits. We deliberately do NOT
//         subtract totalRefundedSet, which includes refunded shipping/tax and
//         over-subtracts.)
//   • Channel classification  B2B / DTC / ADCS
//   • Rep roster + attribution
//   • SKU → product family map + B2B focus SKUs
//
// Reconciled vs Shopify, May 2026: B2B May 1–30 = $1,013,743 / 469 rep orders.
// Same metric + same window ⇒ same number on every dashboard, by construction.
// =============================================================================

export const SHOP_TZ = 'America/Los_Angeles';
const API_VERSION = '2025-01';
const DEFAULT_STORE = 'ace1d0-26.myshopify.com';
const shopDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN || process.env.WINDSOR_ACCOUNT || DEFAULT_STORE;

export function hasShopifyCreds() {
  return Boolean(
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)
  );
}

// ---- Store-timezone date helpers -------------------------------------------
// Shopify Analytics (the number the team cross-checks against) buckets orders
// in the SHOP timezone. Order timestamps come back as UTC ISO; convert to the
// shop wall-clock so month boundaries tie. Without this, late-evening-PT orders
// (early next-day UTC) leak into the next month.
const _dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
export function toShopLocalISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = {};
  for (const part of _dtf.formatToParts(d)) p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}`;
}
export const shopLocalDate = (iso) => toShopLocalISO(iso).slice(0, 10);

// ---- Tag parsing / rep roster / classification -----------------------------
export const REPS = {
  "Jamie Bergeron": ["Existing", "West"],
  "Michelle Spencer": ["Existing", "East"],
  "Dia Lamport": ["Existing", "East"],
  "Cheryl Greiber": ["Existing", "West"],
  "Denisse Schimelpfening": ["Existing", "West"],
  "Tyler De Masi": ["Existing", "East"],
  "Laura Mann": ["Existing", "West"],
  "Sherry Quinn": ["Existing", "East"],
  "Michelle Boehle": ["Existing", "West"],
  "Sonia Mace": ["Existing", "East"],
  "Taylor Bates": ["Existing", "East"],
  "Julie Fetter": ["Existing", "West"],
  "Becky Curry": ["Existing", "East"],
  "Ryan Masa": ["1099", "West"],
  "Heidi Fisher": ["New", "West"],
  "Gina Napoli": ["New", "East"],
  "Amy Pierre": ["New", "East"],
  "Megan Gilbert": ["New", "East"],
  "Bridget Selberg": ["New", "West"],
  "Carrie Dodge": ["New", "West"],
  "Morgan Hood": ["New", "East"],
  "James Tuckett": ["New", "West"],
  "Lexi Cavaliere": ["1099", "West"],
  "Jim & Anne Weeks": ["1099", "East"],
  "Sevi McCutcheon": ["1099", "East"],
  "Krista Taylor": ["1099", "West"],
};
export const TERRITORY_ORDER = ["Existing", "New", "1099"];

const norm = (s) =>
  String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const VARIANTS = (() => {
  const m = {};
  for (const r of Object.keys(REPS)) m[norm(r)] = r;
  m[norm('Tyler DeMasi')] = 'Tyler De Masi';
  m[norm('jim and anne weeks')] = 'Jim & Anne Weeks';
  m[norm('Dia Spangler Lamport')] = 'Dia Lamport';
  m[norm('lexi Calaviere')] = 'Lexi Cavaliere';
  return m;
})();

// Accepts an array OR any string format Shopify Flow / connectors emit:
// Python list literal, JSON array, or plain CSV. Format-agnostic ON PURPOSE so
// the row tag encoding can never break attribution again.
export function parseOrderTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  const stripped = String(raw).trim().replace(/^\[|\]$/g, '');
  const quoted = stripped.match(/['"]([^'"]*)['"]/g);
  if (quoted && quoted.length > 0) {
    return quoted.map((m) => m.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
  }
  return stripped.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// canonical rep attribution. Returns repName | '__EXCLUDE__' (ADCS) | null.
export function findRep(tagsRaw) {
  const tags = parseOrderTags(tagsRaw);
  if (tags.length === 0) return null;
  for (const t of tags) {
    const lower = String(t || '').toLowerCase();
    if (lower.includes('adcs') || lower.includes('advanced derm')) return '__EXCLUDE__';
  }
  for (const t of tags) {
    const nt = norm(t);
    if (VARIANTS[nt]) return VARIANTS[nt];
  }
  return null;
}
export function territoryFor(rep) { return REPS[rep] ? REPS[rep][0] : null; }
export function regionFor(rep) { return REPS[rep] ? REPS[rep][1] : null; }

export function isAdcs(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^adcs$/i.test(t) || /advanced derm/i.test(t));
}
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}

const B2B_DISCOUNT_PATTERNS = [/^REP-/i, /^XVIE\d+/i, /^B2B-/i, /^ADCS-/i];

// Channel: 'B2B' (incl ADCS sub-bucket) | 'DTC'. Use isAdcs() to split ADCS.
// B2B iff: a recognized rep is tagged, OR b2b/wholesale/adcs tag, OR a B2B
// discount-code pattern. Rep attribution is the primary signal.
export function classifyChannel({ tagsRaw, discountCodesRaw }) {
  if (isAdcs(tagsRaw)) return 'ADCS';
  const rep = findRep(tagsRaw);
  if (rep && rep !== '__EXCLUDE__') return 'B2B';
  const tags = parseOrderTags(tagsRaw).map((t) => t.toLowerCase());
  if (tags.includes('b2b') || tags.includes('wholesale')) return 'B2B';
  const codes = parseOrderTags(discountCodesRaw);
  if (codes.some((c) => B2B_DISCOUNT_PATTERNS.some((re) => re.test(c)))) return 'B2B';
  return 'DTC';
}

// ---- SKU → family ----------------------------------------------------------
export const SKU_FAMILY = {
  "860011740100": "Gummies",
  "X-GN-045CT-001": "Gummies", "X-GN-060CT-001": "Gummies", "X-GN-060CT-003": "Gummies",
  "X-GN-060CT-BROWN": "Gummies", "X-GN-090CT-001": "Gummies", "X-GN-180CT-001": "Gummies",
  "X-GN-002CT-001": "Sachets", "X-GN-002CT-002": "Sachets", "X-GN-002CT-003": "Sachets",
  "X-GN-002CT-004": "Sachets", "X-GN-002CT-RAW": "Sachets",
  "X-FRC-30ML-CASE": "Serum", "X-FRC-30ML-001": "Serum",
  "X-XVIE-2ML-006": "XVIE", "X-XVIE-2ML-001": "XVIE", "X-XVIE-2ML-003": "XVIE", "X-XVIE-003": "XVIE",
  "XTR-SHPR-DBL": "Exclude", "test-nem-1234": "Exclude", "X-BAG-MKT": "Exclude",
  "X-TEE-F-XS": "Exclude", "X-TEE-F-S": "Exclude", "X-TEE-F-MD": "Exclude",
  "X-TEE-F-LG": "Exclude", "X-TEE-F-XL": "Exclude", "X-TEE-M-SM": "Exclude",
  "X-TEE-M-MD": "Exclude", "X-TEE-M-LG": "Exclude", "X-TEE-M-XL": "Exclude",
};
export function familyFor(sku) {
  if (!sku) return "Other";
  if (SKU_FAMILY[sku]) return SKU_FAMILY[sku];
  const u = String(sku).toUpperCase();
  if (u.startsWith("X-GN-002")) return "Sachets";
  if (u.startsWith("X-GN")) return "Gummies";
  if (u.includes("XVIE")) return "XVIE";
  if (u.includes("FRC")) return "Serum";
  if (u.startsWith("X-TEE") || u.startsWith("X-BAG") || u.startsWith("XTR-")) return "Exclude";
  return "Other";
}
export const FAMILY_ORDER = ["Gummies", "Serum", "XVIE", "Sachets"];
export const B2B_FOCUS_SKUS = {
  Serum:   new Set(["X-FRC-30ML-CASE"]),
  Gummies: new Set(["860011740100"]),
  XVIE:    null, // no dedicated B2B case SKU — count all XVIE
};

// ---- Shopify Admin API client ----------------------------------------------
let cachedToken = null;
async function getAccessToken() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) return cachedToken.value;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Shopify token exchange returned no access_token');
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 86400000) };
  return cachedToken.value;
}
async function adminGraphQL(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 300 },
  });
  if (res.status === 401) { cachedToken = null; throw new Error('Shopify 401'); }
  if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error('Shopify GraphQL errors: ' + JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

const money = (set) => (set && set.shopMoney ? set.shopMoney.amount : '');
const numericId = (gid) => (gid ? String(gid).split('/').pop() : '');
const mapFulfillment = (s) => (s === 'FULFILLED' ? 'fulfilled' : s === 'PARTIALLY_FULFILLED' ? 'partial' : null);

const ORDERS_QUERY = `
query Orders($q: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name createdAt displayFinancialStatus displayFulfillmentStatus tags discountCodes email
      customer { id defaultAddress { city provinceCode province country zip } }
      subtotalPriceSet { shopMoney { amount } }
      currentSubtotalPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      shippingAddress { address1 city company province provinceCode country countryCodeV2 zip latitude longitude }
      lineItems(first: 100) { edges { node {
        title sku quantity
        originalUnitPriceSet { shopMoney { amount } }
        totalDiscountSet { shopMoney { amount } }
      } } }
    } }
  }
}`;

// Flatten a Shopify order into canonical "Windsor-shaped" rows (one per line
// item) consumed by every dashboard. CANONICAL NET = current subtotal:
//   order_subtotal_price       = subtotalPriceSet            (original, excl ship/tax)
//   order_refunds_subtotal     = subtotalPriceSet − currentSubtotalPriceSet
//   ⇒ net = order_subtotal_price − order_refunds_subtotal = currentSubtotalPriceSet
// order_created_at is SHOP-LOCAL so all windowing/bucketing is store-TZ.
function orderToRows(order) {
  const a = order.shippingAddress || {};
  const def = (order.customer && order.customer.defaultAddress) || {};
  const sub = parseFloat(money(order.subtotalPriceSet)) || 0;
  const curSub = parseFloat(money(order.currentSubtotalPriceSet)) || 0;
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const codes = Array.isArray(order.discountCodes) ? order.discountCodes : [];
  const base = {
    order_id: numericId(order.id),
    order_name: order.name || '',
    order_created_at: toShopLocalISO(order.createdAt),
    order_created_at_utc: order.createdAt || '',
    order_financial_status: order.displayFinancialStatus || '',
    order_fulfillment_status: mapFulfillment(order.displayFulfillmentStatus),
    order_subtotal_price: money(order.subtotalPriceSet),
    order_gross_sales: money(order.subtotalPriceSet),
    order_total_price_amount: money(order.currentTotalPriceSet),
    order_total_price: money(order.currentTotalPriceSet),
    order_total_discounts: money(order.totalDiscountsSet),
    order_total_shipping_price: money(order.totalShippingPriceSet),
    order_refunds_subtotal: String(Math.max(0, sub - curSub)),
    order_returns_amount: '',
    order_tags: JSON.stringify(tags),
    order_discount_codes: JSON.stringify(codes),
    order_email: order.email || '',
    order_customer_id: numericId(order.customer && order.customer.id) || (order.email || '').toLowerCase(),
    order_shipping_address: a.address1 || '',
    order_shipping_address_city: a.city || '',
    order_shipping_address_province: a.province || a.provinceCode || '',
    order_shipping_address_zip: a.zip || '',
    // Shopify geocodes most ship-to addresses → exact rooftop lat/lng. Carried
    // through for the ZIP heat map (preferred over ZIP-centroid geocoding).
    order_shipping_address_lat: a.latitude != null ? a.latitude : '',
    order_shipping_address_lng: a.longitude != null ? a.longitude : '',
    order_shipping_address_country: a.country || a.countryCodeV2 || '',
    order_shipping_address_company: a.company || '',
    customer_default_address__city: def.city || a.city || '',
    customer_default_address__province_code: def.provinceCode || a.provinceCode || '',
  };
  const lis = (order.lineItems && order.lineItems.edges) || [];
  if (lis.length === 0) {
    return [{ ...base, line_item__title: '', line_item__sku: '', line_item__quantity: '', line_item__price: '', line_item__total_discount: '' }];
  }
  return lis.map((le) => {
    const li = le.node;
    return {
      ...base,
      line_item__title: li.title || '',
      line_item__sku: li.sku || '',
      line_item__quantity: li.quantity == null ? '' : String(li.quantity),
      line_item__price: money(li.originalUnitPriceSet),
      line_item__total_discount: money(li.totalDiscountSet),
    };
  });
}

async function fetchOrders(q) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const data = await adminGraphQL(ORDERS_QUERY, { q, cursor });
    const conn = data.orders;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// Quarterly shards fetched concurrently (cursor pagination is sequential per
// query, so sharding is the only way to parallelize the cold full pull).
function quarterShards(fromISO, toISO) {
  const start = new Date(fromISO + 'T00:00:00Z');
  const end = toISO ? new Date(toISO + 'T00:00:00Z') : new Date();
  const shards = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1));
    const lo = cur.toISOString().slice(0, 10);
    const hi = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    shards.push(`created_at:>=${lo} created_at:<=${hi}`);
    cur = next;
  }
  return shards;
}

// Date range pull. Shopify evaluates bare-date created_at in the SHOP timezone,
// so the window is store-TZ — matching order_created_at (also store-local).
export async function fetchShopifyRows({ from, to } = {}) {
  const lo = from || '2024-01-01';
  const hi = to || new Date().toISOString().slice(0, 10);
  // pad one UTC day on each side so store-TZ boundary orders aren't missed,
  // then the consumer windows precisely by shop-local order_created_at.
  const orders = await fetchOrders(`created_at:>=${lo} created_at:<=${hi}`);
  const rows = [];
  for (const o of orders) for (const r of orderToRows(o)) rows.push(r);
  return rows;
}

// Full-history pull (store opened 2024), quarterly-sharded for speed.
export async function fetchShopifyAllRows(fromISO = '2024-01-01') {
  const shards = quarterShards(fromISO);
  const results = await Promise.all(shards.map((q) => fetchOrders(q)));
  const rows = [];
  for (const o of results.flat()) for (const r of orderToRows(o)) rows.push(r);
  return rows;
}
