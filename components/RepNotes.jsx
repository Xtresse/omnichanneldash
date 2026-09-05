"use client";

// Rep "Cadence & Watch" notes — plain-English read on order cadence (who's
// back-loaded vs. strong at month-start) and a low-output watch list, for the
// Rep Performance group. Reads the pre-computed data/rep-cadence.json
// (regenerated from live Shopify by scripts/rep-cadence.mjs, monthly). The
// lead framing is deliberate: "quiet week 1" is usually cadence (deals close
// later), not absence — so no full-time rep gets mislabeled as not working.

import React from "react";
import notes from "@/data/rep-cadence.json";

const names = (arr, flag1099 = false) =>
  (arr || []).map((r) => (flag1099 && r.terr === "1099" ? `${r.rep} (1099)` : r.rep)).join(" · ");

function Note({ dot, label, body, people }) {
  return (
    <div className="flex gap-2.5">
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <span className="font-semibold text-ink">{label}</span>{" "}
        <span className="text-muted">{body}</span>
        {people ? <div className="text-ink mt-0.5 font-medium">{people}</div> : null}
      </div>
    </div>
  );
}

export default function RepNotes() {
  const { window: win, backLoaded = [], lowOutput = [], strongStart = [] } = notes || {};
  return (
    <div className="rounded-xl border border-rule bg-card p-4 md:p-5 font-sans">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h3 className="font-serif text-lg md:text-xl font-semibold text-ink leading-tight">Cadence &amp; Watch</h3>
        <span className="text-[11px] text-muted">{win} · first-week vs full-month · B2B net</span>
      </div>

      <div className="space-y-3 text-[13px] leading-snug">
        {backLoaded.length > 0 && (
          <Note dot="bg-partial" label="Back-loaded closers."
            body="Quiet week 1 but strong months — working; deals just land mid/late month. A nudge for earlier pipeline, not a flag."
            people={names(backLoaded)} />
        )}
        {lowOutput.length > 0 && (
          <Note dot="bg-unfavorable" label="Low output — watch."
            body="Consistently light all month, not just week 1 — worth a production check."
            people={names(lowOutput, true)} />
        )}
        {strongStart.length > 0 && (
          <Note dot="bg-favorable" label="Strong month-start."
            body="Show up big in week 1, every month."
            people={names(strongStart)} />
        )}
      </div>

      <p className="text-[11px] text-tan mt-3 leading-snug">
        Last 5 complete months. A quiet first week is usually cadence (deals close later), not absence — no full-time rep is
        consistently missing week 1; the watch list above is 1099 contractors low <em>all</em> month.
      </p>
    </div>
  );
}
