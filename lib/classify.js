import { B2B_DISCOUNT_PATTERNS, NON_REP_TAGS } from "./constants.js";

/**
 * Parse a Windsor order_tags string. Tags arrive in one of three formats:
 *   - Stringified Python list literal: "['b2b', 'Jamie Bergeron', 'Subscription']"
 *   - JSON-style:                       '["b2b", "Jamie Bergeron"]'
 *   - Plain comma-separated:            "b2b, Jamie Bergeron, Subscription"
 *
 * Earlier versions used a quote-only matcher and silently returned an
 * empty array for the plain CSV format — that was breaking the
 * "first order" tag check on a chunk of B2B orders. This version mirrors
 * xtresse-leadershipdash/lib/windsor.js parseTagSet().
 */
export function parseOrderTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);

  // Strip outer brackets (Python list literal) and surrounding whitespace.
  const stripped = String(raw).trim().replace(/^\[|\]$/g, "");

  // If quoted tags are present, peel them out — this preserves tags
  // that contain a comma in their text.
  const quoted = stripped.match(/['"]([^'"]*)['"]/g);
  if (quoted && quoted.length > 0) {
    return quoted
      .map((m) => m.replace(/^['"]|['"]$/g, "").trim())
      .filter(Boolean);
  }

  // Plain comma-separated fallback.
  return stripped
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
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

/**
 * Extract the first rep name from order tags.
 * Returns null if none of the tags look like a rep name.
 */
export function repFromTags(tagsRaw) {
  const tags = parseOrderTags(tagsRaw);
  for (const t of tags) {
    if (looksLikeRepName(t)) return t.trim();
  }
  return null;
}

/** Subscription detection. */
export function isSubscription(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /subscription/i.test(t));
}

/** First-order detection. */
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}
