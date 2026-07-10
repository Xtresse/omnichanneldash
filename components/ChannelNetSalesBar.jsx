"use client";

// Total Sales by Channel — broken out by channel, showing BOTH gross and net
// per channel. Replaces the old B2B-MTD bar AND the redundant KPI tiles.
//
// Driven entirely by the selected FilterBar window: the parent Dashboard passes
// in the `kpis` block (net + gross per channel) for whatever period / Today is
// active, plus a `periodLabel`. So these cards fluctuate with the date picker
// exactly like every other card — no independent MTD fetch.
//
// Tie-out: channels sum to Total by construction, for both metrics —
//   B2B = total − dtc − adcs · DTC = dtc · ADCS = adcs.
//
// The Gross/Net toggle picks which basis the "% of Base goal" bar compares
// against. Every goal bar (per-channel AND Total) is always MTD-to-date vs.
// the full-month Base target, regardless of the FilterBar window selected
// above — via `budgetTargets`/`mtdKpis` props, NOT an independent self-fetch:
// this component used to self-fetch /api/budget + its own MTD window, which
// (stacked on top of BudgetVsActual.jsx's and Dashboard.jsx's own equivalent
// self-fetches) pushed concurrent Shopify GraphQL calls over the rate limit
// on page load (real "Throttled" 500s, 2026-07-09). Dashboard.jsx now fetches
// both ONCE and passes them down here.
//
// `metric`/`onMetricChange` are controlled by the parent's shared `revMetric`
// state (Dashboard.jsx) — the SAME Gross/Net toggle that drives the
// Executive Summary, Top-Line Performance charts, and Actual vs Goal. This
// used to be its own local toggle, which looked identical to those but
// silently didn't affect anything outside this card — now one toggle
// anywhere on the page moves everything together.

const ALL_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fmt$ = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n || 0);

const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

