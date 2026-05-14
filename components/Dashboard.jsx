"use client";

import { useState, useTransition, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import KpiTiles from "./KpiTiles.jsx";
import SecondaryKpis from "./SecondaryKpis.jsx";
import FilterBar, { PRESET_LABELS } from "./FilterBar.jsx";
import B2BStatusBar from "./B2BStatusBar.jsx";
import RepPerformance from "./RepPerformance.jsx";
import RepTrendChart from "./charts/RepTrendChart.jsx";
import ExportButton from "./ExportButton.jsx";
import ReconciliationCheck from "./ReconciliationCheck.jsx";
import BudgetVsActual from "./BudgetVsActual.jsx";
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
import LazyMount from "./LazyMount.jsx";

// Lazy-loaded heavy bits — keep them out of the main bundle so first paint
// stays snappy. ChatPanel pulls Anthropic SDK + chat UI; OrdersTable can
// render hundreds of rows. Both load in the background after the initial
// dashboard renders. ssr:false because they're client-only anyway.
const ChatPanel = dynamic(() => import("./ChatPanel.jsx"), {
  ssr: false,
  loading: () => null,
});
const OrdersTable = dynamic(() => import("./OrdersTable.jsx"), {
  ssr: false,
  loading: () => (
    <div className="card-tile p-8 text-center text-muted text-sm font-sans">
      Loading orders…
    </div>
  ),
});

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

// Relative time string for the "Refreshed N ago" label.
// Falls back to a date string for anything older than ~24h.
function fmtTimeAgo(iso) {
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
}

// Granularity-driven labels (server resolves "auto" to a concrete bucket).
const GRAN_LABEL = { day: "Daily", week: "Weekly", biweek: "Biweekly", month: "Monthly" };
const GRAN_UNIT  = { day: "day",   week: "week",   biweek: "two weeks", month: "month"   };

function RefreshIcon({ spinning, className = "" }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      className={`${spinning ? "animate-spin" : ""} ${className}`}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function SparkleIcon({ className = "" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" fill="currentColor" />
      <path d="M19 14l.9 2.4L22.3 17l-2.4.9L19 20l-.9-2.1L15.7 17l2.4-.6L19 14z" fill="currentColor" />
    </svg>
  );
}

/** Dispatch the global "open chat" event consumed by ChatPanel.
 *  An optional prompt string is preloaded into the chat input. */
function openClaudeChat(prompt) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("xtresse:open-chat", { detail: prompt ? { prompt } : undefined })
  );
}

