"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

export default function DiscountUsage({ data }) {
  return (
    <ChartShell height="h-80 md:h-[420px]">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={fmtCurrencyShort} />
        <YAxis
          type="category"
          dataKey="code"
          tickLine={false}
          axisLine={false}
          width={110}
          tick={{ fontSize: 10 }}
        />
        <Tooltip
          formatter={(v, name) => (name === "count" ? v : fmtCurrencyFull(v))}
        />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey="B2B" stackId="a" fill={COLORS.B2B} />
        <Bar dataKey="DTC" stackId="a" fill={COLORS.DTC} />
      </BarChart>
    </ChartShell>
  );
}