export default function ChannelNetSalesBar({
  kpis = null,
  periodLabel = "Selected period",
  error = null,
  metric = "net",
  onMetricChange = () => {},
  budgetTargets = null,
  mtdKpis = null,
}) {
  const err = error;
  const loading = kpis == null && !err;
  const targets = budgetTargets;

  // Both metrics per channel; B2B = total − dtc − adcs so each ties to Total.
  const num = (v) => (kpis ? Number(v || 0) : null);
  const totalNet = num(kpis?.totalNetSales);
  const totalGross = num(kpis?.totalGrossSales);
  const dtcNet = num(kpis?.dtcNetSales);
  const dtcGross = num(kpis?.dtcGrossSales);
  const adcsNet = num(kpis?.adcsNetSales);
  const adcsGross = num(kpis?.adcsGrossSales);
  const b2bNet = kpis ? totalNet - dtcNet - adcsNet : null;
  const b2bGross = kpis ? totalGross - dtcGross - adcsGross : null;

  // This month's Base-tier target for a channel, summed across products, at
  // the toggled basis (gross/net) — same cube BudgetVsActual.jsx's coTarget reads.
  const ym = currentMonth();
  const co = targets?.company || {};
  const baseTarget = (channel) =>
    ALL_PRODUCTS.reduce((a, p) => a + Number(co?.[channel]?.[p]?.[ym]?.base?.[metric] || 0), 0);

  // Every goal bar (per-channel AND Total) always compares MTD-to-date vs.
  // the full-month Base target — never whatever window the FilterBar has
  // selected above. Otherwise e.g. "Today" actuals against a full-month
  // target reads as a near-frozen ~0-3% no matter what happens that day.
  const mtdNum = (v) => (mtdKpis ? Number(v || 0) : null);
  const mtdTotalNet = mtdNum(mtdKpis?.totalNetSales);
  const mtdTotalGross = mtdNum(mtdKpis?.totalGrossSales);
  const mtdDtcNet = mtdNum(mtdKpis?.dtcNetSales);
  const mtdDtcGross = mtdNum(mtdKpis?.dtcGrossSales);
  const mtdAdcsNet = mtdNum(mtdKpis?.adcsNetSales);
  const mtdAdcsGross = mtdNum(mtdKpis?.adcsGrossSales);
  const mtdB2bNet = mtdKpis ? mtdTotalNet - mtdDtcNet - mtdAdcsNet : null;
  const mtdB2bGross = mtdKpis ? mtdTotalGross - mtdDtcGross - mtdAdcsGross : null;

  const mtdByChannel = {
    B2B: { net: mtdB2bNet, gross: mtdB2bGross },
    DTC: { net: mtdDtcNet, gross: mtdDtcGross },
    ADCS: { net: mtdAdcsNet, gross: mtdAdcsGross },
  };

  // All-channel Base target + MTD-to-date actual, for the Total card's goal bar.
  const allTarget = targets ? baseTarget("B2B") + baseTarget("DTC") + baseTarget("ADCS") : null;
  const mtdActual = mtdKpis ? Number((metric === "gross" ? mtdKpis.totalGrossSales : mtdKpis.totalNetSales) || 0) : null;
  const totalGoalShare = allTarget && allTarget > 0 && mtdActual != null ? mtdActual / allTarget : null;

  const CHANNELS = [
    { label: "B2B", net: b2bNet, gross: b2bGross, note: "Reps · clinics, med spas, derms" },
    { label: "DTC", net: dtcNet, gross: dtcGross, note: "Shopify direct-to-consumer" },
    { label: "ADCS", net: adcsNet, gross: adcsGross, note: "Aesthetic Derm + Cosmetic Surgery" },
  ];

  return (
    <div className="rounded-xl border border-rule bg-paper2/60 p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3 mb-2.5 md:mb-3 flex-wrap">
        <h2 className="font-display text-lg md:text-xl font-semibold text-ink leading-tight">
          Total Sales by Channel
        </h2>
        <div className="flex items-center gap-2">
          <MetricToggle value={metric} onChange={onMetricChange} />
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted leading-snug">
            {periodLabel}
          </span>
        </div>
      </div>

      {err && (
        <div className="mb-2.5 md:mb-3 rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] md:text-xs text-red-900 leading-snug">
          <strong>Couldn&apos;t load sales:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {CHANNELS.map((c) => {
          const mtdRaw = mtdByChannel[c.label];
          const mtdChannelActual = mtdRaw ? (metric === "gross" ? mtdRaw.gross : mtdRaw.net) : null;
          const target = targets ? baseTarget(c.label) : null;
          const goalShare = target && target > 0 && mtdChannelActual != null ? mtdChannelActual / target : null;
          return (
            <ChannelCard
              key={c.label}
              label={c.label}
              note={c.note}
              loading={loading}
              error={err}
              gross={c.gross}
              net={c.net}
              metric={metric}
              mtdActual={mtdChannelActual}
              goalShare={goalShare}
            />
          );
        })}

        {/* Total — emphasized */}
        <div className="relative bg-card border-2 border-brown rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0">
          <div className="flex items-baseline justify-between">
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">Total</span>
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">{periodLabel}</span>
          </div>
          <MetricPair loading={loading} error={err} gross={totalGross} net={totalNet} metric={metric} big />

          <div className="mt-2 pt-2 border-t border-rule font-sans text-[11px] md:text-xs text-inksoft leading-snug">
            {mtdKpis == null || totalGoalShare == null ? (
              "—"
            ) : (
              <>
                <span className="tabular-nums font-semibold">{fmt$(mtdActual)}</span>
                <span className="text-muted"> MTD · </span>
                <span className="tabular-nums font-semibold">{fmtPct(totalGoalShare)}</span>
                <span className="text-muted"> of Base goal</span>
              </>
            )}
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full rounded-full bg-paper2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(0, Math.min(1, totalGoalShare || 0)) * 100}%`, background: "#5C2F2E" }}
                aria-label={`MTD share of Base goal: ${fmtPct(totalGoalShare || 0)}`}
              />
            </div>
          </div>

          <div className="font-sans text-[10px] text-muted leading-snug mt-1.5">B2B + DTC + ADCS</div>
        </div>
      </div>
    </div>
  );
}

// Compact Gross/Net segmented toggle — picks the basis for the "% of Base
// goal" bar below (mirrors the private MetricToggle in Dashboard.jsx).
function MetricToggle({ value, onChange }) {
  const opts = [
    { k: "gross", label: "Gross" },
    { k: "net", label: "Net" },
  ];
  return (
    <div className="inline-flex rounded-md border border-rule overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.12em] px-2 py-1 min-h-touch sm:min-h-0 ${
            value === o.k ? "bg-brown text-ink font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Gross + Net stacked pair. `big` = larger type for the Total card. `metric`
// (from the Gross/Net toggle) visually emphasizes the selected one — the
// toggle otherwise only moves the "% of Base goal" bar, which barely shifts
// since actual and target scale by the same gross↔net ratio, so this is the
// visible confirmation that the toggle actually did something.
function MetricPair({ loading, error, gross, net, metric = "net", big }) {
  const bigCls = big ? "sm:text-2xl md:text-3xl" : "md:text-2xl";
  const activeCls = `font-display text-xl ${bigCls} font-semibold text-ink leading-none tabular-nums`;
  const dimCls = `font-display text-base ${big ? "sm:text-lg md:text-xl" : "md:text-lg"} font-medium text-muted leading-none tabular-nums`;
  const show = (v) =>
    loading ? <span className="text-muted">…</span> : error ? <span className="text-base">—</span> : fmt$(v);
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
      <div>
        <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted">Gross</div>
        <div className={metric === "gross" ? activeCls : dimCls}>{show(gross)}</div>
      </div>
      <div>
        <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted">Net</div>
        <div className={metric === "net" ? activeCls : dimCls}>{show(net)}</div>
      </div>
    </div>
  );
}

function ChannelCard({ label, note, loading, error, gross, net, metric, mtdActual, goalShare }) {
  const sharePct = goalShare != null ? Math.max(0, Math.min(1, goalShare)) : 0;
  return (
    <div className="relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
                    before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-brown">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
          {label}
        </div>
      </div>

      {/* Gross + Net */}
      <MetricPair loading={loading} error={error} gross={gross} net={net} metric={metric} />

      {/* MTD share of Base goal — always MTD, regardless of the FilterBar window above */}
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-2 leading-snug">
        {loading || goalShare == null ? (
          "—"
        ) : (
          <>
            <span className="tabular-nums font-semibold">{fmt$(mtdActual)}</span>
            <span className="text-muted"> MTD · </span>
            <span className="tabular-nums font-semibold">{fmtPct(goalShare)}</span>
            <span className="text-muted"> of Base goal</span>
          </>
        )}
      </div>

      {/* Share bar */}
      <div className="mt-2 pt-2 border-t border-rule/60">
        <div className="h-1.5 w-full rounded-full bg-paper2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${sharePct * 100}%`, background: "#5C2F2E" }}
            aria-label={`Share of Base goal: ${fmtPct(goalShare || 0)}`}
          />
        </div>
      </div>

      <div className="font-sans text-[10px] text-muted leading-snug mt-1.5">{note}</div>
    </div>
  );
}
