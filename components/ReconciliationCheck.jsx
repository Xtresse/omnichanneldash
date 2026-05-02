"use client";

const fmt$ = (n) => {
  if (n === null || n === undefined) return "$0";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString();
};
const fmtN = (n) => Math.round(n || 0).toLocaleString();
const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

const TOLERANCE = 1; // dollar deltas under $1 are noise — display as "ties out"

/**
 * Visible reconciliation panel — verifies that every chart's totals tie
 * back to the headline KPI numbers. Discrepancies are flagged so silent
 * aggregation bugs don't go unnoticed.
 *
 * Three sections:
 *   1. Net sales — KPI total vs each chart's sum
 *   2. New accounts — chronological vs tag-based ('First Order' tag)
 *   3. Territory rollup — Existing / New / 1099 totals
 */
export default function ReconciliationCheck({ reconciliation }) {
  if (!reconciliation) return null;
  const ns = reconciliation.netSales || {};
  const na = reconciliation.newAccounts || {};
  const territory = reconciliation.territoryRollup || [];

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="p-3 md:p-5 space-y-4 md:space-y-5">
        {/* Net sales checks */}
        <CheckSection title="Net sales — should tie to KPI total">
          <CheckRow
            label="B2B + ADCS + DTC buckets"
            actual={ns.bucketSum}
            expected={ns.kpiTotal}
            delta={ns.bucketDelta}
          />
          <CheckRow
            label="Sum of monthly time series (Net sales by channel)"
            actual={ns.monthlySeriesSum}
            expected={ns.kpiTotal}
            delta={ns.monthlySeriesDelta}
          />
          <CheckRow
            label="Net sales by product family (categorized only)"
            actual={ns.productFamilySum}
            expected={ns.kpiTotal}
            delta={ns.productFamilyDelta}
            note={`${fmtPct(ns.productFamilyCoveragePct)} of total — remainder is line items in Other / Excluded categories`}
            allowDelta
          />
          <CheckRow
            label="Top 10 SKUs (out of all SKUs)"
            actual={ns.topSkusSum}
            expected={ns.allSkuSum}
            delta={(ns.allSkuSum || 0) - (ns.topSkusSum || 0)}
            note={`${fmtPct(ns.topSkusCoveragePct)} of all SKU revenue shown in Top 10`}
            allowDelta
          />
          <CheckRow
            label="Top 15 states (out of all states)"
            actual={ns.revenueByStateSum}
            expected={ns.allStateSum}
            delta={(ns.allStateSum || 0) - (ns.revenueByStateSum || 0)}
            note={`${fmtPct(ns.revenueByStateCoveragePct)} of state-attributed revenue in Top 15`}
            allowDelta
          />
          <CheckRow
            label="Rep performance total (B2B-only)"
            actual={ns.repPerformanceSum}
            expected={ns.b2bTotal}
            delta={ns.repPerformanceDelta}
          />
        </CheckSection>

        {/* New accounts checks */}
        <CheckSection title="New accounts — chronological vs Shopify First-Order tag">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat
              label="Chronological new accounts"
              value={fmtN(na.chronologicalTotal)}
              hint="First order from each customer × rep, computed from order dates"
            />
            <Stat
              label="First-order gummy accounts"
              value={fmtN(na.firstOrderGummyTotal)}
              hint="Orders Shopify Flow tagged 'b2b' + 'first order' that contain a gummy line item — leadership-dash convention"
            />
            <Stat
              label="Difference"
              value={fmtN(na.delta)}
              hint="Chronological count typically ≥ tag count: Flow only tags orders meeting specific conditions"
              tone={Math.abs(na.delta || 0) === 0 ? "ok" : "neutral"}
            />
          </div>
        </CheckSection>

        {/* Territory rollup */}
        <CheckSection title="Territory rollup">
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-xs font-sans border-collapse">
              <thead>
                <tr className="bg-paper2 text-left">
                  <ThSm>Territory</ThSm>
                  <ThSm align="right">Reps</ThSm>
                  <ThSm align="right">Orders</ThSm>
                  <ThSm align="right">Net sales</ThSm>
                  <ThSm align="right">Chrono new</ThSm>
                  <ThSm align="right">First-order gummy</ThSm>
                </tr>
              </thead>
              <tbody>
                {territory.map((t) => (
                  <tr key={t.territory} className="border-t border-rule/60">
                    <TdSm className="font-medium text-ink">{t.territory}</TdSm>
                    <TdSm align="right">{fmtN(t.reps)}</TdSm>
                    <TdSm align="right">{fmtN(t.orders)}</TdSm>
                    <TdSm align="right" className="font-semibold">{fmt$(t.net)}</TdSm>
                    <TdSm align="right">{fmtN(t.newAccounts)}</TdSm>
                    <TdSm align="right">{fmtN(t.firstOrderGummy)}</TdSm>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-paper2 font-semibold border-t border-rule/60">
                  <TdSm className="italic text-inksoft">Total</TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.reps, 0))}</TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.orders, 0))}</TdSm>
                  <TdSm align="right" className="text-brown">
                    {fmt$(territory.reduce((a, t) => a + t.net, 0))}
                  </TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.newAccounts, 0))}</TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.firstOrderGummy, 0))}</TdSm>
                </tr>
              </tfoot>
            </table>
          </div>
        </CheckSection>
      </div>
    </div>
  );
}

