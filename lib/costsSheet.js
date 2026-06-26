/**
 * Google Sheets reader for COGS + Merchant Fees + Fulfillment — the cost side
 * of the margin/contribution view. Same workbook + auth as lib/budgetSheet.js.
 *
 * THREE tabs:
 *   "COGS"          — SKU | Product | Description | Unit Cost | Notes
 *                     (per-unit cost; the dashboard multiplies by NET units sold)
 *   "Merchant Fees" — Month | Merchant Fees | Sales Base | Notes
 *                     (actual Shopify processing fees per month; Sales Base lets
 *                      us derive an effective fee % applied to any window)
 *   "Fulfillment"   — Month | Provider | Shipments | Total Cost | Notes
 *                     (actual ShipBob/3PL spend per month → blended cost/order)
 *
 * Returns:
 *   {
 *     mode: "live" | "stub",
 *     cogsBySku:    { [sku]: unitCost },
 *     merchantFees: { [month]: usd },
 *     salesBase:    { [month]: usd },          // optional, for fee-rate derivation
 *     fulfillment:  { [month]: { shipments, cost } },
 *     effective: { feeRate, costPerOrder },    // blended from all actuals; null if N/A
 *   }
 *
 * WIRING (env, same pattern as budgetSheet): published-CSV per tab —
 *   BUDGET_CSV_URL_COGS, BUDGET_CSV_URL_FEES, BUDGET_CSV_URL_FULFILLMENT
 * or the GOOGLE_SHEETS_SA_* service account (reads COGS!A:E, Merchant Fees!A:D,
 * Fulfillment!A:E). Until wired this returns stub (empty) and the dashboard
 * falls back to the lib/cogs.js placeholder COGS with no fees/fulfillment line.
 */

import { fetchCsvTab, fetchViaServiceAccount } from "./budgetSheet.js";

function num(v) {
  const n = Number(String(v ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function canonMonth(s) {
  const v = String(s || "").trim();
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 7);
  return null;
}
function makeFindCol(header) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[_\s]/g, "");
  return (...needles) => {
    for (const n of needles) {
      const ix = header.findIndex((h) => norm(h).includes(norm(n)));
      if (ix >= 0) return ix;
    }
    return -1;
  };
}

function shape(cogsRaw, feesRaw, fulfRaw, mode) {
  const cogsBySku = {};
  if (cogsRaw && cogsRaw.length > 1) {
    const find = makeFindCol(cogsRaw[0]);
    const si = find("sku");
    const ci = find("unitcost", "cost");
    for (let r = 1; r < cogsRaw.length; r++) {
      const row = cogsRaw[r];
      const sku = String(row?.[si] || "").trim();
      const cost = num(row?.[ci]);
      if (sku) cogsBySku[sku] = cost;
    }
  }

  const merchantFees = {};
  const salesBase = {};
  if (feesRaw && feesRaw.length > 1) {
    const find = makeFindCol(feesRaw[0]);
    const mi = find("month");
    const fi = find("fee", "merchant");
    const bi = find("base", "salesbase", "volume", "sales");
    for (let r = 1; r < feesRaw.length; r++) {
      const row = feesRaw[r];
      const m = canonMonth(row?.[mi]);
      if (!m) continue;
      merchantFees[m] = (merchantFees[m] || 0) + num(row?.[fi]);
      if (bi >= 0) salesBase[m] = (salesBase[m] || 0) + num(row?.[bi]);
    }
  }

  const fulfillment = {};
  if (fulfRaw && fulfRaw.length > 1) {
    const find = makeFindCol(fulfRaw[0]);
    const mi = find("month");
    const shi = find("shipment", "orders");
    const cti = find("totalcost", "cost", "spend");
    for (let r = 1; r < fulfRaw.length; r++) {
      const row = fulfRaw[r];
      const m = canonMonth(row?.[mi]);
      if (!m) continue;
      fulfillment[m] = fulfillment[m] || { shipments: 0, cost: 0 };
      fulfillment[m].shipments += num(row?.[shi]);
      fulfillment[m].cost += num(row?.[cti]);
    }
  }

  // Blended effective rates across all actual months.
  let feeSum = 0, baseSum = 0, fulfCost = 0, fulfShip = 0;
  for (const m of Object.keys(merchantFees)) {
    feeSum += merchantFees[m];
    baseSum += salesBase[m] || 0;
  }
  for (const m of Object.keys(fulfillment)) {
    fulfCost += fulfillment[m].cost;
    fulfShip += fulfillment[m].shipments;
  }
  const effective = {
    feeRate: baseSum > 0 ? feeSum / baseSum : null,
    costPerOrder: fulfShip > 0 ? fulfCost / fulfShip : null,
  };

  return { mode, cogsBySku, merchantFees, salesBase, fulfillment, effective };
}

const STUB = {
  mode: "stub",
  cogsBySku: {},
  merchantFees: {},
  salesBase: {},
  fulfillment: {},
  effective: { feeRate: null, costPerOrder: null },
};

export async function loadCosts() {
  // CSV path
  const cogsCsv = await fetchCsvTab(process.env.BUDGET_CSV_URL_COGS);
  const feesCsv = await fetchCsvTab(process.env.BUDGET_CSV_URL_FEES);
  const fulfCsv = await fetchCsvTab(process.env.BUDGET_CSV_URL_FULFILLMENT);
  if (cogsCsv || feesCsv || fulfCsv) {
    return shape(cogsCsv, feesCsv, fulfCsv, "live");
  }

  // Service-account path
  const sa = await fetchViaServiceAccount(["COGS!A:E", "Merchant Fees!A:D", "Fulfillment!A:E"]);
  if (sa && Array.isArray(sa.valueRanges)) {
    const cogsRows = sa.valueRanges[0]?.values || [];
    const feesRows = sa.valueRanges[1]?.values || [];
    const fulfRows = sa.valueRanges[2]?.values || [];
    if (cogsRows.length > 1 || feesRows.length > 1 || fulfRows.length > 1) {
      return shape(cogsRows, feesRows, fulfRows, "live");
    }
  }

  return STUB;
}
