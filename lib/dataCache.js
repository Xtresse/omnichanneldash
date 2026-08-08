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

// Upstash's REST API rejects oversized request BODIES, so no single KV value
// may exceed ~1 MB serialized. That ceiling used to mean "give up and never
// cache" for anything bigger.
//
// 2026-08-08 incident: the YTD dashboard payload grew past it as the year
// filled up (6.75 MB raw → 0.91 MB gzip → 1.23 MB base64 envelope). Every YTD
// write silently returned {skipped:"too-large"}, so YTD stopped caching
// entirely and every request — including the /api/warm cron's, every 10
// minutes — became a full ~60 s uncached recompute. CPU went ~4×.
//
// Fix: values that don't fit are SPLIT across numbered part keys with a small
// manifest at the primary key. Nothing about the cached payload changes; only
// how it's stored. This scales with the calendar instead of falling off a
// cliff again in November.
const MAX_CACHE_BYTES = 1_000_000; // ~1 MB per-value request-body ceiling
// Payload bytes per part, leaving headroom for JSON/protocol overhead.
const CHUNK_BYTES = 700_000;
// Backstop so a runaway payload can't write hundreds of keys. 24 parts of
// gzip ≈ 16 MB compressed ≈ >100 MB raw — far beyond any real window.
const MAX_CHUNKS = 24;

const mem = new Map();

// Lazy import so local dev without the package/env doesn't crash at load.
let _kv = null;
async function kvClient() {
  if (_kv) return _kv;
  const mod = await import("@vercel/kv");
  _kv = mod.kv;
  return _kv;
}

// Wrapper stored in KV, one of two shapes:
//   single  { at, z }              — base64 gzip of JSON.stringify(data)
//   chunked { at, parts: <n> }     — manifest; body lives at `${key}#0..#n-1`
// `at` stays uncompressed on both so the TTL check is cheap (no decompress,
// and for a chunked entry no part reads at all, on a stale/miss).
function encodeEnvelope(data) {
  const z = gzipSync(Buffer.from(JSON.stringify(data))).toString("base64");
  return { at: Date.now(), z };
}

/** Read one raw wrapper (no TTL check, no part assembly). */
async function readRaw(key) {
  if (HAS_KV) {
    const kv = await kvClient();
    return await kv.get(key);
  }
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

async function writeRaw(key, value) {
  if (HAS_KV) {
    const kv = await kvClient();
    await kv.set(key, value);
  } else {
    mem.set(key, JSON.stringify(value));
  }
}

const partKey = (key, i) => `${key}#${i}`;

/**
 * Resolve a wrapper into { data, at }, fetching and reassembling parts when
 * the entry is chunked. TTL is checked BEFORE any part read so an expired
 * chunked entry costs exactly one KV get.
 */
async function decodeEnvelope(env, ttlMs, key) {
  if (!env || typeof env.at !== "number") return null;
  if (Date.now() - env.at > ttlMs) return null;

  let b64;
  if (typeof env.z === "string") {
    b64 = env.z;
  } else if (Number.isInteger(env.parts) && env.parts > 0) {
    if (!key) return null;
    // Parts are independent keys — fetch them concurrently, not serially.
    const parts = await Promise.all(
      Array.from({ length: env.parts }, (_, i) => readRaw(partKey(key, i)))
    );
    // A missing/evicted part makes the entry unusable — treat as a miss so the
    // caller recomputes rather than gunzipping a truncated body.
    if (parts.some((p) => !p || typeof p.s !== "string")) return null;
    b64 = parts.map((p) => p.s).join("");
  } else {
    return null;
  }

  try {
    const json = gunzipSync(Buffer.from(b64, "base64")).toString();
    return { data: JSON.parse(json), at: env.at };
  } catch {
    return null; // corrupt/partial body → miss, never a throw
  }
}

// Low-level read of the stored wrapper, regardless of age. Returns
// { data, at } or null. The caller decides fresh/stale/expired — this is what
// the stale-while-revalidate path in /api/dashboard uses so it can serve a
// slightly-stale payload instantly and refresh in the background.
export async function getCachedEntry(key) {
  try {
    const env = await readRaw(key);
    return await decodeEnvelope(env, Infinity, key); // Infinity → never expires on read
  } catch {
    return null;
  }
}

// Return cached payload if present AND fresher than ttlMs; else null.
// Never throws — a cache miss/KV error just falls through to a live compute.
export async function getCachedData(key, ttlMs) {
  try {
    const env = await readRaw(key);
    return await decodeEnvelope(env, ttlMs, key);
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
    bytes = Buffer.byteLength(JSON.stringify(env)); // what would hit KV as one value

    // Fits in a single value → store exactly as before.
    if (bytes <= MAX_CACHE_BYTES) {
      await writeRaw(key, env);
      return { ok: true, bytes, rawBytes, parts: 1 };
    }

    // Too big for one value → split the base64 body across part keys and store
    // a manifest at the primary key. Parts go first so a reader that finds the
    // manifest always finds a complete body behind it.
    const b64 = env.z;
    const parts = Math.ceil(b64.length / CHUNK_BYTES);
    if (parts > MAX_CHUNKS) {
      return {
        ok: false,
        skipped: true,
        reason: "too-large",
        bytes,
        rawBytes,
        parts,
        maxChunks: MAX_CHUNKS,
      };
    }
    const slices = Array.from({ length: parts }, (_, i) =>
      b64.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    );
    await Promise.all(slices.map((s, i) => writeRaw(partKey(key, i), { s })));
    await writeRaw(key, { at: env.at, parts });
    return { ok: true, bytes, rawBytes, parts, chunked: true };
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
