"use client";

// Channel Metrics — the two figures investors ask about first, per channel:
//   • Average Order Value (this period, follows the Net/Gross toggle)
//   • Reorder rate (LIFETIME / all-time, customer- & account-level)
//
// Added 2026-08 for Mike's investor meetings. B2B AOV used to live only in the
// tiny sub-text of KpiTiles (which isn't even rendered on the dashboard) and in
// the dual-axis AOV line chart — so B2B AOV had no headline home the way DTC's
// did. This surfaces AOV for ALL THREE channels together, clearly labeled.
//
// Two DIFFERENT time bases sit side by side on purpose, each labeled:
//   • AOV is window-scoped — it moves with the FilterBar date picker (and the
//     Net/Gross toggle), exactly like every other headline number. Recomputed
//     here from the same kpis block so it respects the toggle.
//   • Reorder rate is LIFETIME (server-computed in lib/windsor.js from all-time
//     history, payload.reorderRates) — the standard investor "repeat rate", and
//     it must stay stable regardless of the loaded window. It is CUSTOMER- /
//     ACCOUNT-level (share of distinct customers/accounts with >=2 lifetime
//     paid orders), distinct from the order-level Repeat Purchase Rate chart.
//       DTC = distinct customers (customer id) · B2B = distinct accounts at
//       Shopify CompanyLocation grain, rep-attributed (the canonical B2B
//       universe). ADCS is intentionally omitted — it's a handful of large
//       institutional orders where a lifetime "reorder %" isn't meaningful.

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtInt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const pct0 = (n) => `${Math.round(n || 0)}%`;

export default function ChannelMetrics({ kpis = null, reorderRates = null, metric = "net", periodLabel = "Selected period" }) {
  if (!kpis) return null;
  const gross = metric === "gross";
  const salesOf = (ch) => Number((gross ? kpis[`${ch}GrossSales`] : kpis[`${ch}NetSales`]) || 0);
  const ordersOf = (ch) => Number(kpis[`${ch}Orders`] || 0);
  const aovOf = (ch) => (ordersOf(ch) ? salesOf(ch) / ordersOf(ch) : 0);

  const aov = [
    { label: "B2B", color: "bg-b2b", value: aovOf("b2b"), orders: ordersOf("b2b") },
    { label: "DTC", color: "bg-dtc", value: aovOf("dtc"), orders: ordersOf("dtc") },
    { label: "ADCS", color: "bg-adcs", value: aovOf("adcs"), orders: ordersOf("adcs") },
  ];

  const rr = reorderRates || {};
  const b2bRR = rr.b2b || null;
  const dtcRR = rr.dtc || null;

  return (
    <div className="rounded-xl border border-rule bg-paper2/60 p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3 mb-2.5 md:mb-3 flex-wrap">
        <h2 className="font-display text-lg md:text-xl font-semibold text-ink leading-tight">
          Channel Metrics
        </h2>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted leading-snug">
          AOV · {periodLabel} · reorder rate · lifetime
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        {/* Average order value — per channel, this period */}
        <div className="bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 min-w-0">
          <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
            Average Order Value
            <span className="normal-case tracking-normal text-muted"> · {gross ? "gross" : "net"}, {periodLabel.toLowerCase()}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {aov.map((c) => (
              <div key={c.label} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${c.color} shrink-0`} aria-hidden="true" />
                  <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-muted">{c.label}</span>
                </div>
                <div className="font-display text-xl sm:text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1 tabular-nums break-words">
                  {fmt$(c.value)}
                </div>
                <div className="font-sans text-[10px] md:text-[11px] text-muted mt-0.5 tabular-nums">{fmtInt(c.orders)} orders</div>
              </div>
            ))}
          </div>
        </div>

        {/* Reorder rate — lifetime, customer/account-level */}
        <div className="bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 min-w-0">
          <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
            Reorder Rate
            <span className="normal-case tracking-normal text-muted"> · lifetime, share that ordered ≥2×</span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <ReorderStat
              label="B2B"
              color="bg-b2b"
              stat={b2bRR}
              denomKey="accounts"
              unit="accounts"
            />
            <ReorderStat
              label="DTC"
              color="bg-dtc"
              stat={dtcRR}
              denomKey="customers"
              unit="customers"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReorderStat({ label, color, stat, denomKey, unit }) {
  const has = stat && typeof stat.pct === "number";
  const denom = has ? Number(stat[denomKey] || 0) : 0;
  const repeat = has ? Number(stat.repeat || 0) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${color} shrink-0`} aria-hidden="true" />
        <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
      </div>
      <div className="font-display text-xl sm:text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1 tabular-nums">
        {has ? pct0(stat.pct) : "—"}
        <span className="font-sans text-[10px] md:text-[11px] font-normal text-muted normal-case tracking-normal"> of {unit}</span>
      </div>
      <div className="font-sans text-[10px] md:text-[11px] text-muted mt-0.5 tabular-nums">
        {has ? `${fmtInt(repeat)} of ${fmtInt(denom)} reordered` : "no data"}
      </div>
    </div>
  );
}
