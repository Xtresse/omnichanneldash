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

const SECTIONS = [
  { id: "topline", label: "Top-line" },
  { id: "customers", label: "Customers" },
  { id: "operational", label: "Operations" },
  { id: "marketing", label: "Marketing" },
];

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
        <div className="max-w-md mx-auto mt-12 rounded-lg border border-rule bg-paper2 p-6">
          <h2 className="font-serif text-2xl text-brown mb-2">Couldn&apos;t load data</h2>
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
      {/* Sticky top header — collapses elegantly on mobile */}
      <header className="sticky top-0 z-30 backdrop-blur bg-paper/85 border-b border-rule">
        <div className="max-w-[1400px] mx-auto px-3 md:px-6 py-2.5 md:py-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="font-serif font-semibold text-2xl md:text-4xl tracking-tight leading-none">
                Xtress<em className="not-italic text-accent">é</em> Omnichannel
              </h1>
              <p className="font-sans text-[10px] md:text-xs uppercase tracking-[0.18em] text-inksoft mt-1">
                B2B &middot; DTC &middot; Live from Shopify via Windsor.ai
              </p>
            </div>
            {data && (
              <div className="font-sans text-[10px] md:text-xs text-muted shrink-0">
                {data.orderCount.toLocaleString()} orders &middot; refreshed{" "}
                {new Date(data.generatedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>

          <div className="mt-2.5 md:mt-3">
            <FilterBar preset={preset} onChange={changePreset} loading={isPending} />
          </div>

          {/* Section quick-jump nav (visible on mobile + desktop, scrolls to anchor) */}
          <nav
            aria-label="Section navigation"
            className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1"
          >
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 font-sans text-[11px] md:text-xs px-2.5 py-1 rounded-md text-inksoft hover:text-ink hover:bg-paper2 border border-transparent hover:border-rule transition"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-3 md:px-6 py-3 md:py-8">
        {data && (
          <>
            {/* DTC backfill banner — visible up top so users know what to expect */}
            <div className="mb-4 md:mb-6 rounded-md border border-amber-300/60 bg-amber-50/70 px-3 py-2 md:px-4 md:py-2.5">
              <p className="font-sans text-[11px] md:text-xs leading-snug text-amber-900">
                <strong>DTC backfill pending</strong> — Windsor only has DTC Shopify data from
                3/31/26 forward. Long-range DTC trends will fill in once the historical range is
                extended.
              </p>
            </div>

            <KpiTiles kpis={data.kpis} />

            {/* Tier 1 — Top-line performance */}
            <Section id="topline" title="Top-line performance" eyebrow="Tier 1">
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
              </ChartGrid>
              <ChartGrid>
                <ChartCell title="Top 10 SKUs by revenue" subtitle="Channel split">
                  <TopSKUs data={data.topSKUs} />
                </ChartCell>
                <ChartCell title="Revenue by product family" subtitle="Gummies / Xvié / Sachets">
                  <ProductFamily data={data.productFamily} />
                </ChartCell>
              </ChartGrid>
            </Section>

            {/* Tier 2 — Customer dynamics */}
            <Section id="customers" title="Customer dynamics" eyebrow="Tier 2">
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

            {/* Tier 3 — Operational & geographic */}
            <Section id="operational" title="Operational & geographic" eyebrow="Tier 3">
              <ChartGrid>
                <ChartCell title="Top 15 states by revenue" subtitle="Channel split" wide>
                  <RevenueByState data={data.revenueByState} />
                </ChartCell>
              </ChartGrid>
              <ChartGrid>
                <ChartCell title="Discount code usage" subtitle="Top 12 by frequency">
                  <DiscountUsage data={data.discountUsage} />
                </ChartCell>
                <ChartCell title="3PL fulfillment split" subtitle="Order count by location">
                  <FulfillmentSplit data={data.fulfillmentSplit} />
                </ChartCell>
              </ChartGrid>
            </Section>

            {/* Tier 4 — Marketing (placeholder) */}
            <Section
              id="marketing"
              title="Marketing performance"
              eyebrow="Tier 4 — pending connectors"
              note="Activates once Google Ads, Meta, TikTok, and Klaviyo are authorized on Windsor.ai."
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
            </Section>

            <footer className="font-sans text-[10px] md:text-xs text-muted mt-12 border-t border-rule pt-4 leading-relaxed">
              <p>
                Channel classification: orders are B2B if tagged{" "}
                <code className="bg-paper2 px-1 rounded">b2b</code>, contain a known rep name in
                tags, or use a B2B-pattern discount code (REP-, XVIE-numeric, ADCS-). Otherwise
                DTC.
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

function Section({ id, title, eyebrow, note, children }) {
  return (
    <section id={id} className="mt-8 md:mt-12 scroll-mt-32 md:scroll-mt-36">
      <div className="mb-3 md:mb-5">
        {eyebrow && (
          <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted mb-1">
            {eyebrow}
          </div>
        )}
        <h2 className="font-serif text-xl md:text-2xl font-medium leading-tight">{title}</h2>
        {note && <p className="font-sans text-xs text-inksoft mt-2 max-w-xl">{note}</p>}
      </div>
      <div className="space-y-4 md:space-y-6">{children}</div>
    </section>
  );
}

function ChartGrid({ children }) {
  // Single column on mobile, 2 cols at lg breakpoint
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">{children}</div>;
}

function ChartCell({ title, subtitle, wide, children }) {
  return (
    <div
      className={`${
        wide ? "lg:col-span-2" : ""
      } bg-paper2/60 border border-rule rounded-lg p-3 md:p-5`}
    >
      <div className="mb-2 md:mb-3">
        <h3 className="font-serif text-base md:text-lg font-medium leading-tight">{title}</h3>
        {subtitle && (
          <p className="font-sans text-[11px] md:text-xs text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
