"use client";

import { sellingDaysBetween } from "../lib/sellingDays.js";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

// Brand-aligned compare colors (also defined in tailwind.config — using
// inline rgb for resilience in case theme tokens drift).
const FAVORABLE = "#F0922E"; // green sage
const UNFAVORABLE = "#5C2F2E"; // brand maroon
const NEUTRAL = "#9A8F80";

function deltaColor(cur, prior, higherIsBetter = true) {
  if (prior === undefined || prior === null) return NEUTRAL;
  if (cur === prior) return NEUTRAL;
  const up = cur > prior;
  if (higherIsBetter) return up ? FAVORABLE : UNFAVORABLE;
  return up ? UNFAVORABLE : FAVORABLE;
}

// Returns:
//   null  → prior data is missing entirely (treat as "no comparison data")
//   "new" → prior was zero / negative and current is positive (no meaningful %)
//   "—"   → both sides are zero/non-positive (nothing to compare)
//   string with sign — otherwise the rounded percent change
function deltaPctText(cur, prior) {
  if (prior === undefined || prior === null) return null;
  if (!prior || prior <= 0) return cur > 0 ? "new" : "—";
  const x = (cur - prior) / prior;
  if (!isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function arrow(cur, prior) {
  if (prior === undefined || prior === null) return "";
  if (cur > prior) return "▲";
  if (cur < prior) return "▼";
  return "·";
}

function CompareLine({ cur, prior, label, dateRange, fmt = fmtCurrency, higherIsBetter = true }) {
  if (prior === undefined || prior === null) {
    return (
      <div className="font-sans text-[10px] md:text-[11px] text-muted tabular-nums">
        — no {label} data
      </div>
    );
  }
  const pctText = deltaPctText(cur, prior);
  const color = deltaColor(cur, prior, higherIsBetter);
  const ar = arrow(cur, prior);
  // Full hover/tap tooltip — includes the explicit date range so the
  // "vs prior 30d" label can never be ambiguous about which window was
  // compared. Falls back to the short label when no date range is known.
  const tooltip = dateRange
    ? `vs ${label} (${dateRange}): ${fmt(prior)}`
    : `vs ${label}: ${fmt(prior)}`;
  return (
    <div
      className="font-sans text-[10px] md:text-[11px] tabular-nums leading-tight"
      style={{ color }}
      title={tooltip}
    >
      {fmt(prior)} <span style={{ marginLeft: 2 }}>{ar}</span>{" "}
      {pctText ?? "—"}
      <span className="text-muted"> vs {label}</span>
    </div>
  );
}

export default function KpiTiles({ kpis, compare, metric = "net" }) {
  if (!kpis) return null;
  const gross = metric === "gross";
  const word = gross ? "gross" : "net";
  const cmp = compare && compare.kpis ? compare.kpis : null;
  const cmpLabel = compare ? labelFor(compare) : null;
  const dateRange = compare ? formatDateRange(compare.from, compare.to) : null;

  // Three MUTUALLY EXCLUSIVE buckets that sum to the total.
  // B2B excludes ADCS now (per Sam's request). ADCS is its own line.
  const totalOrders =
    (kpis.b2bOrders || 0) + (kpis.adcsOrders || 0) + (kpis.dtcOrders || 0);
  const grossToNet = kpis.totalGrossSales
    ? Math.round((kpis.totalNetSales / kpis.totalGrossSales) * 100)
    : null;
  // Pick the basis driven by the global Net/Gross toggle.
  const total = gross ? kpis.totalGrossSales : kpis.totalNetSales;
  const b2b = gross ? kpis.b2bGrossSales : kpis.b2bNetSales;
  const adcs = gross ? kpis.adcsGrossSales : kpis.adcsNetSales;
  const dtc = gross ? kpis.dtcGrossSales : kpis.dtcNetSales;
  const shareOf = (v) => (total ? v / total : 0);
  const aov = (v, o) => (o ? v / o : 0);
  const tiles = [
    {
      label: `Total ${word} sales`,
      value: fmtCurrency(total),
      sub: gross
        ? `Net ${fmtCurrency(kpis.totalNetSales)}${grossToNet != null ? ` (${grossToNet}% of gross)` : ""} · ${fmtNum(totalOrders)} orders`
        : `Gross ${fmtCurrency(kpis.totalGrossSales)}${grossToNet != null ? ` → net ${grossToNet}% of gross` : ""} · ${fmtNum(totalOrders)} orders`,
      tone: "primary",
      cur: total,
      prior: cmp ? (gross ? cmp.totalGrossSales : cmp.totalNetSales) : null,
    },
    {
      label: `B2B ${word} sales`,
      value: fmtCurrency(b2b),
      sub: `${fmtPct(shareOf(b2b))} of total · ${fmtNum(kpis.b2bOrders)} orders · AOV ${fmtCurrency(aov(b2b, kpis.b2bOrders))}`,
      tone: "accent",
      cur: b2b,
      prior: cmp ? (gross ? cmp.b2bGrossSales : cmp.b2bNetSales) : null,
    },
    {
      label: `ADCS ${word} sales`,
      value: fmtCurrency(adcs),
      sub: `${fmtPct(shareOf(adcs))} of total · ${fmtNum(kpis.adcsOrders)} orders · AOV ${fmtCurrency(aov(adcs, kpis.adcsOrders))}`,
      tone: "accent",
      cur: adcs,
      prior: cmp ? (gross ? cmp.adcsGrossSales : cmp.adcsNetSales) : null,
    },
    {
      label: `DTC ${word} sales`,
      value: fmtCurrency(dtc),
      sub: `${fmtPct(shareOf(dtc))} of total · ${fmtNum(kpis.dtcOrders)} orders · AOV ${fmtCurrency(aov(dtc, kpis.dtcOrders))}`,
      tone: "muted",
      cur: dtc,
      prior: cmp ? (gross ? cmp.dtcGrossSales : cmp.dtcNetSales) : null,
    },
  ];

  return (
    <div className="space-y-2 md:space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {tiles.map((t) => (
          <Tile
            key={t.label}
            {...t}
            cmpLabel={cmpLabel}
            dateRange={dateRange}
            compareOn={!!cmp}
          />
        ))}
      </div>
      {/* Plain-language description of the gross vs net calculation (Mike's
          request) — clarifies what the headline figures and the Net/Gross
          toggle actually mean. */}
      <p className="font-sans text-[10px] md:text-[11px] text-muted leading-snug">
        <strong className="text-inksoft">Gross</strong> = total order value before discounts &amp; returns.{" "}
        <strong className="text-inksoft">Net</strong> = gross − discounts − returns
        {grossToNet != null ? ` (net is currently ${grossToNet}% of gross)` : ""}. Net is the
        dashboard default; use the Net/Gross toggle to switch the basis for every figure above.
      </p>
    </div>
  );
}

