// Direct Shopify Admin API data source — drop-in replacement for the Windsor
// connector. Returns the SAME flat, one-row-per-line-item shape that
// fetchWindsorRows() produced (same field names), so buildDashboardData() and
// every downstream consumer work unchanged.
//
// Auth: Dev Dashboard app (client-credentials grant). Client ID + Secret are
// exchanged server-side for a short-lived Admin API token (cached in module
// scope). Mirrors xvie-shipping-dashboard/lib/shopify.ts.
//
// Env vars:
//   SHOPIFY_CLIENT_ID      — Dev Dashboard app Client ID (required)
//   SHOPIFY_CLIENT_SECRET  — Dev Dashboard app Client Secret (required)
//   SHOPIFY_STORE_DOMAIN   — optional; defaults to ace1d0-26.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN — optional legacy static token; used if present.
//
// Scope: read_orders. NOTE order.customer needs read_customers, which we do NOT
// require — order_customer_id is keyed off order.email instead (stable per
// buyer, available under read_orders). New-vs-existing keys off the "first
// order" tag regardless.

const API_VERSION = "2025-01";
const DEFAULT_STORE = "ace1d0-26.myshopify.com";

const shopDomain = () => process.env.SHOPIFY_STORE_DOMAIN || DEFAULT_STORE;

export function hasShopifyCreds() {
  return Boolean(
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)
  );
}

let cachedToken = null; // { value, expiresAt }
async function getAccessToken() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("Shopify token exchange returned no access_token");
  const ttl = (json.expires_in ? json.expires_in * 1000 : 24 * 3600 * 1000);
  cachedToken = { value: json.access_token, expiresAt: now + ttl };
  return cachedToken.value;
}

async function adminGraphQL(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 300 },
  });
  if (res.status === 401) { cachedToken = null; throw new Error("Shopify 401 — token rejected"); }
  if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors) throw new Error("Shopify GraphQL errors: " + JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

const num = (v) => (v == null ? "" : String(v));
const money = (set) => (set && set.shopMoney ? set.shopMoney.amount : "");
const numericId = (gid) => (gid ? String(gid).split("/").pop() : "");

// preset -> [from, to] (YYYY-MM-DD). Mirrors Windsor's date_preset defaults.
function presetRange(preset) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const d = new Date(today);
  const map = { last_7d: 7, last_30d: 30, last_3m: 90, last_90d: 90, last_6m: 182, last_12m: 365, last_year: 365 };
  const days = map[preset] || 90;
  d.setDate(d.getDate() - days);
  return [d.toISOString().slice(0, 10), to];
}

const ORDERS_QUERY = `
query Orders($q: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name createdAt displayFinancialStatus tags discountCodes email
      subtotalPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      shippingAddress { address1 city company provinceCode province countryCodeV2 country zip }
      lineItems(first: 100) { edges { node {
        title sku quantity
        originalUnitPriceSet { shopMoney { amount } }
      } } }
    } }
  }
}`;

// Flatten Shopify orders into Windsor-shaped rows (one per line item).
function ordersToRows(orders) {
  const rows = [];
  for (const order of orders) {
    const a = order.shippingAddress || {};
    const orderFields = {
      order_id: numericId(order.id),
      order_name: order.name || "",
      order_created_at: order.createdAt || "",
      order_total_price_amount: money(order.totalPriceSet),
      order_total_price: money(order.totalPriceSet),
      order_gross_sales: money(order.subtotalPriceSet),
      order_total_discounts: money(order.totalDiscountsSet),
      order_refunds_subtotal: money(order.totalRefundedSet),
      order_returns_amount: "",
      order_financial_status: order.displayFinancialStatus || "",
      order_subtotal_price: money(order.subtotalPriceSet),
      order_tags: Array.isArray(order.tags) ? order.tags.join(", ") : (order.tags || ""),
      order_discount_codes: Array.isArray(order.discountCodes) ? order.discountCodes.join(",") : (order.discountCodes || ""),
      // read_orders cannot read order.customer; key by email instead.
      order_customer_id: (order.email || "").toLowerCase(),
      order_email: order.email || "",
      order_shipping_address_country: a.country || a.countryCodeV2 || "",
      order_shipping_address_province: a.province || a.provinceCode || "",
      order_shipping_address: a.address1 || "",
      order_shipping_address_city: a.city || "",
      order_shipping_address_zip: a.zip || "",
      // NEW: B2B account/company name straight off the order address.
      order_shipping_address_company: a.company || "",
    };
    const lis = (order.lineItems && order.lineItems.edges) || [];
    if (lis.length === 0) {
      rows.push({ ...orderFields, line_item__title: "", line_item__sku: "", line_item__quantity: "", line_item__price: "" });
      continue;
    }
    for (const le of lis) {
      const li = le.node;
      rows.push({
        ...orderFields,
        line_item__title: li.title || "",
        line_item__sku: li.sku || "",
        line_item__quantity: num(li.quantity),
        line_item__price: money(li.originalUnitPriceSet),
      });
    }
  }
  return rows;
}

async function fetchAllOrders(q) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) { // hard cap ~20k orders
    const data = await adminGraphQL(ORDERS_QUERY, { q, cursor });
    const conn = data.orders;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// Same signature/shape as fetchWindsorRows({ preset, from, to }).
export async function fetchShopifyRows({ preset, from, to } = {}) {
  let lo = from, hi = to;
  if (!(lo && hi)) [lo, hi] = presetRange(preset);
  const q = `created_at:>=${lo} created_at:<=${hi}`;
  const orders = await fetchAllOrders(q);
  return ordersToRows(orders);
}

// Lightweight all-time pull — only the fields buildDashboardData uses from
// allTimeRows (first-ever-order-per-family detection): customer key (email +
// address), created_at, tags, and line-item sku/title. No money fields, so it
// is much lighter/faster than the windowed pull. Store opened 2024-06.
const ALL_TIME_LIGHT_QUERY = `
query OrdersLight($q: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id createdAt tags email
      shippingAddress { address1 city provinceCode zip }
      lineItems(first: 100) { edges { node { title sku } } }
    } }
  }
}`;

export async function fetchShopifyAllTimeLight() {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const data = await adminGraphQL(ALL_TIME_LIGHT_QUERY, { q: "created_at:>=2024-01-01", cursor });
    const conn = data.orders;
    for (const e of conn.edges) {
      const o = e.node;
      const a = o.shippingAddress || {};
      const base = {
        order_id: numericId(o.id),
        order_created_at: o.createdAt || "",
        order_tags: Array.isArray(o.tags) ? o.tags.join(", ") : (o.tags || ""),
        order_customer_id: (o.email || "").toLowerCase(),
        order_email: o.email || "",
        order_shipping_address: a.address1 || "",
        order_shipping_address_city: a.city || "",
        order_shipping_address_province: a.provinceCode || "",
        order_shipping_address_zip: a.zip || "",
      };
      const lis = (o.lineItems && o.lineItems.edges) || [];
      if (lis.length === 0) { out.push({ ...base, line_item__title: "", line_item__sku: "" }); }
      else for (const le of lis) out.push({ ...base, line_item__title: le.node.title || "", line_item__sku: le.node.sku || "" });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}
