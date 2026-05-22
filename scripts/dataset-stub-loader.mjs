// Combined ESM loader: resolves @/ Next.js path aliases AND intercepts
// the dataset module so the scenario rails see a deterministic fake
// dashboard slice (no Windsor key needed).

import { fileURLToPath, pathToFileURL } from "url";
import { resolve as resolvePath, dirname } from "path";

const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_PATH = pathToFileURL(
  resolvePath(PROJECT_ROOT, "lib/rails/dataset.js")
).href;

// Resolve specifiers. We add two synthetic targets:
//   - `next/server`           — a tiny shim implementing NextResponse.json
//   - `@/...`                  — Next-style path alias
const NEXT_SERVER_URL = "stub:next-server";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return { url: NEXT_SERVER_URL, format: "module", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const abs = resolvePath(PROJECT_ROOT, rel);
    return nextResolve(pathToFileURL(abs).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === NEXT_SERVER_URL) {
    return {
      format: "module",
      shortCircuit: true,
      source: `
export const NextResponse = {
  json(body, init = {}) {
    const status = init.status || 200;
    return {
      status,
      headers: init.headers || {},
      async json() { return body; },
    };
  },
};
`,
    };
  }
  if (url === DATASET_PATH) {
    // Replace dataset.js with an in-memory stub. We export the same
    // surface area as the real module: loadPeriod, loadCompare,
    // loadBudget, newRequestCtx.
    const source = `
const FAKE = {
  granularity: "day",
  kpis: {
    totalNetSales: 200000, totalGrossSales: 220000, totalDiscounts: 18000,
    totalReturns: -2000, totalOrders: 320,
    b2bNetSales: 150000, b2bOrders: 200, b2bAOV: 750,
    adcsNetSales: 20000, adcsOrders: 30, adcsAOV: 667,
    dtcNetSales: 30000, dtcOrders: 90, dtcAOV: 333,
    b2bUntaggedNetSales: 0, b2bUntaggedOrders: 0,
    dtcSkuNetSales: 30000, dtcSkuOrders: 90,
    b2bShare: 0.75, adcsShare: 0.10, dtcShare: 0.15,
  },
  monthlySeries: [{ month: "2026-05", label: "May", B2B: 150000, ADCS: 20000, DTC: 30000, Total: 200000, B2B_orders: 200, ADCS_orders: 30, DTC_orders: 90, B2B_AOV: 750, DTC_AOV: 333 }],
  productFamily: [
    { family: "Gummies", B2B: 90000, ADCS: 10000, DTC: 15000 },
    { family: "Serum", B2B: 40000, ADCS: 5000, DTC: 10000 },
    { family: "XVIE", B2B: 15000, ADCS: 5000, DTC: 5000 },
    { family: "Sachets", B2B: 5000, ADCS: 0, DTC: 0 },
  ],
  b2bFocusByFamily: { Gummies: 80000, XVIE: 12000, Serum: 30000 },
  topSKUs: [{ sku: "860011740100", B2B: 70000, ADCS: 0, DTC: 0, Total: 70000 }],
  revenueByState: [{ state: "CA", B2B: 30000, ADCS: 0, DTC: 5000, Total: 35000 }],
  customerDynamics: [{ month: "2026-05", label: "May", B2B_new: 12, B2B_ret: 18, DTC_new: 25, DTC_ret: 65 }],
  repeatRate: [
    { month: "2026-04", label: "Apr", B2B: 60, DTC: 40 },
    { month: "2026-05", label: "May", B2B: 65, DTC: 45 },
  ],
  subVsOneTime: [{ month: "2026-05", label: "May", Subscription: 18000, OneTime: 12000 }],
  discountUsage: [],
  fulfillmentSplit: [],
  repPerformance: [
    { territory: "Existing", rows: [{ rep: "Jamie Bergeron", net: 35000, orders: 40, firstOrderGummy: 3, newAccounts: 3, productMix: {} }] },
    { territory: "New", rows: [] },
    { territory: "1099", rows: [] },
  ],
  repSalesMonthly: [],
  repNewAccountsMonthly: [
    { month: "2026-05", label: "May", "Jamie Bergeron": 3, "Amy Pierre": 6, "Megan Gilbert": 2 },
  ],
  repsList: ["Jamie Bergeron", "Amy Pierre", "Megan Gilbert"],
  orders: [{ id: "o1", date: "2026-05-12", channel: "B2B", net: 1200, rep: "Amy Pierre", state: "CA" }],
  reconciliation: { netSales: { kpiTotal: 200000, bucketSum: 200000, bucketDelta: 0 } },
};
globalThis.__STUB_CALLS = globalThis.__STUB_CALLS || { loadPeriod: [], loadCompare: [], loadBudget: 0 };
export async function loadPeriod(ctx, period) {
  globalThis.__STUB_CALLS.loadPeriod.push({ ...period });
  return JSON.parse(JSON.stringify(FAKE));
}
export async function loadCompare(ctx, period, mode = "prior") {
  globalThis.__STUB_CALLS.loadCompare.push({ ...period, mode });
  return { ...FAKE, window: { from: period.from, to: period.to, mode } };
}
export async function loadBudget() {
  globalThis.__STUB_CALLS.loadBudget += 1;
  return { mode: "stub", budget: {} };
}
export function newRequestCtx() { return { __ctx: true }; }
`;
    return { format: "module", shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
