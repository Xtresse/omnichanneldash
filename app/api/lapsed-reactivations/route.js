// /api/lapsed-reactivations
//
// One-shot report endpoint for Sam: which Apr 2026 customers reactivated
// after a 2025 last-purchase. Pulls Windsor exactly the way
// /api/dashboard does (mirrors lib/windsor.js fetchWindsorRows() — same
// account, _limit, date_filters shape, fields list semantics) and reuses
// findRep() + parseOrderTags() so rep attribution and channel
// classification match the leadership dashboard.
//
// Logic (per Sam's spec):
//   - Period A: Apr 1 - Apr 30, 2026  (the reactivation window)
//   - Period B: Jan 1, 2025 - Mar 31, 2026  (covers the prior-year
//     qualifier AND the Q1-2026-active disqualifier)
//   - For each customer with at least one Apr 2026 order, find their
//     MOST-RECENT order date in Period B.
//     * if that date is in 2025  → qualified (reactivated)
//     * if that date is in Q1 2026 → skip (active customer)
//     * if no Period B order → skip (we treat pre-2025 history as
//       outside the reactivation window per Sam's framing)
//
// Returns one row per Apr 2026 order belonging to a qualifying customer.

import { NextResponse } from "next/server";
import { findRep } from "@/lib/reps.js";
import { parseOrderTags } from "@/lib/classify.js";

const WINDSOR_BASE = "https://connectors.windsor.ai/shopify";

const DTC_SKU_EXCLUSIONS = new Set([
  "X-GN-060CT-001",
  "X-FRC-30ML-001",
]);

