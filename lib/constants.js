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

  // ---- Sachets (2ct gummy "On The Go") ----
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
  // Sachets BEFORE Gummies (002CT pattern would otherwise match GN- prefix)
  if (u.startsWith("X-GN-002")) return "Sachets";
  if (u.startsWith("X-GN")) return "Gummies";
  if (u.includes("XVIE")) return "XVIE";
  if (u.includes("FRC")) return "Serum";
  if (u.startsWith("X-TEE") || u.startsWith("X-BAG") || u.startsWith("XTR-")) return "Exclude";
  return "Other";
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
  Gummies: new Set(["860011740100"]),
  // null = no SKU filter; count all SKUs in this family for B2B
  XVIE:    null,
};

// =============================================================
// Channel + chart colors
// Aligned with leadership dash login page tokens.
// =============================================================

export const CHANNEL_COLORS = {
  B2B: "#D89A1C",    // primary brown — leadership dash convention
  DTC: "#2E7D6B",    // teal/green
  ADCS: "#9A4A28",   // warm orange-brown — used for sub-bucket only
  Total: "#1A1A1A",
};

export const FAMILY_COLORS = {
  Gummies: "#D89A1C",
  Serum: "#A8472A",
  XVIE: "#2E7D6B",
  Sachets: "#9C6F4A",
};

// =============================================================
// 3PL state routing
// =============================================================

const SCALE3PL_STATES = new Set([
  "CA", "OR", "WA", "NV", "ID", "MT", "WY", "UT", "AZ", "CO", "NM", "AK", "HI", "ND", "SD",
  "CALIFORNIA", "OREGON", "WASHINGTON", "NEVADA", "IDAHO", "MONTANA", "WYOMING", "UTAH",
  "ARIZONA", "COLORADO", "NEW MEXICO", "ALASKA", "HAWAII", "NORTH DAKOTA", "SOUTH DAKOTA",
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

export const NON_REP_TAGS = new Set([
  "b2b", "dtc", "adcs", "subscription", "first order", "subscription first order",
  "new", "national", "loyalty", "gold", "platinum", "diamond", "wholesale",
  "sample", "comp", "test", "employee", "medical spa", "net terms",
  "ofg", "auto-tag", "manual", "gummy", "scale3pl", "shipbob ga",
  "order fulfillment guru", "bundle", "xvie", "nova vita (xvie only)",
]);
