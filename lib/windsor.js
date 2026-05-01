import { classifyOrder, isSubscription, parseOrderTags } from "./classify.js";
import { familyFor, fulfillmentLocFor, CHANNEL_COLORS } from "./constants.js";

const WINDSOR_BASE = "https://windsor.ai/api/v1/all";

/**
 * Fetch line-item-level Shopify orders from Windsor.
 * One row per (order, sku) combination.
 *
 * @param {string} datePreset  e.g. "last_30_days", "last_3_months", "last_2years"
 * @returns {Promise<Array<object>>}
 */
export async function fetchWindsorRows(datePreset = "last_2years") {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");

  const fields = [
    "order_id",
    "order_created_at",
    "order_total_price",
    "order_subtotal",
    "order_tags",
    "order_discount_codes",
    "customer_id",
    "customer_email",
    "shipping_country",
    "shipping_state",
    "line_item__sku",
    "line_item__quantity",
    "line_item__price",
  ].join(",");

  const params = new URLSearchParams({
    api_key: apiKey,
    connector: "shopify",
    fields,
    date_preset: datePreset,
    _limit: "50000",
  });

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Windsor request failed: ${res.status} ${res.statusText}`);
  }
  // Guard against Windsor returning HTML (e.g. login wall, 404 HTML page) when
  // the URL or key is wrong — gives a much clearer error than JSON.parse barfing.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const preview = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      `Windsor returned non-JSON (${contentType || "unknown"}): "${preview}". ` +
        "Check WINDSOR_API_KEY, the API URL, and that the Shopify connector is authorized."
    );
  }
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

// =============================================================
// Aggregation helpers
// =============================================================

const monthKey = (d) => {
  const x = new Date(d);
  if (isNaN(x)) return null;
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (key) => {
  if (!key) return "";
  const [y, m] = key.split("-");
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

/**
 * De-duplicate Windsor line-item rows down to one row per order_id.
 * For order-level metrics (revenue, AOV, order count) we want unique orders;
 * for SKU-level we keep all line items.
 */
function uniqueOrders(rows) {
  const seen = new Map();
  for (const r of rows) {
    const id = r.order_id;
    if (!id) continue;
    if (!seen.has(id)) seen.set(id, r);
  }
  return Array.from(seen.values());
}

/**
 * Run all aggregations on the raw Windsor row set.
 * Returns a single payload object that the dashboard renders.
 */
export function buildDashboardData(rawRows) {
  // Filter test/comp orders (zero-price)
  const rows = rawRows.filter((r) => Number(r.order_total_price) > 0);

  // Pre-classify orders once
  const orderRows = uniqueOrders(rows);
  const channelByOrder = new Map();
  for (const r of orderRows) {
    channelByOrder.set(
      r.order_id,
      classifyOrder({
        tagsRaw: r.order_tags,
        discountCodesRaw: r.order_discount_codes,
      })
    );
  }

  // ---- KPIs (top of page) ----
  const kpis = {
    totalRevenue: 0,
    totalOrders: orderRows.length,
    b2bRevenue: 0,
    dtcRevenue: 0,
    b2bOrders: 0,
    dtcOrders: 0,
    b2bAOV: 0,
    dtcAOV: 0,
  };
  for (const r of orderRows) {
    const ch = channelByOrder.get(r.order_id);
    const rev = Number(r.order_total_price) || 0;
    kpis.totalRevenue += rev;
    if (ch === "B2B") {
      kpis.b2bRevenue += rev;
      kpis.b2bOrders += 1;
    } else {
      kpis.dtcRevenue += rev;
      kpis.dtcOrders += 1;
    }
  }
  kpis.b2bAOV = kpis.b2bOrders ? kpis.b2bRevenue / kpis.b2bOrders : 0;
  kpis.dtcAOV = kpis.dtcOrders ? kpis.dtcRevenue / kpis.dtcOrders : 0;
  kpis.b2bShare = kpis.totalRevenue ? kpis.b2bRevenue / kpis.totalRevenue : 0;
  kpis.dtcShare = kpis.totalRevenue ? kpis.dtcRevenue / kpis.totalRevenue : 0;

  // ---- Tier 1: monthly revenue / orders / AOV by channel ----
  const monthly = new Map(); // key -> { B2B_rev, DTC_rev, B2B_ord, DTC_ord }
  for (const r of orderRows) {
    const k = monthKey(r.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(r.order_id);
    if (!monthly.has(k)) monthly.set(k, { B2B_rev: 0, DTC_rev: 0, B2B_ord: 0, DTC_ord: 0 });
    const slot = monthly.get(k);
    slot[`${ch}_rev`] += Number(r.order_total_price) || 0;
    slot[`${ch}_ord`] += 1;
  }
  const monthlyKeys = Array.from(monthly.keys()).sort();
  const monthlySeries = monthlyKeys.map((k) => {
    const s = monthly.get(k);
    return {
      month: k,
      label: monthLabel(k),
      B2B: Math.round(s.B2B_rev),
      DTC: Math.round(s.DTC_rev),
      Total: Math.round(s.B2B_rev + s.DTC_rev),
      B2B_orders: s.B2B_ord,
      DTC_orders: s.DTC_ord,
      B2B_AOV: s.B2B_ord ? Math.round(s.B2B_rev / s.B2B_ord) : 0,
      DTC_AOV: s.DTC_ord ? Math.round(s.DTC_rev / s.DTC_ord) : 0,
    };
  });

  // ---- Tier 1: cumulative YTD revenue per year ----
  // Group by year, then accumulate revenue chronologically, label by month-of-year.
  const yearAccum = new Map(); // year -> [{month, B2B, DTC, Total}]
  for (const k of monthlyKeys) {
    const [y, m] = k.split("-");
    const slot = monthly.get(k);
    if (!yearAccum.has(y)) yearAccum.set(y, []);
    const arr = yearAccum.get(y);
    const prev = arr[arr.length - 1] || { B2B: 0, DTC: 0, Total: 0 };
    arr.push({
      month: Number(m),
      label: monthLabel(k),
      B2B: prev.B2B + Math.round(slot.B2B_rev),
      DTC: prev.DTC + Math.round(slot.DTC_rev),
      Total: prev.Total + Math.round(slot.B2B_rev + slot.DTC_rev),
    });
  }
  const cumulativeYTD = Array.from(yearAccum.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, points]) => ({ year, points }));

  // ---- Tier 1: top 10 SKUs by revenue, faceted by channel ----
  // Use line-item rows, attribute revenue at line level (qty * price).
  const skuTotals = new Map(); // sku -> { B2B, DTC }
  for (const r of rows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineRev = (Number(r.line_item__price) || 0) * (Number(r.line_item__quantity) || 0);
    if (!skuTotals.has(sku)) skuTotals.set(sku, { B2B: 0, DTC: 0 });
    skuTotals.get(sku)[ch] += lineRev;
  }
  const topSKUs = Array.from(skuTotals.entries())
    .map(([sku, v]) => ({
      sku,
      B2B: Math.round(v.B2B),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.DTC),
    }))
    .sort((a, b) => b.Total - a.Total)
    .slice(0, 10);

  // ---- Tier 1: product family revenue, channel grouped ----
  const familyTotals = new Map(); // family -> { B2B, DTC }
  for (const r of rows) {
    const fam = familyFor(r.line_item__sku);
    if (fam === "Other") continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineRev = (Number(r.line_item__price) || 0) * (Number(r.line_item__quantity) || 0);
    if (!familyTotals.has(fam)) familyTotals.set(fam, { B2B: 0, DTC: 0 });
    familyTotals.get(fam)[ch] += lineRev;
  }
  const productFamily = Array.from(familyTotals.entries())
    .map(([family, v]) => ({
      family,
      B2B: Math.round(v.B2B),
      DTC: Math.round(v.DTC),
    }))
    .sort((a, b) => b.B2B + b.DTC - (a.B2B + a.DTC));

  // ---- Tier 2: new vs returning customers per channel, monthly ----
  // First-touch: earliest order_created_at per customer_email within the channel.
  const firstSeen = new Map(); // `${ch}|${email}` -> ms
  for (const r of orderRows) {
    const email = (r.customer_email || "").toLowerCase().trim();
    if (!email) continue;
    const ch = channelByOrder.get(r.order_id);
    const key = `${ch}|${email}`;
    const t = new Date(r.order_created_at).getTime();
    if (isNaN(t)) continue;
    if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
  }

  const newReturnByMonth = new Map(); // monthKey -> { B2B_new, B2B_ret, DTC_new, DTC_ret }
  for (const r of orderRows) {
    const k = monthKey(r.order_created_at);
    const email = (r.customer_email || "").toLowerCase().trim();
    if (!k || !email) continue;
    const ch = channelByOrder.get(r.order_id);
    const t = new Date(r.order_created_at).getTime();
    const first = firstSeen.get(`${ch}|${email}`);
    const isNew = t === first;
    if (!newReturnByMonth.has(k))
      newReturnByMonth.set(k, { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 });
    const slot = newReturnByMonth.get(k);
    slot[`${ch}_${isNew ? "new" : "ret"}`] += 1;
  }
  const customerDynamics = monthlyKeys.map((k) => ({
    month: k,
    label: monthLabel(k),
    ...(newReturnByMonth.get(k) || { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 }),
  }));

  // ---- Tier 2: repeat purchase rate per channel, monthly ----
  // = returning_orders / total_orders within month, per channel
  const repeatRate = customerDynamics.map((row) => {
    const b2bTotal = row.B2B_new + row.B2B_ret;
    const dtcTotal = row.DTC_new + row.DTC_ret;
    return {
      month: row.month,
      label: row.label,
      B2B: b2bTotal ? Math.round((row.B2B_ret / b2bTotal) * 1000) / 10 : 0,
      DTC: dtcTotal ? Math.round((row.DTC_ret / dtcTotal) * 1000) / 10 : 0,
    };
  });

  // ---- Tier 2: DTC subscription vs one-time, monthly stacked ----
  const subVsOneTime = monthlyKeys.map((k) => {
    let sub = 0;
    let one = 0;
    for (const r of orderRows) {
      if (monthKey(r.order_created_at) !== k) continue;
      if (channelByOrder.get(r.order_id) !== "DTC") continue;
      const rev = Number(r.order_total_price) || 0;
      if (isSubscription(r.order_tags)) sub += rev;
      else one += rev;
    }
    return {
      month: k,
      label: monthLabel(k),
      Subscription: Math.round(sub),
      OneTime: Math.round(one),
    };
  });

  // ---- Tier 3: revenue by state, top 15, B2B vs DTC ----
  const stateTotals = new Map();
  for (const r of orderRows) {
    const state = (r.shipping_state || "").toUpperCase().trim();
    if (!state) continue;
    const ch = channelByOrder.get(r.order_id);
    const rev = Number(r.order_total_price) || 0;
    if (!stateTotals.has(state)) stateTotals.set(state, { B2B: 0, DTC: 0 });
    stateTotals.get(state)[ch] += rev;
  }
  const revenueByState = Array.from(stateTotals.entries())
    .map(([state, v]) => ({
      state,
      B2B: Math.round(v.B2B),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.DTC),
    }))
    .sort((a, b) => b.Total - a.Total)
    .slice(0, 15);

  // ---- Tier 3: discount code usage ----
  const codeTotals = new Map();
  for (const r of orderRows) {
    const codes = (r.order_discount_codes || "")
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!codes.length) continue;
    const ch = channelByOrder.get(r.order_id);
    const rev = Number(r.order_total_price) || 0;
    for (const c of codes) {
      const key = c.toUpperCase();
      if (!codeTotals.has(key)) codeTotals.set(key, { B2B: 0, DTC: 0, count: 0 });
      const slot = codeTotals.get(key);
      slot[ch] += rev;
      slot.count += 1;
    }
  }
  const discountUsage = Array.from(codeTotals.entries())
    .map(([code, v]) => ({
      code,
      B2B: Math.round(v.B2B),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.DTC),
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // ---- Tier 3: 3PL fulfillment split ----
  const fulfillTotals = new Map();
  for (const r of orderRows) {
    const loc = fulfillmentLocFor(r.shipping_state);
    const ch = channelByOrder.get(r.order_id);
    if (!fulfillTotals.has(loc)) fulfillTotals.set(loc, { B2B: 0, DTC: 0 });
    fulfillTotals.get(loc)[ch] += 1;
  }
  const fulfillmentSplit = Array.from(fulfillTotals.entries()).map(
    ([location, v]) => ({ location, B2B: v.B2B, DTC: v.DTC })
  );

  return {
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    orderCount: orderRows.length,
    kpis,
    monthlySeries,
    cumulativeYTD,
    topSKUs,
    productFamily,
    customerDynamics,
    repeatRate,
    subVsOneTime,
    revenueByState,
    discountUsage,
    fulfillmentSplit,
    channelColors: CHANNEL_COLORS,
  };
}
