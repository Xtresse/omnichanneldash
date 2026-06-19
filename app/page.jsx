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

// Default preset = TODAY (2026-06, Sam). The single-day window is tiny and is
// pre-warmed by the cron, so the dashboard opens instantly. We compute the
// from/to in EASTERN TIME — identical to the "Today" quick-pick in FilterBar
// (the business runs on ET; toISOString() would roll the date forward after
// ~8pm ET) — so the SSR window, the client highlight, and the cron-warmed KV
// entry all line up on the same day.
function todayRange() {
  const et = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // → "YYYY-MM-DD" in ET
  return { from: et, to: et };
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
