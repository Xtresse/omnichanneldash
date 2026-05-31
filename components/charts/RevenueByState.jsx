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

export default function RevenueByState({ data, metric = "net" }) {
  const gross = metric === "gross";
  const w2Key = gross ? "B2BW2_gross" : "B2BW2";
  const k1099Key = gross ? "B2B1099_gross" : "B2B1099";
  const dtcKey = gross ? "DTC_gross" : "DTC";
  return (
    <ChartShell height="h-96 md:h-[480px]">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={fmtCurrencyShort} />
        <YAxis
          type="category"
          dataKey="state"
          tickLine={false}
          axisLine={false}
          width={88}
          interval={0}
          tick={{ fontSize: 10 }}
        />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey={w2Key} name="B2B · W2" stackId="a" fill={COLORS.B2BW2} />
        <Bar dataKey={k1099Key} name="B2B · 1099" stackId="a" fill={COLORS.B2B1099} />
        <Bar dataKey={dtcKey} name="DTC" stackId="a" fill={COLORS.DTC} />
      </BarChart>
    </ChartShell>
  );
}
