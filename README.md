# Xtressé Omnichannel Dashboard

Unified B2B + DTC analytics dashboard pulling directly from the Shopify Admin API. Combines logic from `xtresse-leadershipdash` (B2B) and `xtressedtcdash` (DTC) into a single omnichannel view, **mobile-first**.

## Mobile-first design choices

This rebuild assumes the dashboard will be opened on a phone first and a desktop second — the layout reflows clean from 320 px up to 1400 px without horizontal scroll, sticky header, scrolling filter pills, and a section quick-jump nav that lets you tap straight to Customers / Operations / Marketing without endless scrolling.

Specific patterns:
- KPI tiles: 2-up on phone → 3-up on tablet portrait → 6-up on desktop
- Chart cards: 1-up under 1024 px, 2-up at lg breakpoint and above (charts breathe on phones)
- Recharts wrapped in a `ChartShell` with `h-60` (240 px) on mobile and `h-80` (320 px) on desktop, plus full `ResponsiveContainer` so widths follow the card
- All inputs use 16 px font to stop iOS auto-zoom on focus
- Filter pills are min-44 px tall (Apple HIG touch target), scroll horizontally with hidden scrollbar
- Sticky top header with backdrop blur stays out of the way without losing access to the date range
- `<section>` anchors with `scroll-mt-32` so jumping to a section doesn't hide the heading under the sticky header
- DTC backfill warning surfaces as a top banner instead of buried in the footer
- Section headings stack with the eyebrow line, so even on a 320 px viewport the hierarchy stays readable

## What's included

**Tier 1 — Top-line performance (6 charts)**
- Revenue by channel (stacked area, monthly)
- Order count by channel (line, monthly)
- AOV by channel (dual-axis line)
- Cumulative YTD revenue (line, year over year)
- Top 10 SKUs by channel (stacked horizontal bar)
- Product family revenue: Gummies / Xvié / Sachets / Starter Pack (grouped bar)

**Tier 2 — Customer dynamics (4 charts)**
- B2B new vs returning accounts (stacked bar)
- DTC new vs returning customers (stacked bar)
- Repeat purchase rate by channel (line)
- DTC subscription vs one-time mix (stacked area)

**Tier 3 — Operational & geographic (3 charts)**
- Top 15 states by revenue, B2B vs DTC (horizontal stacked bar)
- Discount code usage (top 12, horizontal stacked bar)
- 3PL fulfillment split: Scale3PL (CA) vs ShipBob GA (grouped bar)

**Tier 4 — Marketing (scaffolded, awaiting connectors)**
- Blended ROAS placeholder
- CAC by channel placeholder
- Ad spend allocation placeholder
- Activates once Google Ads, Meta, TikTok, Klaviyo ad-spend data is wired in

## Architecture

- **Framework**: Next.js 14 (App Router), 14.2.35 (security-patched)
- **Charts**: Recharts 2.13
- **Styling**: Tailwind CSS 3.4
- **Data source**: Shopify Admin API direct (store `ace1d0-26.myshopify.com`), via the canonical shared core `lib/xtresseCore.js`. Windsor.ai is no longer used.
- **Channel classification** (`lib/classify.js`):
  - `b2b` or `wholesale` tag → B2B
  - Any tag matching a person-name pattern (and not in the NON_REP_TAGS list) → B2B
  - Discount code matching `REP-`, `XVIE\d+`, `ADCS-`, or `B2B-` → B2B
  - Otherwise → DTC
- **Order de-duplication**: line-item rows are de-duped to one row per `order_id` for revenue / order-count / AOV; line-level is preserved for SKU and product-family rollups
- **Cache**: 5-minute server-side cache (`revalidate: 300`) on the `/api/dashboard` route

## File structure

