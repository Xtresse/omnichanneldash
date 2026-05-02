import { classifyOrder, isAdcs, isSubscription } from "./classify.js";
import {
  familyFor,
  fulfillmentLocFor,
  CHANNEL_COLORS,
  FAMILY_COLORS,
  FAMILY_ORDER,
} from "./constants.js";

const WINDSOR_BASE = "https://connectors.windsor.ai/shopify";

/**
 * Fetch line-item-level Shopify orders from Windsor.
 * One row per (order, sku) combination.
 *
 * Accepts EITHER a date_preset OR a custom range:
 *   fetchWindsorRows({ preset: "last_3m" })
 *   fetchWindsorRows({ from: "2025-01-01", to: "2025-12-31" })
 *
 * IMPORTANT: requests `order_net_sales` (gross - discounts - returns,
 * test/cancelled excluded) as the primary revenue field. Also pulls
 * `order_subtotal_price` so we can allocate net sales proportionally
 * to line items for SKU/family-level rollups.
 */
export async function fetchWindsorRows({ preset, from, to } = {}) {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");

  const fields = [
    "order_id",
    "order_created_at",
    "order_net_sales",           // <-- PRIMARY revenue metric
    "order_gross_sales",         // <-- for transparency in tooltips
    "order_total_discounts",
    "order_returns_amount",
    "order_subtotal_price",      // for line-item proportional allocation
    "order_total_price",         // kept for reference (gross+ship+tax)
    "order_tags",
    "order_discount_codes",
    "order_customer_id",
    "order_email",
    "order_shipping_address_country",
    "order_shipping_address_province",
    "line_item__sku",
    "line_item__quantity",
    "line_item__price",
  ].join(",");

  const params = new URLSearchParams({
    api_key: apiKey,
    fields,
    _limit: "50000",
    // CRITICAL: this filter forces Windsor to apply the returns/refunds join
    // so order_net_sales correctly reflects gross − discounts − returns.
    // Without a filter, Windsor returns order_returns_amount = $0 across the
    // board and net_sales is overstated. ADCS orders are also tagged 'b2b'
    // in practice, so this single filter captures B2B + ADCS together.
    // Verified: 2025 with this filter returns $4,254,057 (matches bookkeeping).
    filters: JSON.stringify([["order_tags", "contains", "b2b"]]),
  });

  if (from && to) {
    params.set("date_from", from);
    params.set("date_to", to);
  } else {
    params.set("date_preset", preset || "last_3m");
  }

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Windsor request failed: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const preview = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      `Windsor returned non-JSON (${contentType || "unknown"}): "${preview}". ` +
        "Check WINDSOR_API_KEY, the API URL, and that the Shopify connector is authorized."
    );
  }
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
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

function uniqueOrders(rows) {
  const seen = new Map();
  for (const r of rows) {
    const id = r.order_id;
    if (!id) continue;
    if (!seen.has(id)) seen.set(id, r);
  }
  return Array.from(seen.values());
}

const numOrZero = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

/**
 * Aggregate order-level totals across ALL rows for each order.
 *
 * Why: Windsor returns multiple rows per order (one per line item, plus
 * synthetic "refund rows" with sku=null and negative order_net_sales when
 * a refund exists). Summing across all rows correctly subtracts refunds.
 * Taking just the first row (as our old uniqueOrders dedup did) silently
 * dropped refund rows and overstated revenue.
 */
function aggregateOrderTotals(rawRows) {
  const totalsByOrder = new Map();
  for (const r of rawRows) {
    const id = r.order_id;
    if (!id) continue;
    if (!totalsByOrder.has(id)) {
      totalsByOrder.set(id, {
        order_id: id,
        order_created_at: r.order_created_at,
        order_tags: r.order_tags,
        order_discount_codes: r.order_discount_codes,
        order_email: r.order_email,
        order_customer_id: r.order_customer_id,
        order_shipping_address_country: r.order_shipping_address_country,
        order_shipping_address_province: r.order_shipping_address_province,
        order_subtotal_price: numOrZero(r.order_subtotal_price),
        net_sales: 0,
        gross_sales: 0,
        discounts: 0,
        returns: 0,
      });
    }
    const slot = totalsByOrder.get(id);
    slot.net_sales += numOrZero(r.order_net_sales);
    slot.gross_sales += numOrZero(r.order_gross_sales);
    slot.discounts += numOrZero(r.order_total_discounts);
    slot.returns += numOrZero(r.order_returns_amount);
    // Prefer non-null metadata (refund rows may have nulls in a few fields)
    if (!slot.order_created_at && r.order_created_at) slot.order_created_at = r.order_created_at;
    if (!slot.order_tags && r.order_tags) slot.order_tags = r.order_tags;
    if (!slot.order_email && r.order_email) slot.order_email = r.order_email;
    if (!slot.order_shipping_address_province && r.order_shipping_address_province)
      slot.order_shipping_address_province = r.order_shipping_address_province;
  }
  return Array.from(totalsByOrder.values());
}

