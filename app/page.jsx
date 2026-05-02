import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";
import Dashboard from "@/components/Dashboard.jsx";

export const dynamic = "force-dynamic";
export const revalidate = 300;

async function loadInitial() {
  try {
    // Default to last_3m for fast initial render — user can switch to last_year/2years
    const rows = await fetchWindsorRows({ preset: "last_3m" });
    return { ok: true, data: buildDashboardData(rows) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <Dashboard initial={initial} />;
}
