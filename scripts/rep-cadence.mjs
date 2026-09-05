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
const BACKLOADED_LASTWK_PCT = 45; // ...or this much of the month lands in the final week
const BACKLOADED_MIN_FULL = 20000; // ...but only flag a rep whose month is otherwise healthy
const LOW_OUTPUT_FULL = 3000;   // avg full-month below this = low output
const STRONG_W1 = 10000;        // week-1 run-rate at/above this (dollar floor for strong start)
const STRONG_W1PCT = 23;        // ...AND week-1 share at/above even pace (7 of ~30 days) = genuinely front-loaded

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

// Days in a month, and how many of them are weekdays (Mon–Fri) — for the
// "goes quiet" count. UTC throughout, matching the shop-local day keys.
function monthShape(ym) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let weekdays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays += 1;
  }
  return { daysInMonth, weekdays };
}

async function main() {
  const today = shopLocalDate(new Date().toISOString());
  const months = lastCompleteMonths(today, 5);
  const from = `${months[0]}-01`;
  const rows = await fetchShopifyRows({ from, to: today });

  const byOrder = {};
  for (const li of rows) { const id = li.order_id; if (id && !byOrder[id]) byOrder[id] = li; }

  const shape = Object.fromEntries(months.map((m) => [m, monthShape(m)]));

  // rep -> ym -> { week1, lastWeek, full, sellWeekdays:Set<day> }
  const D = {};
  for (const o of Object.values(byOrder)) {
    if (classifyChannel({ tagsRaw: o.order_tags, discountCodesRaw: o.order_discount_codes }) !== "B2B") continue;
    const rep = findRep(o.order_tags);
    if (!rep) continue;
    // order_created_at is ALREADY shop-local (xtresseCore sets it via
    // toShopLocalISO). Just take the date — running shopLocalDate() on it again
    // re-parses a naive-local string in the HOST tz and shifts early-morning-PT
    // orders back a day on any non-Pacific host (incl. Vercel/UTC).
    const dl = (o.order_created_at || "").slice(0, 10);
    if (!dl) continue;
    const ym = dl.slice(0, 7);
    if (!shape[ym]) continue; // outside the 5-month window
    const day = Number(dl.slice(8, 10));
    const net = Math.max(0, Number(o.order_subtotal_price || 0) - Number(o.order_refunds_subtotal || 0));
    D[rep] ??= {};
    D[rep][ym] ??= { week1: 0, lastWeek: 0, full: 0, sellWeekdays: new Set() };
    const rec = D[rep][ym];
    rec.full += net;
    if (day <= 7) rec.week1 += net;
    if (day > shape[ym].daysInMonth - 7) rec.lastWeek += net; // final 7 calendar days
    if (net > 0) {
      const dow = new Date(dl + "T00:00:00Z").getUTCDay();
      if (dow !== 0 && dow !== 6) rec.sellWeekdays.add(day);
    }
  }

  const reps = Object.keys(D).map((rep) => {
    const rec = (m) => D[rep][m];
    const activeMonths = months.filter((m) => (rec(m)?.full || 0) > 0);
    const active = activeMonths.length;
    // Shares are ratios of the RAW window sums, so the averaging denominator
    // cancels out and can't distort them. Dollar run-rates divide by ACTIVE
    // months (same denominator as quietWeekdays below), so a rep who started
    // mid-window is measured on the months they actually worked, not penalised
    // by empty months before they existed.
    const sumW1 = months.reduce((a, m) => a + (rec(m)?.week1 || 0), 0);
    const sumLastWk = months.reduce((a, m) => a + (rec(m)?.lastWeek || 0), 0);
    const sumFull = months.reduce((a, m) => a + (rec(m)?.full || 0), 0);
    const div = Math.max(1, active);
    const avgW1 = sumW1 / div;
    const avgFull = sumFull / div;
    const w1pct = sumFull > 0 ? (sumW1 / sumFull) * 100 : 0;
    const lastWkPct = sumFull > 0 ? (sumLastWk / sumFull) * 100 : 0;
    const quietWeekdays = active
      ? activeMonths.reduce((a, m) => a + (shape[m].weekdays - rec(m).sellWeekdays.size), 0) / active
      : 0;
    return {
      rep, terr: territoryFor(rep) || "?",
      avgW1: Math.round(avgW1), avgFull: Math.round(avgFull),
      w1pct: Math.round(w1pct), lastWkPct: Math.round(lastWkPct),
      quietWeekdays: Math.round(quietWeekdays), active, manager: MANAGERS.has(rep),
      sumW1, sumFull, // raw window sums (for the dollar-weighted team benchmark; not emitted)
    };
    // Exclude managers (no quota) AND 1099 contractors at the SOURCE — the watch
    // list is a ranking, and 1099s are never ranked (President's Club rule), so
    // the persisted JSON must not carry them (defense in depth vs. the UI filter).
  }).filter((r) => r.active > 0 && !r.manager && r.terr !== "1099");

  const backLoaded = reps
    .filter((r) => r.avgFull >= BACKLOADED_MIN_FULL && (r.w1pct < BACKLOADED_W1_PCT || r.lastWkPct >= BACKLOADED_LASTWK_PCT))
    .sort((a, b) => b.lastWkPct - a.lastWkPct || a.w1pct - b.w1pct);
  const lowOutput = reps
    .filter((r) => r.avgFull < LOW_OUTPUT_FULL)
    .sort((a, b) => a.avgFull - b.avgFull);
  // "Strong start" must mean genuinely FRONT-LOADED, not just high-volume. Rank
  // by week-1 SHARE and require it above even pace (STRONG_W1PCT), with a dollar
  // floor and a min-active-months guard so "reliably" is earned, not a one-month
  // spike. (Ranking by absolute week-1 dollars mislabeled big-but-back-loaded
  // reps like a $65k/mo rep who books only 17% in week 1.)
  const strongStart = reps
    .filter((r) => r.avgW1 >= STRONG_W1 && r.w1pct >= STRONG_W1PCT && r.active >= 4)
    .sort((a, b) => b.w1pct - a.w1pct || b.avgW1 - a.avgW1);

  // Team week-1 benchmark — what share of the month the (W-2, 1099 already
  // excluded above) team books in the first 7 days, so a rep's week-1 % reads
  // against a yardstick. Even pacing would be ~23% (7 of ~30 days). Computed
  // from the RAW window sums (true dollar-weighted share) — NOT a sum of the
  // per-active-month run-rates, which would over-weight a partial-window rep.
  const teamFull = reps.reduce((a, r) => a + r.sumFull, 0);
  const teamW1 = reps.reduce((a, r) => a + r.sumW1, 0);
  const week1 = {
    teamW1Pct: teamFull > 0 ? Math.round((teamW1 / teamFull) * 100) : 0,
    evenPacePct: STRONG_W1PCT,
  };

  const label = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const out = {
    generatedAt: today,
    window: `${label(months[0])}–${label(months[months.length - 1])} ${months[months.length - 1].slice(0, 4)}`,
    months,
    method: "B2B net sales by rep: first-7-days, final-7-days and quiet-weekday cadence over the last 5 complete months.",
    week1,
    backLoaded: backLoaded.map(({ rep, terr, avgFull, w1pct, lastWkPct }) => ({ rep, terr, avgFull, w1pct, lastWkPct })),
    lowOutput: lowOutput.map(({ rep, terr, avgFull, quietWeekdays }) => ({ rep, terr, avgFull, quietWeekdays })),
    strongStart: strongStart.map(({ rep, terr, avgW1, w1pct, avgFull }) => ({ rep, terr, avgW1, w1pct, avgFull })),
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(path.join(__dirname, ".."), OUT)} — window ${out.window}`);
  console.log(`  back-loaded: ${out.backLoaded.map((r) => `${r.rep} (${r.lastWkPct}% final wk)`).join(", ") || "none"}`);
  console.log(`  low output:  ${out.lowOutput.map((r) => `${r.rep} (${r.terr}, ~${r.quietWeekdays} quiet wkdays)`).join(", ") || "none"}`);
  console.log(`  strong start:${out.strongStart.map((r) => `${r.rep} ($${Math.round(r.avgW1/1000)}k wk1, ${r.w1pct}%)`).join(", ") || "none"}`);
  console.log(`  team wk1:     ${out.week1.teamW1Pct}% of the month books in week 1 (even pace ~${out.week1.evenPacePct}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
