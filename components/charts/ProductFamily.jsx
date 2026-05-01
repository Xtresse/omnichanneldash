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

export default function ProductFamily({ data }) {
  return (
    <ChartShell>
      <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="family" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={50} tickFormatter={fmtCurrencyShort} />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey="B2B" fill={COLORS.B2B} radius={[2, 2, 0, 0]} />
        <Bar dataKey="DTC" fill={COLORS.DTC} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}
