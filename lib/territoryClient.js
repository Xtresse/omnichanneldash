/**
 * Client for Sales-Rep-Dashboards' /api/territory-export — the single source
 * of truth for rep territory (TERRITORY_OVERRIDES, FENCED_ACCOUNTS, order-tag
 * inference all live there; this app never re-implements that logic, only
 * reads its output). See lib/territoryStore.js for what happens to the result.
 *
 * Env: TERRITORY_SOURCE_URL (e.g. https://sales-rep-dashboards.vercel.app),
 *      TERRITORY_SOURCE_TOKEN (matches TERRITORY_EXPORT_TOKEN over there).
 */

const TIMEOUT_MS = 20000;

export function territoryClientConfigured() {
  return !!(process.env.TERRITORY_SOURCE_URL && process.env.TERRITORY_SOURCE_TOKEN);
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`territory-export failed (${r.status}): ${text.slice(0, 300)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the live territory map, one retry on transient failure. */
export async function fetchTerritoryExport() {
  if (!territoryClientConfigured()) {
    throw new Error("Territory source not configured (set TERRITORY_SOURCE_URL / TERRITORY_SOURCE_TOKEN).");
  }
  const base = process.env.TERRITORY_SOURCE_URL.replace(/\/$/, "");
  const url = `${base}/api/territory-export?token=${encodeURIComponent(process.env.TERRITORY_SOURCE_TOKEN)}`;
  try {
    return await fetchOnce(url);
  } catch (e) {
    await new Promise((res) => setTimeout(res, 1500));
    return await fetchOnce(url); // let this one throw if it fails too
  }
}