function CheckSection({ title, children }) {
  return (
    <div className="space-y-2">
      <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function CheckRow({ label, actual, expected, delta, note, allowDelta }) {
  const d = Math.round(delta || 0);
  const passes = Math.abs(d) <= TOLERANCE;
  // For "subset" rows (allowDelta=true) we don't flag a non-zero delta as
  // a failure — it's expected (Top 10, Top 15, etc.).
  const tone = allowDelta ? "neutral" : passes ? "ok" : "fail";

  return (
    <div className="flex items-start gap-3 py-1.5">
      <Indicator tone={tone} />
      <div className="flex-1 min-w-0">
        <div className="font-sans text-xs text-inksoft">{label}</div>
        {note && (
          <div className="font-sans text-[10px] text-muted leading-snug mt-0.5">
            {note}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-sans text-xs tabular-nums text-ink">
          {fmt$(actual)} {expected !== undefined && expected !== null && (
            <span className="text-muted"> / {fmt$(expected)}</span>
          )}
        </div>
        {!allowDelta && (
          <div
            className={`font-sans text-[10px] tabular-nums ${
              passes ? "text-muted" : "text-red-700"
            }`}
          >
            Δ {fmt$(d)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone = "neutral" }) {
  const valueColor =
    tone === "ok" ? "text-brown" : "text-ink";
  return (
    <div className="rounded-md border border-rule bg-paper2/50 px-3 py-2">
      <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold">
        {label}
      </div>
      <div className={`font-display text-2xl font-semibold mt-1 leading-none ${valueColor}`}>
        {value}
      </div>
      {hint && (
        <div className="font-sans text-[10px] text-muted mt-1.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}

function Indicator({ tone }) {
  // ok = green dot · fail = red dot · neutral = grey dot
  const cls =
    tone === "ok"
      ? "bg-emerald-600"
      : tone === "fail"
      ? "bg-red-600"
      : "bg-tan";
  return (
    <span className={`shrink-0 mt-1.5 inline-block w-2 h-2 rounded-full ${cls}`} aria-hidden="true" />
  );
}

function ThSm({ children, align = "left" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <th
      className={`py-2 px-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted font-semibold ${alignClass}`}
    >
      {children}
    </th>
  );
}

function TdSm({ children, align = "left", className = "" }) {
  const alignClass = align === "right" ? "text-right tabular-nums" : "text-left";
  return (
    <td className={`py-1.5 px-2 text-inksoft whitespace-nowrap ${alignClass} ${className}`}>
      {children}
    </td>
  );
}
