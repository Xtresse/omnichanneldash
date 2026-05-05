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
const DTC_DATA_AVAILABLE_FROM = "2026-04-01";
const ALL_TIME_FROM = "2022-01-01";
const WINDSOR_BASE = "https://connectors.windsor.ai/shopify";

const DTC_SKU_EXCLUSIONS = new Set([
  "X-GN-060CT-001",
  "X-FRC-30ML-001",
]);

export async function fetchWindsorRows({ preset, from, to } = {}) {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");
  const account = process.env.WINDSOR_ACCOUNT || "ace1d0-26.myshopify.com";

  const fields = [
    "order_id", "order_name", "order_created_at",
    "order_total_price_amount", "order_total_price",
    "order_gross_sales", "order_total_discounts",
    "order_refunds_subtotal", "order_returns_amount",
    "order_financial_status", "order_subtotal_price",
    "order_tags", "order_discount_codes",
    "order_customer_id", "order_email",
    "order_shipping_address_country", "order_shipping_address_province",
    "line_item__title", "line_item__sku",
    "line_item__quantity", "line_item__price",
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

export async function fetchWindsorAllTimeLight() {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");
  const account = process.env.WINDSOR_ACCOUNT || "ace1d0-26.myshopify.com";
  const today = new Date().toISOString().slice(0, 10);

  const fields = [
    "order_id", "order_created_at", "order_customer_id",
    "order_email", "order_tags", "line_item__title", "line_item__sku",
  ].join(",");

  const params = new URLSearchParams({
    api_key: apiKey,
    accounts: account,
    fields,
    _limit: "50000",
    date_filters: JSON.stringify({ orders: "createdAt" }),
    date_from: ALL_TIME_FROM,
    date_to: today,
  });

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`Windsor all-time request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

const numOrZero = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

// Per-product-family slot used in the rep table — each cell tracks
// units and dollars split by new-vs-existing customer for that product.
const emptySlot = () => ({
  newUnits: 0,
  newDollars: 0,
  existingUnits: 0,
  existingDollars: 0,
});

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

const DAY_MS = 86400000;

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

const mondayOf = (d) => {
  const x = new Date(d);
  if (isNaN(x)) return null;
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - dow));
};

const weekKey = (d) => {
  const m = mondayOf(d);
  if (!m) return null;
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}-${String(m.getUTCDate()).padStart(2, "0")}`;
};

const formatRangeLabel = (start, end) => {
  const sM = start.getUTCMonth();
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (sM === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${startStr}–${end.getUTCDate()}`;
  }
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${startStr}–${endStr}`;
};

const weekLabel = (key) => {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  const start = new Date(Date.UTC(+y, +m - 1, +d));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return formatRangeLabel(start, end);
};

const biweekKey = (d) => {
  const m = mondayOf(d);
  if (!m) return null;
  const anchor = Date.UTC(1970, 0, 5);
  const weekIdx = Math.floor((m.getTime() - anchor) / (7 * DAY_MS));
  const startMs = m.getTime() - (weekIdx % 2) * 7 * DAY_MS;
  const start = new Date(startMs);
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
};

const biweekLabel = (key) => {
  if (!key) return "";
  const [y, m, d] = key.split("-");
  const start = new Date(Date.UTC(+y, +m - 1, +d));
  const end = new Date(start.getTime() + 13 * DAY_MS);
  return formatRangeLabel(start, end);
};

const ALLOWED_GRANULARITY = new Set(["auto", "day", "week", "biweek", "month"]);

function pickGranularity({ from, to, granularity } = {}) {
  if (granularity && granularity !== "auto" && ALLOWED_GRANULARITY.has(granularity)) {
    return granularity;
  }
  if (!from || !to) return "month";
  const fromMs = new Date(from + "T00:00:00").getTime();
  const toMs = new Date(to + "T00:00:00").getTime();
  if (isNaN(fromMs) || isNaN(toMs)) return "month";
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days <= 14) return "day";
  if (days <= 70) return "week";
  return "month";
}

const BUCKET_HELPERS = {
  day: { key: dayKey, label: dayLabel },
  week: { key: weekKey, label: weekLabel },
  biweek: { key: biweekKey, label: biweekLabel },
  month: { key: monthKey, label: monthLabel },
};

function isRefundOffsetRow(r) {
  const hasLineItem =
    (r.line_item__sku && String(r.line_item__sku).trim()) ||
    (r.line_item__title && String(r.line_item__title).trim());
  return !hasLineItem;
}

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
        grossSales: 0,
        grossSalesCaptured: false,
        discounts: 0,
        discountsCaptured: false,
        refundsSubtotal: 0,
        sumOfReturns: 0,
        skus: new Set(),
        hasDtcSku: false,
        hasGummySku: false,
        gummyLineGross: 0,
      });
    }
    const o = byId.get(id);

    if (!o.grossTotalCaptured && !isRefundRow) {
      const g = parseFloat(r.order_total_price_amount);
      if (Number.isFinite(g) && g > 0) {
        o.grossTotal = g;
        o.grossTotalCaptured = true;
      }
    }
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
    const rs = parseFloat(r.order_refunds_subtotal);
    if (Number.isFinite(rs) && rs > o.refundsSubtotal) o.refundsSubtotal = rs;
    if (isRefundRow) {
      const ra = parseFloat(r.order_returns_amount);
      if (Number.isFinite(ra) && ra < 0) o.sumOfReturns += ra;
    }
    if (r.order_financial_status) {
      o.order_financial_status = String(r.order_financial_status).toUpperCase();
    }
    if (!o.order_created_at && r.order_created_at) o.order_created_at = r.order_created_at;
    if (!o.order_tags && r.order_tags) o.order_tags = r.order_tags;
    if (!o.order_email && r.order_email) o.order_email = r.order_email;
    if (!o.order_shipping_address_province && r.order_shipping_address_province)
      o.order_shipping_address_province = r.order_shipping_address_province;
    if (!o.order_subtotal_price && r.order_subtotal_price) {
      const sub = numOrZero(r.order_subtotal_price);
      if (sub > 0) o.order_subtotal_price = sub;
    }
    if (!isRefundRow) {
      const sku = (r.line_item__sku || "").trim();
      if (sku) {
        o.skus.add(sku);
        if (DTC_SKU_EXCLUSIONS.has(sku)) o.hasDtcSku = true;
        if (familyFor(sku) === "Gummies") {
          o.hasGummySku = true;
          const lineGross =
            numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
          if (lineGross > 0) o.gummyLineGross += lineGross;
        }
      }
    }
  }

  for (const o of byId.values()) {
    const refundDollars = Math.max(o.refundsSubtotal, Math.abs(o.sumOfReturns));
    let net = o.grossTotal - refundDollars;
    if (Math.abs(net) < 0.01) net = 0;
    o.net = net;
    o.refundDollars = refundDollars;
    if (!o.grossSales && o.grossTotal) {
      o.grossSales = o.grossTotal + o.discounts;
    }
  }

  return Array.from(byId.values());
}

