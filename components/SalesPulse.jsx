"use client";

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);

const FAVORABLE = "#5C8A6F";
const UNFAVORABLE = "#5C2F2E";
const NEUTRAL = "#9A8F80";

function deltaPctText(cur, prior) {
  if (prior === undefined || prior === null) return null;
  if (!prior || prior <= 0) return cur > 0 ? "new" : "—";
  const x = (cur - prior) / prior;
  if (!isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function deltaColor(cur, prior, higherIsBetter = true) {
  if (prior === undefined || prior === null) return NEUTRAL;
  if (cur === prior) return NEUTRAL;
  const up = cur > prior;
  if (higherIsBetter) return up ? FAVORABLE : UNFAVORABLE;
  return up ? UNFAVORABLE : FAVORABLE;
}

function arrow(cur, prior) {
  if (prior === undefined || prior === null) return "";
  if (cur > prior) return "▲";
  if (cur < prior) return "▼";
  return "·";
}

/**
 * Returns the family with the largest net across the period.
 * productFamily rows are { family, B2B, ADCS, DTC }.
 */
function topFamily(productFamily) {
  if (!productFamily?.length) return null;
  return productFamily
    .map((r) => ({ name: r.family, net: (r.B2B || 0) + (r.ADCS || 0) + (r.DTC || 0) }))
    .sort((a, b) => b.net - a.net)[0];
}

/**
 * Returns the highest-grossing rep across all territories.
 * repPerformance is [{ territory, rows: [{ rep, net, ... }] }].
 */
function topRep(repPerformance) {
  if (!repPerformance?.length) return null;
  let best = null;
  for (const sec of repPerformance) {
    for (const r of sec.rows || []) {
      if (!best || (r.net || 0) > best.net) {
        best = { name: r.rep, net: r.net || 0, territory: sec.territory };
      }
    }
  }
  return best;
}

function topState(revenueByState) {
  if (!revenueByState?.length) return null;
  return { name: revenueByState[0].state, net: revenueByState[0].Total };
}

/**
 * Discount uptake = orders w/ a tracked code / total orders. discountUsage
 * counts can double-count when an order uses multiple codes; cap at 1.0.
 */
function discountUptake(discountUsage, totalOrders) {
  if (!discountUsage?.length || !totalOrders) return 0;
  const codedOrders = discountUsage.reduce((s, r) => s + (r.count || 0), 0);
  return Math.min(1, codedOrders / totalOrders);
}

/**
 * Most-recent bucket repeat rate, blended across B2B + DTC by simple avg.
 * repeatRate rows are { month, label, B2B, DTC } where B2B/DTC are already
 * percentages (0–100).
 */
function latestRepeatRate(repeatRate) {
  if (!repeatRate?.length) return null;
  const last = repeatRate[repeatRate.length - 1];
  const b2b = last.B2B || 0;
  const dtc = last.DTC || 0;
  // Average only the non-zero sides so a missing channel doesn't drag it.
  const sides = [b2b, dtc].filter((v) => v > 0);
  if (!sides.length) return 0;
  return sides.reduce((s, v) => s + v, 0) / sides.length;
}

function Tile({ label, value, hint, cur, prior, higherIsBetter, fmt, href }) {
  const pct = deltaPctText(cur, prior);
  const color = deltaColor(cur, prior, higherIsBetter);
  const ar = arrow(cur, prior);
  const showDelta =
    cur !== undefined && prior !== undefined && prior !== null;
  return (
    <a
      href={href}
      className="relative bg-card border border-rule rounded-xl px-3 py-2.5 md:px-4 md:py-3 hover:bg-paper2 transition-colors block"
    >
      <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted leading-tight">
        {label}
      </div>
      <div className="font-display text-xl md:text-2xl font-semibold text-brown leading-none tracking-tight mt-1.5 break-words tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="font-sans text-[11px] text-inksoft mt-1 leading-snug truncate">
          {hint}
        </div>
      )}
      {showDelta && pct && (
        <div
          className="font-sans text-[10px] tabular-nums mt-1 leading-tight"
          style={{ color }}
          title={`prior: ${fmt ? fmt(prior) : prior}`}
        >
          {ar} {pct}
          <span className="text-muted"> vs prior</span>
        </div>
      )}
    </a>
  );
}

export default function SalesPulse({ data }) {
  if (!data?.kpis) return null;
  const k = data.kpis;
  const cmp = data.compare?.kpis || null;

  const totalAOV = k.totalOrders ? k.totalNetSales / k.totalOrders : 0;
  const cmpTotalAOV = cmp && cmp.totalOrders
    ? cmp.totalNetSales / cmp.totalOrders
    : null;

  const fam = topFamily(data.productFamily);
  const rep = topRep(data.repPerformance);
  const state = topState(data.revenueByState);
  const uptake = discountUptake(data.discountUsage, k.totalOrders);
  const repeat = latestRepeatRate(data.repeatRate);

  const returnsPct = k.totalGrossSales
    ? Math.abs(k.totalReturns) / k.totalGrossSales
    : 0;
  const cmpReturnsPct = cmp && cmp.totalGrossSales
    ? Math.abs(cmp.totalReturns) / cmp.totalGrossSales
    : null;

  const tiles = [
    {
      label: "Net sales",
      value: fmtCurrency(k.totalNetSales),
      hint: `${fmtNum(k.totalOrders)} orders`,
      cur: k.totalNetSales,
      prior: cmp ? cmp.totalNetSales : null,
      higherIsBetter: true,
      fmt: fmtCurrency,
      href: "#kpi-channels",
    },
    {
      label: "Blended AOV",
      value: fmtCurrency(totalAOV),
      hint: "net basis",
      cur: totalAOV,
      prior: cmpTotalAOV,
      higherIsBetter: true,
      fmt: fmtCurrency,
      href: "#topline",
    },
    {
      label: "Top family",
      value: fam ? fam.name : "—",
      hint: fam ? fmtCurrency(fam.net) : "no rows",
      href: "#topline",
    },
    {
      label: "Top rep",
      value: rep ? rep.name : "—",
      hint: rep ? `${rep.territory} · ${fmtCurrency(rep.net)}` : "no rows",
      href: "#sales-by-rep",
    },
    {
      label: "Top state",
      value: state ? state.name : "—",
      hint: state ? fmtCurrency(state.net) : "no rows",
      href: "#operational",
    },
    {
      label: "Discount uptake",
      value: `${Math.round(uptake * 100)}%`,
      hint: "orders with a code",
      href: "#operational",
    },
    {
      label: "Repeat rate",
      value: repeat == null ? "—" : `${repeat.toFixed(1)}%`,
      hint: "latest bucket, blended",
      href: "#customer-dynamics",
    },
    {
      label: "Returns",
      value: `${(returnsPct * 100).toFixed(1)}%`,
      hint: "of gross",
      cur: returnsPct,
      prior: cmpReturnsPct,
      higherIsBetter: false,
      fmt: (n) => `${(n * 100).toFixed(1)}%`,
      href: "#reconciliation",
    },
  ];

  return (
    <section className="bg-card border border-rule rounded-xl overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 px-4 py-2.5 md:px-5 md:py-3 border-b border-rule bg-paper">
        <div className="min-w-0">
          <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
            Sales pulse
          </div>
          <h2 className="font-display text-base md:text-lg font-semibold text-brown leading-tight tracking-tight">
            One-glance health
          </h2>
        </div>
        <span className="font-sans text-[10px] md:text-[11px] text-muted">
          tap a tile to jump
        </span>
      </header>
      <div className="p-3 md:p-4 grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {tiles.map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}