function ChevronIcon({ open, className = "" }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 12 12"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform duration-mid ease-out ${open ? "rotate-180" : ""} ${className}`}
    >
      <polyline points="2 4 6 8 10 4" />
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
  // preserve the user's last selection. Initial value is "off" (SSR-safe),
  // and the mount effect below reads ?compare= on the client and reconciles.
  const [compareMode, setCompareMode] = useState("off");
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

  // On mount, read ?compare= from the URL and reconcile state. Lazy
  // useState initializers that read window during hydration can desync
  // server vs client renders, so we do this in an effect: state starts
  // as "off" (matching SSR), then the effect promotes it to "prior" or
  // "yoy" and triggers a one-shot refetch so the deltas / overlays /
  // reconciliation strip populate without the user clicking the toggle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = new URLSearchParams(window.location.search).get("compare");
    const next = v === "prior" || v === "yoy" ? v : "off";
    if (next === "off") return;
    setCompareMode(next);
    if (customFrom && customTo) {
      startTransition(() =>
        loadFromUrl(buildQs(customFrom, customTo, granularity, next))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  // Derive display copy once per data load. periodLabel + the granularity
  // captions used in every chart subtitle are pure functions of state, so
  // memoizing them shaves a few cycles on re-renders driven by the 30s
  // tick or by the compare-toggle alone.
  const periodLabel = useMemo(() => {
    if (activePreset) return PRESET_LABELS[activePreset] || "Selected period";
    if (customFrom && customTo) return `${customFrom} → ${customTo}`;
    return "Selected period";
  }, [activePreset, customFrom, customTo]);

  const G     = GRAN_LABEL[data?.granularity] || "Monthly";
  const Gunit = GRAN_UNIT[data?.granularity]  || "month";

  if (error && !data) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="max-w-md mx-auto mt-12 card-tile p-6">
          <div className="eyebrow text-bad mb-2">Connection error</div>
          <h2 className="font-display text-2xl font-semibold text-brown mb-2">
            Couldn&apos;t load data
          </h2>
          <p className="font-sans text-sm text-inksoft">{error}</p>
          <p className="font-sans text-xs text-muted mt-3">
            Check that <code className="bg-paper px-1.5 py-0.5 rounded">WINDSOR_API_KEY</code> is set in
            Vercel env vars.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <div className="max-w-[1400px] mx-auto px-3 md:px-6 py-4 md:py-7">
        <Masthead
          data={data}
          periodLabel={periodLabel}
          isPending={isPending}
          compareMode={compareMode}
          onCompareChange={changeCompareMode}
          onRefresh={refresh}
        />

        {/* B2B MTD status bar — always shows current month, independent of
            the FilterBar date selection below. Pulls product-family MTD
            B2B net sales for Serum / Xvié / Gummies with linear pacing
            and user-entered monthly goals. */}
        <div className="mb-4 md:mb-6">
          <B2BStatusBar />
        </div>

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
            <div className="mb-3 md:mb-4">
              <KpiTiles kpis={data.kpis} compare={data.compare} />
            </div>

            <div className="mb-4 md:mb-6">
              <SecondaryKpis
                kpis={data.kpis}
                compare={data.compare}
                reconciliation={data.reconciliation}
              />
            </div>

            <NotesStrip
              kpis={data.kpis}
              fmtMoney={fmtMoney}
            />

            <Section
              id="actual-vs-goal"
              title="Actual vs Goal"
              detail="Per-product, monthly · Sheet-backed"
              collapsible
            >
              <BudgetVsActual productFamily={data.productFamily} periodLabel={periodLabel} />
            </Section>

            <Section
              id="top-line"
              title="Top-line performance"
              detail="Tier 1 · 5 charts"
              collapsible
            >
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

            <LazySection
              id="customer-dynamics"
              title="Customer dynamics"
              detail="Tier 2 · 4 charts"
              collapsible
            >
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
            </LazySection>

            <LazySection
              id="operational"
              title="Operational & geographic"
              detail="Tier 3 · 3 charts"
              collapsible
            >
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
            </LazySection>

            <LazySection
              id="reps"
              title="Sales by rep"
              detail={`B2B reps · ${(data.repsList?.length || 0).toLocaleString()} on roster`}
              collapsible
            >
              <ChartGrid>
                <ChartCell title="Net sales by rep" subtitle={`${G} trend · click chips to toggle`}>
                  <RepTrendChart
                    data={data.repSalesMonthly || []}
                    reps={data.repsList || []}
                    valueType="currency"
                    compare={data.compare}
                    priorKey="repSalesMonthly"
                  />
                </ChartCell>
                <ChartCell title="New gummy accounts by rep" subtitle={`First-order tagged · gummies · per ${Gunit}, by rep`}>
                  <RepTrendChart
                    data={data.repNewAccountsMonthly || []}
                    reps={data.repsList || []}
                    valueType="count"
                    compare={data.compare}
                    priorKey="repNewAccountsMonthly"
                  />
                </ChartCell>
              </ChartGrid>
              <div className="mt-3 md:mt-4">
                <RepPerformance
                  repPerformance={data.repPerformance || []}
                  compare={data.compare}
                />
              </div>
            </LazySection>

            <LazySection
              id="reconciliation"
              title="Reconciliation"
              detail="Cross-checks chart totals against the headline KPIs"
              collapsible
              defaultCollapsed
            >
              <ReconciliationCheck
                reconciliation={data.reconciliation}
                kpis={data.kpis}
                compare={data.compare}
              />
            </LazySection>

            <LazySection
              id="orders"
              title="Orders audit trail"
              detail={`${(data.orders?.length || 0).toLocaleString()} orders in period`}
              collapsible
              defaultCollapsed
            >
              <OrdersTable orders={data.orders || []} />
            </LazySection>

            <LazySection
              id="marketing"
              title="Marketing performance"
              detail="Tier 4 · pending connectors"
              collapsible
              defaultCollapsed
            >
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
            </LazySection>

            <Methodology />
          </>
        )}
      </div>

      {/* Floating AI chat — visible on every screen size, scoped to the
          currently-loaded dashboard data. */}
      {data && <ChatPanel data={data} />}
    </main>
  );
}

/**
 * Refined masthead — split into a wordmark/period block on the left and a
 * cluster of session controls on the right. A single hairline rule below
 * acts as the visual "letterhead bar" that signals the start of the
 * reporting surface (it's the move every enterprise dashboard makes, and
 * the cheapest way to feel less "boutique landing page" and more
 * "executive reporting tool").
 */
