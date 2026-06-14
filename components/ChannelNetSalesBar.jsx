"use client";

import { useEffect, useMemo, useState } from "react";

// Total Net Sales — month-to-date, broken out by channel.
// Replaces the old B2B-MTD product-goal bar. Sits above the KPI tiles and is
// ALWAYS month-to-date, independent of the FilterBar selection (matching the
// "headline above the dashboard" role of the widget it replaced).
//
// Data source: /api/dashboard?from=<1st-of-month>&to=<today>, which reuses the
// canonical net-sales aggregation (gross − discounts − refunds). We read the
// kpis block and present three channel cards + a Total.
//
// Tie-out: channels sum to Total by construction —
//   B2B = totalNetSales − dtcNetSales − adcsNetSales  (rep-tagged + untagged B2B)
//   DTC = dtcNetSales
//   ADCS = adcsNetSales
// so B2B + DTC + ADCS === Total to the dollar regardless of untagged orders.

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

export default function ChannelNetSalesBar() {
  const [kpis, setKpis] = useState(null); // { totalNetSales, dtcNetSales, adcsNetSales, ... }
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
          setErr(j.error || "Failed to load net-sales data");
          return;
        }
        setKpis(j.kpis);
      })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const loading = kpis == null && !err;

  const totalNet = kpis ? Number(kpis.totalNetSales || 0) : null;
  const dtcNet = kpis ? Number(kpis.dtcNetSales || 0) : null;
  const adcsNet = kpis ? Number(kpis.adcsNetSales || 0) : null;
  // B2B = everything that isn't DTC or ADCS — ties the three channels to Total
  // to the dollar (includes rep-tagged + untagged-by-signal B2B orders).
  const b2bNet = kpis ? totalNet - dtcNet - adcsNet : null;

  const CHANNELS = [
    { label: "B2B", net: b2bNet, note: "Reps · clinics, med spas, derms" },
    { label: "DTC", net: dtcNet, note: "Shopify direct-to-consumer" },
    { label: "ADCS", net: adcsNet, note: "Aesthetic Derm + Cosmetic Surgery" },
  ];

  return (
    <div className="rounded-xl border border-rule bg-paper2/60 p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3 mb-2.5 md:mb-3 flex-wrap">
        <h2 className="font-display text-lg md:text-xl font-semibold text-ink leading-tight">
          Total Net Sales by Channel
        </h2>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted leading-snug">
          MTD · Day {completed}/{total} · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
      </div>

      {err && (
        <div className="mb-2.5 md:mb-3 rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] md:text-xs text-red-900 leading-snug">
          <strong>Couldn&apos;t load net sales:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {CHANNELS.map((c) => {
          const share = totalNet && totalNet > 0 && c.net != null ? c.net / totalNet : null;
          return (
            <ChannelCard
              key={c.label}
              label={c.label}
              note={c.note}
              loading={loading}
              error={err}
              net={c.net}
              share={share}
            />
          );
        })}

        {/* Total — emphasized */}
        <div className="relative bg-card border-2 border-brown rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0">
          <div className="flex items-baseline justify-between">
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">Total Net</span>
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">MTD</span>
          </div>
          <div className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold text-ink leading-none mt-1.5 tabular-nums">
            {loading ? <span className="text-muted">…</span> : err ? <span className="text-base">—</span> : fmt$(totalNet)}
          </div>
          <div className="font-sans text-[11px] md:text-xs text-inksoft mt-2 pt-2 border-t border-rule">
            Gross − discounts − refunds
          </div>
          <div className="font-sans text-[10px] text-muted mt-2 truncate">B2B + DTC + ADCS</div>
        </div>
      </div>
    </div>
  );
}

function ChannelCard({ label, note, loading, error, net, share }) {
  const sharePct = share != null ? Math.max(0, Math.min(1, share)) : 0;
  return (
    <div className="relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
                    before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-brown">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
          {label}
        </div>
        <div className="font-sans text-[10px] text-muted">Net</div>
      </div>

      {/* Net sales value */}
      <div className="font-display text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1.5 md:mt-2 tabular-nums break-words">
        {loading ? <span className="text-muted">…</span> : error ? <span className="text-muted text-base">—</span> : fmt$(net)}
      </div>

      {/* Share of total net */}
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1 leading-snug">
        {loading || share == null ? (
          "—"
        ) : (
          <>
            <span className="tabular-nums font-semibold">{fmtPct(share)}</span>
            <span className="text-muted"> of total net</span>
          </>
        )}
      </div>

      {/* Share bar */}
      <div className="mt-2.5 pt-2 border-t border-rule/60">
        <div className="h-1.5 w-full rounded-full bg-paper2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${sharePct * 100}%`, background: "#5C2F2E" }}
            aria-label={`Share of total net: ${fmtPct(share || 0)}`}
          />
        </div>
      </div>

      <div className="font-sans text-[10px] text-muted leading-snug mt-1.5">{note}</div>
    </div>
  );
}
