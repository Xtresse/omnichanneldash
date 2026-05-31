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
import { ChartShell, COLORS, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

/**
 * Average-order-value by channel, dual-axis (B2B left, DTC right).
 * Optional `compare` adds dashed prior-period AOV lines on each axis so
 * Sam can spot AOV trend shifts independent of channel mix changes.
 */
export default function AOVByChannel({ data, compare, metric = "net" }) {
  const gross = metric === "gross";
  const b2bKey = gross ? "B2B_AOV_gross" : "B2B_AOV";
  const dtcKey = gross ? "DTC_AOV_gross" : "DTC_AOV";
  const merged = mergePriorAOV(data, compare);
  const showPrior = compare && compare.monthlySeries && compare.monthlySeries.length > 0;
  const priorLabel = compare && compare.mode === "yoy" ? "last yr" : "prior";

  return (
    <ChartShell>
      <LineChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          yAxisId="b2b"
          orientation="left"
          tickLine={false}
          axisLine={false}
          width={50}
          tickFormatter={fmtCurrencyShort}
          stroke={COLORS.B2B}
        />
        <YAxis
          yAxisId="dtc"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={50}
          tickFormatter={fmtCurrencyShort}
          stroke={COLORS.DTC}
        />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Line
          yAxisId="b2b"
          type="monotone"
          dataKey={b2bKey}
          name="B2B AOV"
          stroke={COLORS.B2B}
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="dtc"
          type="monotone"
          dataKey={dtcKey}
          name="DTC AOV"
          stroke={COLORS.DTC}
          strokeWidth={2}
          dot={false}
        />
        {showPrior && (
          <>
            <Line
              yAxisId="b2b"
              type="monotone"
              dataKey="priorB2BAOV"
              name={`B2B ${priorLabel}`}
              stroke={COLORS.B2B}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              dot={false}
            />
            <Line
              yAxisId="dtc"
              type="monotone"
              dataKey="priorDTCAOV"
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

function mergePriorAOV(current, compare) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.monthlySeries || compare.monthlySeries.length === 0) {
    return current;
  }
  return current.map((bucket, i) => {
    const p = compare.monthlySeries[i];
    return {
      ...bucket,
      priorB2BAOV: p ? p.B2B_AOV ?? null : null,
      priorDTCAOV: p ? p.DTC_AOV ?? null : null,
    };
  });
}
