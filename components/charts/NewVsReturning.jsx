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
import { ChartShell, COLORS, fmtInt } from "./_shared.js";

export default function NewVsReturning({ data, channel = "B2B" }) {
  const newKey = `${channel}_new`;
  const retKey = `${channel}_ret`;
  return (
    <ChartShell>
      <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={fmtInt} />
        <Tooltip />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey={newKey} name="New" stackId="a" fill={COLORS.newCust} />
        <Bar dataKey={retKey} name="Returning" stackId="a" fill={COLORS.retCust} />
      </BarChart>
    </ChartShell>
  );
}
