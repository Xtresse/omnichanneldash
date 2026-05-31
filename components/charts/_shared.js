"use client";

import { ResponsiveContainer } from "recharts";

export const COLORS = {
  B2B: "#e6a403",        // rust — matches leadership
  ADCS: "#aa2d2d",       // warm orange-brown — sub-bucket distinct from B2B
  DTC: "#302c29",        // teal
  Total: "#2b1a10",
  Subscription: "#e6a403",
  OneTime: "#c9b68e",
  newCust: "#302c29",
  retCust: "#e6a403",
  Other: "#bfa988",
};

export const fmtCurrencyShort = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${(n / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(n || 0)}`;
};

export const fmtCurrencyFull = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

export const fmtInt = (n) => new Intl.NumberFormat("en-US").format(n || 0);

/**
 * Wraps Recharts ResponsiveContainer with a sensible mobile height.
 * Default 240px on mobile, 320px on desktop via Tailwind.
 */
export function ChartShell({ children, height = "h-60 md:h-80" }) {
  return (
    <div className={`w-full ${height}`}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
