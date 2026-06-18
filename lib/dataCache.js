// Shared, cross-instance cache for the (expensive) aggregated dashboard
// payload. The Shopify pull + buildDashboardData is ~11s cold; Next's
// per-URL route cache only lives inside ONE serverless instance's memory
// and expires fast, so clicking between date windows / granularities keeps
// hitting cold instances. This persists the SMALL aggregated result JSON in
// Vercel KV (same store used by /api/b2b-goals) keyed by the full query
// signature, so any instance serves a warm copy instantly.
//
// Notes:
//  - We cache the OUTPUT (KPIs + timeseries + rep table), never the raw order
//    rows. Even so the aggregated payload is large — ~1.35 MB for a 2-week
//    window, ~3 MB for 90 days — which is OVER Upstash's ~1 MB REST request
//    limit. So we GZIP the JSON before storing (this data compresses ~5–10×),
//    keeping typical windows comfortably under the limit. base64 of the gzip
//    is stored on a wrapper object; a size guard skips anything still too big.
//  - TTL is enforced via an embedded timestamp (the KV `set` we use has no
//    native EX wired here), so this works identically in the in-memory dev
//    fallback.
//  - Encoding: we use the official @vercel/kv client (the same one
//    /api/b2b-goals uses in prod). kv.set serializes the wrapper and kv.get
//    deserializes it — ONE consistent encoding on both sides. The previous
//    hand-rolled fetch double-encoded the body (JSON.stringify of an already-
//    stringified envelope) but only decoded once, so every read missed; and it
//    swallowed the oversized-body write failure that hid the size problem.
//  - Does NOT touch lib/xtresseCore.js (byte-identical across dashboards).

import { gzipSync, gunzipSync } from "node:zlib";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HAS_KV = Boolean(KV_URL && KV_TOKEN);

export const DATA_CACHE_MODE = HAS_KV ? "kv" : "memory";

// Skip caching when even the COMPRESSED wrapper would exceed this (serialized
// bytes). Upstash's REST API rejects oversized request bodies — a silent write
// failure there is what made large windows look like they "never cache". We
// detect it up front and just serve live instead of attempting a doomed write.
const MAX_CACHE_BYTES = 1_000_000; // ~1 MB request-body ceiling

const mem = new Map();

// Lazy import so local dev without the package/env doesn't crash at load.
let _kv = null;
async function kvClient() {
  if (_kv) return _kv;
  const mod = await import("@vercel/kv");
  _kv = mod.kv;
  return _kv;
}

// Wrapper stored in KV: { at: <ms>, z: <base64 gzip of JSON.stringify(data)> }.
// `at` stays uncompressed so the TTL check is cheap (no decompress on a miss).
function encodeEnvelope(data) {
  const z = gzipSync(Buffer.from(JSON.stringify(data))).toString("base64");
  return { at: Date.now(), z };
}
function decodeEnvelope(env, ttlMs) {
  if (!env || typeof env.at !== "number" || typeof env.z !== "string") return null;
  if (Date.now() - env.at > ttlMs) return null;
  const json = gunzipSync(Buffer.from(env.z, "base64")).toString();
  return { data: JSON.parse(json), at: env.at };
}

// Low-level read of the stored wrapper, regardless of age. Returns
// { data, at } or null. The caller decides fresh/stale/expired — this is what
// the stale-while-revalidate path in /api/dashboard uses so it can serve a
// slightly-stale payload instantly and refresh in the background.
export async function getCachedEntry(key) {
  try {
    let env;
    if (HAS_KV) {
      const kv = await kvClient();
      env = await kv.get(key); // auto-deserialized → wrapper object | null
    } else {
      env = mem.has(key) ? JSON.parse(mem.get(key)) : null;
    }
    return decodeEnvelope(env, Infinity); // Infinity ttl → never expires on read
  } catch {
    return null;
  }
}

// Return cached payload if present AND fresher than ttlMs; else null.
// Never throws — a cache miss/KV error just falls through to a live compute.
export async function getCachedData(key, ttlMs) {
  try {
    let env;
    if (HAS_KV) {
      const kv = await kvClient();
      env = await kv.get(key); // auto-deserialized → wrapper object | null
    } else {
      env = mem.has(key) ? JSON.parse(mem.get(key)) : null;
    }
    return decodeEnvelope(env, ttlMs);
  } catch {
    return null;
  }
}

// Persist payload with a timestamp. Never throws. Returns a small status object
// ({ ok, bytes, rawBytes, skipped?, error? }) so callers / the debug route can
// see write failures (and the compression ratio) that were swallowed before.
export async function setCachedData(key, data) {
  let bytes = 0;
  let rawBytes = 0;
  try {
    const env = encodeEnvelope(data);
    rawBytes = Buffer.byteLength(JSON.stringify(data));
    bytes = Buffer.byteLength(JSON.stringify(env)); // what actually hits KV
    if (bytes > MAX_CACHE_BYTES) {
      return { ok: false, skipped: true, reason: "too-large", bytes, rawBytes };
    }
    if (HAS_KV) {
      const kv = await kvClient();
      await kv.set(key, env); // kv serializes the wrapper object for us
    } else {
      mem.set(key, JSON.stringify(env));
    }
    return { ok: true, bytes, rawBytes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), bytes, rawBytes };
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
