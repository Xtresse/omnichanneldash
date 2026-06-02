"use client";

import { ResponsiveContainer } from "recharts";

export const COLORS = {
  B2B: "#f0922e",        // brand orange — primary channel
  B2BW2: "#f0922e",      // W2 reps — brand orange (the bulk of B2B)
  B2B1099: "#5c2f2e",    // 1099 reps — maroon, clearly distinct from W2 orange
  ADCS: "#a85f28",       // clay — sub-bucket distinct from B2B
  DTC: "#3a7a6f",        // teal-sage
  Total: "#2b1a10",      // brand ink
  Subscription: "#f0922e", // orange
  OneTime: "#c9b68e",    // taupe
  newCust: "#3a7a6f",    // teal
  retCust: "#f0922e",    // orange
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