/**
 * Run all aggregations using order_net_sales as the revenue metric.
 *
 * Channel structure:
 *   - B2B  = headline channel (includes ADCS as a sub-bucket)
 *   - DTC  = secondary
 *   - ADCS = sub-bucket of B2B (counted in B2B totals AND tracked separately)
 *
 * Line-item-level metrics (top SKUs, product family, top states, etc.)
 * use proportional allocation:
 *   line_item_net = order_net_sales × (line_item_revenue / order_subtotal_price)
 */
export function buildDashboardData(rawRows) {
  // Aggregate to order level (sums refund rows so net is accurate)
  const orderTotals = aggregateOrderTotals(rawRows);
  // Drop zero/negative-only orders (test/fully-refunded — Windsor already
  // excludes test orders from order_net_sales, but a zero result is meaningless)
  const orderRows = orderTotals.filter((o) => o.net_sales > 0);
  // Keep raw rows aligned with kept orders (for line-item rollups)
  const keptOrderIds = new Set(orderRows.map((o) => o.order_id));
  const rows = rawRows.filter((r) => keptOrderIds.has(r.order_id) && r.line_item__sku);

  const channelByOrder = new Map();
  const adcsByOrder = new Map();
  for (const o of orderRows) {
    channelByOrder.set(
      o.order_id,
      classifyOrder({ tagsRaw: o.order_tags, discountCodesRaw: o.order_discount_codes })
    );
    adcsByOrder.set(o.order_id, isAdcs(o.order_tags));
  }

  // ---- KPIs (B2B headline; ADCS as sub; DTC as secondary) ----
  const kpis = {
    totalNetSales: 0,
    b2bNetSales: 0,
    b2bExclAdcsNetSales: 0,
    adcsNetSales: 0,
    dtcNetSales: 0,
    totalOrders: orderRows.length,
    b2bOrders: 0,
    b2bExclAdcsOrders: 0,
    adcsOrders: 0,
    dtcOrders: 0,
    totalGrossSales: 0,
    totalDiscounts: 0,
    totalReturns: 0,
  };
  for (const o of orderRows) {
    const ch = channelByOrder.get(o.order_id);
    const isAdcsOrd = adcsByOrder.get(o.order_id);
    kpis.totalNetSales += o.net_sales;
    kpis.totalGrossSales += o.gross_sales;
    kpis.totalDiscounts += o.discounts;
    kpis.totalReturns += o.returns;
    if (ch === "B2B") {
      kpis.b2bNetSales += o.net_sales;
      kpis.b2bOrders += 1;
      if (isAdcsOrd) {
        kpis.adcsNetSales += o.net_sales;
        kpis.adcsOrders += 1;
      } else {
        kpis.b2bExclAdcsNetSales += o.net_sales;
        kpis.b2bExclAdcsOrders += 1;
      }
    } else {
      kpis.dtcNetSales += o.net_sales;
      kpis.dtcOrders += 1;
    }
  }
  kpis.b2bAOV = kpis.b2bOrders ? kpis.b2bNetSales / kpis.b2bOrders : 0;
  kpis.dtcAOV = kpis.dtcOrders ? kpis.dtcNetSales / kpis.dtcOrders : 0;
  kpis.b2bShare = kpis.totalNetSales ? kpis.b2bNetSales / kpis.totalNetSales : 0;
  kpis.dtcShare = kpis.totalNetSales ? kpis.dtcNetSales / kpis.totalNetSales : 0;

  // ---- Monthly revenue / orders / AOV (NET) ----
  const monthly = new Map();
  for (const o of orderRows) {
    const k = monthKey(o.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!monthly.has(k)) monthly.set(k, { B2B_rev: 0, DTC_rev: 0, B2B_ord: 0, DTC_ord: 0 });
    const slot = monthly.get(k);
    slot[`${ch}_rev`] += o.net_sales;
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

  // ---- Cumulative YTD per year ----
  const yearAccum = new Map();
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

  // ---- Pre-compute net-sales allocator per order ----
  // line_item_net = line_revenue × (order_net / order_subtotal)
  // The aggregated order's net_sales already has refunds subtracted, so this
  // ratio properly scales line-item gross down to net.
  const netRatioByOrder = new Map();
  for (const o of orderRows) {
    const sub = o.order_subtotal_price;
    netRatioByOrder.set(o.order_id, sub > 0 ? o.net_sales / sub : 1);
  }

  // ---- Top SKUs (line-item revenue × net allocation) ----
  const skuTotals = new Map();
  for (const r of rows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 1);
    if (!skuTotals.has(sku)) skuTotals.set(sku, { B2B: 0, DTC: 0 });
    skuTotals.get(sku)[ch] += netLine;
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

  // ---- Product family rollup (Gummies / Serum / XVIE / Sachets) ----
  const familyTotals = new Map();
  for (const r of rows) {
    const fam = familyFor(r.line_item__sku);
    if (fam === "Other" || fam === "Exclude") continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 1);
    if (!familyTotals.has(fam)) familyTotals.set(fam, { B2B: 0, DTC: 0 });
    familyTotals.get(fam)[ch] += netLine;
  }
  const productFamily = FAMILY_ORDER
    .filter((fam) => familyTotals.has(fam))
    .map((fam) => {
      const v = familyTotals.get(fam);
      return { family: fam, B2B: Math.round(v.B2B), DTC: Math.round(v.DTC) };
    });

  // ---- New vs returning customers, monthly per channel ----
  const firstSeen = new Map();
  for (const o of orderRows) {
    const email = (o.order_email || "").toLowerCase().trim();
    if (!email) continue;
    const ch = channelByOrder.get(o.order_id);
    const t = new Date(o.order_created_at).getTime();
    if (isNaN(t)) continue;
    const key = `${ch}|${email}`;
    if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
  }
  const newReturnByMonth = new Map();
  for (const o of orderRows) {
    const k = monthKey(o.order_created_at);
    const email = (o.order_email || "").toLowerCase().trim();
    if (!k || !email) continue;
    const ch = channelByOrder.get(o.order_id);
    const t = new Date(o.order_created_at).getTime();
    const first = firstSeen.get(`${ch}|${email}`);
    const isNew = t === first;
    if (!newReturnByMonth.has(k))
      newReturnByMonth.set(k, { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 });
    newReturnByMonth.get(k)[`${ch}_${isNew ? "new" : "ret"}`] += 1;
  }
  const customerDynamics = monthlyKeys.map((k) => ({
    month: k,
    label: monthLabel(k),
    ...(newReturnByMonth.get(k) || { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 }),
  }));

  // ---- Repeat purchase rate ----
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

  // ---- DTC subscription vs one-time, monthly ----
  const subVsOneTime = monthlyKeys.map((k) => {
    let sub = 0;
    let one = 0;
    for (const o of orderRows) {
      if (monthKey(o.order_created_at) !== k) continue;
      if (channelByOrder.get(o.order_id) !== "DTC") continue;
      if (isSubscription(o.order_tags)) sub += o.net_sales;
      else one += o.net_sales;
    }
    return { month: k, label: monthLabel(k), Subscription: Math.round(sub), OneTime: Math.round(one) };
  });

  // ---- Revenue by state (NET), top 15 ----
  const stateTotals = new Map();
  for (const o of orderRows) {
    const state = (o.order_shipping_address_province || "").trim();
    if (!state) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!stateTotals.has(state)) stateTotals.set(state, { B2B: 0, DTC: 0 });
    stateTotals.get(state)[ch] += o.net_sales;
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

  // ---- Discount code usage ----
  const isLikelyPromoCode = (s) => {
    const v = String(s || "").trim();
    if (v.length < 3 || v.length > 30) return false;
    return !/\s/.test(v);
  };
  const codeTotals = new Map();
  for (const o of orderRows) {
    const codes = (o.order_discount_codes || "")
      .split(",")
      .map((c) => c.trim())
      .filter(isLikelyPromoCode);
    if (!codes.length) continue;
    const ch = channelByOrder.get(o.order_id);
    for (const c of codes) {
      const key = c.toUpperCase();
      if (!codeTotals.has(key)) codeTotals.set(key, { B2B: 0, DTC: 0, count: 0 });
      const slot = codeTotals.get(key);
      slot[ch] += o.net_sales;
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

  // ---- 3PL fulfillment split (order count) ----
  const fulfillTotals = new Map();
  for (const o of orderRows) {
    const loc = fulfillmentLocFor(o.order_shipping_address_province);
    const ch = channelByOrder.get(o.order_id);
    if (!fulfillTotals.has(loc)) fulfillTotals.set(loc, { B2B: 0, DTC: 0 });
    fulfillTotals.get(loc)[ch] += 1;
  }
  const fulfillmentSplit = Array.from(fulfillTotals.entries()).map(([location, v]) => ({
    location,
    B2B: v.B2B,
    DTC: v.DTC,
  }));

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
    familyColors: FAMILY_COLORS,
  };
}
