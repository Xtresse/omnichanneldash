"use client";

import {
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtInt } from "./_shared.js";

/**
 * Stacked-bar new-vs-returning per channel (B2B or DTC).
 *
 * Optional `compare` adds a dashed total-orders prior-period line per
 * bucket index — same alignment trick as the channel charts. Lets Sam
 * see whether new/returning order velocity is up or down vs prior period.
 */
export default function NewVsReturning({ data, compare, channel = "B2B" }) {
  const newKey = `${channel}_new`;
  const retKey = `${channel}_ret`;
  const merged = mergePrior(data, compare, newKey, retKey);
  const showPrior = compare && compare.customerDynamics && compare.customerDynamics.length > 0;

  return (
    <ChartShell>
      <ComposedChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={fmtInt} />
        <Tooltip itemSorter={(it) => -(it.value || 0)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey={newKey} name="New" stackId="a" fill={COLORS.newCust} />
        <Bar dataKey={retKey} name="Returning" stackId="a" fill={COLORS.retCust} />
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

function mergePrior(current, compare, newKey, retKey) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.customerDynamics || compare.customerDynamics.length === 0) {
    return current;
  }
  return current.map((bucket, i) => {
    const p = compare.customerDynamics[i];
    return {
      ...bucket,
      priorTotal: p ? (p[newKey] || 0) + (p[retKey] || 0) : null,
    };
  });
}
