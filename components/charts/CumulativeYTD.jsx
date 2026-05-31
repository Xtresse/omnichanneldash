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
import { ChartShell, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

const YEAR_COLORS = ["#C9B68E", "#7A3D23", "#E6A403", "#302C29", "#AA2D2D"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CumulativeYTD({ data }) {
  // Reshape: pivot so each year is a series, x-axis is month-of-year
  if (!data?.length) return <ChartShell><LineChart data={[]} /></ChartShell>;

  const merged = MONTHS.map((label, i) => {
    const row = { month: i + 1, label };
    data.forEach(({ year, points }) => {
      const point = points.find((p) => p.month === i + 1);
      row[year] = point ? point.Total : null;
    });
    return row;
  });

  const years = data.map((d) => d.year);

  return (
    <ChartShell>
      <LineChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tickFormatter={fmtCurrencyShort} width={50} />
        <Tooltip formatter={(v) => fmtCurrencyFull(v)} />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        {years.map((y, idx) => (
          <Line
            key={y}
            type="monotone"
            dataKey={y}
            stroke={YEAR_COLORS[idx % YEAR_COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ChartShell>
  );
}
