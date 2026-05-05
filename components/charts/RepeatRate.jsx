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
import { ChartShell, COLORS, fmtPct } from "./_shared.js";

/**
 * Repeat-purchase rate over time (% returning per bucket) for B2B and DTC.
 *
 * Optional `compare` adds dashed prior-period rate lines for both channels
 * — slightly transparent so the current B2B/DTC rates remain dominant.
 */
export default function RepeatRate({ data, compare }) {
  const merged = mergePrior(data, compare);
  const showPrior = compare && compare.repeatRate && compare.repeatRate.length > 0;
  const priorLabel = compare && compare.mode === "yoy" ? "last yr" : "prior";

  return (
    <ChartShell>
      <LineChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip formatter={(v) => fmtPct(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Line type="monotone" dataKey="B2B" stroke={COLORS.B2B} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="DTC" stroke={COLORS.DTC} strokeWidth={2} dot={false} />
        {showPrior && (
          <>
            <Line
              type="monotone"
              dataKey="priorB2B"
              name={`B2B ${priorLabel}`}
              stroke={COLORS.B2B}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="priorDTC"
              name={`DTC ${priorLabel}`}
              stroke={COLORS.DTC}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              dot={false}
            />
          </>
        )}
      </LineChart>
    </ChartShell>
  );
}

function mergePrior(current, compare) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.repeatRate || compare.repeatRate.length === 0) {
    return current;
  }
  return current.map((bucket, i) => {
    const p = compare.repeatRate[i];
    return {
      ...bucket,
      priorB2B: p ? p.B2B ?? null : null,
      priorDTC: p ? p.DTC ?? null : null,
    };
  });
}
