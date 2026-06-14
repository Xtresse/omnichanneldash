"use client";

import { useEffect, useMemo, useState } from "react";

// Total Sales by Channel — month-to-date, broken out by channel, with a
// Gross/Net toggle. Replaces both the old B2B-MTD bar AND the redundant KPI
// tiles (which showed the same B2B/DTC/ADCS/Total split). ALWAYS month-to-date,
// independent of the FilterBar — the "headline above the dashboard" role.
//
// Data source: /api/dashboard?from=<1st-of-month>&to=<today>, which reuses the
// canonical sales aggregation. We read the kpis block (net + gross per channel)
// and present three channel cards + a Total, for the selected metric.
//
// Tie-out: channels sum to Total by construction —
//   B2B = total − dtc − adcs   (rep-tagged + untagged B2B)
//   DTC = dtc · ADCS = adcs
// so B2B + DTC + ADCS === Total to the dollar, for both gross and net.

const fmt$ = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n || 0);

const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

// Days elapsed INCLUDING today, and total days in the current month.
function dayProgress() {
  const now = new Date();
  const completed = now.getDate();
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { completed, total };
}

// First-of-month → end of TODAY in YYYY-MM-DD (includes today's sales so the
// MTD number is live).
function mtdRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  return { from: ymd(start), to: ymd(now) };
}

export default function ChannelNetSalesBar({ metric = "net", onMetricChange }) {
  const [kpis, setKpis] = useState(null);
  const [err, setErr] = useState(null);

  const { completed, total } = useMemo(() => dayProgress(), []);

  useEffect(() => {
    let cancelled = false;
    const range = mtdRange();
    const qs = new URLSearchParams({ from: range.from, to: range.to, granularity: "auto" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok || !j.kpis) {
          setErr(j.error || "Failed to load sales data");
          return;
        }
        setKpis(j.kpis);
      })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const loading = kpis == null && !err;
  const isGross = metric === "gross";
  const metricWord = isGross ? "Gross" : "Net";

  // Pull the right metric's per-channel values; B2B = total − dtc − adcs so the
  // three channels always tie to Total to the dollar.
  const totalVal = kpis ? Number((isGross ? kpis.totalGrossSales : kpis.totalNetSales) || 0) : null;
  const dtcVal = kpis ? Number((isGross ? kpis.dtcGrossSales : kpis.dtcNetSales) || 0) : null;
  const adcsVal = kpis ? Number((isGross ? kpis.adcsGrossSales : kpis.adcsNetSales) || 0) : null;
  const b2bVal = kpis ? totalVal - dtcVal - adcsVal : null;

  const CHANNELS = [
    { label: "B2B", val: b2bVal, note: "Reps · clinics, med spas, derms" },
    { label: "DTC", val: dtcVal, note: "Shopify direct-to-consumer" },
    { label: "ADCS", val: adcsVal, note: "Aesthetic Derm + Cosmetic Surgery" },
  ];

  return (
    <div className="rounded-xl border border-rule bg-paper2/60 p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3 mb-2.5 md:mb-3 flex-wrap">
        <h2 className="font-display text-lg md:text-xl font-semibold text-ink leading-tight">
          Total {metricWord} Sales by Channel
        </h2>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {onMetricChange && <MetricToggle value={metric} onChange={onMetricChange} />}
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted leading-snug">
            MTD · Day {completed}/{total} · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
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
          const share = totalVal && totalVal > 0 && c.val != null ? c.val / totalVal : null;
          return (
            <ChannelCard
              key={c.label}
              label={c.label}
              metricWord={metricWord}
              note={c.note}
              loading={loading}
              error={err}
              value={c.val}
              share={share}
            />
          );
        })}

        {/* Total — emphasized */}
        <div className="relative bg-card border-2 border-brown rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0">
          <div className="flex items-baseline justify-between">
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">Total {metricWord}</span>
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">MTD</span>
          </div>
          <div className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold text-ink leading-none mt-1.5 tabular-nums">
            {loading ? <span className="text-muted">…</span> : err ? <span className="text-base">—</span> : fmt$(totalVal)}
          </div>
          <div className="font-sans text-[11px] md:text-xs text-inksoft mt-2 pt-2 border-t border-rule">
            {isGross ? "Before discounts & returns" : "Gross − discounts − refunds"}
          </div>
          <div className="font-sans text-[10px] text-muted mt-2 truncate">B2B + DTC + ADCS</div>
        </div>
      </div>
    </div>
  );
}

// Compact Gross/Net segmented toggle (mirrors Dashboard.jsx MetricToggle).
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

function ChannelCard({ label, metricWord, note, loading, error, value, share }) {
  const sharePct = share != null ? Math.max(0, Math.min(1, share)) : 0;
  return (
    <div className="relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
                    before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-brown">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
          {label}
        </div>
        <div className="font-sans text-[10px] text-muted">{metricWord}</div>
      </div>

      {/* Sales value */}
      <div className="font-display text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1.5 md:mt-2 tabular-nums break-words">
        {loading ? <span className="text-muted">…</span> : error ? <span className="text-muted text-base">—</span> : fmt$(value)}
      </div>

      {/* Share of total */}
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1 leading-snug">
        {loading || share == null ? (
          "—"
        ) : (
          <>
            <span className="tabular-nums font-semibold">{fmtPct(share)}</span>
            <span className="text-muted"> of total {metricWord.toLowerCase()}</span>
          </>
        )}
      </div>

      {/* Share bar */}
      <div className="mt-2.5 pt-2 border-t border-rule/60">
        <div className="h-1.5 w-full rounded-full bg-paper2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${sharePct * 100}%`, background: "#5C2F2E" }}
            aria-label={`Share of total ${metricWord.toLowerCase()}: ${fmtPct(share || 0)}`}
          />
        </div>
      </div>

      <div className="font-sans text-[10px] text-muted leading-snug mt-1.5">{note}</div>
    </div>
  );
}