async function fetchWindsor({ from, to, fields }) {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) throw new Error("WINDSOR_API_KEY not set");
  const account = process.env.WINDSOR_ACCOUNT || "ace1d0-26.myshopify.com";

  const params = new URLSearchParams({
    api_key: apiKey,
    accounts: account,
    fields: fields.join(","),
    _limit: "50000",
    date_filters: JSON.stringify({ orders: "createdAt" }),
    date_from: from,
    date_to: to,
  });

  const url = `${WINDSOR_BASE}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Windsor request failed (${from}..${to}): ${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const preview = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`Windsor non-JSON (${from}..${to}): "${preview}"`);
  }
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

const numOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function isRefundOffsetRow(r) {
  const hasLine =
    (r.line_item__sku && String(r.line_item__sku).trim()) ||
    (r.line_item__title && String(r.line_item__title).trim());
  return !hasLine;
}

// Mirrors aggregateOrders() from lib/windsor.js — collapses Windsor's
// row-per-line-item shape into one record per order.
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
        order_billing_address_first_name: r.order_billing_address_first_name,
        order_billing_address_last_name: r.order_billing_address_last_name,
        order_billing_address_company: r.order_billing_address_company,
        order_shipping_address_first_name: r.order_shipping_address_first_name,
        order_shipping_address_last_name: r.order_shipping_address_last_name,
        order_shipping_address_company: r.order_shipping_address_company,
        order_shipping_address_country: r.order_shipping_address_country,
        order_shipping_address_province: r.order_shipping_address_province,
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
    if (!o.order_created_at && r.order_created_at) o.order_created_at = r.order_created_at;
    if (!o.order_tags && r.order_tags) o.order_tags = r.order_tags;
    if (!o.order_email && r.order_email) o.order_email = r.order_email;
    if (!o.order_customer_id && r.order_customer_id) o.order_customer_id = r.order_customer_id;
    if (!o.order_billing_address_first_name && r.order_billing_address_first_name)
      o.order_billing_address_first_name = r.order_billing_address_first_name;
    if (!o.order_billing_address_last_name && r.order_billing_address_last_name)
      o.order_billing_address_last_name = r.order_billing_address_last_name;
    if (!o.order_billing_address_company && r.order_billing_address_company)
      o.order_billing_address_company = r.order_billing_address_company;
    if (!o.order_shipping_address_first_name && r.order_shipping_address_first_name)
      o.order_shipping_address_first_name = r.order_shipping_address_first_name;
    if (!o.order_shipping_address_last_name && r.order_shipping_address_last_name)
      o.order_shipping_address_last_name = r.order_shipping_address_last_name;
    if (!o.order_shipping_address_company && r.order_shipping_address_company)
      o.order_shipping_address_company = r.order_shipping_address_company;
    if (!isRefundRow) {
      const sku = (r.line_item__sku || "").trim();
      if (sku) {
        o.skus.add(sku);
        if (DTC_SKU_EXCLUSIONS.has(sku)) o.hasDtcSku = true;
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

// Mirrors classifyOrderChannel() from lib/windsor.js — same priority:
// ADCS > DTC SKU > rep tag > b2b/wholesale tag > B2B discount code >
// pre-DTC-data fallback. We add an explicit "Sampling" sub-channel for
// orders tagged 'sample' / 'sampling' / 'comp' (Sam's framing).
const B2B_DISCOUNT_PATTERNS = [/^REP-/i, /^XVIE\d+/i, /^B2B-/i, /^ADCS-/i];
const DTC_DATA_AVAILABLE_FROM = "2026-04-01";

function classifyOrderChannel(order) {
  const tags = parseOrderTags(order.order_tags);
  const lower = tags.map((t) => String(t).toLowerCase());

  if (lower.some((t) => t === "adcs" || t.includes("advanced derm"))) {
    return { channel: "ADCS", rep: null };
  }
  // Sampling — tag-driven sub-channel. Distinguished BEFORE B2B/DTC so a
  // sample order tagged with a rep name still shows as "Sampling" (Sam
  // wants these isolated from rep-attributed B2B revenue).
  if (lower.some((t) => t === "sample" || t === "sampling" || t === "comp")) {
    return { channel: "Sampling", rep: findRepSafe(order.order_tags) };
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

function findRepSafe(tags) {
  const r = findRep(tags);
  return r && r !== "__EXCLUDE__" ? r : null;
}

function customerKey(o) {
  const cid = String(o.order_customer_id || "").trim();
  if (cid && cid !== "null") return `cid:${cid}`;
  const email = String(o.order_email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  return null;
}

function customerDisplayName(o) {
  const company = (
    o.order_billing_address_company ||
    o.order_shipping_address_company ||
    ""
  ).trim();
  const first =
    (o.order_billing_address_first_name || o.order_shipping_address_first_name || "").trim();
  const last =
    (o.order_billing_address_last_name || o.order_shipping_address_last_name || "").trim();

  // For B2B/ADCS prefer the company; for DTC prefer the person.
  // (We don't know channel here yet — caller passes a hint.)
  return { company, first, last, person: [first, last].filter(Boolean).join(" ").trim() };
}

const DAY_MS = 86400000;
const dayStr = (d) => (d ? String(d).slice(0, 10) : null);

export async function GET() {
  try {
    // Period A — Apr 2026, full fields.
    const fieldsA = [
      "order_id", "order_name", "order_created_at",
      "order_total_price_amount", "order_total_price",
      "order_gross_sales", "order_total_discounts",
      "order_refunds_subtotal", "order_returns_amount",
      "order_financial_status", "order_subtotal_price",
      "order_tags", "order_discount_codes",
      "order_customer_id", "order_email",
      "order_billing_address_first_name", "order_billing_address_last_name",
      "order_billing_address_company",
      "order_shipping_address_first_name", "order_shipping_address_last_name",
      "order_shipping_address_company",
      "order_shipping_address_country", "order_shipping_address_province",
      "line_item__title", "line_item__sku",
      "line_item__quantity", "line_item__price",
    ];
    // Period B — minimal, just enough to find prior-order date+name.
    const fieldsB = [
      "order_id", "order_name", "order_created_at",
      "order_customer_id", "order_email", "order_tags",
    ];

    // Period B is 15 months — split into quarters to stay under
    // Windsor's 50k row cap (line-item rows per call).
    const periodBChunks = [
      { from: "2025-01-01", to: "2025-03-31" },
      { from: "2025-04-01", to: "2025-06-30" },
      { from: "2025-07-01", to: "2025-09-30" },
      { from: "2025-10-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-03-31" },
    ];

    const [aRows, ...bChunks] = await Promise.all([
      fetchWindsor({ from: "2026-04-01", to: "2026-04-30", fields: fieldsA }),
      ...periodBChunks.map((c) => fetchWindsor({ ...c, fields: fieldsB })),
    ]);
    const bRows = bChunks.flat();

    const chunkSizes = bChunks.map((c, i) => ({
      window: `${periodBChunks[i].from}..${periodBChunks[i].to}`,
      rows: c.length,
    }));

    if (aRows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "Windsor returned 0 rows for April 2026 — check date_from/date_to and key.",
        chunkSizes,
      }, { status: 502 });
    }
    if (bRows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "Windsor returned 0 rows for any 2025/Q1-2026 chunk — check Windsor connector.",
        chunkSizes,
      }, { status: 502 });
    }

    // Surface near-cap chunks so we know if we're losing data silently.
    const NEAR_CAP = 49000;
    const overcapChunks = chunkSizes.filter((c) => c.rows >= NEAR_CAP);

    // Aggregate.
    const aOrders = aggregateOrders(aRows);
    const bOrders = aggregateOrders(bRows); // only used for prior-date lookup

    // Collect Apr 2026 orders that count: net > 0 (live, non-cancelled).
    const aLive = aOrders.filter((o) => o.net > 0 && o.order_created_at);

    // Build per-customer "most recent prior order" map from period B.
    // We DON'T require net > 0 here — even cancelled-then-rebooked orders
    // signal the customer was active in that period. Use any order date.
    const priorByCust = new Map(); // custKey -> { date, order_name, order_id }
    for (const o of bOrders) {
      const key = customerKey(o);
      if (!key) continue;
      const d = dayStr(o.order_created_at);
      if (!d) continue;
      const prev = priorByCust.get(key);
      if (!prev || d > prev.date) {
        priorByCust.set(key, { date: d, order_name: o.order_name || null, order_id: String(o.order_id) });
      }
    }

    // Walk Apr 2026 orders, classify, qualify.
    const rows = [];
    let totalNet = 0;
    let totalDays = 0;
    const qualifyingCusts = new Set();

    for (const o of aLive) {
      const key = customerKey(o);
      if (!key) continue;
      const prior = priorByCust.get(key);
      if (!prior) continue; // no prior order in 2025-Q1'26 window — skip (per spec)
      // most recent prior must be in 2025
      if (!(prior.date >= "2025-01-01" && prior.date <= "2025-12-31")) continue;

      const { channel, rep } = classifyOrderChannel(o);
      const aprDay = dayStr(o.order_created_at);
      const days = Math.round(
        (new Date(aprDay + "T00:00:00Z").getTime() -
          new Date(prior.date + "T00:00:00Z").getTime()) / DAY_MS
      );

      const names = customerDisplayName(o);
      // Channel-aware customer name pick:
      let displayName;
      if (channel === "B2B" || channel === "ADCS") {
        displayName = names.company || names.person || (o.order_email || "").toLowerCase();
      } else {
        displayName = names.person || names.company || (o.order_email || "").toLowerCase();
      }

      qualifyingCusts.add(key);
      totalNet += o.net;
      totalDays += days;

      rows.push({
        orderName: o.order_name || `#${o.order_id}`,
        customerName: displayName,
        rep: rep || "",
        orderDate: aprDay,
        netSales: Math.round(o.net * 100) / 100,
        channel,
        daysSincePrior: days,
        priorOrderDate: prior.date,
        priorOrderName: prior.order_name || `#${prior.order_id}`,
        // diagnostics
        _email: (o.order_email || "").toLowerCase(),
        _customerId: o.order_customer_id || null,
      });
    }

    // Sort: rep, then customer, then date.
    rows.sort((a, b) => {
      if (a.rep !== b.rep) return (a.rep || "zzz").localeCompare(b.rep || "zzz");
      if (a.customerName !== b.customerName)
        return (a.customerName || "").localeCompare(b.customerName || "");
      return a.orderDate.localeCompare(b.orderDate);
    });

    const summary = {
      totalReactivatedCustomers: qualifyingCusts.size,
      totalReactivationOrders: rows.length,
      totalReactivationNet: Math.round(totalNet * 100) / 100,
      averageDaysLapsed: rows.length ? Math.round(totalDays / rows.length) : 0,
    };

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      windows: {
        periodA: { from: "2026-04-01", to: "2026-04-30" },
        periodB: { from: "2025-01-01", to: "2026-03-31" },
      },
      counts: {
        periodARawRows: aRows.length,
        periodBRawRowsTotal: bRows.length,
        periodBChunkSizes: chunkSizes,
        periodAUniqueOrders: aOrders.length,
        periodBUniqueOrders: bOrders.length,
        priorCustomersIndexed: priorByCust.size,
        nearCapChunks: overcapChunks,
      },
      summary,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
