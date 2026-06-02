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
// Brand-aligned compare colors — match KpiTiles / RepPerformance.
const FAVORABLE = "#5C8A6F";
const UNFAVORABLE = "#5C2F2E";
const NEUTRAL = "#9A8F80";

function deltaColor(cur, prior, higherIsBetter = true) {
  if (prior === undefined || prior === null) return NEUTRAL;
  if (cur === prior) return NEUTRAL;
  const up = cur > prior;
  if (higherIsBetter) return up ? FAVORABLE : UNFAVORABLE;
  return up ? UNFAVORABLE : FAVORABLE;
}

function deltaPctText(cur, prior) {
  if (prior === undefined || prior === null) return "—";
  if (!prior) return cur > 0 ? "new" : "—";
  const x = (cur - prior) / prior;
  if (!isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function compareLabel(compare) {
  if (!compare) return null;
  if (compare.mode === "yoy") return "last year";
  const f = new Date(compare.from + "T00:00:00Z");
  const t = new Date(compare.to + "T00:00:00Z");
  const days = Math.round((t - f) / 86400000) + 1;
  if (days === 1) return "yesterday";
  return `prior ${days}d (${compare.from} → ${compare.to})`;
}

export default function ReconciliationCheck({ reconciliation, kpis, compare }) {
  if (!reconciliation) return null;
  const ns = reconciliation.netSales || {};
  const na = reconciliation.newAccounts || {};
  const territory = reconciliation.territoryRollup || [];

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="p-3 md:p-5 space-y-4 md:space-y-5">
        {/* Compare-mode strip — shows current vs prior for the four
            headline channel totals (B2B / ADCS / DTC / Total net) so Sam
            can quickly tell whether a discrepancy in any reconciliation
            row carried over from the prior window or is fresh. Hidden
            when compare is off. */}
        {compare && compare.kpis && (
          <CompareStrip kpis={kpis} compare={compare} />
        )}

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
          <CheckRow
            label="DTC channel · tag-based vs SKU-allowlist (xtressedtcdash)"
            actual={ns.dtcSkuTotal}
            expected={ns.dtcTagTotal}
            delta={ns.dtcReconcileDelta}
            note={`Tag-based DTC: ${fmtN(ns.dtcTagOrders || 0)} orders · ${fmt$(ns.dtcTagTotal)}. ` +
              `SKU-allowlist (X-GN-060CT-001 / X-FRC-30ML-001 / XTR-DTC-GMFR-02): ${fmtN(ns.dtcSkuOrders || 0)} orders · ${fmt$(ns.dtcSkuTotal)}. ` +
              `Delta = tag-based DTC orders that don't have a retail SKU, or retail-SKU orders that got tagged B2B/ADCS.`}
            allowDelta
          />
        </CheckSection>

        {/* New accounts checks */}
        <CheckSection title="New accounts — Shopify First-Order tag (headline) vs chronological (sanity)">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="First-order gummy accounts"
              value={fmtN(na.firstOrderGummyTotal)}
              hint="Headline metric. Orders Shopify Flow tagged 'b2b' + 'first order' with positive gummy revenue — exactly how leadership-dash counts new accounts."
              tone="ok"
            />
            <Stat
              label="Chronological (sanity check)"
              value={fmtN(na.chronologicalTotal)}
              hint="Naive: first order from each customer × rep within the loaded window. Only useful as a backstop — a returning customer's earliest order in this window would inflate this count."
            />
            <Stat
              label="Difference"
              value={fmtN(na.delta)}
              hint="Expected non-zero when many existing customers re-ordered in this window. A wide gap usually means lots of returning activity, not a bug."
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
                  <ThSm align="right">New gummy accts</ThSm>
                  <ThSm align="right">Chrono (sanity)</ThSm>
                </tr>
              </thead>
              <tbody>
                {territory.map((t) => (
                  <tr key={t.territory} className="border-t border-rule/60">
                    <TdSm className="font-medium text-ink">{t.territory}</TdSm>
                    <TdSm align="right">{fmtN(t.reps)}</TdSm>
                    <TdSm align="right">{fmtN(t.orders)}</TdSm>
                    <TdSm align="right" className="font-semibold">{fmt$(t.net)}</TdSm>
                    <TdSm align="right" className="font-semibold">{fmtN(t.firstOrderGummy)}</TdSm>
                    <TdSm align="right" className="text-muted">{fmtN(t.chronological)}</TdSm>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-paper2 font-semibold border-t border-rule/60">
                  <TdSm className="italic text-inksoft">Total</TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.reps, 0))}</TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.orders, 0))}</TdSm>
                  <TdSm align="right" className="text-ink">
                    {fmt$(territory.reduce((a, t) => a + t.net, 0))}
                  </TdSm>
                  <TdSm align="right">{fmtN(territory.reduce((a, t) => a + t.firstOrderGummy, 0))}</TdSm>
                  <TdSm align="right" className="text-muted">{fmtN(territory.reduce((a, t) => a + t.chronological, 0))}</TdSm>
                </tr>
              </tfoot>
            </table>
          </div>
        </CheckSection>
      </div>
    </div>
  );
}

