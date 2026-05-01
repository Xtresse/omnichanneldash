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

export default function OrdersByChannel({ data }) {
  return (
    <ChartShell>
      <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={fmtInt} />
        <Tooltip />
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
      </LineChart>
    </ChartShell>
  );
}
