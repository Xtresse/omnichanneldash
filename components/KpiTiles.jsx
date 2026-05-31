"use client";

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
const FAVORABLE = "#C8860D"; // green sage
const UNFAVORABLE = "#AA2D2D"; // brand maroon
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

export default function KpiTiles({ kpis, compare }) {
  if (!kpis) return null;
  const cmp = compare && compare.kpis ? compare.kpis : null;
  const cmpLabel = compare ? labelFor(compare) : null;
  const dateRange = compare ? formatDateRange(compare.from, compare.to) : null;

  // Three MUTUALLY EXCLUSIVE buckets that sum to total net sales.
  // B2B excludes ADCS now (per Sam's request). ADCS is its own line.
  const totalOrders =
    (kpis.b2bOrders || 0) + (kpis.adcsOrders || 0) + (kpis.dtcOrders || 0);
  const grossToNet = kpis.totalGrossSales
    ? Math.round((kpis.totalNetSales / kpis.totalGrossSales) * 100)
    : null;
  const tiles = [
    {
      label: "Total net sales",
      value: fmtCurrency(kpis.totalNetSales),
      sub: `Gross ${fmtCurrency(kpis.totalGrossSales)}${
        grossToNet != null ? ` → net ${grossToNet}% of gross` : ""
      } · ${fmtNum(totalOrders)} orders`,
      tone: "primary",
      cur: kpis.totalNetSales,
      prior: cmp ? cmp.totalNetSales : null,
    },
    {
      label: "B2B net sales",
      value: fmtCurrency(kpis.b2bNetSales),
      sub: `${fmtPct(kpis.b2bShare)} of total · ${fmtNum(kpis.b2bOrders)} orders · AOV ${fmtCurrency(
        kpis.b2bAOV
      )}`,
      tone: "accent",
      cur: kpis.b2bNetSales,
      prior: cmp ? cmp.b2bNetSales : null,
    },
    {
      label: "ADCS net sales",
      value: fmtCurrency(kpis.adcsNetSales),
      sub: `${fmtPct(kpis.adcsShare)} of total · ${fmtNum(kpis.adcsOrders)} orders · AOV ${fmtCurrency(
        kpis.adcsAOV
      )}`,
      tone: "accent",
      cur: kpis.adcsNetSales,
      prior: cmp ? cmp.adcsNetSales : null,
    },
    {
      label: "DTC net sales",
      value: fmtCurrency(kpis.dtcNetSales),
      sub: `${fmtPct(kpis.dtcShare)} of total · ${fmtNum(kpis.dtcOrders)} orders · AOV ${fmtCurrency(
        kpis.dtcAOV
      )}`,
      tone: "muted",
      cur: kpis.dtcNetSales,
      prior: cmp ? cmp.dtcNetSales : null,
    },
  ];

  return (
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
  // Friendly window length label for prior-period mode.
  const f = new Date(compare.from + "T00:00:00Z");
  const t = new Date(compare.to + "T00:00:00Z");
  const days = Math.round((t - f) / 86400000) + 1;
  if (days === 1) return "yesterday";
  if (days === 7) return "prior 7d";
  if (days === 14) return "prior 14d";
  if (days === 30) return "prior 30d";
  if (days === 90) return "prior 90d";
  return `prior ${days}d`;
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
