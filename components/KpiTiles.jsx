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

  const tiles = [
    {
      label: "Total revenue",
      value: fmtCurrency(kpis.totalRevenue),
      sub: `${fmtNum(kpis.totalOrders)} orders, B2B + DTC`,
    },
    {
      label: "B2B revenue",
      value: fmtCurrency(kpis.b2bRevenue),
      sub: `${fmtPct(kpis.b2bShare)} of total · ${fmtNum(kpis.b2bOrders)} orders · AOV ${fmtCurrency(
        kpis.b2bAOV
      )}`,
    },
    {
      label: "DTC revenue",
      value: fmtCurrency(kpis.dtcRevenue),
      sub: `${fmtPct(kpis.dtcShare)} of total · ${fmtNum(kpis.dtcOrders)} orders · AOV ${fmtCurrency(
        kpis.dtcAOV
      )}`,
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

function Tile({ label, value, sub }) {
  return (
    <div className="bg-paper2 border border-rule rounded-md px-4 py-3.5 md:px-5 md:py-4">
      <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
        {label}
      </div>
      <div className="font-serif text-3xl md:text-4xl font-bold text-ink leading-tight mt-2 md:mt-3 break-words">
        {value}
      </div>
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1.5 leading-snug">
        {sub}
      </div>
    </div>
  );
}
