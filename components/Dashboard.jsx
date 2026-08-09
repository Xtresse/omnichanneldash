"use client";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import FilterBar, { PRESET_LABELS, GRANULARITY_OPTIONS } from "./FilterBar.jsx";
import ChannelNetSalesBar from "./ChannelNetSalesBar.jsx";
import RepPerformance from "./RepPerformance.jsx";
import PresidentsClub from "./PresidentsClub.jsx";
import RepLeaderboard from "./RepLeaderboard.jsx";
// Heavy-ish grid (reps × up to 400 day cells) and it lives in a collapsed
// bottom section, so keep it out of the initial bundle.
const RepHeatMap = dynamic(() => import("./RepHeatMap.jsx"), {
  ssr: false,
  loading: () => (
    <div className="bg-card border border-rule rounded-xl p-6 md:p-8 text-center text-muted text-sm font-sans">
      Loading heat map…
    </div>
  ),
});
import {
  SALES_BY_REP_METRICS,
  PRESIDENTS_CLUB_METRICS,
  isPresidentsClubEligible,
} from "@/lib/repMetrics.js";
import RepTrendChart from "./charts/RepTrendChart.jsx";
import ExportButton from "./ExportButton.jsx";
import MonthlyReport from "./MonthlyReport.jsx";
import ProjectionsPanel from "./ProjectionsPanel.jsx";
import ReconciliationCheck from "./ReconciliationCheck.jsx";
import BudgetVsActual from "./BudgetVsActual.jsx";
import AccountAging from "./AccountAging.jsx";
import AmbassadorProgram from "./AmbassadorProgram.jsx";
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
import B2BAccountGrowth from "./charts/B2BAccountGrowth.jsx";

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
    <div className="bg-card border border-rule rounded-xl p-6 md:p-8 text-center text-muted text-sm font-sans">
      Loading orders…
    </div>
  ),
});
// The ZIP heat map pulls react-simple-maps + d3 + a bundled US base map, so it's
// client-only and lazy. It lives in a defaultCollapsed Section, so the chunk
// (and the per-order aggregation) only load when Sam expands it.
const ZipHeatMap = dynamic(() => import("./ZipHeatMap.jsx"), {
  ssr: false,
  loading: () => (
    <div className="bg-card border border-rule rounded-xl p-6 md:p-8 text-center text-muted text-sm font-sans">
      Loading map…
    </div>
  ),
});
const SalesExplorer = dynamic(() => import("./SalesExplorer.jsx"), {
  ssr: false,
  loading: () => (
    <div className="bg-card border border-rule rounded-xl p-6 md:p-8 text-center text-muted text-sm font-sans">
      Loading explorer…
    </div>
  ),
});

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

