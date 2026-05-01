"use client";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNum = (n) =>
  new Intl.NumberFormat("en-US").format(n || 0);

const fmtPct = (n) =>
  `${Math.round((n || 0) * 100)}%`;

export default function KpiTiles({ kpis }) {
  if (!kpis) return null;

  const tiles = [
    {
      label: "Total revenue",
      value: fmtCurrency(kpis.totalRevenue),
      sub: `${fmtNum(kpis.totalOrders)} orders`,
      accent: "ink",
    },
    {
      label: "B2B revenue",
      value: fmtCurrency(kpis.b2bRevenue),
      sub: `${fmtPct(kpis.b2bShare)} of total`,
      accent: "b2b",
    },
    {
      label: "DTC revenue",
      value: fmtCurrency(kpis.dtcRevenue),
      sub: `${fmtPct(kpis.dtcShare)} of total`,
      accent: "dtc",
    },
    {
      label: "B2B AOV",
      value: fmtMoney(kpis.b2bAOV),
      sub: `${fmtNum(kpis.b2bOrders)} B2B orders`,
      accent: "b2b",
    },
    {
      label: "DTC AOV",
      value: fmtMoney(kpis.dtcAOV),
      sub: `${fmtNum(kpis.dtcOrders)} DTC orders`,
      accent: "dtc",
    },
    {
      label: "Channel mix",
      value: `${Math.round(kpis.b2bShare * 100)} / ${Math.round(kpis.dtcShare * 100)}`,
      sub: "B2B / DTC %",
      accent: "ink",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </div>
  );
}

function Tile({ label, value, sub, accent }) {
  const accentClass =
    accent === "b2b"
      ? "border-l-[3px] border-b2b"
      : accent === "dtc"
      ? "border-l-[3px] border-dtc"
      : "border-l-[3px] border-ink";

  return (
    <div className={`${accentClass} bg-paper2/60 border border-rule rounded-md px-3 py-2.5 md:px-4 md:py-3.5`}>
      <div className="font-sans text-[9px] md:text-[10px] uppercase tracking-[0.16em] text-muted leading-tight">
        {label}
      </div>
      <div className="font-serif text-lg md:text-2xl font-medium leading-tight mt-1 break-words">
        {value}
      </div>
      <div className="font-sans text-[10px] md:text-[11px] text-inksoft mt-0.5 leading-tight">
        {sub}
      </div>
    </div>
  );
}
