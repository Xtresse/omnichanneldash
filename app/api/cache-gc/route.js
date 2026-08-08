// /api/cache-gc — reclaim KV space taken by cache keys that outlived their use.
//
// Why this exists (2026-08-08): dataCache wrote every key with no Redis
// expiry. Freshness was governed by an embedded timestamp, so entries LOOKED
// like they expired while the bytes stayed forever. Every distinct date range
// anyone ever picked left a permanent multi-hundred-KB key behind. The Upstash
// DB hit its 256 MiB quota and every write began failing — /api/warm reported
// warmed 0/13 while looking otherwise healthy.
//
// Writes now carry a real EX, so this is a one-off cleanup for the backlog
// plus a safety valve if it ever creeps again.
//
// Deletes ONLY derived cache entries (dash: / lb: / rows: / alltime), never
// anything else in the store, and only when older than `olderThanH`.
// Behind the dashboard password — not a public path.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PREFIXES = ["dash:v", "lb:v", "hm:v", "rows:v", "live:v"];
const DEFAULT_OLDER_THAN_H = 24;

export async function GET(request) {
  const url = new URL(request.url);
  const olderThanH = Number(url.searchParams.get("olderThanH") || DEFAULT_OLDER_THAN_H);
  const apply = url.searchParams.get("apply") === "1"; // dry-run unless set
  const cutoff = Date.now() - olderThanH * 3600 * 1000;

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 500 });
  }

  const { kv } = await import("@vercel/kv");

  const scanned = [];
  let cursor = 0;
  // SCAN in pages so a large keyspace doesn't blow the request.
  do {
    const [next, keys] = await kv.scan(cursor, { count: 500 });
    cursor = Number(next);
    for (const k of keys) {
      if (PREFIXES.some((p) => k.startsWith(p))) scanned.push(k);
    }
  } while (cursor !== 0 && scanned.length < 20000);

  // A `#part` key holds no timestamp of its own — its fate follows its
  // manifest, so decide on manifests and take parts with them.
  const manifests = scanned.filter((k) => !k.includes("#"));
  const partsByBase = new Map();
  for (const k of scanned) {
    const i = k.indexOf("#");
    if (i === -1) continue;
    const base = k.slice(0, i);
    if (!partsByBase.has(base)) partsByBase.set(base, []);
    partsByBase.get(base).push(k);
  }

  const doomed = [];
  let kept = 0;
  for (const key of manifests) {
    let env = null;
    try {
      env = await kv.get(key);
    } catch {
      /* unreadable → treat as garbage */
    }
    const at = typeof env?.at === "number" ? env.at : null;
    if (at === null || at < cutoff) {
      doomed.push(key, ...(partsByBase.get(key) || []));
    } else {
      kept++;
    }
  }

  // Orphaned parts whose manifest is already gone.
  for (const [base, parts] of partsByBase) {
    if (!manifests.includes(base)) doomed.push(...parts);
  }

  let deleted = 0;
  if (apply && doomed.length) {
    for (let i = 0; i < doomed.length; i += 100) {
      const batch = doomed.slice(i, i + 100);
      try {
        await kv.del(...batch);
        deleted += batch.length;
      } catch {
        /* keep going; a failed batch just stays until the next run */
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: !apply,
    olderThanH,
    scannedCacheKeys: scanned.length,
    manifests: manifests.length,
    kept,
    candidates: doomed.length,
    deleted,
    sample: doomed.slice(0, 10),
  });
}
