"use client";

import {
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

/**
 * Stacked area chart of net sales by channel (B2B + DTC).
 *
 * `compare` (optional): { mode, monthlySeries } from data.compare. When
 * provided, the chart renders a dashed total line for the prior-period
 * window aligned by bucket INDEX, not by date label, so a "Last 30d"
 * window overlays "Prior 30d" buckets 1-to-1. The dashed line is the
 * total (B2B + ADCS + DTC) so Sam can scan whether the channel mix is
 * shifting independently of the headline number.
 */
export default function RevenueByChannel({ data, compare }) {
  const merged = mergePriorSeries(data, compare);
  const showPrior = compare && compare.monthlySeries && compare.monthlySeries.length > 0;

  return (
    <ChartShell>
      <ComposedChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="b2bGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.B2B} stopOpacity={0.6} />
            <stop offset="100%" stopColor={COLORS.B2B} stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="dtcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.DTC} stopOpacity={0.6} />
            <stop offset="100%" stopColor={COLORS.DTC} stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tickFormatter={fmtCurrencyShort} width={50} />
        <Tooltip
          formatter={(v, name) => [fmtCurrencyFull(v), name]}
          labelClassName="text-xs"
          itemSorter={(it) => -(it.value || 0)}
        />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Area
          type="monotone"
          dataKey="B2B"
          stackId="1"
          stroke={COLORS.B2B}
          fill="url(#b2bGrad)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="DTC"
          stackId="1"
          stroke={COLORS.DTC}
          fill="url(#dtcGrad)"
          strokeWidth={1.5}
        />
        {showPrior && (
          <Line
            type="monotone"
            dataKey="priorTotal"
            stroke="#9A8F80"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name={compare.mode === "yoy" ? "Total — last year" : "Total — prior period"}
          />
        )}
      </ComposedChart>
    </ChartShell>
  );
}

/**
 * Merge prior-period totals into the current series by bucket INDEX.
 * Recharts needs the prior values on the same data points it's plotting
 * (the bottom area chart drives the X-axis), so we fold prior totals in
 * as a `priorTotal` field on each bucket. Buckets with no matching prior
 * (e.g. the prior window is shorter, or the current bucket has no prior
 * counterpart) get null so the dashed line gracefully cuts off.
 */
function mergePriorSeries(current, compare) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.monthlySeries || compare.monthlySeries.length === 0) {
    return current;
  }
  const priorTotals = compare.monthlySeries.map(
    (b) => (b.B2B || 0) + (b.ADCS || 0) + (b.DTC || 0)
  );
  return current.map((bucket, i) => ({
    ...bucket,
    priorTotal: i < priorTotals.length ? priorTotals[i] : null,
  }));
}
