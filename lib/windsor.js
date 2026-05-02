import { findRep, REPS, TERRITORY_ORDER } from "./reps.js";
import { isSubscription, parseOrderTags } from "./classify.js";
import {
  familyFor,
  fulfillmentLocFor,
  CHANNEL_COLORS,
  FAMILY_COLORS,
  FAMILY_ORDER,
  B2B_DISCOUNT_PATTERNS,
} from "./constants.js";

// Windsor only began returning real DTC Shopify data on this date.
// Any order created strictly before this is treated as B2B even when it
// lacks a canonical rep tag (those are old/unrecognized B2B orders, not
// DTC), unless it carries an explicit ADCS tag.
const DTC_DATA_AVAILABLE_FROM = "2026-04-01";

const WINDSOR_BASE = "https://connectors.windsor.ai/shopify";

// SKUs that mark an order as DTC. If ANY line item in an order matches
// one of these SKUs, the entire order is bumped from B2B → DTC bucket
// (matches leadership-dash carve-out logic).
const DTC_SKU_EXCLUSIONS = new Set([
  "X-GN-060CT-001", // 60-count consumer pack
  "X-FRC-30ML-001", // 30ml serum single
]);

/**
 * Fetch line-item-level Shopify orders from Windsor.
 * One row per (order, sku). Refund offset rows have null line items.
 *
 * Accepts EITHER a date_preset OR a custom range:
 *   fetchWindsorRows({ preset: "last_3m" })
 *   fetchWindsorRows({ from: "2025-01-01", to: "2025-12-31" })
 *
 * Pulls the same field set as xtresse-leadershipdash so refund math is
 * identical: net = gross − max(refunds_subtotal, |sum_of_returns|).
 *
 * NO `tags contains 'b2b'` filter (the previous version had this and was
 * wrong — many B2B orders have a rep tag but no literal 'b2b' tag, and
 * the filter was also pulling in DTC orders that happened to contain
 * 'b2b' as a substring).
 */
