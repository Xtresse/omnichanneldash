"use client";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

export default function KpiTiles({ kpis }) {
  if (!kpis) return null;

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
    },
    {
      label: "ADCS net sales",
      value: fmtCurrency(kpis.adcsNetSales),
      sub: `${fmtPct(kpis.adcsShare)} of total · ${fmtNum(kpis.adcsOrders)} orders · AOV ${fmtCurrency(
        kpis.adcsAOV
      )}`,
      tone: "accent",
    },
    {
      label: "DTC net sales",
      value: fmtCurrency(kpis.dtcNetSales),
      sub: `${fmtPct(kpis.dtcShare)} of total · ${fmtNum(kpis.dtcOrders)} orders · AOV ${fmtCurrency(
        kpis.dtcAOV
      )}`,
      tone: "muted",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const stripe =
    tone === "primary"
      ? "before:bg-brown"
      : tone === "accent"
      ? "before:bg-accent"
      : "before:bg-tan";
  return (
    <div
      className={`relative bg-card border border-rule rounded-xl px-4 py-3.5 md:px-5 md:py-4 overflow-hidden
        before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripe}`}
    >
      <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-tight mt-2 md:mt-3 break-words">
        {value}
      </div>
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1.5 leading-snug">{sub}</div>
    </div>
  );
}
