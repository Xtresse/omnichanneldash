// =============================================================
// SKU → product family mapping
// Sam's 4 categories: Gummies, Serum, XVIE, Sachets
// "Exclude" SKUs (apparel/merch/test/packaging) are filtered from
// product-level rollups.
// =============================================================

export const SKU_FAMILY = {
  // ---- Gummies (full bottles + B2B cases) ----
  "860011740100": "Gummies",       // B2B Hair Growth Gummy Case (45 pcs)
  "X-GN-045CT-001": "Gummies",
  "X-GN-060CT-001": "Gummies",
  "X-GN-060CT-003": "Gummies",
  "X-GN-060CT-BROWN": "Gummies",
  "X-GN-090CT-001": "Gummies",
  "X-GN-180CT-001": "Gummies",

  // ---- Sachets (2ct gummy "On The Go") — broken out as their own family
  // (corrected 2026-07-09): previously lumped into Gummies per a 2026-05
  // decision, which conflicted with the later decision to give Sachets its
  // own tracked row in the gross-margin/Actual-vs-Goal breakdowns — that row
  // could never show a nonzero value while familyFor() never produced
  // "Sachets", silently inflating Gummies by real sachet revenue instead.
  "X-GN-002CT-001": "Sachets",
  "X-GN-002CT-002": "Sachets",
  "X-GN-002CT-003": "Sachets",
  "X-GN-002CT-004": "Sachets",
  "X-GN-002CT-RAW": "Sachets",

  // ---- Serum (Force Concentrate) ----
  "X-FRC-30ML-CASE": "Serum",
  "X-FRC-30ML-001": "Serum",

  // ---- XVIE ----
  "X-XVIE-2ML-006": "XVIE",
  "X-XVIE-2ML-001": "XVIE",
  "X-XVIE-2ML-003": "XVIE",
  "X-XVIE-003": "XVIE",

  // ---- Exclude ----
  "XTR-SHPR-DBL": "Exclude",
  "test-nem-1234": "Exclude",
  "X-BAG-MKT": "Exclude",
  "X-TEE-F-XS": "Exclude",
  "X-TEE-F-S": "Exclude",
  "X-TEE-F-MD": "Exclude",
  "X-TEE-F-LG": "Exclude",
  "X-TEE-F-XL": "Exclude",
  "X-TEE-M-SM": "Exclude",
  "X-TEE-M-MD": "Exclude",
  "X-TEE-M-LG": "Exclude",
  "X-TEE-M-XL": "Exclude",
};

export function familyFor(sku) {
  if (!sku) return "Other";
  if (SKU_FAMILY[sku]) return SKU_FAMILY[sku];
  const u = sku.toUpperCase();
  // X-GN-002CT-* sachets are caught by the exact-match table above (returns
  // "Sachets") before reaching this prefix fallback, so any OTHER X-GN SKU
  // (full-size bottles/cases not yet in the table) still defaults to Gummies.
  if (u.startsWith("X-GN")) return "Gummies";
  if (u.includes("XVIE")) return "XVIE";
  if (u.includes("FRC")) return "Serum";
  if (u.startsWith("X-TEE") || u.startsWith("X-BAG") || u.startsWith("XTR-")) return "Exclude";
  return "Other";
}

// =============================================================
// Composite/bundle SKUs — one SKU that legitimately represents MORE
// THAN ONE product family in a single line item.
//
// Gap found 2026-08 (B2B product-tagging investigation): XTR-DTC-GMFR-02
// ("Xtressé Grow System") pairs the Hair Growth Gummies with the Force
// Concentrate serum, but familyFor() classified it "Exclude" (caught by
// the generic "XTR-" prefix fallback above) — it was never decomposed
// into its component families anywhere.
//
// Verified against the live product (2026-08-11, Admin GraphQL):
//   product 9363085918431 "Xtressé Grow System", single variant,
//   variant.requiresComponents = false.
// requiresComponents:false means this is NOT a native Shopify Bundle —
// Shopify never emits separate child line items for its contents, so
// there is no line-item-level decomposition available from order data.
// The only correct fix is to hardcode that this ONE SKU counts as BOTH
// families whenever it appears as a line item. (It is also DTC-only in
// practice — confirmed via order search, every order carrying this SKU
// is tagged "dtc" — so this has ~zero effect on B2B rollups, but fixes
// the gap for any future DTC/blended use, e.g. the new First-Gummy/
// First-Serum/First-XVIE tagging logic in lib/firstOrderTags.js.)
//
// familyFor() above is left UNCHANGED (still single-valued, still returns
// "Exclude" for this SKU) so no existing revenue-rollup consumer changes
// behavior. Use familiesFor() below wherever a SKU needs to be able to
// count toward more than one family at once.
export const COMPOSITE_SKU_FAMILIES = {
  "XTR-DTC-GMFR-02": ["Gummies", "Serum"],
};

// Composite-aware classifier: returns an ARRAY of families for a SKU.
// Single-family SKUs return a 1-element array via familyFor(); SKUs in
// COMPOSITE_SKU_FAMILIES return all of their component families; SKUs
// that classify to "Exclude"/"Other" (and aren't a known composite)
// return an empty array.
export function familiesFor(sku) {
  if (!sku) return [];
  if (COMPOSITE_SKU_FAMILIES[sku]) return COMPOSITE_SKU_FAMILIES[sku];
  const f = familyFor(sku);
  return f === "Exclude" || f === "Other" ? [] : [f];
}

export const FAMILY_ORDER = ["Gummies", "Serum", "XVIE", "Sachets"];

