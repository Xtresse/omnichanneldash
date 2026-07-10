import { fetchShopifyRows, fetchShopifyAllTimeLight, hasShopifyCreds } from "./shopify.js";
import { findRep, REPS, TERRITORY_ORDER } from "./reps.js";
import { isSubscription, parseOrderTags } from "./classify.js";
import { geocode } from "./geo.js";
import { sellingDaysBetween, sellingDayWindow } from "./sellingDays.js";
import {
  familyFor,
  fulfillmentLocFor,
  CHANNEL_COLORS,
  FAMILY_COLORS,
  FAMILY_ORDER,
  B2B_DISCOUNT_PATTERNS,
  B2B_FOCUS_SKUS,
  canonicalizeCode,
} from "./constants.js";
import { cogsPerUnit, COGS_IS_PLACEHOLDER, COGS_PLACEHOLDER_NOTE } from "./cogs.js";
import { buildBudgetForecast } from "./budgetForecast.js";

// DTC Shopify data is only reliable from this date onward — pre-2026-04-01
// orders are bucketed as B2B by the channel-classification fallback
// (see classifyOrderChannel below). Used by buildDashboardData.
const DTC_DATA_AVAILABLE_FROM = "2026-04-01";

const DTC_SKU_EXCLUSIONS = new Set([
  "X-GN-060CT-001",
  "X-FRC-30ML-001",
]);

// SHOPIFY-ONLY: this dashboard pulls live data directly from Shopify via
// lib/shopify.js → lib/xtresseCore.js. The Windsor connector has been
// removed entirely — there is no fallback. The function NAMES below are
// kept (callers across the app depend on them) but they now delegate
// straight to the Shopify core and require Shopify creds.
export async function fetchWindsorRows({ preset, from, to } = {}) {
  if (!hasShopifyCreds()) {
    throw new Error(
      "Shopify credentials required (SHOPIFY_CLIENT_ID/SECRET or SHOPIFY_ADMIN_API_TOKEN)"
    );
  }
  return fetchShopifyRows({ preset, from, to });
}