/**
 * Compact 4-tile strip surfaced when compare mode is on. Shows current
 * vs prior totals for the four headline reconciliation numbers (Total
 * net, B2B, ADCS, DTC) alongside a delta % so Sam can quickly tell
 * whether a discrepancy is fresh or carries over from the prior period.
 */
function CompareStrip({ kpis, compare }) {
  const lbl = compareLabel(compare);
  const k = kpis || {};
  const p = compare.kpis || {};
  const curTotal = (k.b2bNetSales || 0) + (k.adcsNetSales || 0) + (k.dtcNetSales || 0);
  const priTotal = (p.b2bNetSales || 0) + (p.adcsNetSales || 0) + (p.dtcNetSales || 0);
  return (
    <div className="rounded-md border border-rule bg-paper2/50 px-3 py-2 md:px-4 md:py-3">
      <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted font-semibold mb-1.5">
        Compare — vs {lbl}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <CompareTile label="Total net" cur={curTotal} prior={priTotal} compareLabel={lbl} />
        <CompareTile label="B2B net" cur={k.b2bNetSales || 0} prior={p.b2bNetSales || 0} compareLabel={lbl} />
        <CompareTile label="ADCS net" cur={k.adcsNetSales || 0} prior={p.adcsNetSales || 0} compareLabel={lbl} />
        <CompareTile label="DTC net" cur={k.dtcNetSales || 0} prior={p.dtcNetSales || 0} compareLabel={lbl} />
      </div>
    </div>
  );
}

function CompareTile({ label, prior, cur, compareLabel: lbl }) {
  // For tiles where we don't pass a current value, just show the prior
  // figure as a reference. The KPI tiles up top already carry the live
  // delta — this strip is for at-a-glance scanning of prior totals.
  // The full-window label (e.g. "prior 30d (Apr 4 – May 4, 2026)") is
  // surfaced in the tooltip so a hover/tap on any tile clarifies which
  // comparison window the prior figure refers to.
  const tooltip = lbl ? `vs ${lbl}: ${fmt$(prior)}` : `Prior: ${fmt$(prior)}`;
  return (
    <div className="rounded border border-rule bg-paper px-2.5 py-1.5" title={tooltip}>
      <div className="font-sans text-[9.5px] uppercase tracking-[0.14em] text-muted font-semibold leading-tight">
        {label}
      </div>
      {cur !== null && cur !== undefined ? (
        <>
          <div className="font-display text-base md:text-lg font-semibold text-ink tabular-nums leading-tight mt-0.5">
            {fmt$(cur)}
          </div>
          <div
            className="font-sans text-[10px] tabular-nums leading-tight"
            style={{ color: deltaColor(cur, prior, true) }}
          >
            {fmt$(prior)} prior · {deltaPctText(cur, prior)}
          </div>
        </>
      ) : (
        <div className="font-sans text-sm md:text-base text-inksoft tabular-nums leading-tight mt-0.5">
          {fmt$(prior)}
        </div>
      )}
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
    <div className="flex items-start gap-2 sm:gap-3 py-1.5">
      <Indicator tone={tone} />
      <div className="flex-1 min-w-0">
        <div className="font-sans text-xs text-inksoft leading-snug">{label}</div>
        {note && (
          <div className="font-sans text-[10px] text-muted leading-snug mt-0.5">
            {note}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-sans text-[11px] sm:text-xs tabular-nums text-ink whitespace-nowrap">
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
    tone === "ok" ? "text-ink" : "text-ink";
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
