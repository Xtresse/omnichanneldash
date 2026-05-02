import { B2B_DISCOUNT_PATTERNS, NON_REP_TAGS } from "./constants.js";

/**
 * Parse a Windsor order_tags string. Tags arrive as a stringified
 * Python list literal — e.g. "['b2b', 'Jamie Bergeron', 'Subscription']".
 */
export function parseOrderTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  const matches = String(raw).match(/'([^']*)'/g) || String(raw).match(/"([^"]*)"/g) || [];
  return matches.map((m) => m.replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
}

function looksLikeRepName(tag) {
  if (!tag) return false;
  const lower = tag.toLowerCase().trim();
  if (NON_REP_TAGS.has(lower)) return false;
  if (lower.startsWith("ofg:") || lower.startsWith("auto-")) return false;
  const parts = tag.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[A-Z][a-zA-Z'\-.]+$/.test(p));
}

/**
 * Classify an order as 'B2B' or 'DTC'. ADCS is a SUB-channel of B2B —
 * use isAdcs() separately to break it out for sub-tile display.
 *
 * Returns 'B2B' if: tagged b2b/wholesale, ADCS-tagged, contains rep name,
 * or uses a B2B discount code pattern. Otherwise 'DTC'.
 */
export function classifyOrder({ tagsRaw, discountCodesRaw }) {
  const tags = parseOrderTags(tagsRaw);
  const lowered = tags.map((t) => t.toLowerCase());

  // ADCS orders are B2B (every ADCS order is also tagged 'b2b' in practice,
  // but check independently in case that ever changes)
  if (lowered.includes("adcs")) return "B2B";
  if (lowered.includes("b2b") || lowered.includes("wholesale")) return "B2B";
  if (tags.some(looksLikeRepName)) return "B2B";

  const codes = (discountCodesRaw ? String(discountCodesRaw) : "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.some((c) => B2B_DISCOUNT_PATTERNS.some((re) => re.test(c)))) return "B2B";

  return "DTC";
}

/** Identifies an order as ADCS (sub-bucket within B2B). */
export function isAdcs(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^adcs$/i.test(t));
}

/** Subscription detection. */
export function isSubscription(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /subscription/i.test(t));
}

/** First-order detection. */
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}
