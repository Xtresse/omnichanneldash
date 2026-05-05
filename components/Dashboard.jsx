"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import KpiTiles from "./KpiTiles.jsx";
import FilterBar, { PRESET_LABELS } from "./FilterBar.jsx";
import OrdersTable from "./OrdersTable.jsx";
import RepPerformance from "./RepPerformance.jsx";
import RepTrendChart from "./charts/RepTrendChart.jsx";
import ExportButton from "./ExportButton.jsx";
import ChatPanel from "./ChatPanel.jsx";
import ReconciliationCheck from "./ReconciliationCheck.jsx";
import RevenueByChannel from "./charts/RevenueByChannel.jsx";
import OrdersByChannel from "./charts/OrdersByChannel.jsx";
import AOVByChannel from "./charts/AOVByChannel.jsx";
import CumulativeYTD from "./charts/CumulativeYTD.jsx";
import ProductFamily from "./charts/ProductFamily.jsx";
import NewVsReturning from "./charts/NewVsReturning.jsx";
import RepeatRate from "./charts/RepeatRate.jsx";
import SubVsOneTime from "./charts/SubVsOneTime.jsx";
import RevenueByState from "./charts/RevenueByState.jsx";
import DiscountUsage from "./charts/DiscountUsage.jsx";
import FulfillmentSplit from "./charts/FulfillmentSplit.jsx";
import MarketingPlaceholder from "./charts/MarketingPlaceholder.jsx";

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