export async function fetchWindsorRows({ preset, from, to } = {}) {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");
  const account = process.env.WINDSOR_ACCOUNT || "ace1d0-26.myshopify.com";

  const fields = [
    "order_id",
    "order_name",
    "order_created_at",
    "order_total_price_amount", // pre-refund gross incl. tax/ship/discounts (for net calc)
    "order_total_price",        // post-refund snapshot (kept for audit reference only)
    "order_gross_sales",        // pre-discount, pre-refund line-item gross
    "order_total_discounts",    // discount $ on the order
    "order_refunds_subtotal",   // refund signal A
    "order_returns_amount",     // refund signal B (per-row negative on refund offsets)
    "order_financial_status",
    "order_subtotal_price",     // for line-item proportional allocation
    "order_tags",
    "order_discount_codes",
    "order_customer_id",
    "order_email",
    "order_shipping_address_country",
    "order_shipping_address_province",
    "line_item__title",
    "line_item__sku",
    "line_item__quantity",
    "line_item__price",
  ].join(",");

  const params = new URLSearchParams({
    api_key: apiKey,
    accounts: account,
    fields,
    _limit: "50000",
    date_filters: JSON.stringify({ orders: "createdAt" }),
  });

  if (from && to) {
    params.set("date_from", from);
    params.set("date_to", to);
  } else {
    params.set("date_preset", preset || "last_3m");
  }

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Windsor request failed: ${res.status} ${res.statusText}`);
  }
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

const numOrZero = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

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

const dayKey = (d) => {
  const x = new Date(d);
  if (isNaN(x)) return null;
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
};

const dayLabel = (key) => {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Pick chart bucket granularity based on the date window.
 *   ≤ 100 days: "day" — better detail for short audit windows
 *   > 100 days: "month" — keeps long-period charts readable
 */
function pickGranularity({ from, to } = {}) {
  if (!from || !to) return "month";
  const fromMs = new Date(from + "T00:00:00").getTime();
  const toMs = new Date(to + "T00:00:00").getTime();
  if (isNaN(fromMs) || isNaN(toMs)) return "month";
  const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)) + 1;
  return days <= 100 ? "day" : "month";
}

// A "refund offset row" carries no line item info. Negative
// order_total_price, null line_item__sku/title.
function isRefundOffsetRow(r) {
  const hasLineItem =
    (r.line_item__sku && String(r.line_item__sku).trim()) ||
    (r.line_item__title && String(r.line_item__title).trim());
  return !hasLineItem;
}

/**
 * Aggregate raw Windsor rows into per-order records with refund-aware
 * net totals. Mirrors xtresse-leadershipdash math.
 */
function aggregateOrders(rawRows) {
  const byId = new Map();
  for (const r of rawRows) {
    const id = r.order_id;
    if (!id) continue;
    const isRefundRow = isRefundOffsetRow(r);

    if (!byId.has(id)) {
      byId.set(id, {
        order_id: id,
        order_name: r.order_name || null,
        order_created_at: r.order_created_at,
        order_tags: r.order_tags,
        order_discount_codes: r.order_discount_codes,
        order_email: r.order_email,
        order_customer_id: r.order_customer_id,
        order_shipping_address_country: r.order_shipping_address_country,
        order_shipping_address_province: r.order_shipping_address_province,
        order_subtotal_price: numOrZero(r.order_subtotal_price),
        order_financial_status: "",
        grossTotal: 0,
        grossTotalCaptured: false,
        grossSales: 0,            // pre-discount line gross (for reconciliation)
        grossSalesCaptured: false,
        discounts: 0,             // order_total_discounts (captured once)
        discountsCaptured: false,
        refundsSubtotal: 0,
        sumOfReturns: 0,
        skus: new Set(),
        hasDtcSku: false,
      });
    }
    const o = byId.get(id);

    // Capture pre-refund gross from the FIRST sale row (repeats across rows)
    if (!o.grossTotalCaptured && !isRefundRow) {
      const g = parseFloat(r.order_total_price_amount);
      if (Number.isFinite(g) && g > 0) {
        o.grossTotal = g;
        o.grossTotalCaptured = true;
      }
    }
    // Capture pre-discount gross + discounts once (also repeated across rows)
    if (!o.grossSalesCaptured && !isRefundRow) {
      const gs = parseFloat(r.order_gross_sales);
      if (Number.isFinite(gs) && gs > 0) {
        o.grossSales = gs;
        o.grossSalesCaptured = true;
      }
    }
    if (!o.discountsCaptured && !isRefundRow) {
      const d = parseFloat(r.order_total_discounts);
      if (Number.isFinite(d) && d >= 0) {
        o.discounts = d;
        o.discountsCaptured = true;
      }
    }
    // Cumulative refund $ — repeated across rows; take max defensively
    const rs = parseFloat(r.order_refunds_subtotal);
    if (Number.isFinite(rs) && rs > o.refundsSubtotal) o.refundsSubtotal = rs;
    // Sum of return $ — only on refund offset rows (sale rows are 0)
    if (isRefundRow) {
      const ra = parseFloat(r.order_returns_amount);
      if (Number.isFinite(ra) && ra < 0) o.sumOfReturns += ra;
    }
    if (r.order_financial_status) {
      o.order_financial_status = String(r.order_financial_status).toUpperCase();
    }
    // Prefer non-null metadata
    if (!o.order_created_at && r.order_created_at) o.order_created_at = r.order_created_at;
    if (!o.order_tags && r.order_tags) o.order_tags = r.order_tags;
    if (!o.order_email && r.order_email) o.order_email = r.order_email;
    if (!o.order_shipping_address_province && r.order_shipping_address_province)
      o.order_shipping_address_province = r.order_shipping_address_province;
    if (!o.order_subtotal_price && r.order_subtotal_price) {
      const sub = numOrZero(r.order_subtotal_price);
      if (sub > 0) o.order_subtotal_price = sub;
    }
    // SKU tracking for DTC carve-out + line-item rollups
    if (!isRefundRow) {
      const sku = (r.line_item__sku || "").trim();
      if (sku) {
        o.skus.add(sku);
        if (DTC_SKU_EXCLUSIONS.has(sku)) o.hasDtcSku = true;
      }
    }
  }

  // Compute net per order using leadership's refund-aware approach.
  for (const o of byId.values()) {
    const refundDollars = Math.max(o.refundsSubtotal, Math.abs(o.sumOfReturns));
    let net = o.grossTotal - refundDollars;
    if (Math.abs(net) < 0.01) net = 0;
    o.net = net;
    o.refundDollars = refundDollars;
    // If Windsor didn't return order_gross_sales, fall back to grossTotal +
    // discounts so the reconciliation tile still adds up.
    if (!o.grossSales && o.grossTotal) {
      o.grossSales = o.grossTotal + o.discounts;
    }
  }

  return Array.from(byId.values());
}

/**
 * Classify an order into one of three channels.
 *
 * Order of checks:
 *   1. ADCS / advanced derm tag           → ADCS
 *   2. Canonical rep tag, no DTC SKU      → B2B (with rep)
 *   3. Any other B2B signal               → B2B (no rep)
 *        - 'b2b' or 'wholesale' tag
 *        - any tag that looks like a person's name (heuristic — catches
 *          old/unrecognized rep tags where a rep has left or been renamed)
 *        - REP-/XVIE\d+/B2B-/ADCS- discount code
 *   4. Order created before DTC_DATA_AVAILABLE_FROM → B2B (no rep)
 *      (Windsor had no DTC data before that date — anything else here
 *       is an untagged B2B order, not real DTC)
 *   5. Order contains a DTC SKU carve-out → DTC (overrides 2/3)
 *   6. Otherwise                          → DTC
 */
function classifyOrderChannel(order) {
  const tags = parseOrderTags(order.order_tags);
  const lower = tags.map((t) => String(t).toLowerCase());

  // 1. ADCS / advanced derm — matches leadership carve-out exactly.
  if (lower.some((t) => t === "adcs" || t.includes("advanced derm"))) {
    return { channel: "ADCS", rep: null };
  }

  // DTC SKU carve-out applies before any B2B classification — a rep's
  // sale of a DTC-only consumer SKU is treated as DTC, matching leadership.
  if (order.hasDtcSku) {
    return { channel: "DTC", rep: null };
  }

  // 2. Canonical rep tag — preferred B2B signal.
  const rep = findRep(order.order_tags);
  if (rep && rep !== "__EXCLUDE__") {
    return { channel: "B2B", rep };
  }

  // 3. Other B2B signals (catches B2B orders with old/unrecognized rep tags).
  const isB2bByTag = lower.some(
    (t) => t === "b2b" || t === "wholesale" || /\b(rep|territory)\b/.test(t)
  );
  const codes = String(order.order_discount_codes || "")
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter(Boolean);
  const isB2bByCode = codes.some((c) =>
    B2B_DISCOUNT_PATTERNS.some((re) => re.test(c))
  );
  if (isB2bByTag || isB2bByCode) {
    return { channel: "B2B", rep: null };
  }

  // 4. Pre-DTC-data-window orders are B2B by default.
  const dateOnly = (order.order_created_at || "").slice(0, 10);
  if (dateOnly && dateOnly < DTC_DATA_AVAILABLE_FROM) {
    return { channel: "B2B", rep: null };
  }

  // 5/6. True DTC.
  return { channel: "DTC", rep: null };
}

/**
 * Run all aggregations.
 *
 * Channel structure:
 *   - B2B  : rep-tagged, no DTC SKU
 *   - ADCS : adcs/advanced-derm tag (separate bucket, NOT folded into B2B)
 *   - DTC  : everything else
 *
 * The three buckets are mutually exclusive and sum to total net sales.
 *
 * Time-series buckets pick automatically: daily for windows ≤ 100 days,
 * monthly otherwise. Cumulative YTD always stays monthly because it's a
 * year-over-year comparison.
 */
export function buildDashboardData(rawRows, dateRange = {}) {
  const granularity = pickGranularity(dateRange);
  const bucketKey = granularity === "day" ? dayKey : monthKey;
  const bucketLabel = granularity === "day" ? dayLabel : monthLabel;
  const aggregated = aggregateOrders(rawRows);
  // Drop zero-net orders (test orders / fully refunded with no remaining $).
  const orderRows = aggregated.filter((o) => o.net > 0);
  const keptIds = new Set(orderRows.map((o) => o.order_id));
  const lineRows = rawRows.filter(
    (r) => keptIds.has(r.order_id) && r.line_item__sku
  );

  const channelByOrder = new Map();
  const repByOrder = new Map();
  for (const o of orderRows) {
    const { channel, rep } = classifyOrderChannel(o);
    channelByOrder.set(o.order_id, channel);
    if (rep) repByOrder.set(o.order_id, rep);
  }

  // ---- KPIs (3 mutually-exclusive buckets) ----
  const kpis = {
    totalNetSales: 0,
    b2bNetSales: 0,
    adcsNetSales: 0,
    dtcNetSales: 0,
    totalOrders: orderRows.length,
    b2bOrders: 0,
    adcsOrders: 0,
    dtcOrders: 0,
    totalGrossSales: 0,
    totalDiscounts: 0,
    totalReturns: 0,
  };
  for (const o of orderRows) {
    const ch = channelByOrder.get(o.order_id);
    kpis.totalNetSales += o.net;
    kpis.totalGrossSales += o.grossSales || o.grossTotal;
    kpis.totalDiscounts += o.discounts;
    kpis.totalReturns += -Math.abs(o.refundDollars);
    if (ch === "B2B") {
      kpis.b2bNetSales += o.net;
      kpis.b2bOrders += 1;
    } else if (ch === "ADCS") {
      kpis.adcsNetSales += o.net;
      kpis.adcsOrders += 1;
    } else {
      kpis.dtcNetSales += o.net;
      kpis.dtcOrders += 1;
    }
  }
  kpis.b2bAOV = kpis.b2bOrders ? kpis.b2bNetSales / kpis.b2bOrders : 0;
  kpis.adcsAOV = kpis.adcsOrders ? kpis.adcsNetSales / kpis.adcsOrders : 0;
  kpis.dtcAOV = kpis.dtcOrders ? kpis.dtcNetSales / kpis.dtcOrders : 0;
  kpis.b2bShare = kpis.totalNetSales ? kpis.b2bNetSales / kpis.totalNetSales : 0;
  kpis.adcsShare = kpis.totalNetSales ? kpis.adcsNetSales / kpis.totalNetSales : 0;
  kpis.dtcShare = kpis.totalNetSales ? kpis.dtcNetSales / kpis.totalNetSales : 0;

  // ---- Net sales / orders / AOV by bucket (day or month per granularity) ----
  const bucketed = new Map();
  for (const o of orderRows) {
    const k = bucketKey(o.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!bucketed.has(k))
      bucketed.set(k, {
        B2B_rev: 0, ADCS_rev: 0, DTC_rev: 0,
        B2B_ord: 0, ADCS_ord: 0, DTC_ord: 0,
      });
    const slot = bucketed.get(k);
    slot[`${ch}_rev`] += o.net;
    slot[`${ch}_ord`] += 1;
  }
  const bucketKeys = Array.from(bucketed.keys()).sort();
  const monthlySeries = bucketKeys.map((k) => {
    const s = bucketed.get(k);
    return {
      month: k,
      label: bucketLabel(k),
      B2B: Math.round(s.B2B_rev),
      ADCS: Math.round(s.ADCS_rev),
      DTC: Math.round(s.DTC_rev),
      Total: Math.round(s.B2B_rev + s.ADCS_rev + s.DTC_rev),
      B2B_orders: s.B2B_ord,
      ADCS_orders: s.ADCS_ord,
      DTC_orders: s.DTC_ord,
      B2B_AOV: s.B2B_ord ? Math.round(s.B2B_rev / s.B2B_ord) : 0,
      DTC_AOV: s.DTC_ord ? Math.round(s.DTC_rev / s.DTC_ord) : 0,
    };
  });

  // ---- Cumulative YTD — always month-based (year-over-year view) ----
  const monthlyForYtd = new Map();
  for (const o of orderRows) {
    const k = monthKey(o.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!monthlyForYtd.has(k))
      monthlyForYtd.set(k, { B2B_rev: 0, ADCS_rev: 0, DTC_rev: 0 });
    monthlyForYtd.get(k)[`${ch}_rev`] += o.net;
  }
  const yearAccum = new Map();
  for (const k of Array.from(monthlyForYtd.keys()).sort()) {
    const [y, m] = k.split("-");
    const slot = monthlyForYtd.get(k);
    if (!yearAccum.has(y)) yearAccum.set(y, []);
    const arr = yearAccum.get(y);
    const prev = arr[arr.length - 1] || { B2B: 0, ADCS: 0, DTC: 0, Total: 0 };
    arr.push({
      month: Number(m),
      label: monthLabel(k),
      B2B: prev.B2B + Math.round(slot.B2B_rev),
      ADCS: prev.ADCS + Math.round(slot.ADCS_rev),
      DTC: prev.DTC + Math.round(slot.DTC_rev),
      Total: prev.Total + Math.round(slot.B2B_rev + slot.ADCS_rev + slot.DTC_rev),
    });
  }
  const cumulativeYTD = Array.from(yearAccum.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, points]) => ({ year, points }));

  // ---- Net-sales allocator per order ----
  const netRatioByOrder = new Map();
  for (const o of orderRows) {
    const sub = o.order_subtotal_price;
    netRatioByOrder.set(o.order_id, sub > 0 ? o.net / sub : 1);
  }

  // ---- Top SKUs ----
  const skuTotals = new Map();
  for (const r of lineRows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 1);
    if (!skuTotals.has(sku)) skuTotals.set(sku, { B2B: 0, ADCS: 0, DTC: 0 });
    skuTotals.get(sku)[ch] += netLine;
  }
  const topSKUs = Array.from(skuTotals.entries())
    .map(([sku, v]) => ({
      sku,
      B2B: Math.round(v.B2B),
      ADCS: Math.round(v.ADCS),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC),
    }))
    .sort((a, b) => b.Total - a.Total)
    .slice(0, 10);

  // ---- Product family rollup ----
  const familyTotals = new Map();
  for (const r of lineRows) {
    const fam = familyFor(r.line_item__sku);
    if (fam === "Other" || fam === "Exclude") continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 1);
    if (!familyTotals.has(fam)) familyTotals.set(fam, { B2B: 0, ADCS: 0, DTC: 0 });
    familyTotals.get(fam)[ch] += netLine;
  }
  const productFamily = FAMILY_ORDER
    .filter((fam) => familyTotals.has(fam))
    .map((fam) => {
      const v = familyTotals.get(fam);
      return {
        family: fam,
        B2B: Math.round(v.B2B),
        ADCS: Math.round(v.ADCS),
        DTC: Math.round(v.DTC),
      };
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
  const newReturnByBucket = new Map();
  for (const o of orderRows) {
    const k = bucketKey(o.order_created_at);
    const email = (o.order_email || "").toLowerCase().trim();
    if (!k || !email) continue;
    const ch = channelByOrder.get(o.order_id);
    const t = new Date(o.order_created_at).getTime();
    const first = firstSeen.get(`${ch}|${email}`);
    const isNew = t === first;
    if (!newReturnByBucket.has(k))
      newReturnByBucket.set(k, { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 });
    const slot = newReturnByBucket.get(k);
    if (ch === "B2B" || ch === "DTC") {
      slot[`${ch}_${isNew ? "new" : "ret"}`] += 1;
    }
  }
  const customerDynamics = bucketKeys.map((k) => ({
    month: k,
    label: bucketLabel(k),
    ...(newReturnByBucket.get(k) || { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 }),
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

  // ---- DTC subscription vs one-time ----
  const subVsOneTime = bucketKeys.map((k) => {
    let sub = 0;
    let one = 0;
    for (const o of orderRows) {
      if (bucketKey(o.order_created_at) !== k) continue;
      if (channelByOrder.get(o.order_id) !== "DTC") continue;
      if (isSubscription(o.order_tags)) sub += o.net;
      else one += o.net;
    }
    return { month: k, label: bucketLabel(k), Subscription: Math.round(sub), OneTime: Math.round(one) };
  });

  // ---- Revenue by state (NET), top 15 ----
  const stateTotals = new Map();
  for (const o of orderRows) {
    const state = (o.order_shipping_address_province || "").trim();
    if (!state) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!stateTotals.has(state)) stateTotals.set(state, { B2B: 0, ADCS: 0, DTC: 0 });
    stateTotals.get(state)[ch] += o.net;
  }
  const revenueByState = Array.from(stateTotals.entries())
    .map(([state, v]) => ({
      state,
      B2B: Math.round(v.B2B),
      ADCS: Math.round(v.ADCS),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC),
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
      if (!codeTotals.has(key)) codeTotals.set(key, { B2B: 0, ADCS: 0, DTC: 0, count: 0 });
      const slot = codeTotals.get(key);
      slot[ch] += o.net;
      slot.count += 1;
    }
  }
  const discountUsage = Array.from(codeTotals.entries())
    .map(([code, v]) => ({
      code,
      B2B: Math.round(v.B2B),
      ADCS: Math.round(v.ADCS),
      DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC),
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // ---- 3PL fulfillment split ----
  const fulfillTotals = new Map();
  for (const o of orderRows) {
    const loc = fulfillmentLocFor(o.order_shipping_address_province);
    const ch = channelByOrder.get(o.order_id);
    if (!fulfillTotals.has(loc)) fulfillTotals.set(loc, { B2B: 0, ADCS: 0, DTC: 0 });
    fulfillTotals.get(loc)[ch] += 1;
  }
  const fulfillmentSplit = Array.from(fulfillTotals.entries()).map(([location, v]) => ({
    location,
    B2B: v.B2B,
    ADCS: v.ADCS,
    DTC: v.DTC,
  }));

  // ============================================================
  // Rep performance — per-rep aggregations using leadership's REPS list
  // ============================================================
  const repAgg = {};
  for (const rep of Object.keys(REPS)) {
    repAgg[rep] = {
      rep,
      territory: REPS[rep][0],
      region: REPS[rep][1],
      net: 0,
      orders: 0,
      newAccounts: 0,
      lastOrderAt: null,
    };
  }
  // Track first-order date per (rep, customer) so we can count new accounts.
  // "New account" for a rep = first ever order from this customer with this
  // rep tag, occurring within the loaded window.
  const firstByRepCust = new Map();
  for (const o of orderRows) {
    const rep = repByOrder.get(o.order_id);
    if (!rep) continue;
    const cust = String(o.order_customer_id || (o.order_email || "").toLowerCase() || "");
    if (!cust || cust === "null") continue;
    const t = new Date(o.order_created_at).getTime();
    if (isNaN(t)) continue;
    const key = `${rep}|${cust}`;
    if (!firstByRepCust.has(key) || t < firstByRepCust.get(key)) {
      firstByRepCust.set(key, t);
    }
  }
  for (const o of orderRows) {
    const rep = repByOrder.get(o.order_id);
    if (!rep || !repAgg[rep]) continue;
    const a = repAgg[rep];
    a.net += o.net;
    a.orders += 1;
    const cust = String(o.order_customer_id || (o.order_email || "").toLowerCase() || "");
    const t = new Date(o.order_created_at).getTime();
    if (cust && !isNaN(t)) {
      const first = firstByRepCust.get(`${rep}|${cust}`);
      if (t === first) a.newAccounts += 1;
    }
    if (o.order_created_at) {
      if (!a.lastOrderAt || o.order_created_at > a.lastOrderAt) {
        a.lastOrderAt = o.order_created_at;
      }
    }
  }
  // Group reps into territories, sort by net within each territory.
  const repPerformance = TERRITORY_ORDER.map((t) => ({
    territory: t,
    rows: Object.values(repAgg)
      .filter((r) => r.territory === t)
      .sort((a, b) => b.net - a.net)
      .map((r, i) => ({
        ...r,
        net: Math.round(r.net),
        rank: i + 1,
      })),
  }));

  // Per-rep time series for charts (sales + new accounts).
  // Buckets follow the same granularity as the rest of the dashboard.
  const repBucketedSales = new Map();
  const repBucketedNew = new Map();
  for (const o of orderRows) {
    const rep = repByOrder.get(o.order_id);
    if (!rep || !REPS[rep]) continue;
    const k = bucketKey(o.order_created_at);
    if (!k) continue;
    if (!repBucketedSales.has(k)) repBucketedSales.set(k, {});
    if (!repBucketedNew.has(k)) repBucketedNew.set(k, {});
    repBucketedSales.get(k)[rep] = (repBucketedSales.get(k)[rep] || 0) + o.net;
    const cust = String(o.order_customer_id || (o.order_email || "").toLowerCase() || "");
    const t = new Date(o.order_created_at).getTime();
    if (cust && !isNaN(t)) {
      const first = firstByRepCust.get(`${rep}|${cust}`);
      if (t === first) {
        repBucketedNew.get(k)[rep] = (repBucketedNew.get(k)[rep] || 0) + 1;
      }
    }
  }
  const repSalesMonthly = bucketKeys.map((k) => {
    const slot = repBucketedSales.get(k) || {};
    const out = { month: k, label: bucketLabel(k) };
    for (const rep of Object.keys(REPS)) out[rep] = Math.round(slot[rep] || 0);
    return out;
  });
  const repNewAccountsMonthly = bucketKeys.map((k) => {
    const slot = repBucketedNew.get(k) || {};
    const out = { month: k, label: bucketLabel(k) };
    for (const rep of Object.keys(REPS)) out[rep] = slot[rep] || 0;
    return out;
  });

  // ---- Orders audit list (newest first) ----
  const orders = orderRows
    .map((o) => {
      const ch = channelByOrder.get(o.order_id);
      const codes = (o.order_discount_codes || "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      return {
        id: String(o.order_id),
        name: o.order_name || null,
        date: o.order_created_at || null,
        channel: ch,
        adcs: ch === "ADCS",
        sub: ch === "DTC" ? isSubscription(o.order_tags) : false,
        rep: repByOrder.get(o.order_id) || null,
        email: o.order_email || null,
        state: o.order_shipping_address_province || null,
        country: o.order_shipping_address_country || null,
        codes,
        // gross is pre-discount; net is post-discount AND post-refund.
        gross: Math.round(o.grossSales || o.grossTotal + o.discounts),
        discounts: Math.round(o.discounts),
        returns: -Math.round(o.refundDollars),
        net: Math.round(o.net),
      };
    })
    .sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });

  return {
    generatedAt: new Date().toISOString(),
    rowCount: lineRows.length,
    orderCount: orderRows.length,
    granularity, // "day" | "month" — useful for chart subtitle copy
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
    orders,
    repPerformance,
    repSalesMonthly,
    repNewAccountsMonthly,
    repsList: Object.keys(REPS),
    channelColors: CHANNEL_COLORS,
    familyColors: FAMILY_COLORS,
  };
}
