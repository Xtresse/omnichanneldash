# Account / Loyalty report generator

Turns Shopify order history into a branded multi-tab workbook
(Tier Progress · Lapsed Locations · Validation · Read Me), by **ship-to location**
and **rep territory**, with contacts, addresses, last order value, and cross-sell
flags. Reusable for any product, period, or tier scheme.

## Pipeline (hands-off — no manual export)
```
node   pull_orders.mjs   /tmp/xtresse_orders.json          # 1. pull all orders (Bulk API, full history)
node   assign_reps.mjs   /tmp/xtresse_orders.json /tmp/territory_reps.json   # 2. resolve current territory rep
python3 loyalty_report.py /tmp/xtresse_orders.json "out.xlsx" /tmp/territory_reps.json   # 3. build workbook
```
(needs `openpyxl`: `pip3 install openpyxl`). Step 3 auto-picks up `/tmp/territory_reps.json`
if present, so the 3rd arg is optional.

## The three scripts
- **`pull_orders.mjs`** — runs a Shopify Bulk Operations export of every order +
  line item + tags + shipping/billing, stitches the JSONL (line items carry
  `__parentId`), converts dates to shop-local, writes normalized JSON. Creds come
  from `omnichanneldash/.env.local` (`SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`,
  client-credentials grant → read_all_orders; store `ace1d0-26`).
- **`assign_reps.mjs`** — resolves the **current territory rep** for each ship-to
  location using the canonical **Sales-Rep-Dashboards** engine (sibling repo:
  `lib/repTerritory.js` + `lib/repRoster.js`, imported unchanged). Tag-primary
  (fresh ≤120d) → declared overrides → ZIP prefix → region → state → nearest-rep
  proximity, over an 18-month recency window. Outputs `{locationKey: {rep, tagRep,
  basis, reassignedFrom}}`.
- **`loyalty_report.py`** — builds the workbook from the orders (JSON from the pull,
  or a manual CSV export) + the territory map. `Rep` = current territory owner;
  `Assigned Via` = how it was decided; `Opened By (tag)` = the tagged rep when it
  differs (reassignment). Active buyers keep their fresh tag; dormant/lapsed accounts
  flow to the current territory owner.

## Reuse for any product / period
Edit `CONFIG` at the top of `loyalty_report.py`:
- `target_skus` + `target_label` — e.g. Serum Case `{"X-FRC-30ML-CASE"}`, XVIE, etc.
- `period` / `period_label`, `tiers` `(min_units, name)` ascending, `crosssell` flags.

## Fallback (no creds)
`loyalty_report.py` also accepts a manual **Shopify Admin → Orders → Export → All
orders → Plain CSV** as input. Run `assign_reps.mjs` against the JSON pull for the
territory map, or skip it and the report falls back to the raw order-tag rep.

## Conventions (Xtresse canonical)
- A **location = Shipping Company + ZIP** (true ship-to clinic). Not billing company
  (group/AP entities span clinics) and not ZIP alone (a ZIP can hold several clinics).
- **B2B only**, **ADCS excluded**, cancelled excluded. Rep matching + territory come
  from the sales-rep-dashboard libs (single source of truth — don't fork them).

Verified 2026-06-17: live pull (7,483 orders) → 887 locations / 1,378 Q2 gummy cases;
territory resolved 1,858 B2B locations (2 unassigned), 173 lapsed accounts reassigned
to current owner; all validation accounts tie to real order IDs.
