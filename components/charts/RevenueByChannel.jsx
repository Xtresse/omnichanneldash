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

export default function RevenueByChannel({ data }) {
  return (
    <ChartShell>
      <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="b2bGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.B2B} stopOpacity={0.6} />
            <stop offset="100%" stopColor={COLORS.B2B} stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="dtcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.DTC} stopOpacity={0.6} />
            <stop offset="100%" stopColor={COLORS.DTC} stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tickFormatter={fmtCurrencyShort} width={50} />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} labelClassName="text-xs" />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Area
          type="monotone"
          dataKey="B2B"
          stackId="1"
          stroke={COLORS.B2B}
          fill="url(#b2bGrad)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="DTC"
          stackId="1"
          stroke={COLORS.DTC}
          fill="url(#dtcGrad)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ChartShell>
  );
}
