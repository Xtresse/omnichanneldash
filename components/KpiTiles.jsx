"use client";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

// Status palette read from the CSS-var design tokens (matches the
// `--status-*` set defined in app/globals.css). Centralizing here means
// every delta cell, every reconciliation indicator, and every progress
// bar share the same hue — dark-mode flips happen automatically because
// the tokens are var-driven. Hex fallbacks ship for the rare case where
// these helpers are called before the document has resolved its vars
// (SSR snapshot, etc.).
const FAVORABLE   = "rgb(var(--status-good))";
const UNFAVORABLE = "rgb(var(--status-bad))";
const NEUTRAL     = "rgb(var(--status-neutral))";

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

/** Tiny inline SVG up/down/flat arrow. Replaces the unicode triangles so
 *  weight/size match the surrounding Inter text on every platform. */
function DeltaArrow({ cur, prior, className = "" }) {
  if (prior === undefined || prior === null) return null;
  if (cur === prior) {
    return (
      <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" className={className}>
        <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  const up = cur > prior;
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" className={className}>
      {up ? (
        <path d="M6 2 L10 8 L2 8 Z" fill="currentColor" />
      ) : (
        <path d="M6 10 L10 4 L2 4 Z" fill="currentColor" />
      )}
    </svg>
  );
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
  const tooltip = dateRange
    ? `vs ${label} (${dateRange}): ${fmt(prior)}`
    : `vs ${label}: ${fmt(prior)}`;
  return (
    <div
      className="font-sans text-[10px] md:text-[11px] tabular-nums leading-tight inline-flex items-center gap-1"
      style={{ color }}
      title={tooltip}
    >
      <span className="tabular-nums">{fmt(prior)}</span>
      <DeltaArrow cur={cur} prior={prior} />
      <span className="tabular-nums">{pctText ?? "—"}</span>
      <span className="text-muted ml-0.5">vs {label}</span>
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
  const tiles = [
    {
      label: "B2B net sales",
      value: fmtCurrency(kpis.b2bNetSales),
      sub: `${fmtPct(kpis.b2bShare)} of total · ${fmtNum(kpis.b2bOrders)} orders · AOV ${fmtCurrency(
        kpis.b2bAOV
      )}`,
      tone: "primary",
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
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
  // Accent stripe color by tone — mapped to brand tokens so dark mode
  // flips with the rest of the palette automatically.
  const stripe =
    tone === "primary" ? "bg-brown"
    : tone === "accent" ? "bg-accent"
    : "bg-tan";

  return (
    <div className="relative card-tile card-surface-hover px-4 py-3.5 md:px-5 md:py-4 overflow-hidden group">
      {/* Accent stripe — animates to slightly wider on hover, a small but
          tactile detail that signals "this card is interactive context". */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-1 ${stripe} transition-[width] duration-mid ease-out group-hover:w-1.5`}
      />

      <div className="eyebrow text-muted leading-tight">{label}</div>

      <div className="font-display text-[2.05rem] md:text-[2.55rem] font-semibold text-ink leading-[1.05] mt-2 md:mt-2.5 tabular-nums break-words">
        {value}
      </div>

      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1.5 leading-snug">
        {sub}
      </div>

      {compareOn && (
        <div className="mt-2 pt-2 border-t border-rule/60">
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
