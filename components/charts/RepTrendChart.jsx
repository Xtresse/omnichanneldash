"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// Pre-picked palette — distinct enough that 6-8 lines stay readable.
const PALETTE = [
  "#F0922E", "#5C2F2E", "#3A7A6F", "#5C8A6F", "#9C6F4A",
  "#7A3D23", "#D9731E", "#8A3324", "#C9B68E", "#5A4730",
  "#B8902A", "#6E4B2A",
];

const fmt$short = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(n / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n || 0)}`;
};
const fmtInt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));

/**
 * Generic monthly time-series line chart with rep selection.
 * Used for both "Sales by rep" and "New accounts by rep" — pass the
 * appropriate data array and value formatter.
 *
 * Props:
 *   data:      [{ month, label, [rep1]: $/count, [rep2]: ..., ... }]
 *   reps:      string[] of all rep names that may appear in data
 *   valueType: "currency" | "count" — controls Y axis + tooltip format
 *   defaultTopN: how many reps to show by default (default 6)
 *   compare:   optional { mode, monthlySeries|repSalesMonthly|repNewAccountsMonthly }
 *              When provided, a dashed muted-brown line is rendered showing
 *              the SUM of the currently-selected reps for the prior window,
 *              aligned by bucket index. Useful so Sam can see whether the
 *              top-rep cohort he's focusing on is up vs prior period without
 *              eyeballing each individual line.
 *   priorKey:  which key on `compare` to pull the prior per-rep series from
 *              ("repSalesMonthly" or "repNewAccountsMonthly"). Defaults to
 *              repSalesMonthly to match the currency variant.
 */
export default function RepTrendChart({
  data,
  reps,
  valueType = "currency",
  defaultTopN = 6,
  compare,
  priorKey = "repSalesMonthly",
}) {
  // Compute total per rep over the loaded period to pick a sensible default.
  const totals = useMemo(() => {
    const sums = {};
    for (const row of data || []) {
      for (const rep of reps) {
        sums[rep] = (sums[rep] || 0) + (row[rep] || 0);
      }
    }
    return sums;
  }, [data, reps]);

  const sortedReps = useMemo(
    () => [...reps].sort((a, b) => (totals[b] || 0) - (totals[a] || 0)),
    [reps, totals]
  );

  // Default: top N reps by total. User can toggle individual reps on/off.
  const [selected, setSelected] = useState(() => {
    const top = new Set(sortedReps.slice(0, defaultTopN).filter((r) => totals[r] > 0));
    if (top.size === 0) sortedReps.slice(0, defaultTopN).forEach((r) => top.add(r));
    return top;
  });

  function toggle(rep) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rep)) next.delete(rep);
      else next.add(rep);
      return next;
    });
  }

  function showTop(n) {
    setSelected(new Set(sortedReps.slice(0, n).filter((r) => totals[r] > 0)));
  }
  function showAll() {
    setSelected(new Set(sortedReps.filter((r) => totals[r] > 0)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  const fmt = valueType === "currency" ? fmt$short : fmtInt;
  const tooltipFmt = (v) =>
    valueType === "currency"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(v || 0)
      : fmtInt(v);

  // Stable color assignment (always same color per rep regardless of selection).
  const repColor = useMemo(() => {
    const m = {};
    sortedReps.forEach((r, i) => {
      m[r] = PALETTE[i % PALETTE.length];
    });
    return m;
  }, [sortedReps]);

  const visibleReps = sortedReps.filter((r) => selected.has(r));
  const hasData = data && data.length > 0;

  // Merge prior totals into the chart data by bucket index. The prior total
  // is the SUM of currently-visible reps for that bucket, so it always
  // tracks the cohort Sam is looking at — toggling reps on/off retunes
  // the dashed line in real time without needing a refetch.
  const priorSeries = compare && compare[priorKey] ? compare[priorKey] : null;
  const showPrior = !!priorSeries && priorSeries.length > 0;
  const merged = useMemo(() => {
    if (!hasData) return data || [];
    if (!showPrior) return data;
    return data.map((row, i) => {
      const p = priorSeries[i];
      if (!p) return { ...row, priorTotal: null };
      let sum = 0;
      for (const rep of visibleReps) sum += p[rep] || 0;
      return { ...row, priorTotal: sum };
    });
  }, [data, hasData, priorSeries, showPrior, visibleReps]);

  return (
    <div className="space-y-3">
      {/* Rep toggle chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted shrink-0 mr-1">
          Reps
        </span>
        {sortedReps.map((rep) => {
          const active = selected.has(rep);
          const has = (totals[rep] || 0) > 0;
          return (
            <button
              key={rep}
              type="button"
              onClick={() => toggle(rep)}
              className={`shrink-0 px-2 py-1 rounded text-[11px] font-sans border transition ${
                active
                  ? "border-transparent text-paper"
                  : "bg-paper text-inksoft border-rule hover:border-tan"
              } ${!has ? "opacity-40" : ""}`}
              style={
                active
                  ? { backgroundColor: repColor[rep], borderColor: repColor[rep] }
                  : undefined
              }
              aria-pressed={active}
              title={`${rep}${has ? "" : " (no data)"}`}
            >
              {rep}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => showTop(6)}
            className="px-2 py-1 rounded text-[10px] font-sans text-inksoft border border-rule hover:bg-paper2"
          >
            Top 6
          </button>
          <button
            type="button"
            onClick={showAll}
            className="px-2 py-1 rounded text-[10px] font-sans text-inksoft border border-rule hover:bg-paper2"
          >
            All
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="px-2 py-1 rounded text-[10px] font-sans text-inksoft border border-rule hover:bg-paper2"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="w-full h-72 md:h-96">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11 }} />
              <Tooltip formatter={tooltipFmt} itemSorter={(it) => -(it.value || 0)} />
              <Legend wrapperStyle={{ paddingTop: 8, fontSize: 11 }} />
              {visibleReps.map((rep) => (
                <Line
                  key={rep}
                  type="monotone"
                  dataKey={rep}
                  stroke={repColor[rep]}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 4 }}
                />
              ))}
              {showPrior && (
                <Line
                  type="monotone"
                  dataKey="priorTotal"
                  stroke="#9A8F80"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  name={
                    compare.mode === "yoy"
                      ? "Selected — last year"
                      : "Selected — prior period"
                  }
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted text-sm">
            No rep data for this period.
          </div>
        )}
      </div>
    </div>
  );
}
