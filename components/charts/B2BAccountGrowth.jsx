"use client";

import { useMemo } from "react";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { ChartShell, fmtInt } from "./_shared.js";

const TARGET = 7000; // Mike's threshold before considering a sale of the biz.

// Cumulative distinct B2B accounts/locations over time — derived client-side
// from accountAging (rep-attributed B2B, ADCS excluded; see the acctMap loop
// in lib/windsor.js) by bucketing each account's firstOrder to a calendar
// month and running a cumulative count. accountAging is built server-side
// from the ALL-TIME pull regardless of the requested window, so every
// /api/dashboard response already carries it — this reads Dashboard.jsx's
// own `data.accountAging` instead of firing a second, duplicate fetch (used
// to self-fetch preset=last_7d here, identical to AccountAging.jsx's own
// self-fetch; the two together were part of what pushed concurrent Shopify
// GraphQL calls over the rate limit on page load, 2026-07-09).
export default function B2BAccountGrowth({ accountAging = null }) {
  const accounts = accountAging;

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
