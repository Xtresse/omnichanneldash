#!/usr/bin/env node
// scripts/materialize-history.mjs
//
// Freeze CLOSED-quarter order history into data/history-base.json so the omni
// dashboard reads two years of unchanging orders from a committed file instead
// of re-pulling them from Shopify on every cold render (and instead of leaning
// on the KV all-time cache, which evicts closed quarters and pays ~37s on the
// next cold rebuild). Run when a quarter closes, then commit the file.
//
//   node --env-file=.env.local scripts/materialize-history.mjs           # (re)generate closed quarters
//   node --env-file=.env.local scripts/materialize-history.mjs --verify  # compare a fresh pull to the file, no write
//
// Env: same Shopify creds lib/xtresseCore.js uses (SHOPIFY_CLIENT_ID/SECRET or
// SHOPIFY_ADMIN_API_TOKEN / XVIE_INTERNAL_* in .env.local). The OPEN (current)
// quarter is intentionally left out — it still fetches live in lib/historyRows.js.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { fetchShopifyRows } from "../lib/xtresseCore.js";
import { quarterWindows } from "../lib/historyRows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "data", "history-base.json");
const VERIFY = process.argv.includes("--verify");

const zip = (rows) => zlib.gzipSync(Buffer.from(JSON.stringify(rows))).toString("base64");
const unzip = (z) => JSON.parse(zlib.gunzipSync(Buffer.from(z, "base64")).toString());

// Order-independent multiset comparison: sort a canonical serialization of each
// row and compare. Equal sorted arrays ⇒ identical row multiset ⇒ identical
// aggregateOrders/buildDashboardData output (deterministic pure functions of
// the rows).
function sameRowMultiset(a, b) {
  if (a.length !== b.length) return { ok: false, reason: `count ${a.length} vs ${b.length}` };
  const sa = a.map((r) => JSON.stringify(r)).sort();
  const sb = b.map((r) => JSON.stringify(r)).sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) {
      return {
        ok: false,
        reason: `row ${i} differs:\n  file: ${sa[i].slice(0, 200)}\n  live: ${sb[i].slice(0, 200)}`,
      };
    }
  }
  return { ok: true };
}

async function main() {
  // Only fully-closed quarters get frozen; the open quarter stays live.
  const closed = quarterWindows().filter((w) => w.closed);
  console.log(`Closed quarters to freeze (open quarter skipped): ${closed.map((w) => w.key).join(", ")}`);

  if (VERIFY) {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    let ok = 0, bad = 0;
    for (const w of closed) {
      const live = await fetchShopifyRows({ from: w.from, to: w.to });
      const have = existing[w.key] ? unzip(existing[w.key].z) : null;
      if (!have) { console.log(`  ${w.key}: MISSING from file (live ${live.length})`); bad++; continue; }
      const cmp = sameRowMultiset(have, live);
      console.log(`  ${w.key} ${w.from}→${w.to}: file ${have.length} vs live ${live.length} — ${cmp.ok ? "OK" : "MISMATCH: " + cmp.reason}`);
      cmp.ok ? ok++ : bad++;
    }
    console.log(`\nVerify: ${ok} ok, ${bad} mismatched.`);
    process.exit(bad ? 1 : 0);
  }

  const out = {};
  let total = 0;
  for (const w of closed) {
    const t0 = Date.now();
    const rows = await fetchShopifyRows({ from: w.from, to: w.to });
    const z = zip(rows);
    out[w.key] = { z };
    total += rows.length;
    console.log(`  ${w.key} ${w.from}→${w.to}: ${rows.length} rows, ${(z.length / 1048576).toFixed(2)}MB gz-b64, ${Date.now() - t0}ms`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const sizeMB = fs.statSync(OUT).size / 1048576;
  console.log(`\nWrote ${OUT} — ${closed.length} quarters, ${total} rows, ${sizeMB.toFixed(2)}MB on disk.`);
}

main().catch((e) => { console.error("materialize-history failed:", e?.message || e); process.exit(1); });
