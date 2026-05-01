// SKU → product family mapping
// Keep in sync with leadership / DTC dashboards.
export const SKU_FAMILY = {
  // Gummies (B2B + DTC, multiple count formats)
  "X-GN-045CT-001": "Gummies",
  "X-GN-060CT-001": "Gummies",
  "X-GN-090CT-001": "Gummies",
  "X-GN-180CT-001": "Gummies",
  // Xvie serum
  "X-XVIE-2ML-006": "Xvie",
  "X-XVIE-2ML-001": "Xvie",
  "X-XVIE-2ML-003": "Xvie Starter Pack",
  // Sachets
  "X-SACHET-001": "Sachets",
  "X-SACHET-30CT-001": "Sachets",
  // Future / ad-hoc
  "X-FRC-30ML-001": "Force Serum",
};

export function familyFor(sku) {
  if (!sku) return "Other";
  if (SKU_FAMILY[sku]) return SKU_FAMILY[sku];
  // Fuzzy fallbacks
  const u = sku.toUpperCase();
  if (u.startsWith("X-GN")) return "Gummies";
  if (u.includes("XVIE")) return "Xvie";
  if (u.includes("SACHET")) return "Sachets";
  if (u.includes("FRC")) return "Force Serum";
  return "Other";
}

// Channel colors — used everywhere (charts, KPI accents, legends)
export const CHANNEL_COLORS = {
  B2B: "#7a3d23",   // accent brown
  DTC: "#3a7a6f",   // teal/green
  Total: "#2b1a10", // ink
};

// 3PL state routing — Scale3PL (CA) handles western, ShipBob GA handles eastern/central.
// Windsor returns full state names ("California"), so the set holds full names + 2-letter codes.
const SCALE3PL_STATES = new Set([
  // 2-letter codes (defensive; Windsor uses names but keep both)
  "CA", "OR", "WA", "NV", "ID", "MT", "WY", "UT", "AZ", "CO", "NM", "AK", "HI", "ND", "SD",
  // Full names (what Windsor's order_shipping_address_province actually returns)
  "CALIFORNIA", "OREGON", "WASHINGTON", "NEVADA", "IDAHO", "MONTANA", "WYOMING", "UTAH",
  "ARIZONA", "COLORADO", "NEW MEXICO", "ALASKA", "HAWAII", "NORTH DAKOTA", "SOUTH DAKOTA",
]);

export function fulfillmentLocFor(state) {
  if (!state) return "Unknown";
  const s = String(state).toUpperCase().trim();
  if (SCALE3PL_STATES.has(s)) return "Scale3PL (CA)";
  return "ShipBob GA";
}

// Discount code patterns that indicate a B2B order even when no rep tag is present
export const B2B_DISCOUNT_PATTERNS = [
  /^REP-/i,
  /^XVIE\d+/i,        // XVIE50, XVIE25
  /^ADCS-/i,
  /^B2B-/i,
];

// Tags to ignore when scanning order_tags for rep names
// (these are operational tags, not rep identifiers)
export const NON_REP_TAGS = new Set([
  "b2b", "dtc", "subscription", "first order", "subscription first order",
  "new", "national", "loyalty", "gold", "platinum", "diamond", "wholesale",
  "sample", "comp", "test", "employee", "medical spa", "net terms",
  "ofg", "auto-tag", "manual", "gummy", "scale3pl", "shipbob ga",
  "order fulfillment guru",
]);
