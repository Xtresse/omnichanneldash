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
//  - TTL is enforced via an embedded timestamp (the KV `set` we use has no
//    native EX wired here), so this works identically in the in-memory dev
//    fallback.
//  - Encoding: we use the official @vercel/kv client (the same one
//    /api/b2b-goals uses in prod). kv.set serializes the value and kv.get
//    deserializes it — ONE consistent encoding on both sides. The previous
//    hand-rolled fetch double-encoded the body (JSON.stringify of an already-
//    stringified envelope) but only decoded once, so every read missed.
//  - Does NOT touch lib/xtresseCore.js (byte-identical across dashboards).

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HAS_KV = Boolean(KV_URL && KV_TOKEN);

export const DATA_CACHE_MODE = HAS_KV ? "kv" : "memory";

// Skip caching payloads larger than this (serialized bytes). Upstash's REST
// API rejects oversized request bodies; a silent write failure there is what
// made large windows (e.g. 90-day) look like they "never cache". We detect it
// up front and just serve live instead of attempting a doomed write.
const MAX_CACHE_BYTES = 900_000; // ~900 KB, comfortably under the ~1 MB limit

const mem = new Map();

// Lazy import so local dev without the package/env doesn't crash at load.
let _kv = null;
async function kvClient() {
  if (_kv) return _kv;
  const mod = await import("@vercel/kv");
  _kv = mod.kv;
  return _kv;
}

// Return cached payload if present AND fresher than ttlMs; else null.
// Never throws — a cache miss/KV error just falls through to a live compute.
export async function getCachedData(key, ttlMs) {
  try {
    let env;
    if (HAS_KV) {
      const kv = await kvClient();
      env = await kv.get(key); // auto-deserialized → object | null
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

// Persist payload with a timestamp. Never throws. Returns a small status object
// ({ ok, bytes, skipped?, error? }) so callers / the debug route can see write
// failures that would otherwise be swallowed.
export async function setCachedData(key, data) {
  const env = { at: Date.now(), data };
  let bytes = 0;
  try {
    bytes = JSON.stringify(env).length;
    if (bytes > MAX_CACHE_BYTES) {
      return { ok: false, skipped: true, reason: "too-large", bytes };
    }
    if (HAS_KV) {
      const kv = await kvClient();
      await kv.set(key, env); // kv serializes the object for us
    } else {
      mem.set(key, JSON.stringify(env));
    }
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), bytes };
  }
}

// Write-then-read round-trip against the real cache path, for /api/cache-debug.
// Returns the truth about whether KV actually persists on this deployment.
export async function cacheSelfTest() {
  const key = `cache-debug:${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;
  const sample = { hello: "world", n: 42, nested: { a: [1, 2, 3], b: "✓" } };
  const out = {
    mode: DATA_CACHE_MODE,
    hasKv: HAS_KV,
    key,
    wrote: false,
    writeStatus: null,
    readBack: null,
    equal: false,
    error: null,
  };
  try {
    out.writeStatus = await setCachedData(key, sample);
    out.wrote = !!out.writeStatus?.ok;
    const got = await getCachedData(key, 60_000);
    out.readBack = got?.data ?? null;
    out.equal = JSON.stringify(out.readBack) === JSON.stringify(sample);
    // best-effort cleanup so the probe key doesn't linger
    if (HAS_KV) {
      try { const kv = await kvClient(); await kv.del(key); } catch { /* ignore */ }
    } else {
      mem.delete(key);
    }
  } catch (e) {
    out.error = String(e?.message || e);
  }
  return out;
}
