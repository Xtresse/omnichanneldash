"use client";

import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtInt } from "./_shared.js";

/**
 * Order-count line chart by channel. Optional `compare` adds a dashed
 * total-orders line for the prior-period window aligned by bucket index.
 */
export default function OrdersByChannel({ data, compare }) {
  const merged = mergePriorOrders(data, compare);
  const showPrior = compare && compare.monthlySeries && compare.monthlySeries.length > 0;

  return (
    <ChartShell>
      <LineChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={fmtInt} />
        <Tooltip itemSorter={(it) => -(it.value || 0)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Line
          type="monotone"
          dataKey="B2B_orders"
          name="B2B"
          stroke={COLORS.B2B}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="DTC_orders"
          name="DTC"
          stroke={COLORS.DTC}
          strokeWidth={2}
          dot={false}
        />
        {showPrior && (
          <Line
            type="monotone"
            dataKey="priorTotalOrders"
            stroke="#9A8F80"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name={compare.mode === "yoy" ? "Total — last year" : "Total — prior period"}
          />
        )}
      </LineChart>
    </ChartShell>
  );
}

function mergePriorOrders(current, compare) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.monthlySeries || compare.monthlySeries.length === 0) {
    return current;
  }
  const priorTotals = compare.monthlySeries.map(
    (b) => (b.B2B_orders || 0) + (b.ADCS_orders || 0) + (b.DTC_orders || 0)
  );
  return current.map((bucket, i) => ({
    ...bucket,
    priorTotalOrders: i < priorTotals.length ? priorTotals[i] : null,
  }));
}
