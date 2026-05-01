"use client";

import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

export default function SubVsOneTime({ data }) {
  return (
    <ChartShell>
      <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={50} tickFormatter={fmtCurrencyShort} />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Area
          type="monotone"
          dataKey="Subscription"
          stackId="1"
          stroke={COLORS.Subscription}
          fill={COLORS.Subscription}
          fillOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="OneTime"
          name="One-time"
          stackId="1"
          stroke={COLORS.OneTime}
          fill={COLORS.OneTime}
          fillOpacity={0.6}
        />
      </AreaChart>
    </ChartShell>
  );
}
