# omnichanneldash

Unified B2B + DTC + ADCS sales dashboard for Xtressé. Next.js 14 (App Router),
Recharts, Tailwind. Deployed at **omnichanneldash.vercel.app**, listed in
xtresse-hub as "Omni Channel Dashboard" (category: Sales).

## What it shows

- **KPIs**: gross/net sales, by channel (B2B / DTC / ADCS), today + trailing windows.
- **Actual vs Goal** ([components/BudgetVsActual.jsx](components/BudgetVsActual.jsx)): 3-tier
  (Budget / Base Goal / Stretch) targets vs actuals, by product and by channel, with
  run-rate projection to month-end. Currently mid-refactor on this branch
  (`agent/omni-targets-cogs-auth`) — see uncommitted diff before touching it.
- **Gross margin / contribution**: COGS + merchant fees + fulfillment cost rolled up
  against net sales ([lib/costsSheet.js](lib/costsSheet.js), [lib/cogs.js](lib/cogs.js)).
- **/ask**: an in-app chatbot ([app/api/ask/route.js](app/api/ask/route.js)) — Claude
  tool-use loop over "data rails" ([lib/rails/](lib/rails)) that answers natural-language
  questions about this dashboard's own sales data (variance, trends, top SKUs, rep
  performance). This already *is* a "dashboard bot," but scoped to this repo's data only.

## Data sources

- **Sales**: Windsor.ai → Shopify (`account ace1d0-26.myshopify.com`), via
  [lib/windsor.js](lib/windsor.js). Channel classification in `lib/classify.js`:
  `b2b`/`wholesale` tag or a rep-name-pattern tag or a `REP-`/`XVIE\d+`/`ADCS-`/`B2B-`
  discount code → B2B; otherwise DTC. Line items de-duped to one row/order for
  revenue/order-count/AOV; kept at line level for SKU/product-family rollups.
- **Targets/goals** (`lib/budgetSheet.js`): Google Sheet *"Xtresse Net Revenue Budget
  & Rep Goals 2026"* (`1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8`), 3 tabs — `Budget`,
  `Base Goal`, `Stretch`. Each tab: NET block + GROSS block, rows
  `Territory | Entity | Product`, months across as columns. `Territory=Company` rows
  are DTC/ADCS channel goals; all other rows are B2B rep goals (auto-rolled to B2B).
  Wire via published-CSV env vars (`BUDGET_CSV_URL_BUDGET` / `_BASE` / `_STRETCH`) or
  a service account (`GOOGLE_SHEETS_SA_EMAIL` / `GOOGLE_SHEETS_SA_PRIVATE_KEY`). **As of
  2026-07-09 neither is set** — the dashboard shows "No {tier} set" until one is wired.
  `lib/scenarioGoals.js` has a hardcoded June-2026 fallback (deck figures) for Base/Stretch
  NET only, used when the sheet isn't wired.
- **COGS / fees / fulfillment** (`lib/costsSheet.js`): same workbook, 3 more tabs —
  `COGS` (SKU unit cost), `Merchant Fees` (actual Shopify fees/month), `Fulfillment`
  (actual ShipBob/3PL spend/month). Env: `BUDGET_CSV_URL_COGS` / `_FEES` / `_FULFILLMENT`.
  Falls back to a placeholder COGS table in `lib/cogs.js` when unwired.

## Auth

Whole app is gated behind a shared password (`middleware.js` + `lib/auth.js`),
cookie-based session. Env: `DASHBOARD_PASSWORD`, `DASHBOARD_AUTH_SECRET`. Public
paths (no cookie required): `/login`, `/api/login`, `/api/logout`, `/api/warm`
(Vercel cron warmer), Next metadata routes.

## Conventions / gotchas

- Net sales = subtotal (post-discount, pre-shipping/tax) − refunds.
- DTC backfill: Windsor only has real DTC Shopify data from **2026-03-31 forward** —
  long-range DTC trends are sparse before that; the UI surfaces a banner.
- 5-minute server cache (`revalidate: 300`) on `/api/dashboard`; sheet reads
  (budget/COGS) cache at `revalidate: 600`.
- Targets are always **full-month**, never prorated — actuals get a run-rate
  projection instead (see the in-progress `BudgetVsActual.jsx` refactor).
- Mobile-first: 2/3/6-col KPI tiles by breakpoint, sticky header, `ChartShell`
  wrapper for Recharts, 16px inputs (no iOS auto-zoom).
- Monitored by `xtresse-monitor`'s daily health check (`/api/dashboard?from=today-30&to=today`
  expected to return ≥50 orders).

## Deploy

Vercel, team Xtressé. `npm run dev` / `npm run build`. Push to `main` → auto-deploy
(watch for the webhook-stall pattern `xtresse-monitor` auto-fixes with an empty commit).

## Related repos

- **xtresse-hub** — app directory listing this dashboard.
- **xtresse-monitor** — watches this app's health + data integrity, digests to Slack/email.
- **xtresse-financeos** — sibling app pulling similar Shopify/QBO data for full P&L.
- Google Sheet *"Xtresse Net Revenue Budget & Rep Goals 2026"* — shared with
  `budgetSheet.js`/`costsSheet.js`; same sheet feeds targets and cost tabs.