function Masthead({ data, periodLabel, isPending, compareMode, onCompareChange, onRefresh }) {
  return (
    <header className="mb-5 md:mb-7 pb-4 md:pb-5 border-b border-rule">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-6">
        <div className="min-w-0">
          <div className="eyebrow text-brown mb-2 md:mb-2.5">
            Xtresse · Executive Reporting
          </div>
          <h1 className="font-display text-[2.1rem] md:text-5xl font-semibold text-ink leading-[1.05] tracking-tight">
            Omnichannel Dashboard
          </h1>
          {data && (
            <div className="mt-2.5 md:mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-sans text-[11px] md:text-xs text-inksoft leading-snug">
              <Meta label="Period" value={periodLabel} accent />
              <Sep />
              <Meta label="Orders" value={data.orderCount.toLocaleString()} />
              <Sep />
              <Meta label="Source" value="Shopify via Windsor.ai" />
              <Sep />
              <Meta label="Refreshed" value={fmtTimeAgo(data.generatedAt)} title={new Date(data.generatedAt).toLocaleString()} />
            </div>
          )}
        </div>

        {/* Right cluster — wraps cleanly on mobile so refresh + compare +
            Ask Claude + export all fit within a 375px viewport. */}
        <div className="flex items-center gap-2 md:gap-2.5 shrink-0 flex-wrap md:justify-end">
          <CompareToggle
            value={compareMode}
            onChange={onCompareChange}
            disabled={isPending || !data}
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={isPending || !data}
            className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-paper text-brown border border-brown/70 hover:bg-paper2 hover:border-brown disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast ease-out tracking-[0.04em] inline-flex items-center gap-1.5 shadow-card hover:shadow-card-hover"
            aria-label="Refresh dashboard data"
            title="Re-fetch the current window from Windsor"
          >
            <RefreshIcon spinning={isPending} />
            <span className="hidden sm:inline">{isPending ? "Refreshing…" : "Refresh"}</span>
          </button>
          {/* Ask Claude — promoted from a floating-only launcher to a
              first-class masthead control. Dispatches a global event the
              ChatPanel listens for; no prop drilling needed. */}
          <button
            type="button"
            onClick={() => openClaudeChat()}
            disabled={!data}
            className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-brown text-paper border border-brown hover:bg-browndeep disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast ease-out tracking-[0.04em] inline-flex items-center gap-1.5 shadow-card hover:shadow-card-hover"
            aria-label="Open Ask Claude chat"
            title="Ask Claude about the data in the current period"
          >
            <SparkleIcon />
            <span className="hidden sm:inline">Ask Claude</span>
          </button>
          {data && <ExportButton data={data} periodLabel={periodLabel} />}
        </div>
      </div>
    </header>
  );
}

function Meta({ label, value, accent, title }) {
  return (
    <span className="inline-flex items-baseline gap-1.5" title={title}>
      <span className="eyebrow text-muted tracking-chip">{label}</span>
      <span className={`font-sans text-[12px] md:text-[13px] tabular-nums ${accent ? "text-ink font-semibold" : "text-inksoft"}`}>
        {value}
      </span>
    </span>
  );
}
function Sep() {
  return <span className="text-rulestrong/80 select-none" aria-hidden="true">·</span>;
}

/**
 * The two informational banners directly under KPI tiles, consolidated.
 * Was previously two separate full-width cards; now one shared rail keeps
 * the eye moving down to the data instead of breaking rhythm twice.
 */
function NotesStrip({ kpis, fmtMoney }) {
  return (
    <div className="mb-5 md:mb-7 card-tile px-3 py-2.5 md:px-4 md:py-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 font-sans text-[11px] md:text-xs leading-snug text-inksoft">
        <p>
          <span className="eyebrow text-ink tracking-chip mr-1.5">Net sales</span>
          Gross {fmtMoney(kpis.totalGrossSales)} − discounts{" "}
          {fmtMoney(kpis.totalDiscounts)} − returns{" "}
          {fmtMoney(Math.abs(kpis.totalReturns))} = net{" "}
          <strong className="text-ink tabular-nums">{fmtMoney(kpis.totalNetSales)}</strong>.
          <span className="text-muted"> Test &amp; cancelled orders excluded by Windsor.</span>
        </p>
        <p>
          <span className="eyebrow text-ink tracking-chip mr-1.5">DTC since</span>
          4/1/2026 — Windsor's DTC feed didn't exist before that date, so periods covering earlier
          history will show $0 DTC. Pre-2026-04-01 untagged orders are treated as B2B (not DTC).
        </p>
      </div>
    </div>
  );
}

