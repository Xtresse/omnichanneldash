"use client";

import { useState, useTransition } from "react";
import KpiTiles from "./KpiTiles.jsx";
import FilterBar from "./FilterBar.jsx";
import RevenueByChannel from "./charts/RevenueByChannel.jsx";
import OrdersByChannel from "./charts/OrdersByChannel.jsx";
import AOVByChannel from "./charts/AOVByChannel.jsx";
import CumulativeYTD from "./charts/CumulativeYTD.jsx";
import TopSKUs from "./charts/TopSKUs.jsx";
import ProductFamily from "./charts/ProductFamily.jsx";
import NewVsReturning from "./charts/NewVsReturning.jsx";
import RepeatRate from "./charts/RepeatRate.jsx";
import SubVsOneTime from "./charts/SubVsOneTime.jsx";
import RevenueByState from "./charts/RevenueByState.jsx";
import DiscountUsage from "./charts/DiscountUsage.jsx";
import FulfillmentSplit from "./charts/FulfillmentSplit.jsx";
import MarketingPlaceholder from "./charts/MarketingPlaceholder.jsx";

const PRESET_LABEL = {
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  last_3m: "Last 3 months",
  last_6m: "Last 6 months",
  this_year: "YTD",
  last_year: "Last year",
  last_2years: "All time",
};

export default function Dashboard({ initial }) {
  const [data, setData] = useState(initial?.ok ? initial.data : null);
  const [error, setError] = useState(initial?.ok ? null : initial?.error || "Unable to load data");
  const [preset, setPreset] = useState("last_2years");
  const [isPending, startTransition] = useTransition();

  async function changePreset(next) {
    setPreset(next);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/dashboard?preset=${next}`, { cache: "no-store" });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "load failed");
        setData(json);
        setError(null);
      } catch (err) {
        setError(String(err?.message || err));
      }
    });
  }

  if (error && !data) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="max-w-md mx-auto mt-12 rounded-md border border-rule bg-paper2 p-6">
          <h2 className="font-serif text-2xl font-bold text-brown mb-2">Couldn&apos;t load data</h2>
          <p className="font-sans text-sm text-inksoft">{error}</p>
          <p className="font-sans text-xs text-muted mt-3">
            Check that <code className="bg-paper px-1 rounded">WINDSOR_API_KEY</code> is set in
            Vercel env vars.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <div className="max-w-[1400px] mx-auto px-3 md:px-6 py-4 md:py-7">
        {/* Header — title left, refresh stamp right (matches leadership dash) */}
        <header className="flex items-start justify-between gap-3 flex-wrap mb-4 md:mb-6">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl md:text-5xl font-bold text-ink leading-none tracking-tight">
              Xtress<span className="text-accent">é</span> Omnichannel
            </h1>
            <p className="font-sans text-xs md:text-sm text-muted mt-2 md:mt-3 leading-snug">
              B2B + DTC analytics from Shopify via Windsor.ai
              {data && (
                <>
                  {" / "}
                  <strong className="text-inksoft">
                    {PRESET_LABEL[preset] || "Selected period"}
                  </strong>
                  {" / "}
                  {data.orderCount.toLocaleString()} orders
                </>
              )}
            </p>
          </div>
          {data && (
            <div className="font-sans text-[10px] md:text-xs text-muted shrink-0 mt-1">
              Refreshed{" "}
              {new Date(data.generatedAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          )}
        </header>

        {/* Filter card */}
        <div className="mb-4 md:mb-6">
          <FilterBar preset={preset} onChange={changePreset} loading={isPending} />
        </div>

        {data && (
          <>
            {/* KPI tiles — 3 big ones, matching leadership dash style */}
            <div className="mb-4 md:mb-6">
              <KpiTiles kpis={data.kpis} />
            </div>

            {/* DTC backfill note — subtle, in the paper aesthetic */}
            <div className="mb-5 md:mb-7 rounded-md border border-rule bg-paper2 px-3 py-2 md:px-4 md:py-2.5">
              <p className="font-sans text-[11px] md:text-xs leading-snug text-inksoft">
                <span className="font-semibold text-ink">DTC backfill pending</span> — Windsor only
                has DTC Shopify data from 3/31/26 forward. Long-range DTC trends will fill in once
                the historical range is extended.
              </p>
            </div>

            <Section title="Top-line performance" detail="Tier 1 / 6 charts">
              <ChartGrid>
                <ChartCell title="Revenue by channel" subtitle="Monthly, stacked area">
                  <RevenueByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Order count by channel" subtitle="Monthly">
                  <OrdersByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Average order value by channel" subtitle="Dual axis (B2B vs DTC)">
                  <AOVByChannel data={data.monthlySeries} />
                </ChartCell>
                <ChartCell title="Cumulative revenue YTD" subtitle="By calendar year">
                  <CumulativeYTD data={data.cumulativeYTD} />
                </ChartCell>
                <ChartCell title="Top 10 SKUs by revenue" subtitle="Channel split">
                  <TopSKUs data={data.topSKUs} />
                </ChartCell>
                <ChartCell title="Revenue by product family" subtitle="Gummies / Xvié / Sachets">
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
                <ChartCell
                  title="Repeat purchase rate by channel"
                  subtitle="% returning customers, monthly"
                >
                  <RepeatRate data={data.repeatRate} />
                </ChartCell>
                <ChartCell title="DTC subscription vs one-time" subtitle="Revenue mix, monthly">
                  <SubVsOneTime data={data.subVsOneTime} />
                </ChartCell>
              </ChartGrid>
            </Section>

            <Section title="Operational & geographic" detail="Tier 3 / 3 charts">
              <ChartGrid>
                <ChartCell title="Top 15 states by revenue" subtitle="Channel split" wide>
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
                Channel classification: orders are B2B if tagged{" "}
                <code className="bg-paper2 px-1 rounded">b2b</code>, contain a known rep name in
                tags, or use a B2B-pattern discount code (REP-, XVIE-numeric, ADCS-, B2B-).
                Otherwise DTC.
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
      {/* Dark-brown banner header — matches leadership dash */}
      <div className="bg-brown text-paper rounded-md px-4 py-2.5 md:px-5 md:py-3 mb-3 md:mb-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-serif text-lg md:text-2xl font-semibold leading-tight">{title}</h2>
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
      } bg-paper2 border border-rule rounded-md p-3 md:p-5`}
    >
      <div className="mb-2 md:mb-3">
        <h3 className="font-serif text-base md:text-lg font-semibold leading-tight text-ink">
          {title}
        </h3>
        {subtitle && (
          <p className="font-sans text-[11px] md:text-xs text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
