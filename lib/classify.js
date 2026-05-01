import { B2B_DISCOUNT_PATTERNS, NON_REP_TAGS } from "./constants.js";

/**
 * Parse a Windsor order_tags string. Tags arrive as a stringified
 * Python list literal — e.g. "['b2b', 'Jamie Bergeron', 'Subscription']".
 * Returns a clean array of trimmed tag strings.
 */
export function parseOrderTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  const matches = String(raw).match(/'([^']*)'/g) || String(raw).match(/"([^"]*)"/g) || [];
  return matches
    .map((m) => m.replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}

/**
 * Looks like a person's name? (Capitalized, two-ish words, not in the
 * non-rep tag set.)
 */
function looksLikeRepName(tag) {
  if (!tag) return false;
  const lower = tag.toLowerCase().trim();
  if (NON_REP_TAGS.has(lower)) return false;
  if (lower.startsWith("ofg:") || lower.startsWith("auto-")) return false;
  // Person name: at least one space, both halves start with uppercase letter
  const parts = tag.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[A-Z][a-zA-Z'\-.]+$/.test(p));
}

/**
 * Classify an order as B2B or DTC.
 *
 * Inputs:
 *  - tagsRaw: the order_tags string (or array) from Windsor
 *  - discountCodesRaw: the order_discount_codes string from Windsor
 *
 * Returns: 'B2B' | 'DTC'
 *
 * Logic, in priority order:
 *   1. Tags contain 'b2b' (case insensitive) → B2B
 *   2. Tags contain a rep name (looksLikeRepName) → B2B
 *   3. Discount code matches a known B2B pattern (XVIE50, REP-, etc) → B2B
 *   4. Otherwise → DTC
 */
export function classifyOrder({ tagsRaw, discountCodesRaw }) {
  const tags = parseOrderTags(tagsRaw);
  const lowered = tags.map((t) => t.toLowerCase());

  if (lowered.includes("b2b") || lowered.includes("wholesale")) return "B2B";
  if (tags.some(looksLikeRepName)) return "B2B";

  const codes = (discountCodesRaw ? String(discountCodesRaw) : "")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (codes.some((c) => B2B_DISCOUNT_PATTERNS.some((re) => re.test(c)))) return "B2B";

  return "DTC";
}

/**
 * Subscription detection — scans tags for "Subscription" (case-insensitive).
 * Used in the DTC sub-vs-one-time chart.
 */
export function isSubscription(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /subscription/i.test(t));
}

/**
 * First-order detection — scans tags for "First Order" (exact tag created
 * by Shopify segmentation).
 */
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}