function Methodology() {
  return (
    <footer className="font-sans text-[10px] md:text-xs text-muted mt-10 pt-5 border-t border-rule leading-relaxed">
      <div className="eyebrow text-brown mb-2">Methodology</div>
      <p>
        Revenue metric: net sales (gross − discounts − refunds; test &amp; cancelled orders
        excluded). Channel: <strong>ADCS</strong> if tagged{" "}
        <code className="bg-card border border-rule px-1 rounded">adcs</code> or{" "}
        <code className="bg-card border border-rule px-1 rounded">advanced derm</code>;{" "}
        <strong>B2B</strong> if a canonical rep tag is present, or if any tag is{" "}
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
  );
}

/**
 * Refined section block. The banner is now a gradient brown bar (CSS
 * .section-banner class) with a slim brown accent rule below to echo the
 * Mastiff "letterhead" treatment, and the disclosure chevron is a real
 * SVG with rotate-on-state instead of "Show/Hide" word toggles.
 *
 * Adds optional `id` so anchor links land on each section heading — a
 * Fortune-500-dashboard expectation (sharable deep links to specific
 * panels).
 */
function Section({ id, title, detail, children, collapsible = false, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const headerId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headerId} className="mt-6 md:mt-8 scroll-mt-20">
      <div className="section-banner px-4 py-2.5 md:px-5 md:py-3 mb-3 md:mb-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 id={headerId} className="font-display text-lg md:text-2xl font-semibold leading-tight tracking-tight">
              {title}
            </h2>
            {collapsible && (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                aria-controls={id ? `${id}-body` : undefined}
                className="font-sans text-[10px] md:text-xs uppercase tracking-chip bg-paper/10 hover:bg-paper/20 active:bg-paper/30 border border-paper/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5 transition-colors duration-fast ease-out"
              >
                <ChevronIcon open={!collapsed} />
                <span className="hidden sm:inline">{collapsed ? "Show" : "Hide"}</span>
              </button>
            )}
          </div>
          {detail && (
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-chip opacity-85">
              {detail}
            </span>
          )}
        </div>
      </div>
      {!collapsed && (
        <div id={id ? `${id}-body` : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Section wrapper that defers expensive children (charts, tables) until
 * the user scrolls within ~400px of the heading. Saves a measurable chunk
 * of JS work on first paint without changing how the section looks once
 * it's mounted. The LazyMount reserves a 480px placeholder so the page
 * doesn't jank as content swaps in.
 */
function LazySection(props) {
  return (
    <Section {...props}>
      <LazyMount minHeight={480}>{props.children}</LazyMount>
    </Section>
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
    { v: "off",   label: "Off",      title: "Hide prior-period comparison" },
    { v: "prior", label: "vs Prior", title: "Compare to the preceding window of the same length" },
    { v: "yoy",   label: "vs YoY",   title: "Compare to the same period one year ago" },
  ];
  return (
    <div
      className="shrink-0 inline-flex rounded-md border border-rule bg-paper overflow-hidden shadow-card"
      role="group"
      aria-label="Compare mode"
    >
      {opts.map((o, i) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.v)}
            title={o.title}
            aria-pressed={active}
            className={`min-h-touch px-2.5 md:px-3 font-sans text-[11px] md:text-xs font-semibold tracking-[0.04em] transition-colors duration-fast ease-out disabled:opacity-50 disabled:cursor-not-allowed ${
              i > 0 ? "border-l border-rule" : ""
            } ${
              active
                ? "bg-brown text-paper"
                : "text-inksoft hover:bg-paper2 hover:text-ink"
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
      className={`${wide ? "lg:col-span-2" : ""} card-tile card-surface-hover p-3 md:p-5`}
    >
      <div className="mb-2 md:mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base md:text-lg font-semibold leading-tight text-ink tracking-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="font-sans text-[10px] md:text-[11px] uppercase tracking-chip text-muted shrink-0 hidden sm:block">
            {subtitle}
          </p>
        )}
      </div>
      {/* Mobile keeps subtitle as a normal sentence so it can wrap. */}
      {subtitle && (
        <p className="font-sans text-[11px] text-muted mt-0.5 mb-2 sm:hidden">{subtitle}</p>
      )}
      {children}
    </div>
  );
}
