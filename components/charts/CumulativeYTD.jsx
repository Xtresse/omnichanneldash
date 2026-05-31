"use client";

import { useEffect, useState } from "react";
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

// Cumulative Net YTD is inherently a full-calendar-year view, so it must
// NOT follow the main FilterBar window (an MTD/single-month filter would
// leave only one cumulative point → an invisible line, which is the bug
// Sam reported). Like the B2B MTD bar, this chart fetches its OWN range:
// Jan 1 of last year → today, giving a current-year line plus a prior-
// year line for YoY pace. Falls back to the prop-passed series while
// loading / on error.
export default function CumulativeYTD({ data, metric = "net" }) {
  const [series, setSeries] = useState(data || []);
  const gross = metric === "gross";

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const yr = now.getFullYear();
    const from = `${yr - 1}-01-01`;
    const to = `${yr}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const qs = new URLSearchParams({ from, to, granularity: "month" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.cumulativeYTD) && j.cumulativeYTD.length) {
          setSeries(j.cumulativeYTD);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!series?.length) return <ChartShell><LineChart data={[]} /></ChartShell>;

  // Pivot so each year is a series, x-axis is month-of-year.
  const merged = MONTHS.map((label, i) => {
    const row = { month: i + 1, label };
    series.forEach(({ year, points }) => {
      const point = points.find((p) => p.month === i + 1);
      row[year] = point ? (gross ? (point.Total_gross ?? point.Total) : point.Total) : null;
    });
    return row;
  });

  const years = series.map((d) => d.year);

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