// =============================================================
// B2B Status Bar focus SKUs
// The top-of-dashboard B2B MTD widget should ONLY count the dedicated
// B2B case SKUs for each family, not single-unit/DTC SKUs that happen
// to be on B2B-tagged orders. This is separate from the global family
// aggregation (which counts every SKU on a B2B order as B2B) so the
// rest of the dashboard's B2B numbers stay unchanged.
//   Serum:   B2B Concentrate Case (X-FRC-30ML-CASE) only
//   Gummies: B2B Hair Growth Gummy Case (860011740100) only
//   XVIE:    all XVIE SKUs (no separate B2B case SKU exists)
// =============================================================
export const B2B_FOCUS_SKUS = {
  Serum:   new Set(["X-FRC-30ML-CASE"]),
  // Gummy Case + Sachets (sachets lumped into Gummies per Sam, 2026-05) —
  // still excludes single-unit retail gummy bottles.
  Gummies: new Set([
    "860011740100",
    "X-GN-002CT-001", "X-GN-002CT-002", "X-GN-002CT-003", "X-GN-002CT-004", "X-GN-002CT-RAW",
  ]),
  // null = no SKU filter; count all SKUs in this family for B2B
  XVIE:    null,
};

// =============================================================
// Channel + chart colors
// Aligned with leadership dash login page tokens.
// =============================================================

export const CHANNEL_COLORS = {
  B2B: "#F0922E",    // brand orange — primary channel
  DTC: "#2B1A10",    // black (no green per CEO)
  ADCS: "#A85F28",   // clay — sub-bucket only
  Total: "#2B1A10",  // brand ink
};

export const FAMILY_COLORS = {
  Gummies: "#F0922E", // orange — flagship
  Serum: "#5C2F2E",   // maroon
  XVIE: "#2B1A10",    // black
  Sachets: "#9C6F4A", // taupe
};

// =============================================================
// 3PL state routing
// =============================================================

// Matches the live Shopify Flow "Route to location based on shipping address"
// workflow's state list — SD routes to ShipBob (East) there, not Scale3PL.
const SCALE3PL_STATES = new Set([
  "CA", "OR", "WA", "NV", "ID", "MT", "WY", "UT", "AZ", "CO", "NM", "AK", "HI", "ND",
  "CALIFORNIA", "OREGON", "WASHINGTON", "NEVADA", "IDAHO", "MONTANA", "WYOMING", "UTAH",
  "ARIZONA", "COLORADO", "NEW MEXICO", "ALASKA", "HAWAII", "NORTH DAKOTA",
]);

export function fulfillmentLocFor(state) {
  if (!state) return "Unknown";
  const s = String(state).toUpperCase().trim();
  if (SCALE3PL_STATES.has(s)) return "Scale3PL (CA)";
  return "ShipBob GA";
}

// =============================================================
// Classification helpers
// =============================================================

export const B2B_DISCOUNT_PATTERNS = [
  /^REP-/i,
  /^XVIE\d+/i,    // XVIE50, XVIE25
  /^B2B-/i,
  /^ADCS-/i,
];

// =============================================================
// Discount-code canonical casing
// Shopify's Order.discountCodes stores codes AS THE CUSTOMER TYPED THEM
// (so the same code shows up as "OneTime10", "onetime10", "ONETIME10"
// across orders). The canonical casing lives on the discount *definition*
// (codeDiscountNodes). This map (keyed by UPPERCASE, snapshot of the live
// Shopify codeDiscountNodes) restores the real casing for display.
// Only affects the rendered string — never money, attribution, or
// classification (B2B_DISCOUNT_PATTERNS are all case-insensitive).
// Unknown/new codes fall through to their as-entered casing.
// =============================================================
export const DISCOUNT_CODE_CANONICAL = {
  WINBACK10: "WINBACK10", CF10: "Cf10", BUYBACK15: "BUYBACK15", SAMPLE10: "SAMPLE10",
  GOLD5: "GOLD5", PLATINUM12: "PLATINUM12", DIAMOND15: "DIAMOND15", XVIE50: "XVIE50",
  AAD1026: "AAD1026", AMSPA1026: "AMSPA1026", NEWWAVE1026: "NEWWAVE1026",
  MAR26WEBINAR: "Mar26Webinar", SKINSUMMIT1026: "SKINSUMMIT1026",
  DOCS4HAIR1026: "DOCS4Hair1026", DMA1026: "DMA1026", MODERN1026: "MODERN1026",
  SCALE1026: "SCALE1026", TAS1026: "TAS1026", AES1026: "AES1026", LAUNCH10: "LAUNCH10",
  MIRA20: "MIRA20", MIRA10: "MIRA10", MIRA: "MIRA", POPUP10: "POPUP10",
  ONETIME10: "OneTime10", MOM44: "MOM44",
};

// Restore canonical casing for a discount code; falls back to the input.
export function canonicalizeCode(raw) {
  if (!raw) return raw;
  return DISCOUNT_CODE_CANONICAL[String(raw).toUpperCase()] || raw;
}

export const NON_REP_TAGS = new Set([
  "b2b", "dtc", "adcs", "subscription", "first order", "subscription first order",
  "new", "national", "loyalty", "gold", "platinum", "diamond", "wholesale",
  "sample", "comp", "test", "employee", "medical spa", "net terms",
  "ofg", "auto-tag", "manual", "gummy", "scale3pl", "shipbob ga",
  "order fulfillment guru", "bundle", "xvie", "nova vita (xvie only)",
]);