// Relative time string for the "Refreshed N ago" label.
// Falls back to a date string for anything older than ~24h.
const fmtTimeAgo = (iso) => {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.round(diff / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
};

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

export default function Dashboard({ initial }) {
  const [data, setData] = useState(initial?.ok ? initial.data : null);
  const [error, setError] = useState(initial?.ok ? null : initial?.error || "Unable to load data");
  // activePreset is the value of the preset that's currently highlighted,
  // or null when the user has typed custom dates manually.
  const [activePreset, setActivePreset] = useState(initial?.defaults?.preset || "mtd");
  const [customFrom, setCustomFrom] = useState(initial?.defaults?.from || "");
  const [customTo, setCustomTo] = useState(initial?.defaults?.to || "");
  // User-selected chart granularity. "auto" lets the server pick.
  const [granularity, setGranularity] = useState("auto");
  // Compare mode: "off" | "prior" | "yoy". URL-state-driven so deep links
  // preserve the user's last selection. Initial value is read from the
  // ?compare= query param on mount; subsequent changes write back.
  const [compareMode, setCompareMode] = useState(() => {
    if (typeof window === "undefined") return "off";
    const v = new URLSearchParams(window.location.search).get("compare");
    return v === "prior" || v === "yoy" ? v : "off";
  });
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef(null);

  function buildQs(from, to, gran, cmp) {
    const qs = new URLSearchParams({ from, to });
    qs.set("granularity", gran && gran !== "auto" ? gran : "auto");
    if (cmp && cmp !== "off") qs.set("compare", cmp);
    return qs.toString();
  }

  // Sync compareMode → URL so deep links preserve the toggle.
  function syncCompareToUrl(mode) {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    if (mode === "off") u.searchParams.delete("compare");
    else u.searchParams.set("compare", mode);
    window.history.replaceState({}, "", u.toString());
  }

  async function loadFromUrl(qs) {
    try {
      const res = await fetch(`/api/dashboard?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "load failed");
      setData(json);
      setError(null);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }

  function changePreset(value, from, to) {
    setActivePreset(value);
    setCustomFrom(from);
    setCustomTo(to);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    startTransition(() => loadFromUrl(buildQs(from, to, granularity, compareMode)));
  }

  function changeCustom({ from, to }) {
    setActivePreset(null);
    setCustomFrom(from);
    setCustomTo(to);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Partial entry → wait for the second field.
    if (!from || !to) return;

    debounceRef.current = setTimeout(() => {
      startTransition(() => loadFromUrl(buildQs(from, to, granularity, compareMode)));
    }, 500);
  }

  function changeGranularity(value) {
    setGranularity(value);
    // Re-fetch with the new bucket choice using the currently-loaded window.
    if (customFrom && customTo) {
      startTransition(() => loadFromUrl(buildQs(customFrom, customTo, value, compareMode)));
    }
  }

  // Toggle the compare mode (Off / Prior / YoY) and refetch so the server
  // pulls the correct prior-window snapshot. URL is mirrored so links shared
  // out of Sam's session preserve the toggle state.
  function changeCompareMode(value) {
    setCompareMode(value);
    syncCompareToUrl(value);
    if (customFrom && customTo) {
      startTransition(() =>
        loadFromUrl(buildQs(customFrom, customTo, granularity, value))
      );
    }
  }

  // Manual refresh — re-fetches the same window/granularity that's
  // currently loaded. Spinner state is driven by the existing
  // useTransition isPending flag so it lights up the FilterBar's
  // loading indicator too.
  function refresh() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (customFrom && customTo) {
      startTransition(() => loadFromUrl(buildQs(customFrom, customTo, granularity, compareMode)));
    } else if (activePreset) {
      // Defensive — if dates somehow got cleared, fall back to preset.
      const cmpQs = compareMode !== "off" ? `&compare=${compareMode}` : "";
      startTransition(() => loadFromUrl(`preset=${activePreset}&granularity=${granularity}${cmpQs}`));
    }
  }

  // Re-render every 30s so the "refreshed N ago" label stays accurate
  // even when the user is just looking at the dashboard.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  if (error && !data) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="max-w-md mx-auto mt-12 rounded-xl border border-rule bg-card p-6">
          <h2 className="font-display text-2xl font-semibold text-brown mb-2">
            Couldn&apos;t load data
          </h2>
          <p className="font-sans text-sm text-inksoft">{error}</p>
          <p className="font-sans text-xs text-muted mt-3">
            Check that <code className="bg-paper px-1 rounded">WINDSOR_API_KEY</code> is set in
            Vercel env vars.
          </p>
        </div>
      </main>
    );
  }

  const periodLabel = activePreset
    ? PRESET_LABELS[activePreset] || "Selected period"
    : customFrom && customTo
    ? `${customFrom} → ${customTo}`
    : "Selected period";

  // Chart subtitle copy matches the bucket the server actually used.
  const G = (
    {
      day: "Daily",
      week: "Weekly",
      biweek: "Biweekly",
      month: "Monthly",
    }
  )[data?.granularity] || "Monthly";
  const Gunit = (
    {
      day: "day",
      week: "week",
      biweek: "two weeks",
      month: "month",
    }
  )[data?.granularity] || "month";

  return (
    <main className="min-h-screen pb-12">
      <div className="max-w-[1400px] mx-auto px-3 md:px-6 py-4 md:py-7">
        {/* Header — title in single brown ink, period strip below */}
        <header className="flex items-start justify-between gap-3 flex-wrap mb-4 md:mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-3xl md:text-5xl font-semibold text-brown leading-none tracking-tight">
              Xtresse Omni Channel Dashboard
            </h1>
            <p className="font-sans text-xs md:text-sm text-muted mt-2 md:mt-3 leading-snug">
              Net sales from Shopify via Windsor.ai · B2B / ADCS / DTC are mutually exclusive
              {data && (
                <>
                  {" / "}
                  <strong className="text-inksoft">{periodLabel}</strong>
                  {" / "}
                  {data.orderCount.toLocaleString()} orders
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap justify-end">
            {data && (
              <div
                className="font-sans text-[10px] md:text-xs text-muted w-full md:w-auto md:order-1"
                title={new Date(data.generatedAt).toLocaleString()}
              >
                Refreshed {fmtTimeAgo(data.generatedAt)}
              </div>
            )}
            <CompareToggle
              value={compareMode}
              onChange={changeCompareMode}
              disabled={isPending || !data}
            />
            <button
              type="button"
              onClick={refresh}
              disabled={isPending || !data}
              className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-paper text-brown border border-brown hover:bg-paper2 disabled:opacity-50 disabled:cursor-not-allowed transition tracking-[0.04em] inline-flex items-center gap-1.5 md:order-2"
              aria-label="Refresh dashboard data"
              title="Re-fetch the current window from Windsor"
            >
              <RefreshIcon spinning={isPending} />
              {/* Icon-only on phones to keep the header tight; full label from sm+ */}
              <span className="hidden sm:inline">{isPending ? "Refreshing…" : "Refresh"}</span>
            </button>
            {data && <ExportButton data={data} periodLabel={periodLabel} />}
          </div>
        </header>

        <div className="mb-4 md:mb-6">
          <FilterBar
            activePreset={activePreset}
            customFrom={customFrom}
            customTo={customTo}
            granularity={granularity}
            resolvedGranularity={data?.granularity}
            onPresetChange={changePreset}
            onCustomChange={changeCustom}
            onGranularityChange={changeGranularity}
            loading={isPending}
          />
        </div>

        {data && (
          <>
            <div className="mb-4 md:mb-6">
              <KpiTiles kpis={data.kpis} compare={data.compare} />
            </div>

            {/* Net-sales reconciliation note */}
            <div className="mb-5 md:mb-7 rounded-xl border border-rule bg-card px-3 py-2.5 md:px-4 md:py-3">
              <p className="font-sans text-[11px] md:text-xs leading-snug text-inksoft">
                <span className="font-semibold text-ink">Net sales reconciliation</span>
                {" — "}
                Gross {fmtMoney(data.kpis.totalGrossSales)} − discounts{" "}
                {fmtMoney(data.kpis.totalDiscounts)} − returns{" "}
                {fmtMoney(Math.abs(data.kpis.totalReturns))} = net{" "}
                <strong className="text-ink">{fmtMoney(data.kpis.totalNetSales)}</strong>. Test &
                cancelled orders excluded by Windsor.
              </p>
            </div>

            <div className="mb-5 md:mb-7 rounded-xl border border-rule bg-card px-3 py-2.5 md:px-4 md:py-3">
              <p className="font-sans text-[11px] md:text-xs leading-snug text-inksoft">
                <span className="font-semibold text-ink">DTC data starts 4/1/2026</span>
                {" — "}Windsor's DTC feed didn't exist before that date, so periods covering earlier
                history will show $0 DTC. Untagged orders before 4/1/2026 are treated as B2B (not DTC)
                so the channel split stays accurate.
              </p>
            </div>

            <Section title="Top-line performance" detail="Tier 1 / 5 charts">
              <ChartGrid>
                <ChartCell title="Net sales by channel" subtitle={`${G}, B2B vs DTC`}>
                  <RevenueByChannel data={data.monthlySeries} compare={data.compare} />
                </ChartCell>
                <ChartCell title="Order count by channel" subtitle={G}>
                  <OrdersByChannel data={data.monthlySeries} compare={data.compare} />
                </ChartCell>
                <ChartCell title="Average order value" subtitle="Net basis, dual axis">
                  <AOVByChannel data={data.monthlySeries} compare={data.compare} />
                </ChartCell>
                <ChartCell title="Cumulative net YTD" subtitle="By calendar year">
                  <CumulativeYTD data={data.cumulativeYTD} />
                </ChartCell>
                <ChartCell title="Net sales by product family" subtitle="Gummies · Serum · XVIE · Sachets">
                  <ProductFamily data={data.productFamily} compare={data.compare} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section title="Customer dynamics" detail="Tier 2 / 4 charts">
              <ChartGrid>
                <ChartCell title="New vs returning — B2B (gummies only)" subtitle={`${G} stacked · gummy buyers, hero SKU`}>
                  <NewVsReturning data={data.customerDynamics} compare={data.compare} channel="B2B" />
                </ChartCell>
                <ChartCell title="New vs returning — DTC" subtitle={`${G} stacked · all DTC orders`}>
                  <NewVsReturning data={data.customerDynamics} compare={data.compare} channel="DTC" />
                </ChartCell>
                <ChartCell title="Repeat purchase rate" subtitle={`% returning, ${G.toLowerCase()}`}>
                  <RepeatRate data={data.repeatRate} compare={data.compare} />
                </ChartCell>
                <ChartCell title="DTC subscription vs one-time" subtitle={`Net sales mix, ${G.toLowerCase()}`}>
                  <SubVsOneTime data={data.subVsOneTime} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section title="Operational & geographic" detail="Tier 3 / 3 charts">
              <ChartGrid>
                <ChartCell title="Top 15 states by net sales" subtitle="Channel split" wide>
                  <RevenueByState data={data.revenueByState} />
                </ChartCell>
                <ChartCell title="Discount code usage" subtitle="Top 12 by frequency">
                  <DiscountUsage data={data.discountUsage} />
                </ChartCell>
                <ChartCell title="3PL fulfillment split" subtitle="Order count by location">
                  <FulfillmentSplit data={data.fulfillmentSplit} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section
              title="Sales by rep"
              detail={`B2B reps · ${(data.repsList?.length || 0).toLocaleString()} on roster`}
            >
              <ChartGrid>
                <ChartCell title="Net sales by rep" subtitle={`${G} trend · click chips to toggle`}>
                  <RepTrendChart
                    data={data.repSalesMonthly || []}
                    reps={data.repsList || []}
                    valueType="currency"
                  />
                </ChartCell>
                <ChartCell title="New gummy accounts by rep" subtitle={`First-order tagged · gummies · per ${Gunit}, by rep`}>
                  <RepTrendChart
                    data={data.repNewAccountsMonthly || []}
                    reps={data.repsList || []}
                    valueType="count"
                  />
                </ChartCell>
              </ChartGrid>
              <div className="mt-3 md:mt-4">
                <RepPerformance
                  repPerformance={data.repPerformance || []}
                  compare={data.compare}
                />
              </div>
            </Section>

            <Section
              title="Reconciliation"
              detail="Cross-checks chart totals against the headline KPIs"
            >
              <ReconciliationCheck
                reconciliation={data.reconciliation}
                kpis={data.kpis}
                compare={data.compare}
              />
            </Section>

            <Section
              title="Orders audit trail"
              detail={`${(data.orders?.length || 0).toLocaleString()} orders in period`}
            >
              <OrdersTable orders={data.orders || []} />
            </Section>

            <Section title="Marketing performance" detail="Tier 4 / pending connectors">
              <ChartGrid>
                <ChartCell title="Blended ROAS" subtitle="DTC ad spend → all channel revenue">
                  <MarketingPlaceholder label="Blended ROAS" />
                </ChartCell>
                <ChartCell title="CAC by channel" subtitle="New customers / spend">
                  <MarketingPlaceholder label="CAC" />
                </ChartCell>
                <ChartCell title="Ad spend allocation" subtitle="By platform, monthly">
                  <MarketingPlaceholder label="Ad spend" />
                </ChartCell>
              </ChartGrid>
              <p className="font-sans text-xs text-muted mt-3 leading-snug max-w-2xl">
                Activates once Google Ads, Meta, TikTok, and Klaviyo are authorized on Windsor.ai.
              </p>
            </Section>

            <footer className="font-sans text-[10px] md:text-xs text-muted mt-10 border-t border-rule pt-4 leading-relaxed">
              <p>
                Revenue metric: net sales (gross − discounts − refunds; test & cancelled orders
                excluded). Channel: <strong>ADCS</strong> if tagged{" "}
                <code className="bg-card border border-rule px-1 rounded">adcs</code> or{" "}
                <code className="bg-card border border-rule px-1 rounded">advanced derm</code>;
                {" "}<strong>B2B</strong> if a canonical rep tag is present, or if any tag is{" "}
                <code className="bg-card border border-rule px-1 rounded">b2b</code> /
                <code className="bg-card border border-rule px-1 rounded">wholesale</code>, or if a
                B2B-pattern discount code (REP-/XVIE\d+/B2B-/ADCS-) is used; <strong>DTC</strong> otherwise.
                Orders containing the DTC carve-out SKUs (X-GN-060CT-001, X-FRC-30ML-001) are
                forced to DTC. Windsor only began returning DTC data on 2026-04-01, so any pre-2026-04-01
                order without an explicit B2B/ADCS signal is treated as untagged B2B (not DTC).
                Line-item metrics use proportional net allocation: line_net = order_net ×
                (line_revenue / order_subtotal).
              </p>
            </footer>
          </>
        )}
      </div>

      {/* Floating AI chat — visible on every screen size, scoped to the
          currently-loaded dashboard data. */}
      {data && <ChatPanel data={data} />}
    </main>
  );
}

function Section({ title, detail, children }) {
  return (
    <section className="mt-5 md:mt-7">
      <div className="bg-browndeep text-paper rounded-md px-4 py-2.5 md:px-5 md:py-3 mb-3 md:mb-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display text-lg md:text-2xl font-semibold leading-tight">{title}</h2>
          {detail && (
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
              {detail}
            </span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function ChartGrid({ children }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">{children}</div>;
}

/**
 * Three-state segmented toggle for the compare mode (Off / vs Prior / vs YoY).
 * Sized to sit comfortably alongside the Refresh button in the header.
 * Off is the cleanest view; vs Prior is the default when turned on
 * (preceding window of the same length); vs YoY shifts the window back
 * by one calendar year for seasonal businesses.
 */
function CompareToggle({ value, onChange, disabled }) {
  const opts = [
    { v: "off", label: "Off", title: "Hide prior-period comparison" },
    { v: "prior", label: "vs Prior", title: "Compare to the preceding window of the same length" },
    { v: "yoy", label: "vs YoY", title: "Compare to the same period one year ago" },
  ];
  return (
    <div
      className="shrink-0 inline-flex rounded-md border border-rule bg-paper overflow-hidden md:order-2"
      role="group"
      aria-label="Compare mode"
    >
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            title={o.title}
            aria-pressed={active}
            className={`min-h-touch px-2.5 md:px-3 font-sans text-[11px] md:text-xs font-semibold tracking-[0.02em] transition disabled:opacity-50 disabled:cursor-not-allowed ${
              active
                ? "bg-brown text-paper"
                : "text-inksoft hover:bg-paper2"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ChartCell({ title, subtitle, wide, children }) {
  return (
    <div
      className={`${
        wide ? "lg:col-span-2" : ""
      } bg-card border border-rule rounded-xl p-3 md:p-5`}
    >
      <div className="mb-2 md:mb-3">
        <h3 className="font-display text-base md:text-lg font-semibold leading-tight text-ink">
          {title}
        </h3>
        {subtitle && <p className="font-sans text-[11px] md:text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
