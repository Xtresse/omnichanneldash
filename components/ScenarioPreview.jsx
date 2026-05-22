"use client";

// Compact, dashboard-embedded preview of where the business is landing
// EOM at the trailing run rate. Sits in its own collapsible section
// above the rep tables and links straight to the full /scenarios page.
//
// No assumption tuning here — it's the "default" pacing snapshot.
// Any nuance the user wants requires opening /scenarios where the
// sliders + chat live.
//
// Mounts after the dashboard hydrates so the initial paint isn't held
// up by a second Windsor pull. Falls back to a one-line link when the
// fetch fails — never breaks the page.

import { useEffect, useState } from "react";

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export default function ScenarioPreview() {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scenario/snapshot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ horizon: "eom" }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json?.ok) setSnap(json);
        else setErr(json?.error || "Failed to load forecast");
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="rounded-xl border border-rule bg-card p-3 md:p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
              Scenario preview
            </div>
            <p className="font-sans text-[12px] text-muted mt-1">
              Couldn&apos;t load forecast.{" "}
              <a className="text-brown underline" href="/scenarios">
                Open the full planner
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!snap) {
    return (
      <div className="rounded-xl border border-rule bg-card p-3 md:p-4 animate-pulse">
        <div className="h-3 w-1/3 bg-paper2 rounded mb-2"></div>
        <div className="h-6 w-1/2 bg-paper2 rounded mb-2"></div>
        <div className="h-3 w-full bg-paper2 rounded"></div>
      </div>
    );
  }

  const total = snap.channels?.total || {};
  const chs = ["B2B", "ADCS", "DTC"];
  return (
    <div className="rounded-xl border border-rule bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
            EOM landing forecast · {snap.endDate}
          </div>
          <div className="font-display text-2xl md:text-3xl font-semibold text-ink leading-tight mt-0.5 tabular-nums">
            {fmt$(total.landing)}
          </div>
          <div className="font-sans text-[11px] text-inksoft mt-0.5 leading-snug">
            {fmt$(total.actualToDate)} actual + {fmt$(total.forward)} forward
            at trailing run rate.{" "}
            <span className="text-muted">
              {snap.completedDays} of {snap.completedDays + snap.remainingDays} days
              complete.
            </span>
          </div>
        </div>
        <a
          href="/scenarios"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brown text-paper font-sans text-[12px] font-semibold hover:bg-browndeep transition"
        >
          Open planner →
        </a>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {chs.map((ch) => {
          const d = snap.channels?.[ch] || {};
          return (
            <div
              key={ch}
              className="bg-paper2 border border-rule rounded-md px-2.5 py-2 min-w-0"
            >
              <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">
                {ch}
              </div>
              <div className="font-display text-base md:text-lg font-semibold text-ink leading-tight mt-0.5 tabular-nums">
                {fmt$(d.landing)}
              </div>
              <div className="font-sans text-[10px] text-muted tabular-nums mt-0.5">
                {fmt$(d.dailyRate)}/d
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