```
xtresse-omnichannel/
├── app/
│   ├── api/dashboard/route.js   # Server-side data endpoint
│   ├── globals.css              # Paper aesthetic + Recharts overrides + viewport
│   ├── layout.jsx               # Root layout with viewport meta for mobile
│   └── page.jsx                 # SSR entry, renders <Dashboard initial={...}/>
├── components/
│   ├── Dashboard.jsx            # Main layout, sticky header, section nav, banner
│   ├── KpiTiles.jsx             # 6-tile KPI strip (responsive 2/3/6 col)
│   ├── FilterBar.jsx            # Scrolling pill filter for date presets
│   └── charts/
│       ├── _shared.js           # ChartShell wrapper, color palette, formatters
│       ├── RevenueByChannel.jsx
│       ├── OrdersByChannel.jsx
│       ├── AOVByChannel.jsx
│       ├── CumulativeYTD.jsx
│       ├── TopSKUs.jsx
│       ├── ProductFamily.jsx
│       ├── NewVsReturning.jsx
│       ├── RepeatRate.jsx
│       ├── SubVsOneTime.jsx
│       ├── RevenueByState.jsx
│       ├── DiscountUsage.jsx
│       ├── FulfillmentSplit.jsx
│       └── MarketingPlaceholder.jsx
├── lib/
│   ├── salesData.js             # Shopify data fetcher + all aggregations
│   ├── shopify.js               # Thin adapter over the shared core
│   ├── xtresseCore.js           # Canonical Shopify client + revenue/tag logic
│   ├── classify.js              # B2B/DTC classification + tag parsing
│   └── constants.js             # SKU families, 3PL routing, color palette
├── .env.example
├── .gitignore
├── jsconfig.json                # `@/*` import alias
├── next.config.mjs
├── package.json
├── postcss.config.js
└── tailwind.config.js
```

## Deployment (matches existing `xtressedtcdash` / `xtresse-leadershipdash` pattern)

1. Create a new GitHub repo: `samxtresse/xtresse-omnichannel`
2. Push these files to `main`
3. On vercel.com → New Project → import `samxtresse/xtresse-omnichannel` under team Xtressé (`team_nutKciUOSpBvDrfG2cSPbSSA`)
4. Add environment variables: `SHOPIFY_ADMIN_API_TOKEN` (or `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`); optional `SHOPIFY_STORE_DOMAIN` (defaults to `ace1d0-26.myshopify.com`)
5. Deploy → Vercel auto-detects Next.js and ships in ~90 s

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your SHOPIFY_ADMIN_API_TOKEN (or CLIENT_ID + CLIENT_SECRET)
npm run dev
# Open http://localhost:3000 — try resizing to 375 px to validate mobile
```

Verify build before pushing:

```bash
npm run build   # Should compile cleanly, ~107 kB page / ~194 kB First Load JS
```

## Data layer notes

- Pulls at line-item granularity (one row per SKU per order); de-duplicated to order-level for revenue/order-count metrics, kept at line level for SKU mix
- `order_total_price > 0` filter excludes test/comp orders
- Default time window is `last_2years`. Date selector in header lets users switch between 30d / 3mo / 6mo / YTD / 12mo / last year / all time
- 5-minute API cache (`revalidate: 300`) on the `/api/dashboard` route
- DTC SKU exclusions (`X-GN-060CT-001`, `X-FRC-30ML-001`) are intentionally NOT applied here, since this dashboard *compares* both channels. A 60ct gummy bottle sold to DTC IS DTC; the same SKU sold via a B2B rep IS B2B.

## Constraints to be aware of

- **DTC ramp**: the store's DTC channel ramped on 3/31/26, so long-range DTC trends are sparse before that date. The dashboard surfaces this as a banner so it's clear what to expect.
- **Tier 4 inactive** until ad-platform spend data is wired in. Once Google Ads / Meta / TikTok / Klaviyo are connected, the placeholder cells can be replaced with real ROAS / CAC / spend charts using the same `<ChartShell>` pattern.

## Mobile testing checklist

After deploying, walk through these on a phone:

- [ ] Page renders without horizontal scroll at 375 px width (iPhone 13)
- [ ] Sticky header stays put when scrolling
- [ ] Tapping a section pill (Top-line / Customers / Operations / Marketing) jumps to that section without hiding the heading
- [ ] Date filter pills scroll horizontally with no visible scrollbar
- [ ] KPI tiles show 2-up on phone, 3-up on iPad portrait, 6-up on desktop
- [ ] All chart cards stack 1-up under 1024 px
- [ ] Tapping a chart bar/area doesn't trigger an iOS zoom on the input below
- [ ] DTC backfill banner is visible above the KPIs
- [ ] No font sub-16 px on any tappable text input
