"use client";

import { useEffect, useState } from "react";

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
// against (self-fetches /api/budget for the current month's Base-tier target,
// same cube components/BudgetVsActual.jsx reads — see lib/budgetSheet.js).

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

export default function ChannelNetSalesBar({ kpis = null, periodLabel = "Selected period", error = null }) {
  const err = error;
  const loading = kpis == null && !err;
  const [metric, setMetric] = useState("net");
  const [targets, setTargets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.ok !== false) setTargets(d?.targets || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
          <MetricToggle value={metric} onChange={setMetric} />
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
          const actual = metric === "gross" ? c.gross : c.net;
          const target = targets ? baseTarget(c.label) : null;
          const goalShare = target && target > 0 && actual != null ? actual / target : null;
          return (
            <ChannelCard
              key={c.label}
              label={c.label}
              note={c.note}
              loading={loading}
              error={err}
              gross={c.gross}
              net={c.net}
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
          <MetricPair loading={loading} error={err} gross={totalGross} net={totalNet} big />
          <div className="font-sans text-[10px] text-muted mt-2 pt-2 border-t border-rule truncate">B2B + DTC + ADCS</div>
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

// Gross + Net stacked pair. `big` = larger type for the Total card.
function MetricPair({ loading, error, gross, net, big }) {
  const valCls = big
    ? "font-display text-xl sm:text-2xl md:text-3xl font-semibold text-ink leading-none tabular-nums"
    : "font-display text-xl md:text-2xl font-semibold text-ink leading-none tabular-nums";
  const show = (v) =>
    loading ? <span className="text-muted">…</span> : error ? <span className="text-base">—</span> : fmt$(v);
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
      <div>
        <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted">Gross</div>
        <div className={valCls}>{show(gross)}</div>
      </div>
      <div>
        <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted">Net</div>
        <div className={valCls}>{show(net)}</div>
      </div>
    </div>
  );
}

function ChannelCard({ label, note, loading, error, gross, net, goalShare }) {
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
      <MetricPair loading={loading} error={error} gross={gross} net={net} />

      {/* Share of Base goal */}
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-2 leading-snug">
        {loading || goalShare == null ? (
          "—"
        ) : (
          <>
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
