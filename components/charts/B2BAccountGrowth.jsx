"use client";

import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ChartShell, fmtInt } from "./_shared.js";

const TARGET = 7000; // Mike's threshold before considering a sale of the biz.

// Cumulative distinct B2B accounts/locations over time — derived client-side
// from accountAging (rep-attributed B2B, ADCS excluded; see the acctMap loop
// in lib/windsor.js) by bucketing each account's firstOrder to a calendar
// month and running a cumulative count. accountAging is built server-side
// from the ALL-TIME pull regardless of the requested window, so — same as
// AccountAging.jsx — this fetches the smallest/cheapest window.
export default function B2BAccountGrowth() {
  const [accounts, setAccounts] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ preset: "last_7d", granularity: "month" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.accountAging)) setAccounts(j.accountAging);
        else setErr(j.error || "No account data");
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo(() => {
    if (!accounts) return null;
    const byMonth = new Map();
    for (const a of accounts) {
      const month = (a.firstOrder || "").slice(0, 7);
      if (!month) continue;
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
    }
    const months = Array.from(byMonth.keys()).sort();
    let cumulative = 0;
    return months.map((m) => {
      cumulative += byMonth.get(m);
      return { month: m, accounts: cumulative };
    });
  }, [accounts]);

  const total = series?.length ? series[series.length - 1].accounts : null;

  if (err) {
    return (
      <div className="font-sans text-[11px] text-red-900">Couldn&apos;t load account growth: {err}</div>
    );
  }

  return (
    <div>
      <div className="mb-1 px-0.5 font-sans text-[11px] text-muted">
        {total == null ? (
          "—"
        ) : (
          <>
            <span className="font-display text-lg font-semibold text-ink tabular-nums">{fmtInt(total)}</span>{" "}
            of {fmtInt(TARGET)} target
          </>
        )}
      </div>
      <ChartShell>
        <AreaChart data={series || []} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtInt}
            width={44}
            domain={[0, (dataMax) => Math.max(TARGET, dataMax)]}
          />
          <Tooltip formatter={(v) => fmtInt(v)} />
          <ReferenceLine
            y={TARGET}
            stroke="#5C2F2E"
            strokeDasharray="4 4"
            label={{ value: `${fmtInt(TARGET)} target`, position: "insideTopRight", fill: "#5C2F2E", fontSize: 10 }}
          />
          <Area type="monotone" dataKey="accounts" stroke="#f0922e" fill="#f0922e" fillOpacity={0.18} strokeWidth={2} dot={false} />
        </AreaChart>
      </ChartShell>
    </div>
  );
}
