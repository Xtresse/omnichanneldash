"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import KpiTiles from "./KpiTiles.jsx";
import FilterBar, { PRESET_LABELS } from "./FilterBar.jsx";
import OrdersTable from "./OrdersTable.jsx";
import RepPerformance from "./RepPerformance.jsx";
import RepTrendChart from "./charts/RepTrendChart.jsx";
import ExportButton from "./ExportButton.jsx";
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

export default function Dashboard({ initial }) {
  const [data, setData] = useState(initial?.ok ? initial.data : null);
  const [error, setError] = useState(initial?.ok ? null : initial?.error || "Unable to load data");
  // activePreset is the value of the preset that's currently highlighted,
  // or null when the user has typed custom dates manually.
  const [activePreset, setActivePreset] = useState(initial?.defaults?.preset || "mtd");
  const [customFrom, setCustomFrom] = useState(initial?.defaults?.from || "");
  const [customTo, setCustomTo] = useState(initial?.defaults?.to || "");
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef(null);

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
    startTransition(() => loadFromUrl(`from=${from}&to=${to}`));
  }

  function changeCustom({ from, to }) {
    setActivePreset(null);
    setCustomFrom(from);
    setCustomTo(to);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Partial entry → wait for the second field.
    if (!from || !to) return;

    debounceRef.current = setTimeout(() => {
      startTransition(() => loadFromUrl(`from=${from}&to=${to}`));
    }, 500);
  }

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
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {data && (
              <div className="font-sans text-[10px] md:text-xs text-muted">
                Refreshed{" "}
                {new Date(data.generatedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            )}
            {data && <ExportButton data={data} periodLabel={periodLabel} />}
          </div>
        </header>

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
          <>
            <div className="mb-4 md:mb-6">
              <KpiTiles kpis={data.kpis} />
            </div>

            {/* Net-sales reconciliation note — shows the gross→net waterfall so Sam can sanity check */}
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
                <span className="font-semibold text-ink">DTC backfill pending</span>
                {" — "}Windsor only has DTC Shopify data from 3/31/26 forward. Long-range DTC trends
                will fill in once the historical range is extended.
              </p>
            </div>

            <Section title="Top-line performance" detail="Tier 1 / 5 charts">
              <ChartGrid>
                <ChartCell title="Net sales by channel" subtitle="Monthly, B2B vs DTC">
                  <RevenueByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Order count by channel" subtitle="Monthly">
                  <OrdersByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Average order value" subtitle="Net basis, dual axis">
                  <AOVByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Cumulative net YTD" subtitle="By calendar year">
                  <CumulativeYTD data={data.cumulativeYTD} />
                </ChartCell>
                <ChartCell title="Net sales by product family" subtitle="Gummies · Serum · XVIE · Sachets">
                  <ProductFamily data={data.productFamily} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section title="Customer dynamics" detail="Tier 2 / 4 charts">
              <ChartGrid>
                <ChartCell title="New vs returning — B2B" subtitle="Monthly stacked">
                  <NewVsReturning data={data.customerDynamics} channel="B2B" />
                </ChartCell>
                <ChartCell title="New vs returning — DTC" subtitle="Monthly stacked">
                  <NewVsReturning data={data.customerDynamics} channel="DTC" />
                </ChartCell>
                <ChartCell title="Repeat purchase rate" subtitle="% returning, monthly">
                  <RepeatRate data={data.repeatRate} />
                </ChartCell>
                <ChartCell title="DTC subscription vs one-time" subtitle="Net sales mix, monthly">
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
                <ChartCell title="Net sales by rep" subtitle="Monthly trend, click chips to toggle">
                  <RepTrendChart
                    data={data.repSalesMonthly || []}
                    reps={data.repsList || []}
                    valueType="currency"
                  />
                </ChartCell>
                <ChartCell title="New accounts by rep" subtitle="First-time customers per month, by rep">
                  <RepTrendChart
                    data={data.repNewAccountsMonthly || []}
                    reps={data.repsList || []}
                    valueType="count"
                  />
                </ChartCell>
              </ChartGrid>
              <div className="mt-3 md:mt-4">
                <RepPerformance repPerformance={data.repPerformance || []} />
              </div>
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
                Revenue metric: <code className="bg-card border border-rule px-1 rounded">order_net_sales</code>
                {" "}from Windsor (gross − discounts − returns; test & cancelled orders excluded).
                Channel: B2B if tagged{" "}
                <code className="bg-card border border-rule px-1 rounded">b2b</code>,{" "}
                <code className="bg-card border border-rule px-1 rounded">ADCS</code>, contains a rep
                name, or uses a B2B-pattern code (REP-, XVIE-numeric, B2B-, ADCS-). Otherwise DTC.
                Line-item metrics use proportional net allocation: line_net = order_net ×
                (line_revenue / order_subtotal).
              </p>
            </footer>
          </>
        )}
      </div>
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
