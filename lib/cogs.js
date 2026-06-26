// =============================================================================
// PER-SKU COGS + GROSS-MARGIN  —  repo-local fallback (sheet overrides this)
// =============================================================================
// Per-unit cost of goods, used to derive gross margin. The dashboard maps each
// order line item's SKU → a per-UNIT cost below, then subtracts total COGS from
// net sales. When the Google Sheet "COGS" tab is wired (lib/costsSheet.js), its
// per-SKU values OVERRIDE these; this file is the fallback.
//
// Values reconciled to the Xtressé Financial Model v16 (Product COGS tab,
// Sam-confirmed unit-costs): gummy bag $6.15, serum unit $23.50, sachet $1.20,
// XVIE $225 for the B2B 6-vial case (X-XVIE-2ML-006). XVIE single/3-pack SKUs
// are estimated pro-rata from the $225 case (≈$37.50/vial) — confirm if XVIE
// sells in those sub-pack sizes.
// =============================================================================

// These are now model-reconciled (not placeholders). Kept as a flag in case a
// SKU still needs a real cost; the dashboard surfaces it when true.
export const COGS_IS_PLACEHOLDER = false;
export const COGS_PLACEHOLDER_NOTE =
  "COGS reconciled to Financial Model v16 (gummy $6.15 / serum $23.50 / sachet $1.20 / XVIE case $225). XVIE sub-pack costs estimated from the case.";

// ── Per-UNIT cost by exact Shopify SKU ──────────────────────────────────────
// Highest-precision layer: if a SKU is listed here, this cost is used directly
// for each unit of that SKU (line_item__quantity × cost). Case SKUs carry the
// full case cost (one "unit" of the case SKU = one case).
export const COGS_PER_UNIT_BY_SKU = {
  // ---- Gummies ----
  "860011740100": 276.75,     // B2B Hair Growth Gummy Case (45 bags) → case cost
  "X-GN-045CT-001": 6.15,
  "X-GN-060CT-001": 6.15,
  "X-GN-060CT-003": 6.15,
  "X-GN-060CT-BROWN": 6.15,
  "X-GN-090CT-001": 6.15,
  "X-GN-180CT-001": 6.15,
  // Sachets (2ct gummy "On The Go") — model unit cost $1.20.
  "X-GN-002CT-001": 1.20,
  "X-GN-002CT-002": 1.20,
  "X-GN-002CT-003": 1.20,
  "X-GN-002CT-004": 1.20,
  "X-GN-002CT-RAW": 1.20,

  // ---- Serum (Force Concentrate) ----
  "X-FRC-30ML-CASE": 141.00,  // B2B Concentrate Case (6 units) → case cost (model lists $147)
  "X-FRC-30ML-001": 23.50,    // single serum unit

  // ---- XVIE (B2B) — model: $225 for the 6-vial case (X-XVIE-2ML-006) ----
  "X-XVIE-2ML-006": 225.00,   // 6-vial case → case cost (primary B2B XVIE SKU)
  "X-XVIE-2ML-001": 37.50,    // single vial est. = 225 / 6
  "X-XVIE-2ML-003": 112.50,   // 3-pack est. = 3 × 37.50
  "X-XVIE-003": 112.50,       // starter (3) est.
};

// ── Per-UNIT cost by product family (fallback) ──────────────────────────────
// Used when a SKU isn't explicitly listed above. These are single-UNIT costs.
export const COGS_PER_UNIT_BY_FAMILY = {
  Gummies: 6.15,
  Sachets: 1.20,
  Serum: 23.50,
  XVIE: 37.50,   // single vial (= $225 case / 6)
};

/**
 * Per-unit COGS for a SKU. Exact-SKU map wins; else family fallback; else 0.
 * Pure + framework-free so it's safe to call from the aggregation layer.
 *   familyForFn — pass lib/constants.js familyFor (kept as a param so this
 *   file has NO import of constants.js, avoiding any cross-module cycle).
 */
export function cogsPerUnit(sku, familyForFn) {
  if (!sku) return 0;
  if (Object.prototype.hasOwnProperty.call(COGS_PER_UNIT_BY_SKU, sku)) {
    return COGS_PER_UNIT_BY_SKU[sku];
  }
  const fam = typeof familyForFn === "function" ? familyForFn(sku) : null;
  if (fam && COGS_PER_UNIT_BY_FAMILY[fam] != null) return COGS_PER_UNIT_BY_FAMILY[fam];
  return 0;
}
