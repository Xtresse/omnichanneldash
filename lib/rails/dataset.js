// Dataset loader — wraps the Windsor + budget fetchers behind a single
// memoized entry point. Every rail gets its data through here, which means
// one Windsor pull per (period, request) instead of N pulls when Claude
// chains tool calls.
//
// Cache key is the resolved {from, to} window. Per-request memoization
// lives on a WeakMap keyed by an opaque `ctx` token the API route passes
// in; cross-request caching is left to Next's fetch revalidate (5 min)
// inside fetchWindsorRows.

import {
  fetchWindsorRows,
  fetchWindsorAllTimeLight,
  buildDashboardData,
  buildCompareSnapshot,
} from "@/lib/windsor.js";
import { loadBudgetAndGoals } from "@/lib/budgetSheet.js";
import { compareWindow } from "./period.js";

const memo = new WeakMap();

function bag(ctx) {
  if (!memo.has(ctx)) memo.set(ctx, new Map());
  return memo.get(ctx);
}

/**
 * Load and cache the dashboard slice for a resolved period.
 * Returns the same shape as buildDashboardData() so all existing
 * downstream code keeps working.
 */
export async function loadPeriod(ctx, period) {
  const key = `period:${period.from}:${period.to}`;
  const cache = bag(ctx);
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const [rows, allTime] = await Promise.all([
      fetchWindsorRows({ from: period.from, to: period.to }),
      fetchWindsorAllTimeLight(),
    ]);
    return buildDashboardData(rows, { from: period.from, to: period.to }, allTime);
  })();
  cache.set(key, promise);
  return promise;
}

/** Same as loadPeriod but returns the slimmer compare snapshot shape. */
export async function loadCompare(ctx, period, mode = "prior") {
  const win = compareWindow(period, mode);
  const key = `compare:${win.from}:${win.to}`;
  const cache = bag(ctx);
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const rows = await fetchWindsorRows({ from: win.from, to: win.to });
    const snap = buildCompareSnapshot(rows, { from: win.from, to: win.to });
    return { ...snap, window: win };
  })();
  cache.set(key, promise);
  return promise;
}

export async function loadBudget(ctx) {
  const key = "budget";
  const cache = bag(ctx);
  if (cache.has(key)) return cache.get(key);
  const promise = loadBudgetAndGoals();
  cache.set(key, promise);
  return promise;
}

/** Opaque token for per-request memoization. */
export function newRequestCtx() {
  return { __ctx: true };
}
