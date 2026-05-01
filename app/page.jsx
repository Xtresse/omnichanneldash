import Dashboard from "@/components/Dashboard.jsx";
import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";

export const dynamic = "force-dynamic";
export const revalidate = 300;

async function loadInitial() {
  try {
    const rows = await fetchWindsorRows("last_2years");
    return { ok: true, data: buildDashboardData(rows) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export default async function Page() {
  const initial = await loadInitial();
  return <Dashboard initial={initial} />;
}