function classifyOrderChannel(order) {
  const tags = parseOrderTags(order.order_tags);
  const lower = tags.map((t) => String(t).toLowerCase());

  if (lower.some((t) => t === "adcs" || t.includes("advanced derm"))) {
    return { channel: "ADCS", rep: null };
  }
  if (order.hasDtcSku) {
    return { channel: "DTC", rep: null };
  }
  const rep = findRep(order.order_tags);
  if (rep && rep !== "__EXCLUDE__") {
    return { channel: "B2B", rep };
  }
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
  const dateOnly = (order.order_created_at || "").slice(0, 10);
  if (dateOnly && dateOnly < DTC_DATA_AVAILABLE_FROM) {
    return { channel: "B2B", rep: null };
  }
  return { channel: "DTC", rep: null };
}

export function buildDashboardData(rawRows, dateRange = {}, allTimeRows = []) {
  const granularity = pickGranularity(dateRange);
  const helpers = BUCKET_HELPERS[granularity] || BUCKET_HELPERS.month;
  const bucketKey = helpers.key;
  const bucketLabel = helpers.label;

  // Customer-level first-ever purchase dates per product family.
  // Used to flag a customer as "new" for that product when their
  // first-ever date falls inside the loaded window. Tracks Serum,
  // XVIE, and Sachets (for Gummies we use the Shopify First-Order tag
  // instead — see the rep-loop below).
  const firstProductDate = new Map(); // key: `${cust}|${family}` → "YYYY-MM-DD"
  for (const r of allTimeRows) {
    const cust = String(
      r.order_customer_id || (r.order_email || "").toLowerCase() || ""
    );
    if (!cust || cust === "null") continue;
    const date = (r.order_created_at || "").slice(0, 10);
    if (!date) continue;
    const fam = familyFor(r.line_item__sku);
    if (fam !== "Serum" && fam !== "XVIE" && fam !== "Sachets") continue;
    const key = `${cust}|${fam}`;
    const prev = firstProductDate.get(key);
    if (!prev || date < prev) firstProductDate.set(key, date);
  }
  const aggregated = aggregateOrders(rawRows);
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

  const kpis = {
    totalNetSales: 0, b2bNetSales: 0, adcsNetSales: 0, dtcNetSales: 0,
    totalOrders: orderRows.length,
    b2bOrders: 0, adcsOrders: 0, dtcOrders: 0,
    totalGrossSales: 0, totalDiscounts: 0, totalReturns: 0,
  };
  for (const o of orderRows) {
    const ch = channelByOrder.get(o.order_id);
    kpis.totalNetSales += o.net;
    kpis.totalGrossSales += (o.grossTotal || 0) + (o.discounts || 0);
    kpis.totalDiscounts += o.discounts;
    kpis.totalReturns += -Math.abs(o.refundDollars);
    if (ch === "B2B") { kpis.b2bNetSales += o.net; kpis.b2bOrders += 1; }
    else if (ch === "ADCS") { kpis.adcsNetSales += o.net; kpis.adcsOrders += 1; }
    else { kpis.dtcNetSales += o.net; kpis.dtcOrders += 1; }
  }
  kpis.b2bAOV = kpis.b2bOrders ? kpis.b2bNetSales / kpis.b2bOrders : 0;
  kpis.adcsAOV = kpis.adcsOrders ? kpis.adcsNetSales / kpis.adcsOrders : 0;
  kpis.dtcAOV = kpis.dtcOrders ? kpis.dtcNetSales / kpis.dtcOrders : 0;
  kpis.b2bShare = kpis.totalNetSales ? kpis.b2bNetSales / kpis.totalNetSales : 0;
  kpis.adcsShare = kpis.totalNetSales ? kpis.adcsNetSales / kpis.totalNetSales : 0;
  kpis.dtcShare = kpis.totalNetSales ? kpis.dtcNetSales / kpis.totalNetSales : 0;

  const bucketed = new Map();
  for (const o of orderRows) {
    const k = bucketKey(o.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!bucketed.has(k))
      bucketed.set(k, { B2B_rev: 0, ADCS_rev: 0, DTC_rev: 0, B2B_ord: 0, ADCS_ord: 0, DTC_ord: 0 });
    const slot = bucketed.get(k);
    slot[`${ch}_rev`] += o.net;
    slot[`${ch}_ord`] += 1;
  }
  const bucketKeys = Array.from(bucketed.keys()).sort();
  const monthlySeries = bucketKeys.map((k) => {
    const s = bucketed.get(k);
    return {
      month: k, label: bucketLabel(k),
      B2B: Math.round(s.B2B_rev), ADCS: Math.round(s.ADCS_rev), DTC: Math.round(s.DTC_rev),
      Total: Math.round(s.B2B_rev + s.ADCS_rev + s.DTC_rev),
      B2B_orders: s.B2B_ord, ADCS_orders: s.ADCS_ord, DTC_orders: s.DTC_ord,
      B2B_AOV: s.B2B_ord ? Math.round(s.B2B_rev / s.B2B_ord) : 0,
      DTC_AOV: s.DTC_ord ? Math.round(s.DTC_rev / s.DTC_ord) : 0,
    };
  });

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
      month: Number(m), label: monthLabel(k),
      B2B: prev.B2B + Math.round(slot.B2B_rev),
      ADCS: prev.ADCS + Math.round(slot.ADCS_rev),
      DTC: prev.DTC + Math.round(slot.DTC_rev),
      Total: prev.Total + Math.round(slot.B2B_rev + slot.ADCS_rev + slot.DTC_rev),
    });
  }
  const cumulativeYTD = Array.from(yearAccum.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, points]) => ({ year, points }));

  const lineGrossByOrder = new Map();
  for (const r of lineRows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const lg = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    lineGrossByOrder.set(r.order_id, (lineGrossByOrder.get(r.order_id) || 0) + lg);
  }
  const netRatioByOrder = new Map();
  for (const o of orderRows) {
    const lg = lineGrossByOrder.get(o.order_id) || 0;
    netRatioByOrder.set(o.order_id, lg > 0 ? o.net / lg : 0);
  }

  // ---- Per-order family $ allocation ----
  // Computed once and reused by the rep table (per-rep family columns).
  // Each value is the order's net dollars allocated proportionally to a
  // line-item family. The sum across families == o.net minus the "Other"
  // share, matching the product family chart's coverage.
  const familyByOrder = new Map();
  for (const r of lineRows) {
    const fam = familyFor(r.line_item__sku);
    if (fam === "Exclude") continue;
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const ratio = netRatioByOrder.get(r.order_id) || 0;
    const netLine = lineGross * ratio;
    if (!familyByOrder.has(r.order_id)) {
      familyByOrder.set(r.order_id, { Gummies: 0, XVIE: 0, Serum: 0, Sachets: 0, Other: 0 });
    }
    familyByOrder.get(r.order_id)[fam] += netLine;
  }

  // ---- Top SKUs ----
  const skuTotals = new Map();
  for (const r of lineRows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 0);
    if (!skuTotals.has(sku)) skuTotals.set(sku, { B2B: 0, ADCS: 0, DTC: 0 });
    skuTotals.get(sku)[ch] += netLine;
  }
  const topSKUs = Array.from(skuTotals.entries())
    .map(([sku, v]) => ({
      sku, B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC),
    }))
    .sort((a, b) => b.Total - a.Total)
    .slice(0, 10);

  const familyTotals = new Map();
  for (const r of lineRows) {
    const fam = familyFor(r.line_item__sku);
    if (fam === "Other" || fam === "Exclude") continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    const netLine = lineGross * (netRatioByOrder.get(r.order_id) || 0);
    if (!familyTotals.has(fam)) familyTotals.set(fam, { B2B: 0, ADCS: 0, DTC: 0 });
    familyTotals.get(fam)[ch] += netLine;
  }
  const productFamily = FAMILY_ORDER
    .filter((fam) => familyTotals.has(fam))
    .map((fam) => {
      const v = familyTotals.get(fam);
      return { family: fam, B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC) };
    });

  const includeForCohort = (o) => {
    const ch = channelByOrder.get(o.order_id);
    if (ch === "DTC") return true;
    if (ch === "B2B" && o.gummyLineGross > 0) return true;
    return false;
  };
  const firstSeen = new Map();
  for (const o of orderRows) {
    if (!includeForCohort(o)) continue;
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
    if (!includeForCohort(o)) continue;
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
    slot[`${ch}_${isNew ? "new" : "ret"}`] += 1;
  }
  const customerDynamics = bucketKeys.map((k) => ({
    month: k, label: bucketLabel(k),
    ...(newReturnByBucket.get(k) || { B2B_new: 0, B2B_ret: 0, DTC_new: 0, DTC_ret: 0 }),
  }));

  const repeatRate = customerDynamics.map((row) => {
    const b2bTotal = row.B2B_new + row.B2B_ret;
    const dtcTotal = row.DTC_new + row.DTC_ret;
    return {
      month: row.month, label: row.label,
      B2B: b2bTotal ? Math.round((row.B2B_ret / b2bTotal) * 1000) / 10 : 0,
      DTC: dtcTotal ? Math.round((row.DTC_ret / dtcTotal) * 1000) / 10 : 0,
    };
  });

  const subVsOneTime = bucketKeys.map((k) => {
    let sub = 0, one = 0;
    for (const o of orderRows) {
      if (bucketKey(o.order_created_at) !== k) continue;
      if (channelByOrder.get(o.order_id) !== "DTC") continue;
      if (isSubscription(o.order_tags)) sub += o.net;
      else one += o.net;
    }
    return { month: k, label: bucketLabel(k), Subscription: Math.round(sub), OneTime: Math.round(one) };
  });

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
      state, B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC),
    }))
    .sort((a, b) => b.Total - a.Total)
    .slice(0, 15);

  const isLikelyPromoCode = (s) => {
    const v = String(s || "").trim();
    if (v.length < 3 || v.length > 30) return false;
    return !/\s/.test(v);
  };
  const codeTotals = new Map();
  for (const o of orderRows) {
    const codes = (o.order_discount_codes || "")
      .split(",").map((c) => c.trim()).filter(isLikelyPromoCode);
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
      code, B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC), count: v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const fulfillTotals = new Map();
  for (const o of orderRows) {
    const loc = fulfillmentLocFor(o.order_shipping_address_province);
    const ch = channelByOrder.get(o.order_id);
    if (!fulfillTotals.has(loc)) fulfillTotals.set(loc, { B2B: 0, ADCS: 0, DTC: 0 });
    fulfillTotals.get(loc)[ch] += 1;
  }
  const fulfillmentSplit = Array.from(fulfillTotals.entries()).map(([location, v]) => ({
    location, B2B: v.B2B, ADCS: v.ADCS, DTC: v.DTC,
  }));

  const repAgg = {};
  const blankFamily = () => ({ Gummies: emptySlot(), Serum: emptySlot(), XVIE: emptySlot(), Sachets: emptySlot() });
  for (const rep of Object.keys(REPS)) {
    repAgg[rep] = {
      rep,
      territory: REPS[rep][0],
      region: REPS[rep][1],
      net: 0,
      orders: 0,
      // Tag-based first-order gummy count — Shopify Flow tags brand-new
      // B2B locations with `b2b` + `first order` at creation. Kept for
      // the reconciliation panel only; the rep table's product columns
      // surface the same signal at a more granular level.
      firstOrderGummy: 0,
      // Per-product breakdown: new vs existing customer × units & dollars.
      // "New" rules:
      //   - Gummies: order has Shopify Flow's `b2b` + `first order` tags
      //   - Serum / XVIE / Sachets: customer's first-ever date for that
      //     product (across all time) falls inside the loaded window
      productMix: blankFamily(),
      // Filled in after the loop — points at firstOrderGummy so legacy
      // UI fields keep working.
      newAccounts: 0,
      newXvieAccts: 0,
      newSerumAccts: 0,
      // Chronological sanity check (used only by the reconciliation panel).
      chronologicalNewAccounts: 0,
      lastOrderAt: null,
    };
  }
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
  let firstOrderGummyTotal = 0;
  // Tolerant first-order tag check: case-insensitive, whitespace-collapsed.
  const isFirstOrderTag = (t) =>
    t.replace(/\s+/g, " ").trim().toLowerCase() === "first order";

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
      if (t === first) a.chronologicalNewAccounts += 1;
    }

    // Tag-based first-order gummy check.
    //
    // Was previously: BOTH `b2b` AND `first order` tags required (matched
    // leadership). This silently dropped new-account orders where the
    // Shopify Flow automation didn't fire to add `b2b` — for example,
    // manually-keyed orders, draft-converted orders, or orders pre-Flow
    // wiring where the rep added `first order` by hand.
    //
    // Relaxed: every order in this loop already has a rep tag (verified
    // by findRep upstream), which means the order IS B2B. So `first order`
    // alone is enough — the rep's manual tag is a deliberate signal we
    // should honor. Reported by Amy Pierre on Order #5389/#5392 (May 2026).
    const tags = parseOrderTags(o.order_tags);
    const hasFirstOrderTag = tags.some(isFirstOrderTag);
    const isFirstOrderTagged = hasFirstOrderTag;
    if (isFirstOrderTagged && o.gummyLineGross > 0) {
      a.firstOrderGummy += 1;
      firstOrderGummyTotal += 1;
    }

    if (o.order_created_at) {
      if (!a.lastOrderAt || o.order_created_at > a.lastOrderAt) {
        a.lastOrderAt = o.order_created_at;
      }
    }
  }
  for (const r of Object.values(repAgg)) {
    r.newAccounts = r.firstOrderGummy;
  }

  // ---- Per-rep × per-product × new/existing units + dollars ----
  // For each line item we classify the customer as "new" or "existing"
  // for that product family and add units + allocated $ to the rep's
  // productMix slot. Rules:
  //   - Gummies: order has Shopify Flow's `b2b` + `first order` tags
  //   - Serum / XVIE / Sachets: customer's first-ever date for that
  //     product (from the all-time history pull) is inside the window
  //
  // Customers contributing "new" units are ALSO counted as unique
  // customer sets (newXvieCusts / newSerumCusts) so the legacy
  // newXvieAccts / newSerumAccts fields stay accurate for the
  // reconciliation panel.
  const orderRowsById = new Map();
  for (const o of orderRows) orderRowsById.set(o.order_id, o);

  // Pre-compute per-order: is this order tagged 'first order'?
  // Relaxed from b2b+first-order to just first-order — see the comment
  // in the gummy-count block above for context.
  const isFirstOrderTaggedById = new Map();
  for (const o of orderRows) {
    const tags = parseOrderTags(o.order_tags);
    const hasFirstOrderTag = tags.some(isFirstOrderTag);
    isFirstOrderTaggedById.set(o.order_id, hasFirstOrderTag);
  }

  // Resolve the loaded window. dateRange may carry { from, to } or a
  // preset (in which case we infer from the actual order dates).
  let windowFrom = dateRange.from;
  let windowTo = dateRange.to;
  if (!windowFrom || !windowTo) {
    let minDate = "9999-12-31";
    let maxDate = "0000-01-01";
    for (const o of orderRows) {
      const d = (o.order_created_at || "").slice(0, 10);
      if (!d) continue;
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
    windowFrom = windowFrom || minDate;
    windowTo = windowTo || maxDate;
  }

  const newCustsByRep = {}; // rep → family → Set of customer ids
  for (const rep of Object.keys(REPS)) {
    newCustsByRep[rep] = { Gummies: new Set(), Serum: new Set(), XVIE: new Set(), Sachets: new Set() };
  }

  for (const r of lineRows) {
    const fam = familyFor(r.line_item__sku);
    if (fam !== "Gummies" && fam !== "Serum" && fam !== "XVIE" && fam !== "Sachets") continue;
    const o = orderRowsById.get(r.order_id);
    if (!o) continue;
    const rep = repByOrder.get(r.order_id);
    if (!rep || !repAgg[rep]) continue;

    const units = numOrZero(r.line_item__quantity);
    if (units <= 0) continue;
    const lineGross = numOrZero(r.line_item__price) * units;
    const ratio = netRatioByOrder.get(r.order_id) || 0;
    const netLine = lineGross * ratio;

    const cust = String(
      o.order_customer_id || (o.order_email || "").toLowerCase() || ""
    );

    let isNew = false;
    if (fam === "Gummies") {
      // Tag-based — every gummy line item in a first-order-tagged order
      // counts as "new".
      isNew = isFirstOrderTaggedById.get(r.order_id) === true;
    } else if (cust && cust !== "null") {
      // History-based — first-ever date for this customer × family
      // must fall inside the loaded window.
      const firstDate = firstProductDate.get(`${cust}|${fam}`);
      if (firstDate && firstDate >= windowFrom && firstDate <= windowTo) {
        isNew = true;
      }
      // Tag override: if the rep manually tagged the order as
      // 'first order', trust them. Handles two real-world misses:
      //   (1) The all-time pull's customer-id resolution missed a prior
      //       record (e.g. customer collapsed via email fallback to a
      //       record with an old DTC purchase), so firstDate predates
      //       the rep's actual first sale to this account.
      //   (2) The customer is genuinely new and Windsor's all-time
      //       cache happens to not yet include the brand-new order.
      if (!isNew && isFirstOrderTaggedById.get(r.order_id) === true) {
        isNew = true;
      }
    }

    const slot = repAgg[rep].productMix[fam];
    if (isNew) {
      slot.newUnits += units;
      slot.newDollars += netLine;
      if (cust && cust !== "null") newCustsByRep[rep][fam].add(cust);
    } else {
      slot.existingUnits += units;
      slot.existingDollars += netLine;
    }
  }
  // Surface unique-customer counts for the reconciliation panel.
  for (const rep of Object.keys(repAgg)) {
    repAgg[rep].newXvieAccts = newCustsByRep[rep].XVIE.size;
    repAgg[rep].newSerumAccts = newCustsByRep[rep].Serum.size;
  }
  // Group reps into territories, sort by net within each territory.
  // Round productMix dollar values (units stay as integer counts).
  const roundMix = (mix) => {
    const out = {};
    for (const fam of Object.keys(mix)) {
      out[fam] = {
        newUnits: Math.round(mix[fam].newUnits || 0),
        newDollars: Math.round(mix[fam].newDollars || 0),
        existingUnits: Math.round(mix[fam].existingUnits || 0),
        existingDollars: Math.round(mix[fam].existingDollars || 0),
      };
    }
    return out;
  };
  const repPerformance = TERRITORY_ORDER.map((t) => ({
    territory: t,
    rows: Object.values(repAgg)
      .filter((r) => r.territory === t)
      .sort((a, b) => b.net - a.net)
      .map((r, i) => ({
        ...r,
        net: Math.round(r.net),
        productMix: roundMix(r.productMix),
        rank: i + 1,
      })),
  }));

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

    const tags = parseOrderTags(o.order_tags);
    const hasFirstOrderTag = tags.some(isFirstOrderTag);
    if (hasFirstOrderTag && o.gummyLineGross > 0) {
      repBucketedNew.get(k)[rep] = (repBucketedNew.get(k)[rep] || 0) + 1;
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

  const orders = orderRows
    .map((o) => {
      const ch = channelByOrder.get(o.order_id);
      const codes = (o.order_discount_codes || "")
        .split(",").map((c) => c.trim()).filter(Boolean);
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

  const round0 = (n) => Math.round(n || 0);
  const sum = (arr, fn) => arr.reduce((a, x) => a + (fn ? fn(x) : x), 0);

  const netTotal = round0(kpis.totalNetSales);
  const monthlySeriesSum = round0(sum(monthlySeries, (m) => m.Total));
  const productFamilySum = round0(sum(productFamily, (p) => p.B2B + p.ADCS + p.DTC));
  const allSkuSum = round0(sum(Array.from(skuTotals.values()), (v) => v.B2B + v.ADCS + v.DTC));
  const topSkusSum = round0(sum(topSKUs, (s) => s.Total));
  const allStateSum = round0(sum(Array.from(stateTotals.values()), (v) => v.B2B + v.ADCS + v.DTC));
  const revenueByStateSum = round0(sum(revenueByState, (s) => s.Total));
  const repNetSum = round0(sum(repPerformance, (sec) => sum(sec.rows, (r) => r.net)));
  const repTerritoryTotals = TERRITORY_ORDER.map((t) => {
    const rows = repPerformance.find((s) => s.territory === t)?.rows || [];
    return {
      territory: t, reps: rows.length,
      net: round0(sum(rows, (r) => r.net)),
      orders: sum(rows, (r) => r.orders),
      newAccounts: sum(rows, (r) => r.newAccounts),
      firstOrderGummy: sum(rows, (r) => r.firstOrderGummy),
      chronological: sum(rows, (r) => r.chronologicalNewAccounts || 0),
    };
  });
  const chronologicalNewTotal = sum(repTerritoryTotals, (t) => t.chronological);
  const bucketSum = round0(kpis.b2bNetSales + kpis.adcsNetSales + kpis.dtcNetSales);
  const reconciliation = {
    netSales: {
      kpiTotal: netTotal,
      bucketSum, bucketDelta: netTotal - bucketSum,
      monthlySeriesSum, monthlySeriesDelta: netTotal - monthlySeriesSum,
      productFamilySum, productFamilyDelta: netTotal - productFamilySum,
      productFamilyCoveragePct: netTotal ? Math.round((productFamilySum / netTotal) * 1000) / 10 : 0,
      allSkuSum, topSkusSum,
      topSkusCoveragePct: allSkuSum ? Math.round((topSkusSum / allSkuSum) * 1000) / 10 : 0,
      allStateSum, revenueByStateSum,
      revenueByStateCoveragePct: allStateSum ? Math.round((revenueByStateSum / allStateSum) * 1000) / 10 : 0,
      b2bTotal: round0(kpis.b2bNetSales),
      repPerformanceSum: repNetSum,
      repPerformanceDelta: round0(kpis.b2bNetSales) - repNetSum,
    },
    newAccounts: {
      chronologicalTotal: chronologicalNewTotal,
      firstOrderGummyTotal,
      delta: chronologicalNewTotal - firstOrderGummyTotal,
    },
    territoryRollup: repTerritoryTotals,
  };

  return {
    generatedAt: new Date().toISOString(),
    rowCount: lineRows.length,
    orderCount: orderRows.length,
    granularity,
    kpis, reconciliation,
    monthlySeries, cumulativeYTD,
    topSKUs, productFamily,
    customerDynamics, repeatRate, subVsOneTime,
    revenueByState, discountUsage, fulfillmentSplit,
    orders, repPerformance,
    repSalesMonthly, repNewAccountsMonthly,
    repsList: Object.keys(REPS),
    channelColors: CHANNEL_COLORS,
    familyColors: FAMILY_COLORS,
  };
}

// ============================================================
// Compare-window helper for the prior-period comparison feature.
//   mode = "prior" → preceding window of same length immediately before
//   mode = "yoy"   → same window shifted back by one calendar year
// Returns { from, to } in YYYY-MM-DD, or null if inputs are invalid.
// ============================================================
export function computeCompareWindow(from, to, mode = "prior") {
  if (!from || !to) return null;
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) return null;
  if (mode === "yoy") {
    const pf = new Date(fromD); pf.setUTCFullYear(pf.getUTCFullYear() - 1);
    const pt = new Date(toD); pt.setUTCFullYear(pt.getUTCFullYear() - 1);
    return {
      from: pf.toISOString().slice(0, 10),
      to: pt.toISOString().slice(0, 10),
    };
  }
  // "prior" — same length, immediately before
  const dayMs = 86400000;
  const priorTo = new Date(fromD.getTime() - dayMs);
  const priorFrom = new Date(priorTo.getTime() - (toD.getTime() - fromD.getTime()));
  return {
    from: priorFrom.toISOString().slice(0, 10),
    to: priorTo.toISOString().slice(0, 10),
  };
}

// Build a lightweight comparison snapshot from raw rows. Returns just
// the slice of buildDashboardData() that the comparison UI needs:
// kpis (for the tiles), and a flat `reps` array `[{rep, territory, net,
// orders, productMix}]` for the rep table delta lookup. We avoid running
// the full pipeline (chart series, audit list, allTime first-product
// detection) because they are not displayed in compare mode and would
// triple our server work for every dashboard load.
export function buildCompareSnapshot(rawRows, dateRange = {}) {
  const full = buildDashboardData(rawRows, dateRange, []);
  const reps = [];
  for (const sec of (full.repPerformance || [])) {
    for (const r of sec.rows || []) {
      reps.push({
        rep: r.rep,
        territory: sec.territory,
        net: r.net,
        orders: r.orders,
        productMix: r.productMix,
      });
    }
  }
  return {
    kpis: full.kpis,
    reps,
    reconciliation: {
      kpiTotal: full.reconciliation?.netSales?.kpiTotal,
      b2bTotal: full.reconciliation?.netSales?.b2bTotal,
    },
    orderCount: full.orderCount,
    // Bucketed time-series the chart components can use for dashed
    // prior-period overlays. Same shape as full.monthlySeries
    // ([{label, B2B, DTC, ADCS, Total, ...}, ...]). Aligned by bucket
    // INDEX (position) when overlaid on the current chart, so a 30-day
    // prior window with 30 buckets maps 1:1 onto a 30-day current window.
    monthlySeries: full.monthlySeries || [],
  };
}
