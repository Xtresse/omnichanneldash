// Shared, cross-instance cache for the (expensive) aggregated dashboard
// payload. The Shopify pull + buildDashboardData is ~11s cold; Next's
// per-URL route cache only lives inside ONE serverless instance's memory
// and expires fast, so clicking between date windows / granularities keeps
// hitting cold instances. This persists the SMALL aggregated result JSON in
// Vercel KV (same store used by /api/b2b-goals) keyed by the full query
// signature, so any instance serves a warm copy instantly.
//
// Notes:
//  - We cache the OUTPUT (KPIs + small timeseries + rep table), never the raw
//    order rows, so values stay well under KV's value-size limit.
//  - TTL is enforced via an embedded timestamp (the KV REST `set` we use has
//    no native EX), so this works identically in the in-memory dev fallback.
//  - Does NOT touch lib/xtresseCore.js (byte-identical across dashboards).

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HAS_KV = Boolean(KV_URL && KV_TOKEN);

export const DATA_CACHE_MODE = HAS_KV ? "kv" : "memory";

const mem = new Map();

async function kvGetRaw(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.result ?? null;
}

async function kvSetRaw(key, value) {
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

// Return cached payload if present AND fresher than ttlMs; else null.
// Never throws — a cache miss/KV error just falls through to a live compute.
export async function getCachedData(key, ttlMs) {
  try {
    let env;
    if (HAS_KV) {
      const raw = await kvGetRaw(key);
      if (raw == null) return null;
      env = typeof raw === "string" ? JSON.parse(raw) : raw;
    } else {
      env = mem.has(key) ? JSON.parse(mem.get(key)) : null;
    }
    if (!env || typeof env.at !== "number") return null;
    if (Date.now() - env.at > ttlMs) return null;
    return { data: env.data, at: env.at };
  } catch {
    return null;
  }
}

// Persist payload with a timestamp. Never throws.
export async function setCachedData(key, data) {
  try {
    const env = JSON.stringify({ at: Date.now(), data });
    if (HAS_KV) await kvSetRaw(key, env);
    else mem.set(key, env);
  } catch {
    /* cache write is best-effort */
  }
}