export async function fetchWindsorAllTimeLight() {
  // Full history is only ~2.6k orders (store opened 2024-07), so the
  // paginated Shopify pull is a handful of pages — fast, and cached.
  if (!hasShopifyCreds()) {
    throw new Error(
      "Shopify credentials required (SHOPIFY_CLIENT_ID/SECRET or SHOPIFY_ADMIN_API_TOKEN)"
    );
  }
  return fetchShopifyAllTimeLight();
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
  // Distinct-customer (account) counts for this family — a customer is
  // "new" iff this is their first-ever order of the family (gummies use
  // the Shopify First-Order tag). Counts ACCOUNTS, not units: an account
  // buying 2 units of their first serum is 1 new serum customer. Units/
  // dollars above stay for the President's Club comp weighting.
  newCusts: 0,
  existingCusts: 0,
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

// LOCATION-LEVEL NEW ACCOUNTS (2026-05): the `cust` identifier used
// throughout this file now includes a normalized shipping address so
// each Shopify CompanyLocation under a parent Company is a distinct
// purchasing entity. This drives the per-rep newCustsByRep and
// firstByRepCust dedupe sets, plus the per-family firstProductOrder
// map — so multi-location chains count as N new accounts when N
// distinct locations place their first orders, not 1 per chain.
// Mirrored from Sales-Rep-Dashboards/lib/repData.js v9.
function normalizeAddrPart(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function parseShippingAddress(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}
function locationKeyFromRow(r) {
  const addr = parseShippingAddress(r.order_shipping_address);
  const addrIsString = typeof r.order_shipping_address === "string";
  const street = addrIsString
    ? String(r.order_shipping_address || "").trim()
    : (addr.address1 || "");
  const city = addr.city || r.order_shipping_address_city || "";
  const state = addr.province || addr.province_code || r.order_shipping_address_province || "";
  const zip = addr.zip || r.order_shipping_address_zip || "";
  return [
    normalizeAddrPart(street),
    normalizeAddrPart(city),
    normalizeAddrPart(state),
    normalizeAddrPart(zip),
  ].join("|");
}
function custFromRow(r) {
  const base = String(
    r.order_customer_id || (r.order_email || "").toLowerCase() || ""
  );
  if (!base || base === "null") return "";
  return base + "||" + locationKeyFromRow(r);
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
        order_customer_first_name: r.order_customer_first_name || null,
        order_customer_last_name: r.order_customer_last_name || null,
        order_shipping_address_name: r.order_shipping_address_name || null,
        order_shipping_address_company: r.order_shipping_address_company || null,
        order_shipping_address_country: r.order_shipping_address_country,
        order_shipping_address_province: r.order_shipping_address_province,
        // 2026-05: street/city/zip captured here so downstream cust
        // identifiers can be built per location (custFromRow). See
        // header comment on the new-account dedupe semantics.
        order_shipping_address: r.order_shipping_address || null,
        order_shipping_address_city: r.order_shipping_address_city || null,
        order_shipping_address_zip: r.order_shipping_address_zip || null,
        // Exact ship-to coordinates from Shopify (when present) for the heat map.
        order_shipping_address_lat: r.order_shipping_address_lat ?? null,
        order_shipping_address_lng: r.order_shipping_address_lng ?? null,
        order_subtotal_price: numOrZero(r.order_subtotal_price),
        order_financial_status: "",
        // 2026-05 (per Sam): omni net sales now EXCLUDES shipping + tax.
        // grossTotal is sourced from `order_subtotal_price` (line items
        // post-discount, BEFORE shipping/tax/tips) instead of the prior
        // `order_total_price_amount` (which includes shipping + tax).
        // This brings omni's DTC net sales into line with the DTC
        // dashboard (xtressedtcdash), which already uses line-item
        // revenue. Refund offsets remain the same — both
        // order_refunds_subtotal and order_returns_amount are tracked at
        // the line-item level so subtracting them from subtotal yields a
        // clean line-revenue net.
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
      // 2026-05: source the gross from order_subtotal_price (line items
      // post-discount, before shipping + tax) instead of
      // order_total_price_amount. See init-block comment above.
      const g = parseFloat(r.order_subtotal_price);
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
    if (!o.order_customer_first_name && r.order_customer_first_name)
      o.order_customer_first_name = r.order_customer_first_name;
    if (!o.order_customer_last_name && r.order_customer_last_name)
      o.order_customer_last_name = r.order_customer_last_name;
    if (!o.order_shipping_address_name && r.order_shipping_address_name)
      o.order_shipping_address_name = r.order_shipping_address_name;
    if (!o.order_shipping_address_company && r.order_shipping_address_company)
      o.order_shipping_address_company = r.order_shipping_address_company;
    if (!o.order_shipping_address_province && r.order_shipping_address_province)
      o.order_shipping_address_province = r.order_shipping_address_province;
    // 2026-05: also fill in street/city/zip from later rows if the first
    // sale row didn't have them — same back-fill pattern as the other
    // address fields above. Needed because custFromRow() reads these.
    if (!o.order_shipping_address && r.order_shipping_address)
      o.order_shipping_address = r.order_shipping_address;
    if (!o.order_shipping_address_city && r.order_shipping_address_city)
      o.order_shipping_address_city = r.order_shipping_address_city;
    if (!o.order_shipping_address_zip && r.order_shipping_address_zip)
      o.order_shipping_address_zip = r.order_shipping_address_zip;
    if (o.order_shipping_address_lat == null && r.order_shipping_address_lat != null)
      o.order_shipping_address_lat = r.order_shipping_address_lat;
    if (o.order_shipping_address_lng == null && r.order_shipping_address_lng != null)
      o.order_shipping_address_lng = r.order_shipping_address_lng;
    if (!o.order_subtotal_price && r.order_subtotal_price) {
      const sub = numOrZero(r.order_subtotal_price);
      if (sub > 0) o.order_subtotal_price = sub;
    }
    if (!isRefundRow) {
      const sku = (r.line_item__sku || "").trim();
      if (sku) {
        o.skus.add(sku);
        if (DTC_SKU_EXCLUSIONS.has(sku)) o.hasDtcSku = true;
        // Sachets count as a gummy trial here even though they're now their
        // own family for revenue/margin reporting (see lib/constants.js,
        // corrected 2026-07-09) — a sachet purchase is still "tried the
        // gummies," and this flag feeds first-order-gummy new-account
        // tracking (rep commission-adjacent), which shouldn't silently
        // change just because the revenue rollup got more precise.
        const fam = familyFor(sku);
        if (fam === "Gummies" || fam === "Sachets") {
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

  // 2026-05: switched the ADCS check from exact match (t === "adcs") to
  // substring match (t.includes("adcs")) for consistency with:
  //   - findRep() in lib/reps.js, which uses substring match for ADCS
  //   - the leadership dashboard's Windsor pre-filter `ncontains "ADCS"`
  // Previously, tags like "ADCS-AccountName" or "California-ADCS"
  // bypassed the early ADCS return, fell through findRep (which marked
  // them __EXCLUDE__), and then got reclassified as B2B by the
  // "b2b" / "wholesale" tag fallback below — creating a ~$500K gap
  // between omni B2B net sales and the leadership dashboard's number.
  if (lower.some((t) => t.includes("adcs") || t.includes("advanced derm"))) {
    return { channel: "ADCS", rep: null };
  }
  // 2026-05: also detect ADCS by discount code. Order #3831 from
  // ap@adcsclinics.com (2/20/2026, $68,040) was tagged with rep
  // "Michelle Spencer" + a code "ADCS Bulk Pricing per SS-BC-KF" but had
  // no ADCS string in tags — so it was incorrectly attributed to
  // Michelle as B2B. ADCS orders sometimes carry a rep tag for
  // sales-tracking but should never count toward that rep's commission
  // because they're handled separately. Checking codes here, BEFORE the
  // findRep return below, ensures these orders land in ADCS regardless
  // of which rep is named on the order.
  const allCodes = String(order.order_discount_codes || "")
    .split(/[,;]/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (allCodes.some((c) => c.includes("adcs") || c.includes("advanced derm"))) {
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
  const isB2bByCode = allCodes.some((c) =>
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

export function buildDashboardData(rawRows, dateRange = {}, allTimeRows = [], costs = null) {
  const granularity = pickGranularity(dateRange);
  const helpers = BUCKET_HELPERS[granularity] || BUCKET_HELPERS.month;
  const bucketKey = helpers.key;
  const bucketLabel = helpers.label;

  // Customer-level first-ever purchase dates per product family.
  // Used to flag a customer as "new" for that product when their
  // first-ever date falls inside the loaded window. Tracks Serum,
  // XVIE, and Sachets (for Gummies we use the Shopify First-Order tag
  // instead — see the rep-loop below).
  // 2026-05: track the customer's FIRST-EVER ORDER (by ID + timestamp)
  // per family, not just the earliest date. Date-based check
  // over-counted: if a customer's first-ever Serum AND a later return
  // visit both fell inside the dashboard window, BOTH got marked as
  // first-time. Tracking the specific order_id lets the inner loop
  // mark only the actual first order as new, with subsequent orders
  // (even in the same window) correctly bucketed as returning. Matches
  // the Excel/Financial Model Report's per-order First-Time flag.
  const firstProductOrder = new Map(); // key: `${cust}|${family}` → { ts, orderId }
  for (const r of allTimeRows) {
    // v9 (May 2026): cust is LOCATION-level (customer_id + normalized
    // address). See custFromRow header. Without this, a chain's 2nd
    // location buying XVIE for its OWN first time would inherit the
    // chain's earlier first-XVIE date and never get flagged as new.
    const cust = custFromRow(r);
    if (!cust) continue;
    const ts = r.order_created_at || "";
    if (!ts) continue;
    const fam = familyFor(r.line_item__sku);
    if (fam !== "Serum" && fam !== "XVIE" && fam !== "Sachets") continue;
    const key = `${cust}|${fam}`;
    const prev = firstProductOrder.get(key);
    if (!prev || ts < prev.ts) {
      firstProductOrder.set(key, { ts, orderId: r.order_id });
    }
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

  // 2026-05 (Sam): parallel "DTC retail SKUs" classification — an order
  // counts here iff it contains at least one of the 3 explicit retail
  // SKUs on the xtressedtcdash dashboard's allowlist. This is purely
  // additive; the existing tag-based dtcNetSales is unchanged. Surfaced
  // in the reconciliation panel so the two definitions can be compared
  // side-by-side without overriding the channel split that drives the
  // rest of the dashboard.
  const DTC_RETAIL_SKUS = new Set([
    "X-GN-060CT-001",   // Gummies 60ct
    "X-FRC-30ML-001",   // Serum 30ml
    "XTR-DTC-GMFR-02",  // Grow System bundle
  ]);
  const hasDtcSkuByOrder = new Map();
  for (const r of lineRows) {
    if (DTC_RETAIL_SKUS.has(r.line_item__sku)) {
      hasDtcSkuByOrder.set(r.order_id, true);
    }
  }

  const kpis = {
    totalNetSales: 0, b2bNetSales: 0, adcsNetSales: 0, dtcNetSales: 0,
    // 2026-05: b2bNetSales now counts ONLY orders with a recognized rep
    // tag attached — matches leadership dashboard's strict definition
    // and the Excel P Club roster. Orders classified channel='B2B' by
    // tag/code fallback (b2b/wholesale tag, B2B-pattern discount code,
    // or the pre-2026-04-01 date fallback) but missing a rep get
    // bucketed into b2bUntaggedNetSales so they can be cleaned up in
    // Shopify rather than silently inflating the rep totals.
    b2bUntaggedNetSales: 0, b2bUntaggedOrders: 0,
    // SKU-allowlist parallel — same denominator universe (orders with
    // net > 0) but classified by line-item SKU presence instead of by
    // order tags. Reconciliation panel compares this to dtcNetSales.
    dtcSkuNetSales: 0, dtcSkuOrders: 0,
    totalOrders: orderRows.length,
    b2bOrders: 0, adcsOrders: 0, dtcOrders: 0,
    totalGrossSales: 0, totalDiscounts: 0, totalReturns: 0,
    // Per-channel gross (subtotal + discounts) — parallels the net fields
    // so a global Net/Gross toggle can switch every figure client-side.
    b2bGrossSales: 0, adcsGrossSales: 0, dtcGrossSales: 0,
  };
  const grossOf = (o) => (o.grossTotal || 0) + (o.discounts || 0);
  for (const o of orderRows) {
    const ch = channelByOrder.get(o.order_id);
    kpis.totalNetSales += o.net;
    kpis.totalGrossSales += grossOf(o);
    kpis.totalDiscounts += o.discounts;
    kpis.totalReturns += -Math.abs(o.refundDollars);
    if (ch === "B2B") {
      // Rep-attributed B2B is the canonical B2B number (matches leadership).
      // Untagged B2B-by-signal orders are tracked separately so they don't
      // inflate the headline but stay visible for ops cleanup.
      if (repByOrder.has(o.order_id)) {
        kpis.b2bNetSales += o.net;
        kpis.b2bGrossSales += grossOf(o);
        kpis.b2bOrders += 1;
      } else {
        kpis.b2bUntaggedNetSales += o.net;
        kpis.b2bUntaggedOrders += 1;
      }
    }
    else if (ch === "ADCS") { kpis.adcsNetSales += o.net; kpis.adcsGrossSales += grossOf(o); kpis.adcsOrders += 1; }
    else { kpis.dtcNetSales += o.net; kpis.dtcGrossSales += grossOf(o); kpis.dtcOrders += 1; }
    if (hasDtcSkuByOrder.get(o.order_id)) {
      kpis.dtcSkuNetSales += o.net;
      kpis.dtcSkuOrders += 1;
    }
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
      bucketed.set(k, { B2B_rev: 0, ADCS_rev: 0, DTC_rev: 0, B2B_ord: 0, ADCS_ord: 0, DTC_ord: 0, B2B_grs: 0, ADCS_grs: 0, DTC_grs: 0 });
    const slot = bucketed.get(k);
    slot[`${ch}_rev`] += o.net;
    slot[`${ch}_grs`] += (o.grossTotal || 0) + (o.discounts || 0);
    slot[`${ch}_ord`] += 1;
  }
  const bucketKeys = Array.from(bucketed.keys()).sort();
  const monthlySeries = bucketKeys.map((k) => {
    const s = bucketed.get(k);
    return {
      month: k, label: bucketLabel(k),
      B2B: Math.round(s.B2B_rev), ADCS: Math.round(s.ADCS_rev), DTC: Math.round(s.DTC_rev),
      Total: Math.round(s.B2B_rev + s.ADCS_rev + s.DTC_rev),
      // Gross (subtotal + discounts) per channel — drives the Net/Gross toggle.
      B2B_gross: Math.round(s.B2B_grs), ADCS_gross: Math.round(s.ADCS_grs), DTC_gross: Math.round(s.DTC_grs),
      Total_gross: Math.round(s.B2B_grs + s.ADCS_grs + s.DTC_grs),
      B2B_orders: s.B2B_ord, ADCS_orders: s.ADCS_ord, DTC_orders: s.DTC_ord,
      B2B_AOV: s.B2B_ord ? Math.round(s.B2B_rev / s.B2B_ord) : 0,
      DTC_AOV: s.DTC_ord ? Math.round(s.DTC_rev / s.DTC_ord) : 0,
      B2B_AOV_gross: s.B2B_ord ? Math.round(s.B2B_grs / s.B2B_ord) : 0,
      DTC_AOV_gross: s.DTC_ord ? Math.round(s.DTC_grs / s.DTC_ord) : 0,
    };
  });

  const monthlyForYtd = new Map();
  for (const o of orderRows) {
    const k = monthKey(o.order_created_at);
    if (!k) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!monthlyForYtd.has(k))
      monthlyForYtd.set(k, { B2B_rev: 0, ADCS_rev: 0, DTC_rev: 0, grs: 0 });
    const slot0 = monthlyForYtd.get(k);
    slot0[`${ch}_rev`] += o.net;
    slot0.grs += grossOf(o);
  }
  const yearAccum = new Map();
  for (const k of Array.from(monthlyForYtd.keys()).sort()) {
    const [y, m] = k.split("-");
    const slot = monthlyForYtd.get(k);
    if (!yearAccum.has(y)) yearAccum.set(y, []);
    const arr = yearAccum.get(y);
    const prev = arr[arr.length - 1] || { B2B: 0, ADCS: 0, DTC: 0, Total: 0, Total_gross: 0 };
    arr.push({
      month: Number(m), label: monthLabel(k),
      B2B: prev.B2B + Math.round(slot.B2B_rev),
      ADCS: prev.ADCS + Math.round(slot.ADCS_rev),
      DTC: prev.DTC + Math.round(slot.DTC_rev),
      Total: prev.Total + Math.round(slot.B2B_rev + slot.ADCS_rev + slot.DTC_rev),
      Total_gross: prev.Total_gross + Math.round(slot.grs),
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
    if (!familyTotals.has(fam)) familyTotals.set(fam, { B2B: 0, ADCS: 0, DTC: 0, B2B_g: 0, ADCS_g: 0, DTC_g: 0 });
    const slot = familyTotals.get(fam);
    slot[ch] += netLine;
    slot[`${ch}_g`] += lineGross;
  }
  const productFamily = FAMILY_ORDER
    .filter((fam) => familyTotals.has(fam))
    .map((fam) => {
      const v = familyTotals.get(fam);
      return {
        family: fam,
        B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
        B2B_gross: Math.round(v.B2B_g), ADCS_gross: Math.round(v.ADCS_g), DTC_gross: Math.round(v.DTC_g),
      };
    });

  // B2B Status Bar focus totals — same B2B classification, but each family's
  // B2B value is filtered to a hand-picked SKU allowlist (see B2B_FOCUS_SKUS
  // in lib/constants.js). Used only by the top-of-dashboard MTD status bar
  // so single-bottle Serum sales on B2B-tagged orders don't inflate the
  // "B2B Serum case" number. Other widgets keep using productFamily.B2B.
  const b2bFocusByFamily = {};
  for (const fam of Object.keys(B2B_FOCUS_SKUS)) {
    const allowed = B2B_FOCUS_SKUS[fam]; // Set | null
    let total = 0;
    for (const r of lineRows) {
      const sku = r.line_item__sku;
      if (!sku) continue;
      if (familyFor(sku) !== fam) continue;
      if (channelByOrder.get(r.order_id) !== "B2B") continue;
      if (allowed && !allowed.has(sku)) continue;
      const lineGross = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
      total += lineGross * (netRatioByOrder.get(r.order_id) || 0);
    }
    b2bFocusByFamily[fam] = Math.round(total);
  }

  const includeForCohort = (o) => {
    const ch = channelByOrder.get(o.order_id);
    if (ch === "DTC") return true;
    if (ch === "B2B" && o.gummyLineGross > 0) return true;
    return false;
  };
  // First-EVER order date per (channel|email), from ALL-TIME history (not just
  // the loaded window). Without this, any account's first appearance inside the
  // viewed window was mislabeled "new" even if it had ordered for years — which
  // wildly overcounted new vs returning. Full history is available via Shopify
  // read_all_orders (allTimeRows). Cohort = DTC, or B2B that bought gummies.
  const firstSeen = new Map();
  const noteFirst = (channel, email, ts) => {
    if (!email) return;
    const t = typeof ts === "number" ? ts : new Date(ts).getTime();
    if (isNaN(t)) return;
    const key = `${channel}|${email}`;
    if (!firstSeen.has(key) || t < firstSeen.get(key)) firstSeen.set(key, t);
  };
  // Reconstruct each all-time order, classify channel, detect gummy lines.
  const atOrders = new Map();
  for (const r of allTimeRows) {
    const id = r.order_id; if (!id) continue;
    let e = atOrders.get(id);
    if (!e) { e = { order_tags: r.order_tags, order_discount_codes: "", order_email: r.order_email, order_created_at: r.order_created_at, hasGummy: false }; atOrders.set(id, e); }
    const sku = (r.line_item__sku || "").trim();
    // Sachets count toward "hasGummy" here too — see the matching comment on
    // hasGummySku above.
    if (sku) {
      const fam = familyFor(sku);
      if (fam === "Gummies" || fam === "Sachets") e.hasGummy = true;
    }
  }
  for (const e of atOrders.values()) {
    const { channel } = classifyOrderChannel(e);
    if (!(channel === "DTC" || (channel === "B2B" && e.hasGummy))) continue;
    noteFirst(channel, (e.order_email || "").toLowerCase().trim(), e.order_created_at);
  }
  // Fold in the windowed orders too (covers any all-time pull lag on newest orders).
  for (const o of orderRows) {
    if (!includeForCohort(o)) continue;
    noteFirst(channelByOrder.get(o.order_id), (o.order_email || "").toLowerCase().trim(), o.order_created_at);
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

  // Is a B2B order attributed to a 1099 rep (territory "1099") vs a W2 rep
  // (territory "Existing"/"New")? Unattributed B2B (discount-code-classified,
  // no rep) falls into the W2 bucket so the two B2B sub-bars still sum to B2B.
  const isB2B1099 = (orderId) => {
    const rep = repByOrder.get(orderId);
    return !!(rep && REPS[rep] && REPS[rep][0] === "1099");
  };

  const stateTotals = new Map();
  for (const o of orderRows) {
    const state = (o.order_shipping_address_province || "").trim();
    if (!state) continue;
    const ch = channelByOrder.get(o.order_id);
    if (!stateTotals.has(state)) stateTotals.set(state, { B2B: 0, B2BW2: 0, B2B1099: 0, ADCS: 0, DTC: 0, B2BW2_g: 0, B2B1099_g: 0, ADCS_g: 0, DTC_g: 0 });
    const slot = stateTotals.get(state);
    const g = grossOf(o);
    slot[ch] += o.net;
    slot[`${ch}_g`] = (slot[`${ch}_g`] || 0) + g;
    if (ch === "B2B") {
      const k = isB2B1099(o.order_id) ? "B2B1099" : "B2BW2";
      slot[k] += o.net;
      slot[`${k}_g`] += g;
    }
  }
  const revenueByState = Array.from(stateTotals.entries())
    .map(([state, v]) => ({
      state, B2B: Math.round(v.B2B), B2BW2: Math.round(v.B2BW2), B2B1099: Math.round(v.B2B1099),
      ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
      B2BW2_gross: Math.round(v.B2BW2_g), B2B1099_gross: Math.round(v.B2B1099_g),
      ADCS_gross: Math.round(v.ADCS_g || 0), DTC_gross: Math.round(v.DTC_g),
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
    const codes = String(o.order_discount_codes || "")
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((c) => c.trim().replace(/^['"]|['"]$/g, ""))
      .filter(isLikelyPromoCode);
    if (!codes.length) continue;
    const ch = channelByOrder.get(o.order_id);
    for (const c of codes) {
      const key = c.toUpperCase();
      if (!codeTotals.has(key)) codeTotals.set(key, { display: c, B2B: 0, ADCS: 0, DTC: 0, count: 0 });
      const slot = codeTotals.get(key);
      slot[ch] += o.net;
      slot.count += 1;
    }
  }
  const discountUsage = Array.from(codeTotals.entries())
    .map(([code, v]) => ({
      code: canonicalizeCode(v.display), B2B: Math.round(v.B2B), ADCS: Math.round(v.ADCS), DTC: Math.round(v.DTC),
      Total: Math.round(v.B2B + v.ADCS + v.DTC), count: v.count,
    }))
    .sort((a, b) => b.Total - a.Total)
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
      gross: 0,
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
    // v9: location-level cust (customer_id + normalized address) so
    // chronological "first by rep cust" treats each location as its
    // own account. Drives the reconciliation panel's
    // `chronologicalNewAccounts` count.
    const cust = custFromRow(o);
    if (!cust) continue;
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
    a.gross += grossOf(o);
    a.orders += 1;

    // v9: location-level cust to align with firstByRepCust above.
    const cust = custFromRow(o);
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

  const newCustsByRep = {}; // rep → family → Set of customer ids (new)
  const allCustsByRep = {}; // rep → family → Set of customer ids (all, for existing = all − new)
  for (const rep of Object.keys(REPS)) {
    newCustsByRep[rep] = { Gummies: new Set(), Serum: new Set(), XVIE: new Set(), Sachets: new Set() };
    allCustsByRep[rep] = { Gummies: new Set(), Serum: new Set(), XVIE: new Set(), Sachets: new Set() };
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

    // v9: location-level cust to align with firstProductOrder map.
    const cust = custFromRow(o);

    let isNew = false;
    if (fam === "Gummies") {
      // Tag-based — every gummy line item in a first-order-tagged order
      // counts as "new". This matches the Excel "First Time P Club" tab's
      // Gummies logic, which pulls from the Financial Model Report's
      // First-Time Gummies? flag (column U) = "Y" — that flag is itself
      // driven by Shopify's "first order" tag.
      isNew = isFirstOrderTaggedById.get(r.order_id) === true;
    } else if (cust && cust !== "null") {
      // History-based, per-order. The Excel/Financial Model Report's
      // First-Time XVIE/Serum/Sachets flag is set on the SPECIFIC order
      // that is the customer's first-ever purchase of that family.
      // Subsequent orders by the same customer count as returning, even
      // when they fall inside the same dashboard window.
      //
      // 2026-05: previously checked "is firstDate inside window?" which
      // marked every order from a first-time customer as new (including
      // their 2nd / 3rd visits in the same window). Now we compare the
      // current order's ID to the customer's first-ever-order-of-family
      // ID — only that order's line items count toward first-time
      // dollars. This is the same flag Excel column V/W/X uses.
      const first = firstProductOrder.get(`${cust}|${fam}`);
      if (first && first.orderId === r.order_id) {
        isNew = true;
      }
    }

    const slot = repAgg[rep].productMix[fam];
    if (cust && cust !== "null") allCustsByRep[rep][fam].add(cust);
    if (isNew) {
      slot.newUnits += units;
      slot.newDollars += netLine;
      if (cust && cust !== "null") newCustsByRep[rep][fam].add(cust);
    } else {
      slot.existingUnits += units;
      slot.existingDollars += netLine;
    }
  }
  // Surface distinct-customer (account) counts per family. existing = all
  // distinct customers buying the family − the new ones (each customer is
  // counted once: new iff first-ever order of the family, else existing).
  for (const rep of Object.keys(repAgg)) {
    for (const fam of ["Gummies", "Serum", "XVIE", "Sachets"]) {
      const newN = newCustsByRep[rep][fam].size;
      const allN = allCustsByRep[rep][fam].size;
      repAgg[rep].productMix[fam].newCusts = newN;
      repAgg[rep].productMix[fam].existingCusts = Math.max(0, allN - newN);
    }
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
        newCusts: mix[fam].newCusts || 0,
        existingCusts: mix[fam].existingCusts || 0,
      };
    }
    return out;
  };
  // 2026-05: Hide reps with no sales in the selected window. The roster
  // (REPS in lib/reps.js) includes everyone who has ever sold — Julie
  // Fetter, Becky Curry, Krista Taylor are now in the dictionary so
  // their historical orders attribute correctly, but a current-window
  // table that lists 24 names with $0 across half of them is just
  // noise. Filtering at the data layer keeps every consumer (rep table,
  // President's Club, RepTrendChart legend) consistent automatically.
  const repPerformance = TERRITORY_ORDER.map((t) => ({
    territory: t,
    rows: Object.values(repAgg)
      .filter((r) => r.territory === t)
      .filter((r) => (r.net || 0) > 0 || (r.orders || 0) > 0)
      .sort((a, b) => b.net - a.net)
      .map((r, i) => ({
        ...r,
        net: Math.round(r.net),
        gross: Math.round(r.gross || 0),
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
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((c) => canonicalizeCode(c.trim().replace(/^['"]|['"]$/g, "")))
        .filter(Boolean);
      // Customer display name: prefer first+last from the customer record,
      // fall back to the shipping-address name (often the only value set on
      // rep-placed B2B orders), then to "—" via the consumer.
      const customer = (() => {
        const fn = (o.order_customer_first_name || "").trim();
        const ln = (o.order_customer_last_name || "").trim();
        const full = [fn, ln].filter(Boolean).join(" ");
        if (full) return full;
        const ship = (o.order_shipping_address_name || "").trim();
        return ship || null;
      })();
      // Account / company name (B2B account). The Orders Audit Trail leads
      // with this; the shared core flattens company onto
      // order_shipping_address_company. Fall back to the customer name then
      // the email so the column is never blank.
      const company = (o.order_shipping_address_company || "").trim() || null;
      const account = company || customer || o.order_email || null;
      // Geo: resolve a lat/lng for the ZIP heat map from the ship-to ZIP (or
      // major-city fallback). Server-side so the ~900KB ZIP table never ships
      // to the client. `geo` is null for international / un-geocodable orders;
      // those simply don't plot. isFirstOrder reuses the canonical First-Order
      // tag detection already computed above (isFirstOrderTaggedById).
      const geo = geocode({
        lat: o.order_shipping_address_lat,
        lng: o.order_shipping_address_lng,
        zip: o.order_shipping_address_zip,
        city: o.order_shipping_address_city,
        state: o.order_shipping_address_province,
      });
      return {
        id: String(o.order_id),
        name: o.order_name || null,
        date: o.order_created_at || null,
        channel: ch,
        adcs: ch === "ADCS",
        sub: ch === "DTC" ? isSubscription(o.order_tags) : false,
        rep: repByOrder.get(o.order_id) || null,
        account,
        company,
        customer,
        email: o.order_email || null,
        state: o.order_shipping_address_province || null,
        country: o.order_shipping_address_country || null,
        // Ship-to geo for the heat map (see geocode() above).
        shipCity: o.order_shipping_address_city || null,
        shipZip: o.order_shipping_address_zip || null,
        shipState: geo ? geo.abbr : "",
        shipLat: geo ? geo.lat : null,
        shipLng: geo ? geo.lng : null,
        isFirstOrder: isFirstOrderTaggedById.get(o.order_id) === true,
        codes,
        // 2026-05: surface raw order tags so the channel classification
        // (ADCS / B2B / DTC) is debuggable from the UI — caller can spot
        // tags like "ADCS-AccountName" that previously slipped through
        // exact-match checks. Pre-parsed into an array for ergonomics.
        tags: parseOrderTags(o.order_tags),
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

  // ---- Account aging (recency): per-account days-since-last-order +
  // LIFETIME revenue + per-product split + order history. Built from the
  // ALL-TIME pull (allTimeRows — quarterly-sharded, ~11s cold, cached 5min)
  // rather than the selected window, so dormant cohorts and TRUE lifetime $
  // are always captured no matter which date range is loaded. This is why
  // the Account Aging tab no longer needs a slow self-fetched all-history
  // window. Falls back to the current window's rows if the all-time pull is
  // empty. Same aggregateOrders/classifyOrderChannel/findRep helpers as the
  // rest of the dashboard, so it ties out. B2B-only: excludes ADCS AND DTC
  // (rep-attributed orders only) — see the per-order gate below.
  const agingSrc = (allTimeRows && allTimeRows.length) ? allTimeRows : rawRows;
  const agingAgg = aggregateOrders(agingSrc).filter((o) => o.net > 0);
  const agingKeptIds = new Set(agingAgg.map((o) => o.order_id));
  const agingLineRows = agingSrc.filter(
    (r) => agingKeptIds.has(r.order_id) && r.line_item__sku
  );
  const agingLineGross = new Map();
  for (const r of agingLineRows) {
    const lg = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    agingLineGross.set(r.order_id, (agingLineGross.get(r.order_id) || 0) + lg);
  }
  const agingNetRatio = new Map();
  const agingRepByOrder = new Map();
  const agingChannelByOrder = new Map();
  for (const o of agingAgg) {
    const lg = agingLineGross.get(o.order_id) || 0;
    agingNetRatio.set(o.order_id, lg > 0 ? o.net / lg : 0);
    const { channel, rep } = classifyOrderChannel(o);
    agingChannelByOrder.set(o.order_id, channel);
    if (rep) agingRepByOrder.set(o.order_id, rep);
  }
  const agingKey = (company, email) =>
    String((company || "").trim() || (email || "").trim() || "").toLowerCase();
  const acctMap = new Map();
  const nowTs = Date.now();
  for (const o of agingAgg) {
    const channel = agingChannelByOrder.get(o.order_id);
    const rep = agingRepByOrder.get(o.order_id) || null;
    // B2B-only, rep-attributed: skip ADCS (explicit) AND any order without a
    // rep tag. Per Sam, DTC = orders with no rep, so aging counts only
    // rep-attributed B2B accounts — an account appears iff it has at least one
    // rep-attributed order. This mirrors the canonical b2bNetSales /
    // leadership definition (rep-attributed only) and reuses the shared
    // classifyOrderChannel/findRep logic, so it stays consistent with the
    // other tabs (no hand-rolled DTC filter).
    if (channel === "ADCS" || !rep) continue;
    const date = o.order_created_at;
    if (!date) continue;
    const company = (o.order_shipping_address_company || "").trim();
    const email = o.order_email || "";
    const key = agingKey(company, email);
    if (!key) continue;
    let a = acctMap.get(key);
    if (!a) {
      a = { name: company || email || "—", rep, repLast: rep,
            firstOrder: date, lastOrder: date, lifetimeNet: 0, orders: 0,
            byProduct: { Gummies: 0, Serum: 0, XVIE: 0 }, history: [] };
      acctMap.set(key, a);
    }
    a.orders += 1;
    a.lifetimeNet += o.net || 0;
    if (date > a.lastOrder) { a.lastOrder = date; if (rep) a.repLast = rep; }
    if (date < a.firstOrder) a.firstOrder = date;
    if (!a.rep && rep) a.rep = rep;
    a.history.push({ date, name: o.order_name, net: Math.round(o.net || 0), channel });
  }
  // Per-account per-family LIFETIME net from all-time line rows.
  const agingAcctByOrder = new Map();
  for (const o of agingAgg) {
    // Same B2B-only, rep-attributed gate as the account loop above so the
    // per-family lifetime $ only allocates rep-attributed orders.
    if (agingChannelByOrder.get(o.order_id) === "ADCS") continue;
    if (!agingRepByOrder.get(o.order_id)) continue;
    const key = agingKey(o.order_shipping_address_company, o.order_email);
    if (key) agingAcctByOrder.set(o.order_id, key);
  }
  for (const r of agingLineRows) {
    const key = agingAcctByOrder.get(r.order_id);
    if (!key) continue;
    const a = acctMap.get(key);
    if (!a) continue;
    // acctMap.byProduct only has Gummies/Serum/XVIE columns (no Sachets column
    // in the Account Aging drill-down) — fold sachets into Gummies here so
    // the $ isn't silently dropped from an account's lifetime product mix.
    let fam = familyFor(r.line_item__sku);
    if (fam === "Sachets") fam = "Gummies";
    if (fam !== "Gummies" && fam !== "Serum" && fam !== "XVIE") continue;
    const lg = numOrZero(r.line_item__price) * numOrZero(r.line_item__quantity);
    a.byProduct[fam] += lg * (agingNetRatio.get(r.order_id) || 0);
  }
  const accountAging = Array.from(acctMap.values())
    .map((a) => ({
      name: a.name,
      rep: a.repLast || a.rep || null,
      lastOrder: a.lastOrder,
      firstOrder: a.firstOrder,
      daysSince: Math.max(0, Math.floor((nowTs - new Date(a.lastOrder).getTime()) / 86400000)),
      lifetimeNet: Math.round(a.lifetimeNet),
      orders: a.orders,
      byProduct: { Gummies: Math.round(a.byProduct.Gummies), Serum: Math.round(a.byProduct.Serum), XVIE: Math.round(a.byProduct.XVIE) },
      history: a.history.sort((x, y) => (y.date || "").localeCompare(x.date || "")).slice(0, 40),
    }))
    .sort((a, b) => a.daysSince - b.daysSince);

  // ---- Ambassador program (XVIE50) ----
  // Program entry = an order carrying the XVIE50 discount code (50% off the
  // $3,600 Xvie case). Reorder = a LATER order by the same account that
  // contains an Xvie SKU (familyFor === "XVIE") and does NOT carry XVIE50
  // (i.e. a non-discounted, full-price Xvie repurchase). Grouped by the rep
  // tag on the entry order (shared findRep). Built from the same all-time
  // source (agingSrc) + agingKey/familyFor so it ties to the other tabs.
  // The "6 serums + 6 gummies free" perk is intentionally NOT modeled — it
  // isn't represented in Shopify orders.
  // Exact-match the discount code (parse the JSON array and compare each
  // element === "XVIE50"). A substring check over-counts: it matches related
  // codes that merely contain "xvie50" (e.g. an XVIE50OFF variant), inflating
  // the program base. Exact match reproduces Shopify's discount_code:XVIE50.
  const isXvie50 = (codesStr) => {
    if (!codesStr) return false;
    let arr;
    try { arr = JSON.parse(codesStr); } catch { return false; }
    return Array.isArray(arr) && arr.some((c) => String(c).trim().toUpperCase() === "XVIE50");
  };
  // Per-order rollup from the all-time line rows: date, account key, whether
  // it carries XVIE50, whether it has an Xvie line, its rep tag, and its Xvie
  // units/$ (original price).
  const ordMeta = new Map();
  for (const r of agingSrc) {
    const oid = r.order_id;
    if (!oid) continue;
    let m = ordMeta.get(oid);
    if (!m) {
      m = {
        date: r.order_created_at || "",
        key: agingKey(r.order_shipping_address_company, r.order_email),
        company: (r.order_shipping_address_company || "").trim(),
        email: r.order_email || "",
        tags: r.order_tags,
        x50: false,
        hasXvie: false,
        xvieUnits: 0,
        xvieGross: 0,
      };
      ordMeta.set(oid, m);
    }
    if (!m.date && r.order_created_at) m.date = r.order_created_at;
    if (!m.tags && r.order_tags) m.tags = r.order_tags;
    if (isXvie50(r.order_discount_codes)) m.x50 = true;
    if (familyFor(r.line_item__sku) === "XVIE") {
      m.hasXvie = true;
      const q = numOrZero(r.line_item__quantity);
      m.xvieUnits += q;
      m.xvieGross += numOrZero(r.line_item__price) * q;
    }
  }
  for (const m of ordMeta.values()) {
    const rp = findRep(m.tags);
    m.rep = rp && rp !== "__EXCLUDE__" ? rp : null;
  }
  // Entry per account = earliest XVIE50-coded order.
  const ambByKey = new Map();
  for (const m of ordMeta.values()) {
    if (!m.x50 || !m.hasXvie || !m.key || !m.date) continue;
    let a = ambByKey.get(m.key);
    if (!a) {
      ambByKey.set(m.key, {
        key: m.key, name: m.company || m.email || "—",
        entryDate: m.date, rep: m.rep || null,
        reorderOrders: 0, reorderUnits: 0, reorderGross: 0, firstReorderDate: null,
      });
    } else if (m.date < a.entryDate) {
      a.entryDate = m.date;
      if (m.rep) a.rep = m.rep;
      a.name = m.company || m.email || a.name;
    }
  }
  // Reorders = later non-XVIE50 orders containing an Xvie SKU.
  for (const m of ordMeta.values()) {
    if (m.x50 || m.xvieUnits <= 0 || !m.date) continue;
    const a = ambByKey.get(m.key);
    if (!a || m.date <= a.entryDate) continue;
    a.reorderOrders += 1;
    a.reorderUnits += m.xvieUnits;
    a.reorderGross += m.xvieGross;
    if (!a.firstReorderDate || m.date < a.firstReorderDate) a.firstReorderDate = m.date;
  }
  const ambassadorProgram = Array.from(ambByKey.values())
    .map((a) => ({
      name: a.name,
      rep: a.rep || null,
      entryDate: a.entryDate ? a.entryDate.slice(0, 10) : null,
      reorderOrders: a.reorderOrders,
      reorderUnits: a.reorderUnits,
      reorderGross: Math.round(a.reorderGross),
      daysToFirstReorder:
        a.firstReorderDate && a.entryDate
          ? Math.max(0, Math.floor((new Date(a.firstReorderDate).getTime() - new Date(a.entryDate).getTime()) / 86400000))
          : null,
      reordered: a.reorderOrders > 0,
    }))
    .sort((x, y) => (x.entryDate || "").localeCompare(y.entryDate || ""));

  // ---- Gross margin (per-product COGS scaffold) ----
  // Allocate each line item's COGS = unit cost × NET units, where unit cost
  // comes from lib/cogs.js (PLACEHOLDER — replace with Sam's real COGS) via
  // the shared SKU→family classification (familyFor). We cost NET units
  // (gross units × the order's net/gross ratio) so refunds/returns don't
  // over-charge COGS on revenue that was never realized — keeping margin on
  // the same net basis as every other dollar on the dashboard. Surfaced
  // overall and split by channel (B2B / ADCS / DTC).
  const marginByChannel = {
    B2B: { revenue: 0, cogs: 0 },
    ADCS: { revenue: 0, cogs: 0 },
    DTC: { revenue: 0, cogs: 0 },
  };
  // Per-family COGS (overall) so margin can be read by product too.
  const cogsByFamily = { Gummies: 0, Serum: 0, XVIE: 0, Sachets: 0 };
  // Sheet-driven per-SKU unit cost (lib/costsSheet → Google Sheet "COGS" tab).
  // Wins over the lib/cogs.js placeholder when present; unlisted SKUs fall back.
  const sheetCogs = costs?.cogsBySku || null;
  const haveSheetCogs = !!(sheetCogs && Object.keys(sheetCogs).length > 0);
  const unitCostFor = (sku) =>
    haveSheetCogs && Object.prototype.hasOwnProperty.call(sheetCogs, sku)
      ? Number(sheetCogs[sku]) || 0
      : cogsPerUnit(sku, familyFor);
  for (const r of lineRows) {
    const sku = r.line_item__sku;
    if (!sku) continue;
    const fam = familyFor(sku);
    if (fam === "Exclude") continue;
    const ch = channelByOrder.get(r.order_id) || "DTC";
    const ratio = netRatioByOrder.get(r.order_id) || 0;
    const units = numOrZero(r.line_item__quantity);
    const lineGross = numOrZero(r.line_item__price) * units;
    const netLine = lineGross * ratio;
    // Cost the NET units (returned units shouldn't carry COGS).
    const netUnits = units * ratio;
    const lineCogs = unitCostFor(sku) * netUnits;
    if (marginByChannel[ch]) {
      marginByChannel[ch].revenue += netLine;
      marginByChannel[ch].cogs += lineCogs;
    }
    if (cogsByFamily[fam] != null) cogsByFamily[fam] += lineCogs;
  }
  const marginRow = (revenue, cogs) => {
    const gp = revenue - cogs;
    return {
      revenue: Math.round(revenue),
      cogs: Math.round(cogs),
      grossProfit: Math.round(gp),
      grossMarginPct: revenue > 0 ? Math.round((gp / revenue) * 1000) / 10 : null,
    };
  };
  const overallRev =
    marginByChannel.B2B.revenue + marginByChannel.ADCS.revenue + marginByChannel.DTC.revenue;
  const overallCogs =
    marginByChannel.B2B.cogs + marginByChannel.ADCS.cogs + marginByChannel.DTC.cogs;
  const grossMargin = {
    placeholder: haveSheetCogs ? false : COGS_IS_PLACEHOLDER,
    note: haveSheetCogs
      ? "COGS from the Google Sheet (per-SKU unit cost)."
      : COGS_PLACEHOLDER_NOTE,
    overall: marginRow(overallRev, overallCogs),
    byChannel: {
      B2B: marginRow(marginByChannel.B2B.revenue, marginByChannel.B2B.cogs),
      ADCS: marginRow(marginByChannel.ADCS.revenue, marginByChannel.ADCS.cogs),
      DTC: marginRow(marginByChannel.DTC.revenue, marginByChannel.DTC.cogs),
    },
    byFamily: Object.fromEntries(
      Object.entries(cogsByFamily).map(([fam, c]) => [fam, Math.round(c)])
    ),
  };

  // ---- Full gross margin: gross profit − merchant fees − fulfillment ----
  // Merchant fees and fulfillment are flat percentages of NET revenue (Sam,
  // 2026-07-09): fulfillment ≈ 4.5% of net, merchant fees ≈ 3% of net. Per-SKU
  // COGS (above) + these two = the "full COGS" stack subtracted from net
  // revenue to land on gross margin — always computed, no sheet required.
  const FULFILLMENT_PCT_OF_NET = 0.045;
  const MERCHANT_FEE_PCT_OF_NET = 0.03;
  const merchantFees = Math.round(MERCHANT_FEE_PCT_OF_NET * kpis.totalNetSales);
  const fulfillment = Math.round(FULFILLMENT_PCT_OF_NET * kpis.totalNetSales);
  const contribution = Math.round(overallRev - overallCogs - merchantFees - fulfillment);
  grossMargin.merchantFees = merchantFees;
  grossMargin.fulfillment = fulfillment;
  grossMargin.contribution = contribution;
  grossMargin.contributionMarginPct =
    overallRev > 0 ? Math.round((contribution / overallRev) * 1000) / 10 : null;
  grossMargin.feeRatePct = MERCHANT_FEE_PCT_OF_NET * 100;
  grossMargin.fulfillmentPct = FULFILLMENT_PCT_OF_NET * 100;
  grossMargin.costsMode = costs?.mode || "stub";

  // ---- Budget + Forecast (by month), prorated to the selected window ----
  // Channel-split monthly targets come from scenarioGoals.js (B2B vs DTC,
  // Base/Stretch). When the window is shorter than its month, BOTH budget and
  // forecast are prorated: B2B by SELLING days, DTC by CALENDAR days (DTC is
  // 24/7). Forecast = sheet column if present, else month-to-date run-rate.
  // Actuals fed in are the window's per-channel NET sales (rep-attributed B2B
  // matches the headline b2bNetSales). Resilient: any failure → null so the
  // rest of the payload is unaffected.
  let budgetForecast = null;
  try {
    budgetForecast = buildBudgetForecast(
      windowFrom,
      windowTo,
      { B2B: kpis.b2bNetSales, ADCS: kpis.adcsNetSales, DTC: kpis.dtcNetSales },
      {}
    );
  } catch {
    budgetForecast = null;
  }

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
  // 2026-05: bucketSum now includes b2bUntaggedNetSales so the channel
  // sum still ties to totalNetSales. The headline b2bNetSales tile shows
  // only rep-attributed (matching leadership); the untagged orders are
  // visible in the reconciliation panel for ops cleanup.
  const bucketSum = round0(
    kpis.b2bNetSales + kpis.b2bUntaggedNetSales + kpis.adcsNetSales + kpis.dtcNetSales
  );
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
      // 2026-05: surface the un-rep'd B2B-by-signal orders so they can be
      // chased down in Shopify. Adding b2bUntaggedNetSales + b2bNetSales
      // reproduces the omni "wide" B2B definition; b2bNetSales alone
      // matches the leadership / Excel definition.
      b2bUntaggedTotal: round0(kpis.b2bUntaggedNetSales),
      b2bUntaggedOrders: kpis.b2bUntaggedOrders,
      repPerformanceSum: repNetSum,
      repPerformanceDelta: round0(kpis.b2bNetSales) - repNetSum,
      // DTC reconciliation: tag-based (current dtcNetSales) vs the
      // SKU-allowlist definition that powers xtressedtcdash. Surfacing
      // both lets Sam see the gap between "DTC channel = no rep tag"
      // and "DTC channel = contains one of the 3 retail SKUs".
      dtcTagTotal: round0(kpis.dtcNetSales),
      dtcTagOrders: kpis.dtcOrders,
      dtcSkuTotal: round0(kpis.dtcSkuNetSales),
      dtcSkuOrders: kpis.dtcSkuOrders,
      dtcReconcileDelta: round0(kpis.dtcNetSales) - round0(kpis.dtcSkuNetSales),
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
    // Per-product COGS + gross margin (PLACEHOLDER COGS — see lib/cogs.js).
    grossMargin,
    // Budget + forecast by month, prorated to the selected window (B2B by
    // selling days, DTC by calendar days). See lib/budgetForecast.js.
    budgetForecast,
    monthlySeries, cumulativeYTD,
    topSKUs, productFamily, b2bFocusByFamily,
    customerDynamics, repeatRate, subVsOneTime,
    revenueByState, discountUsage, fulfillmentSplit,
    orders, repPerformance, accountAging, ambassadorProgram,
    repSalesMonthly, repNewAccountsMonthly,
    // 2026-05: repsList drives the trend-chart's rep chips. Only emit
    // reps that have at least one order in the window so the legend
    // doesn't list 24 names when only 12 actually sold this period.
    repsList: Object.keys(REPS).filter((name) => {
      const rep = repAgg[name];
      return rep && ((rep.net || 0) > 0 || (rep.orders || 0) > 0);
    }),
    // Full canonical rep roster (ALL reps, window-independent), with each
    // rep's territory so the client can show every rep in the Sales-Explorer
    // dropdown and apply the 1099 designation without forking the registry or
    // pulling xtresseCore into the client bundle. Reuses REPS (lib/reps.js).
    repRoster: Object.keys(REPS).map((name) => ({ name, territory: REPS[name][0] })),
    channelColors: CHANNEL_COLORS,
    familyColors: FAMILY_COLORS,
  };
}

// ============================================================
// Compare-window helper for the prior-period comparison feature.
//   mode = "prior" → SELLING-DAY-matched prior window (see below)
//   mode = "yoy"   → same window shifted back by one calendar year
// Returns { from, to } in YYYY-MM-DD, or null if inputs are invalid.
//
// "prior" is matched on SELLING DAYS (weekdays minus US holidays), never
// calendar days — B2B has no weekend sales, so a calendar-matched window
// inflates months that start on a Friday (their first few calendar days hold
// fewer weekdays). MTD (window starts on the 1st, same month) → the FIRST N
// selling days of the prior month; any other window → the N selling days
// immediately before it (N = selling days in the current window). Uniform with
// every other Xtressé dashboard via lib/sellingDays.js. Runs server-side (UTC),
// so UTC date parts + a UTC ymd keep it timezone-consistent.
// ============================================================
export function computeCompareWindow(from, to, mode = "prior") {
  if (!from || !to) return null;
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) return null;
  if (mode === "yoy") {
    // setUTCFullYear preserves month+day, but if the month+day doesn't exist
    // in the target year (e.g. Feb 29 → 2023), JS rolls forward to Mar 1 —
    // which silently shifts the entire YoY window. shiftYearClamped clamps
    // Feb 29 down to Feb 28 instead, so a leap-year window stays anchored
    // to the same calendar position last year.
    return {
      from: shiftYearClamped(fromD, -1),
      to: shiftYearClamped(toD, -1),
    };
  }
  const n = sellingDaysBetween(fromD, toD);
  const startsFirst = fromD.getUTCDate() === 1;
  const sameMonth =
    fromD.getUTCFullYear() === toD.getUTCFullYear() &&
    fromD.getUTCMonth() === toD.getUTCMonth();
  const w = (startsFirst && sameMonth)
    ? sellingDayWindow(new Date(Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth() - 1, 1)), n, 1)
    : sellingDayWindow(new Date(fromD.getTime() - 86400000), n, -1);
  return {
    from: w.start.toISOString().slice(0, 10),
    to: w.end.toISOString().slice(0, 10),
  };
}

// Shift a UTC date by `years` years, clamping the day-of-month to the last
// valid day of the target month. Returns YYYY-MM-DD. Examples:
//   2024-02-29 with -1 → 2023-02-28  (leap → non-leap clamp)
//   2024-03-31 with -1 → 2023-03-31  (no clamp needed)
//   2024-01-31 with +1 → 2025-01-31  (no clamp needed)
function shiftYearClamped(d, years) {
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  // Last day of month m in year y: day 0 of month m+1
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  const out = new Date(Date.UTC(y, m, clampedDay));
  return out.toISOString().slice(0, 10);
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
    // New-vs-returning bucketed series (per channel new/returning order
    // count) — for the NewVsReturning chart's prior-period overlay.
    customerDynamics: full.customerDynamics || [],
    // Repeat-purchase rate bucketed series — for RepeatRate overlay.
    repeatRate: full.repeatRate || [],
    // Per-family net-sales totals (non-time-series) — for ProductFamily
    // tooltip context. Same shape as full.productFamily.
    productFamily: full.productFamily || [],
    // Per-rep × bucket time series — for RepTrendChart prior overlay.
    // Same shape as full.repSalesMonthly / repNewAccountsMonthly.
    repSalesMonthly: full.repSalesMonthly || [],
    repNewAccountsMonthly: full.repNewAccountsMonthly || [],
  };
}
