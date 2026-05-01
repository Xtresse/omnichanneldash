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

export default function AOVByChannel({ data }) {
  return (
    <ChartShell>
      <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
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
          dataKey="B2B_AOV"
          name="B2B AOV"
          stroke={COLORS.B2B}
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="dtc"
          type="monotone"
          dataKey="DTC_AOV"
          name="DTC AOV"
          stroke={COLORS.DTC}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartShell>
  );
}
