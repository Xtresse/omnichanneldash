#!/usr/bin/env node
// scripts/rep-cadence.mjs
//
// Plain-English rep NOTES for the omni "Rep Performance" group (what Mike sees):
// order cadence (who's back-loaded vs strong at month-start) and a low-output
// watch list. Answers the recurring "who's consistently quiet the first week?"
// question WITHOUT the trap of reading one week — it looks across the last 5
// COMPLETE months so a single slow start doesn't flag anyone.
//
//   node --env-file=.env.local scripts/rep-cadence.mjs
//
// Writes data/rep-cadence.json (committed; the RepNotes card imports it).
// Re-run monthly (same cadence as materialize-history / tradeshow-roi).
//
// Method (validated to the dollar against the Sep first-week screenshot):
//   • B2B only (classifyChannel), rep from order tags (findRep), net = subtotal − refunds.
//   • Per rep/month: week1 = days 1–7, full = whole month.
//   • Window = the 5 complete months before the current one.
// "Back-loaded" = healthy month but tiny week-1 share (working, closes late).
// "Low output" = barely producing ALL month (the real watch item), not a timing quirk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchShopifyRows, classifyChannel, findRep, territoryFor, shopLocalDate } from "../lib/xtresseCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "rep-cadence.json");

// Managers carry no quota — never on a performance watch list. (See memory:
// managers-not-reps — Becky Curry, Julie Fetter.)
const MANAGERS = new Set(["Becky Curry", "Julie Fetter"]);

// Tunables (dollars).
const BACKLOADED_W1_PCT = 12;   // week-1 share below this = back-loaded
const BACKLOADED_MIN_FULL = 20000; // ...but only if the month is otherwise healthy
const LOW_OUTPUT_FULL = 3000;   // avg full-month below this = low output
const STRONG_W1 = 10000;        // avg week-1 at/above this = strong start

function lastCompleteMonths(todayIso, n) {
  const [y, m] = todayIso.slice(0, 7).split("-").map(Number);
  const out = [];
  let cy = y, cm = m - 1; // start at the month before the current one
  for (let i = 0; i < n; i++) {
    if (cm <= 0) { cm = 12; cy -= 1; }
    out.unshift(`${cy}-${String(cm).padStart(2, "0")}`);
    cm -= 1;
  }
  return out;
}

async function main() {
  const today = shopLocalDate(new Date().toISOString());
  const months = lastCompleteMonths(today, 5);
  const from = `${months[0]}-01`;
  const rows = await fetchShopifyRows({ from, to: today });

  const byOrder = {};
  for (const li of rows) { const id = li.order_id; if (id && !byOrder[id]) byOrder[id] = li; }

  const D = {}; // rep -> ym -> { week1, full }
  for (const o of Object.values(byOrder)) {
    if (classifyChannel({ tagsRaw: o.order_tags, discountCodesRaw: o.order_discount_codes }) !== "B2B") continue;
    const rep = findRep(o.order_tags);
    if (!rep) continue;
    const dl = shopLocalDate(o.order_created_at);
    const ym = dl.slice(0, 7), day = Number(dl.slice(8, 10));
    const net = Math.max(0, Number(o.order_subtotal_price || 0) - Number(o.order_refunds_subtotal || 0));
    D[rep] ??= {};
    D[rep][ym] ??= { week1: 0, full: 0 };
    D[rep][ym].full += net;
    if (day <= 7) D[rep][ym].week1 += net;
  }

  const reps = Object.keys(D).map((rep) => {
    const w1 = months.map((m) => D[rep][m]?.week1 || 0);
    const full = months.map((m) => D[rep][m]?.full || 0);
    const active = months.filter((m) => (D[rep][m]?.full || 0) > 0).length;
    const avgW1 = w1.reduce((a, b) => a + b, 0) / months.length;
    const avgFull = full.reduce((a, b) => a + b, 0) / months.length;
    const w1pct = avgFull > 0 ? (avgW1 / avgFull) * 100 : 0;
    return { rep, terr: territoryFor(rep) || "?", avgW1: Math.round(avgW1), avgFull: Math.round(avgFull), w1pct: Math.round(w1pct), active, manager: MANAGERS.has(rep) };
  }).filter((r) => r.active > 0 && !r.manager);

  const byName = (a, b) => a.rep.localeCompare(b.rep);
  const backLoaded = reps
    .filter((r) => r.avgFull >= BACKLOADED_MIN_FULL && r.w1pct < BACKLOADED_W1_PCT)
    .sort((a, b) => b.avgFull - a.avgFull);
  const lowOutput = reps
    .filter((r) => r.avgFull < LOW_OUTPUT_FULL)
    .sort((a, b) => a.avgFull - b.avgFull);
  const strongStart = reps
    .filter((r) => r.avgW1 >= STRONG_W1)
    .sort((a, b) => b.avgW1 - a.avgW1);

  const label = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const out = {
    generatedAt: today,
    window: `${label(months[0])}–${label(months[months.length - 1])} ${months[months.length - 1].slice(0, 4)}`,
    months,
    method: "B2B net sales by rep, first 7 days vs full month, last 5 complete months.",
    backLoaded: backLoaded.map(({ rep, terr, avgFull, w1pct }) => ({ rep, terr, avgFull, w1pct })),
    lowOutput: lowOutput.map(({ rep, terr, avgFull }) => ({ rep, terr, avgFull })),
    strongStart: strongStart.map(({ rep, terr, avgW1 }) => ({ rep, terr, avgW1 })),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(path.join(__dirname, ".."), OUT)} — window ${out.window}`);
  console.log(`  back-loaded: ${out.backLoaded.map((r) => r.rep).join(", ") || "none"}`);
  console.log(`  low output:  ${out.lowOutput.map((r) => `${r.rep} (${r.terr})`).join(", ") || "none"}`);
  console.log(`  strong start:${out.strongStart.map((r) => r.rep).join(", ") || "none"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
