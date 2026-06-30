import {
  fetchWindsorRows,
  buildDashboardData,
} from "@/lib/windsor.js";
import { fetchAllTimeRowsCached } from "@/lib/allTimeCache.js";
import Dashboard from "@/components/Dashboard.jsx";
export const maxDuration = 60; // ~11s cold Shopify all-time pull, cached after

// 5-minute ISR cache on the initial SSR data. Client-side fetches go through
// /api/dashboard which has its own cache.
export const revalidate = 300;

// Default preset = Today, anchored to the SHOP timezone (Pacific,
// America/Los_Angeles) so it matches how xtresseCore buckets orders
// (shopLocalDate). We compute from/to here so the SSR fetch and the
// client-side preset highlight stay in sync. (Old toISOString() basis rolled
// the day forward in the late-afternoon PT; Pacific keeps it correct to
// midnight Pacific.)
const SHOP_TZ = "America/Los_Angeles";
function shopToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function todayRange() {
  const d = shopToday();
  return { from: d, to: d };
}

async function loadInitial() {
  const { from, to } = todayRange();
  try {
    // Fetch period data + all-time history in parallel. The all-time pull
    // is cached separately (1h) so it doesn't slow per-window loads after
    // the first warm-up.
    const [rows, allTimeRows] = await Promise.all([
      fetchWindsorRows({ from, to }),
      fetchAllTimeRowsCached(),
    ]);
    return {
      ok: true,
      data: buildDashboardData(rows, { from, to }, allTimeRows),
      defaults: { preset: "today", from, to },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <Dashboard initial={initial} />;
}