// Compact format for the executive headline — $1.0M / 850K (per dashboard
// design best-practice: round hard, no decimals in the hero number).
const fmtCompact = (n) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};

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
  const [activePreset, setActivePreset] = useState(initial?.defaults?.preset || "today");
  const [customFrom, setCustomFrom] = useState(initial?.defaults?.from || "");
  const [customTo, setCustomTo] = useState(initial?.defaults?.to || "");
  // User-selected chart granularity. "auto" lets the server pick.
  const [granularity, setGranularity] = useState("auto");
  // Compare mode: "off" | "prior" | "yoy". URL-state-driven so deep links
  // preserve the user's last selection. Initial value is "off" (SSR-safe),
  // and the mount effect below reads ?compare= on the client and reconciles.
  const [compareMode, setCompareMode] = useState("off");
  // Net/Gross toggle for the channel revenue chart (Top-Line Performance).
  const [revMetric, setRevMetric] = useState("gross");
  // Top-level view: the dashboard, or the editable Projections (targets) editor.
  const [view, setView] = useState("dashboard");
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef(null);
  // Gate for anything whose render output depends on the CURRENT clock or the
  // viewer's locale. app/page.jsx is ISR-cached, so such output would be baked
  // into stale HTML and mismatch on hydration. See the "Refreshed" label below.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Shared "this month, MTD-to-date" fetch — the single source for every
  // goal-pace figure on the dashboard (Executive Summary's "% to Base Goal"
  // tile, Total Sales by Channel's goal bars, and BudgetVsActual's headline
  // when its Goal-month picker is on the current month). Each of those used
  // to self-fetch this same window independently, which stacked enough
  // concurrent Shopify GraphQL calls on page load to trip the rate limit
  // (real "Throttled" 500s, 2026-07-09) — now fetched once here and passed
  // down as props.
  const [execGoalTargets, setExecGoalTargets] = useState(null);
  const [execGoalMtdFull, setExecGoalMtdFull] = useState(null);
  const execGoalMtd = execGoalMtdFull?.kpis || null;

  // When the selected window IS the current month-to-date, every MTD goal
  // figure (the channel cards' bars AND the Executive "% to Base Goal" tile)
  // must be driven by the SAME payload as the headline — otherwise the two
  // independent fetches of the identical MTD window drift a few $k apart
  // (recent orders still settling / separate cache states) and the card
  // shows a big headline number and a slightly-different "MTD" number right
  // below it, reading as "the numbers don't tie" (Mike, 2026-07-16). The
  // standalone execGoalMtd fetch is only needed when the user is on some
  // OTHER window (Today, Last 90d, …) but still wants monthly goal pace.
  const windowIsMtd = activePreset === "mtd";
  const mtdKpis = windowIsMtd && data?.kpis ? data.kpis : execGoalMtd;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.ok !== false) setExecGoalTargets(d?.targets || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Pacific-anchored month-to-date — MUST match FilterBar's "today()" (shop
    // tz) so this window is byte-identical to the FilterBar MTD preset. A
    // browser-local anchor drifts a full day for any non-PT viewer (e.g. an
    // ET-based CEO after 9pm PT), pulling a different set of orders and
    // de-syncing the goal bars from the headline.
    const [py, pm, pd] = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()).split("-");
    const from = `${py}-${pm}-01`;
    const to = `${py}-${pm}-${pd}`;
    const qs = new URLSearchParams({ from, to, granularity: "month" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setExecGoalMtdFull(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const execGoal = useMemo(() => {
    if (!execGoalTargets || !mtdKpis) return null;
    // Pacific (shop tz) month key — matches how revenue is bucketed and the
    // FilterBar's "today()"; a UTC key can roll to next month a few hours
    // early near a month boundary and read the wrong month's target.
    const ym = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
    }).format(new Date());
    const co = execGoalTargets.company || {};
    const products = ["Gummies", "Serum", "XVIE", "Sachets"];
    const basis = revMetric === "gross" ? "gross" : "net";
    const target = ["B2B", "DTC", "ADCS"].reduce(
      (a, ch) => a + products.reduce((b, p) => b + Number(co?.[ch]?.[p]?.[ym]?.base?.[basis] || 0), 0),
      0
    );
    const actual = Number((basis === "gross" ? mtdKpis.totalGrossSales : mtdKpis.totalNetSales) || 0);
    return target > 0 ? { pct: actual / target, actual, target } : null;
  }, [execGoalTargets, mtdKpis, revMetric]);

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

  // ---- Stale-SSR date correction ----
  // app/page.jsx is ISR-cached (revalidate = 300) and bakes shopToday() into
  // `initial.defaults`. Next serves the STALE page to the first visitor after
  // the window expires and regenerates in the background — so the first person
  // to open the dashboard in the morning gets yesterday's render, with
  // yesterday's date wired into the "Today" preset. The numbers are internally
  // correct, just for the wrong day (Mike, 2026-07-18: "Today" showed Jul 17).
  //
  // Client state seeds from those defaults and never re-checks, so it stays
  // wrong until the range is changed by hand. Re-resolve today in the shop
  // timezone and refetch whenever the loaded range disagrees. Done in an effect
  // (not a lazy useState initializer) to keep the hydration render identical to
  // SSR — same reasoning as the ?compare= reconciliation below.
  //
  // Runs on mount AND on an interval, because there are two ways to end up on
  // the wrong day and the mount check only catches the first:
  //   1. stale ISR render (above) — caught at mount;
  //   2. a tab left open across midnight — the day rolls but the loaded window
  //      doesn't, so it silently keeps showing yesterday until reloaded.
  // The interval is a cheap string compare; it only refetches on an actual day
  // change, and self-cancels once the preset is no longer "today".
  useEffect(() => {
    if (activePreset !== "today") return undefined;
    const check = () => {
      const shopToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      if (customFrom === shopToday && customTo === shopToday) return;
      setCustomFrom(shopToday);
      setCustomTo(shopToday);
      startTransition(() =>
        loadFromUrl(buildQs(shopToday, shopToday, granularity, compareMode))
      );
    };
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, customFrom, customTo, granularity, compareMode]);

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

  if (error && !data) {
    return (
      <main className="min-h-screen p-3 sm:p-4 md:p-8">
        <div className="max-w-md mx-auto mt-8 sm:mt-12 rounded-xl border border-rule bg-card p-4 sm:p-6">
          <h2 className="font-display text-xl sm:text-2xl font-semibold text-ink mb-2">
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

  // Global Net/Gross basis label for titles (driven by the top toggle).
  const M = revMetric === "gross" ? "Gross" : "Net";

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
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-7">
        {/* Header — title in single brown ink, period strip below */}
        <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4 md:mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl md:text-5xl font-semibold text-ink leading-tight md:leading-none tracking-tight break-words">
              Xtresse Omni Channel Dashboard
            </h1>
          </div>
          {/* On mobile this row sits below the title and wraps cleanly so
              the compare toggle, refresh, and export button all fit
              within a 375px viewport. md+ keeps the original right-aligned
              cluster. */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap md:justify-end">
            {/* Client-only: BOTH halves of this are hydration hazards on an
                ISR-cached page — fmtTimeAgo() reads Date.now() and
                toLocaleString() renders in the server's locale/timezone, so
                the cached HTML ("Refreshed just now") never matches what the
                browser computes. React was bailing out of hydration on every
                load and re-rendering the whole tree client-side (minified
                #425 → #418/#423). Same CLAUDE.md rule as the "today" default:
                never trust an SSR-computed date on the client. */}
            {mounted && data && (
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
              className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-paper text-ink border border-brown hover:bg-paper2 disabled:opacity-50 disabled:cursor-not-allowed transition tracking-[0.04em] inline-flex items-center gap-1.5 md:order-2"
              aria-label="Refresh dashboard data"
              title="Re-fetch the current window from Windsor"
            >
              <RefreshIcon spinning={isPending} />
              {/* Icon-only on phones to keep the header tight; full label from sm+ */}
              <span className="hidden sm:inline">{isPending ? "Refreshing…" : "Refresh"}</span>
            </button>
            <a
              href="/ask"
              className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-brown text-ink hover:bg-browndeep transition tracking-[0.04em] inline-flex items-center gap-1.5 md:order-2"
              title="Open the Claude-powered analyst — full-page chat over the data rails"
            >
              <span aria-hidden="true">✦</span>
              <span className="hidden sm:inline">Ask Claude</span>
              <span className="sm:hidden">Ask</span>
            </a>
            {data && <ExportButton data={data} periodLabel={periodLabel} />}
            {data && <MonthlyReport data={data} targets={execGoalTargets} monthPayload={execGoalMtdFull} periodLabel={periodLabel} />}
          </div>
        </header>

        {/* View tabs: the dashboard, or the editable Projections (targets) editor */}
        <div className="mb-4 md:mb-6 flex gap-1 border-b border-rule">
          {[["dashboard", "Dashboard"], ["projections", "Projections"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`min-h-touch px-4 py-2 font-sans text-sm font-semibold tracking-[0.02em] -mb-px border-b-2 transition ${view === v ? "border-brown text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {l}
            </button>
          ))}
        </div>

        {view === "projections" ? (
          <ProjectionsPanel />
        ) : (
        <>
        <div className="mb-4 md:mb-6">
          <FilterBar
            activePreset={activePreset}
            customFrom={customFrom}
            customTo={customTo}
            onPresetChange={changePreset}
            onCustomChange={changeCustom}
            loading={isPending}
          />
        </div>

        {data && (
          <div className="mb-4 md:mb-6 rounded-xl border border-rule bg-card px-4 py-4 md:px-6 md:py-5">
            <div className="mb-1.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
                Executive summary · {periodLabel}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-muted">Showing</span>
                <MetricToggle value={revMetric} onChange={setRevMetric} />
              </div>
            </div>
            <div className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap">
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Gross Sales</div>
                <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                  {fmtMoney(data.kpis.totalGrossSales)}
                </div>
              </div>
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Net Sales</div>
                <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                  {fmtMoney(data.kpis.totalNetSales)}
                </div>
              </div>
              <div>
                <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Gross → Net</div>
                <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                  {data.kpis.totalGrossSales ? `${Math.round((data.kpis.totalNetSales / data.kpis.totalGrossSales) * 100)}%` : "—"}
                </div>
              </div>
              {data.grossMargin?.contribution != null && (
                <div>
                  <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Gross Margin</div>
                  <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                    {data.grossMargin.contributionMarginPct != null ? `${data.grossMargin.contributionMarginPct}%` : "—"}
                  </div>
                </div>
              )}
              {data.grossMargin?.contribution != null && (
                <div>
                  <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Gross Profit</div>
                  <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                    {fmtMoney(data.grossMargin.contribution)}
                  </div>
                </div>
              )}
              {execGoal != null && (
                <div>
                  <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">% To Base Goal (MTD)</div>
                  <div className="font-display text-3xl md:text-4xl font-semibold text-ink leading-none tabular-nums">
                    {Math.round(execGoal.pct * 100)}%
                  </div>
                </div>
              )}
              {(() => {
                const cur = data.kpis.totalNetSales;
                const prior = data.compare?.kpis?.totalNetSales;
                if (prior == null || prior <= 0) return null;
                const x = (cur - prior) / prior;
                const up = x >= 0;
                return (
                  <div>
                    <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Net vs Prior</div>
                    <div className="font-display text-3xl md:text-4xl font-semibold leading-none tabular-nums" style={{ color: up ? "#F0922E" : "#5C2F2E" }}>
                      {up ? "▲" : "▼"} {Math.abs(x * 100).toFixed(1)}%
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="mt-3 pt-3 border-t border-rule/60 font-sans text-[10px] text-muted leading-snug">
              <span className="font-semibold text-inksoft">Gross → Net</span> = net sales ÷ gross sales (gross = subtotal before discounts/returns; net = gross − discounts − returns).{" "}
              {data.grossMargin?.contribution != null && (
                <>
                  <span className="font-semibold text-inksoft">Gross Profit</span> = net sales − COGS − merchant fees ({data.grossMargin.feeRatePct}% of net) − fulfillment ({data.grossMargin.fulfillmentPct}% of net).{" "}
                  <span className="font-semibold text-inksoft">Gross Margin</span> = gross profit ÷ net sales.
                </>
              )}
            </div>
          </div>
        )}

        <div className="mb-4 md:mb-6">
          <ChannelNetSalesBar
            kpis={data?.kpis || null}
            periodLabel={periodLabel}
            error={!data ? error : null}
            metric={revMetric}
            onMetricChange={setRevMetric}
            budgetTargets={execGoalTargets}
            mtdKpis={mtdKpis}
            windowIsMtd={windowIsMtd}
          />
        </div>

        {data && (
          <>
            <SectionGroup title="Sales Performance" detail="Goals, Top-Line Trends & Customer Mix">
            <Section title="Actual Vs Goal" detail={`Budget / Base / Stretch · by product & channel · ${M} basis`} collapsible>
              <BudgetVsActual
                productFamily={data.productFamily}
                grossMargin={data.grossMargin}
                metric={revMetric}
                sharedCurrentMonthActuals={execGoalMtdFull}
              />
            </Section>

            <Section title="Top-Line Performance" detail="Tier 1 / 6 charts" collapsible>
              {/* Bucket (granularity) lives here — directly above the time-series
                  charts it actually controls — alongside the Gross/Net toggle.
                  Both re-bucket/redraw whenever the date period (or Today) and
                  this control change. */}
              <div className="flex items-center justify-between sm:justify-end gap-x-4 gap-y-2 mb-3 flex-wrap">
                <BucketToggle
                  value={granularity}
                  resolved={data?.granularity}
                  onChange={changeGranularity}
                />
                <div className="flex items-center gap-1.5">
                  <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-muted hidden sm:inline">Showing</span>
                  <MetricToggle value={revMetric} onChange={setRevMetric} />
                </div>
              </div>
              <ChartGrid>
                <ChartCell title={`${M} Sales By Channel`} subtitle={`${G}, B2B vs DTC`}>
                  <RevenueByChannel data={data.monthlySeries} compare={data.compare} metric={revMetric} />
                </ChartCell>
                <ChartCell title="Order Count By Channel" subtitle={G}>
                  <OrdersByChannel data={data.monthlySeries} compare={data.compare} />
                </ChartCell>
                <ChartCell title="Average Order Value" subtitle={`${M} basis, dual axis`}>
                  <AOVByChannel data={data.monthlySeries} compare={data.compare} metric={revMetric} />
                </ChartCell>
                <ChartCell title={`Cumulative ${M} YTD`} subtitle="By calendar year">
                  <CumulativeYTD data={data.cumulativeYTD} metric={revMetric} />
                </ChartCell>
                <ChartCell title={`${M} Sales By Product Family`} subtitle="Gummies · Serum · XVIE · Sachets">
                  <ProductFamily data={data.productFamily} compare={data.compare} metric={revMetric} />
                </ChartCell>
                <ChartCell title="B2B Accounts" subtitle="Cumulative total + new accounts added per month">
                  <B2BAccountGrowth accountAging={data.accountAging} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section title="Customer Dynamics" detail="Tier 2 / 4 charts" collapsible defaultCollapsed>
              <ChartGrid>
                <ChartCell title="New Vs Returning — B2B (Gummies Only)" subtitle={`${G} stacked · gummy buyers, hero SKU`}>
                  <NewVsReturning data={data.customerDynamics} compare={data.compare} channel="B2B" />
                </ChartCell>
                <ChartCell title="New Vs Returning — DTC" subtitle={`${G} stacked · all DTC orders`}>
                  <NewVsReturning data={data.customerDynamics} compare={data.compare} channel="DTC" />
                </ChartCell>
                <ChartCell title="Repeat Purchase Rate" subtitle={`% returning, ${G.toLowerCase()}`}>
                  <RepeatRate data={data.repeatRate} compare={data.compare} />
                </ChartCell>
                <ChartCell title="DTC Subscription Vs One-Time" subtitle={`Net sales mix, ${G.toLowerCase()}`}>
                  <SubVsOneTime data={data.subVsOneTime} />
                </ChartCell>
              </ChartGrid>
            </Section>
            </SectionGroup>

            <SectionGroup title="Rep Performance" detail="Leaderboards, Daily Activity & Programs">
            <Section
              title="Sales By Rep"
              detail="Stack-Ranked Leaderboard · MTD / QTD / YTD · Trend Lines Below"
              collapsible
            >
              {/* Lead with the stack-ranked leaderboard (Mike, 2026-08-03) —
                  the multi-line rep trend chart was unreadable with every rep
                  on it. Same server-side net-sales attribution, just ranked
                  top-to-bottom with a bar per rep. Trend lines stay available
                  below as a collapsed secondary view. */}
              <RepLeaderboard
                title="Rep Leaderboard"
                metrics={SALES_BY_REP_METRICS}
                defaultMetric="net"
                repPerformance={data.repPerformance || []}
                rangeFrom={customFrom}
                rangeTo={customTo}
              />

              <SubBlock
                title="Rep Trend Lines"
                detail={`${G} trend · secondary view`}
                className="mt-3 md:mt-4"
              >
                <ChartGrid>
                  <ChartCell title="Net Sales By Rep" subtitle={`${G} trend · click chips to toggle`}>
                    <RepTrendChart
                      data={data.repSalesMonthly || []}
                      reps={data.repsList || []}
                      valueType="currency"
                      compare={data.compare}
                      priorKey="repSalesMonthly"
                    />
                  </ChartCell>
                  <ChartCell title="New Gummy Accounts By Rep" subtitle={`First-order tagged · gummies · per ${Gunit}, by rep`}>
                    <RepTrendChart
                      data={data.repNewAccountsMonthly || []}
                      reps={data.repsList || []}
                      valueType="count"
                      compare={data.compare}
                      priorKey="repNewAccountsMonthly"
                    />
                  </ChartCell>
                </ChartGrid>
              </SubBlock>

              <SubBlock
                title="Rep Detail Table"
                detail="Product mix · new vs existing accounts"
                className="mt-3 md:mt-4"
              >
                <RepPerformance
                  repPerformance={data.repPerformance || []}
                  compare={data.compare}
                  metric={revMetric}
                />
              </SubBlock>
            </Section>

            <Section
              title="President's Club"
              detail="Stack-Ranked · MTD / QTD / YTD · W-2 Only · First-Time 60% / Returning 40%"
              collapsible
              defaultCollapsed
            >
              {/* Same leaderboard component as Sales By Rep, so every rep
                  comparison on the dashboard reads identically. Eligibility is
                  pinned to the President's Club rules (W-2 territories only,
                  managers excluded), which is why the scope chips are off. */}
              <RepLeaderboard
                title="President's Club"
                metrics={PRESIDENTS_CLUB_METRICS}
                defaultMetric="weighted"
                rowFilter={isPresidentsClubEligible}
                showScope={false}
                scopeNote="W-2 Reps Only · Managers Excluded"
                repPerformance={data.repPerformance || []}
                rangeFrom={customFrom}
                rangeTo={customTo}
              />

              <SubBlock
                title="President's Club Detail"
                detail="Per-family first-time / returning split"
                className="mt-3 md:mt-4"
              >
                <PresidentsClub
                  repPerformance={data.repPerformance || []}
                  compare={data.compare}
                />
              </SubBlock>
            </Section>

            <Section
              title="Rep Daily Heat Map"
              detail="Rows = Reps · Columns = Days · Net Sales + Ramp T&E · MTD / QTD / YTD / Range"
              collapsible
              defaultCollapsed
            >
              <RepHeatMap rangeFrom={customFrom} rangeTo={customTo} />
            </Section>

            <Section
              title="Ambassador Program (XVIE50)"
              detail="Xvie 50%-off ambassadors by rep · who reordered Xvie full-price after entry · all-history"
              collapsible
              defaultCollapsed
            >
              <AmbassadorProgram />
            </Section>
            </SectionGroup>

            <SectionGroup title="Territory & Accounts" detail="Geography, Cross-Filter & Account Recency">
            <Section
              title="ZIP Heat Map"
              detail="B2B only · Sales density or Opportunity (open + thin markets) · click / “Jump to” a state"
              collapsible
              defaultCollapsed
            >
              {/* B2B only — exclude DTC consumer orders AND ADCS, so the map (and
                  its rep/whitespace signal) is purely the rep-sold business. */}
              <ZipHeatMap orders={(data.orders || []).filter((o) => o.channel === "B2B")} />
            </Section>

            <Section
              title="Sales By State, Rep & Zip"
              detail="Cross-filter sales on all three · % of total per breakdown · honors Net/Gross toggle"
              collapsible
              defaultCollapsed
            >
              <SalesExplorer orders={data.orders || []} metric={revMetric} repRoster={data.repRoster || []} />
            </Section>

            <Section
              title="Account Aging & Order History"
              detail="Rep-attributed B2B accounts · recency by account + product · all-history · click a bucket to drill in"
              collapsible
              defaultCollapsed
            >
              <AccountAging accountAging={data.accountAging} />
            </Section>
            </SectionGroup>

            <SectionGroup title="Operations & Data Integrity" detail="Fulfillment, Discounts, Audit Trail & Reconciliation">
            <Section title="Operational & Geographic" detail="Tier 3 / 3 charts" collapsible defaultCollapsed>
              <ChartGrid>
                <ChartCell title={`Top 15 States By ${M} Sales`} subtitle="Channel split" wide>
                  <RevenueByState data={data.revenueByState} metric={revMetric} />
                </ChartCell>
                <ChartCell title="Discount Code Usage" subtitle="Top 12 By $ Volume">
                  <DiscountUsage data={data.discountUsage} />
                </ChartCell>
                <ChartCell title="3PL Fulfillment Split" subtitle="Order count by location">
                  <FulfillmentSplit data={data.fulfillmentSplit} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section
              title="Orders Audit Trail"
              detail={`${(data.orders?.length || 0).toLocaleString()} orders in period`}
              collapsible
              defaultCollapsed
            >
              <OrdersTable orders={data.orders || []} />
            </Section>

            {/* Scott Stepe's daily rep grid (Sam, 2026-08-08). Bottom section,
                precomputed via /api/heatmap — never a per-request rebuild. */}

            <Section
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
            </Section>
            </SectionGroup>

            <SectionGroup title="Marketing" detail="Pending Connectors">
            <Section title="Marketing Performance" detail="Tier 4 / pending connectors" collapsible defaultCollapsed>
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
            </SectionGroup>

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
        </>
        )}
      </div>

      {/* Floating AI chat — visible on every screen size, scoped to the
          currently-loaded dashboard data. */}
      {data && <ChatPanel data={data} />}
    </main>
  );
}

function Section({ title, detail, children, collapsible = false, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="mt-5 md:mt-7">
      <div className="bg-browndeep text-paper rounded-md px-3 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-3 mb-3 md:mb-4">
        <div className="flex items-baseline justify-between gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
            <h2 className="font-display text-base sm:text-lg md:text-2xl font-semibold leading-tight text-brown">{title}</h2>
            {collapsible && (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] bg-paper/10 hover:bg-paper/20 border border-paper/30 rounded px-2 py-0.5 transition-colors"
              >
                {collapsed ? "Show" : "Hide"}
              </button>
            )}
          </div>
          {detail && (
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
              {detail}
            </span>
          )}
        </div>
      </div>
      {!collapsed && children}
    </section>
  );
}

// Collapsed-by-default sub-section inside a Section. Used to demote the rep
// trend lines / detail table beneath the stack-ranked leaderboard without
// losing them — one compact cream bar with a Show/Hide affordance, and the
// children don't mount (or fetch/render Recharts) until expanded.
// Top-level grouping band for the section stack. 14 identical dark Section
// bars in a row gave no sense of where sales analysis ended and operations
// began (Sam, 2026-08-09) — this adds the one level of hierarchy that was
// missing. Deliberately NOT collapsible: the Sections inside already collapse,
// and nesting a second collapse just adds clicks between you and the data.
function SectionGroup({ title, detail, children }) {
  return (
    <div className="mt-8 md:mt-10 first:mt-5 md:first:mt-7">
      <div className="flex items-baseline justify-between gap-3 flex-wrap border-b-2 border-brown/70 pb-1.5 mb-1">
        <h2 className="font-display text-lg sm:text-xl md:text-2xl font-semibold leading-tight text-ink">
          {title}
        </h2>
        {detail && (
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.18em] text-muted">
            {detail}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function SubBlock({ title, detail, children, className = "", defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full bg-paper2 border border-rule rounded-md px-3 py-1.5 md:px-4 md:py-2 flex items-center justify-between gap-2 hover:border-tan transition-colors text-left"
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-sm md:text-base font-semibold text-ink leading-tight">
            {title}
          </span>
          {detail && (
            <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.14em] text-muted truncate">
              {detail}
            </span>
          )}
        </span>
        <span className="shrink-0 font-sans text-[10px] uppercase tracking-[0.16em] text-inksoft border border-rule rounded px-2 py-0.5">
          {collapsed ? "Show" : "Hide"}
        </span>
      </button>
      {!collapsed && <div className="mt-3 md:mt-4">{children}</div>}
    </div>
  );
}

function ChartGrid({ children }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">{children}</div>;
}

// Compact Gross/Net segmented toggle — controls the metric for the chart
// sections below (Top-Line, Geography, Sales Explorer, etc.).
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

// Bucket / chart-granularity control. Moved out of the top FilterBar to sit
// directly above the time-series charts it drives. "Auto" lets the server pick
// the bucket for the selected window; when Auto is active we surface what it
// resolved to ("using Weekly") so the choice is legible.
function BucketToggle({ value, resolved, onChange }) {
  const cur = value || "auto";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-muted">Bucket</span>
      <div className="inline-flex rounded-md border border-rule overflow-hidden">
        {GRANULARITY_OPTIONS.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => onChange(g.value)}
            aria-pressed={cur === g.value}
            className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.12em] px-2 py-1 min-h-touch sm:min-h-0 ${
              cur === g.value ? "bg-brown text-ink font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      {cur === "auto" && resolved && (
        <span className="font-sans text-[10px] text-muted">
          using <strong className="text-inksoft">{GRANULARITY_OPTIONS.find((x) => x.value === resolved)?.label || resolved}</strong>
        </span>
      )}
    </div>
  );
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
                ? "bg-brown text-ink"
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

function ChartCell({ title, subtitle, wide, action, children }) {
  return (
    <div
      className={`${
        wide ? "lg:col-span-2" : ""
      } bg-card border border-rule rounded-xl p-3 sm:p-4 md:p-5 min-w-0`}
    >
      <div className="mb-2 md:mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base md:text-lg font-semibold leading-tight text-ink">
            {title}
          </h3>
          {subtitle && <p className="font-sans text-[11px] md:text-xs text-muted mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