/**
 * Friendly date-range label like "Apr 4 – May 4, 2026" for tooltip use.
 * Returns null when either input is missing or unparseable so callers
 * can degrade gracefully.
 */
function formatDateRange(from, to) {
  if (!from || !to) return null;
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return null;
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const fStr = f.toLocaleDateString("en-US", opts);
  const tStr = t.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return sameYear ? `${fStr} – ${tStr}` : `${fStr}, ${f.getUTCFullYear()} – ${tStr}`;
}

function labelFor(compare) {
  if (!compare) return null;
  if (compare.mode === "yoy") return "last year";
  // Prior windows are matched on SELLING DAYS (weekdays minus US holidays),
  // not calendar days, so label them in selling days — a raw "prior Nd" would
  // misstate a window like May 1–7 (7 calendar days, 5 selling days).
  const sd = sellingDaysBetween(
    new Date(compare.from + "T00:00:00Z"),
    new Date(compare.to + "T00:00:00Z")
  );
  return `prior ${sd} selling day${sd === 1 ? "" : "s"}`;
}

function Tile({ label, value, sub, tone, cur, prior, cmpLabel, dateRange, compareOn }) {
  const stripe =
    tone === "primary"
      ? "before:bg-brown"
      : tone === "accent"
      ? "before:bg-accent"
      : "before:bg-tan";
  return (
    <div
      className={`relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
        before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripe}`}
    >
      <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold text-ink leading-tight mt-1.5 sm:mt-2 md:mt-3 break-words">
        {value}
      </div>
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1.5 leading-snug">{sub}</div>
      {compareOn && (
        <div className="mt-1.5 pt-1.5 border-t border-rule/60">
          <CompareLine
            cur={cur}
            prior={prior}
            label={cmpLabel}
            dateRange={dateRange}
            fmt={fmtCurrency}
            higherIsBetter
          />
        </div>
      )}
    </div>
  );
}
