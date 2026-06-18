// =============================================================================
// PER-SKU COGS + GROSS-MARGIN SCAFFOLD  —  repo-local, trivially editable
// =============================================================================
// PLACEHOLDER COGS — REPLACE WITH SAM'S REAL COGS.
//
// This is the ONE place to edit cost-of-goods. The dashboard derives gross
// margin ($ and %) by mapping each order line item's SKU → product family
// (via lib/constants.js familyFor) → a per-UNIT cost below, then subtracting
// total COGS from net sales. No other file holds cost numbers.
//
// NOTE: these are deliberately rough placeholders so the margin plumbing can
// be wired + rendered end-to-end. Swap in the real per-SKU costs (and, if the
// real costs differ by pack size, add the exact SKU keys to COGS_PER_UNIT_BY_SKU
// below) and the whole dashboard margin updates with no other code change.
//
// Provided placeholder figures (Sam, 2026-06 — flagged PLACEHOLDER):
//   gummy bag .................... $6.15   (single retail bag / bottle unit)
//   gummy case (45 bags) ......... $276.75 (= 45 × $6.15)
//   serum unit ................... $23.50
//   serum case (6 units) ......... $141.00 (= 6 × $23.50)
//   xvie ......................... leave at 0 (unknown — awaiting real COGS)
// =============================================================================

// Human-readable flag surfaced on the dashboard so nobody mistakes these for
// real numbers. Flip to false once Sam's actual COGS are entered.
export const COGS_IS_PLACEHOLDER = true;
export const COGS_PLACEHOLDER_NOTE =
  "PLACEHOLDER — replace with Sam's COGS (lib/cogs.js). XVIE cost unknown (0).";

// ── Per-UNIT cost by exact Shopify SKU ──────────────────────────────────────
// Highest-precision layer: if a SKU is listed here, this cost is used directly
// for each unit of that SKU (line_item__quantity × cost). Keys mirror
// lib/constants.js SKU_FAMILY so the mapping is auditable side-by-side.
//
// Gummy CASE and Serum CASE SKUs carry the full case cost (one "unit" of the
// case SKU = one case), while single-bag / single-unit SKUs carry the unit
// cost. SKUs not listed here fall back to the per-family unit cost below.
export const COGS_PER_UNIT_BY_SKU = {
  // ---- Gummies ----
  "860011740100": 276.75,     // B2B Hair Growth Gummy Case (45 bags) → case cost
  "X-GN-045CT-001": 6.15,
  "X-GN-060CT-001": 6.15,
  "X-GN-060CT-003": 6.15,
  "X-GN-060CT-BROWN": 6.15,
  "X-GN-090CT-001": 6.15,
  "X-GN-180CT-001": 6.15,
  // Sachets (2ct gummy "On The Go") — lumped into Gummies per Sam; treated as
  // a single bag-equivalent unit cost until a real sachet COGS is provided.
  "X-GN-002CT-001": 6.15,
  "X-GN-002CT-002": 6.15,
  "X-GN-002CT-003": 6.15,
  "X-GN-002CT-004": 6.15,
  "X-GN-002CT-RAW": 6.15,

  // ---- Serum (Force Concentrate) ----
  "X-FRC-30ML-CASE": 141.00,  // B2B Concentrate Case (6 units) → case cost
  "X-FRC-30ML-001": 23.50,    // single serum unit

  // ---- XVIE (cost unknown — placeholder 0) ----
  "X-XVIE-2ML-006": 0,
  "X-XVIE-2ML-001": 0,
  "X-XVIE-2ML-003": 0,
  "X-XVIE-003": 0,
};

// ── Per-UNIT cost by product family (fallback) ──────────────────────────────
// Used when a SKU isn't explicitly listed above. familyFor() (lib/constants.js)
// maps any unknown gummy SKU → "Gummies", etc. These are the single-UNIT costs
// (a bag, not a case) — case SKUs should be listed explicitly above so their
// case cost isn't undercounted as one bag.
export const COGS_PER_UNIT_BY_FAMILY = {
  Gummies: 6.15,
  Sachets: 6.15, // lumped into Gummies elsewhere, kept for completeness
  Serum: 23.50,
  XVIE: 0,       // unknown
};

/**
 * Per-unit COGS for a SKU. Exact-SKU map wins; else family fallback; else 0.
 * Pure + framework-free so it's safe to call from the aggregation layer.
 *   familyForFn — pass lib/constants.js familyFor (kept as a param so this
 *   file has NO import of constants.js, avoiding any cross-module cycle and
 *   keeping the SKU→family classification single-sourced at the call site).
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
