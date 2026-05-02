import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";
import Dashboard from "@/components/Dashboard.jsx";

// 5-minute ISR cache on the initial SSR data. Client-side fetches go through
// /api/dashboard which has its own cache.
export const revalidate = 300;

// Default preset = MTD (matches leadership-dash default). We compute the
// from/to here so the SSR fetch and the client-side preset highlight stay
// in sync.
function mtdRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const ymd = (d) => d.toISOString().slice(0, 10);
  return { from: ymd(start), to: ymd(now) };
}

async function loadInitial() {
  const { from, to } = mtdRange();
  try {
    const rows = await fetchWindsorRows({ from, to });
    return {
      ok: true,
      data: buildDashboardData(rows, { from, to }),
      defaults: { preset: "mtd", from, to },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <Dashboard initial={initial} />;
}
