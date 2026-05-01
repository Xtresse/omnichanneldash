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

export default function RepeatRate({ data }) {
  return (
    <ChartShell>
      <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
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
      </LineChart>
    </ChartShell>
  );
}
