"use client";

// Watch Outs — a compact, ranked companion above the Rep Daily Heat Map, built
// around the cadence question Mike asked: who's quiet the first week of the
// month, and who waits until the last. Reads the pre-computed
// data/rep-cadence.json (regenerated from live Shopify by
// scripts/rep-cadence.mjs, monthly).
//
// W-2 ONLY (Sam, 2026-09-05) — 1099 contractors are commission-only, set their
// own hours, and are excluded from every rep ranking/leaderboard (President's
// Club rule), so they don't belong on this watch list either. Looks across the
// last 5 COMPLETE months, never one week, so a single slow start never flags
// anyone.

import React from "react";
import notes from "@/data/rep-cadence.json";

const fmtK = (n) => {
  const v = Math.abs(n || 0);
  return v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
};
const w2Only = (arr) => (arr || []).filter((r) => r.terr !== "1099");

function Tier({ dot, badge, badgeCls, label, rows, stat }) {
  if (!rows?.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${badgeCls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {badge}
        </span>
        <span className="text-[11px] text-muted">{label}</span>
      </div>
      <ol className="flex flex-wrap gap-x-4 gap-y-0.5">
        {rows.map((r, i) => (
          <li key={r.rep} className="flex items-baseline gap-1.5 text-[12px]">
            <span className="text-[10px] tabular-nums text-tan">{i + 1}</span>
            <span className="font-semibold text-ink">{r.rep}</span>
            <span className="text-[11px] text-muted tabular-nums">{stat(r)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function RepNotes() {
  const { window: win, backLoaded = [], lowOutput = [], strongStart = [], week1 = {} } = notes || {};
  const backW2 = w2Only(backLoaded);
  const lowW2 = w2Only(lowOutput);
  const strongW2 = w2Only(strongStart);
  const teamW1 = week1.teamW1Pct;
  const evenPace = week1.evenPacePct ?? 23;

  return (
    <div className="mb-3 rounded-xl border border-rule bg-card p-3.5 md:p-4 font-sans">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-inksoft">Watch Outs</span>
        <span className="text-[10px] text-tan">W-2 only · B2B net · {win}</span>
      </div>

      <div className="space-y-3">
        <Tier
          dot="bg-partial"
          badge="Back-loaded"
          badgeCls="bg-partial/15 text-ink"
          label="waits until the final week"
          rows={backW2}
          stat={(r) => `${r.w1pct}% wk 1 · ${r.lastWkPct}% final wk · ${fmtK(r.avgFull)}/mo`}
        />
        <Tier
          dot="bg-unfavorable"
          badge="Running quiet"
          badgeCls="bg-unfavorable/12 text-ink"
          label="light all month"
          rows={lowW2}
          stat={(r) => `${fmtK(r.avgFull)}/mo · ~${r.quietWeekdays} quiet days`}
        />
        {lowW2.length === 0 && (
          <p className="text-[11px] text-muted">
            {backW2.length === 0
              ? "No W-2 cadence watch-outs this window — none back-loaded, none running quiet."
              : "No W-2 rep is running quiet all month — the only watch-out is timing."}
          </p>
        )}
      </div>

      {/* First-week read — the question Mike actually asked. A benchmark for the
          team's week-1 share, then who reliably shows up early. */}
      <div className="mt-3.5 pt-3 border-t border-rule space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-inksoft">First Week</span>
          {teamW1 != null && (
            <span className="text-[11px] text-muted tabular-nums">
              team books <span className="font-semibold text-ink">{teamW1}%</span> of the month in week 1
              <span className="text-tan"> · even pace ≈{evenPace}%</span>
            </span>
          )}
        </div>
        <Tier
          dot="bg-favorable"
          badge="Strong start"
          badgeCls="bg-favorable/15 text-ink"
          label="front-load the month, every month"
          rows={strongW2}
          stat={(r) => `${r.w1pct}% wk 1 · ${fmtK(r.avgW1)} of ${fmtK(r.avgFull)}`}
        />
      </div>
    </div>
  );
}
