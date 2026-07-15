
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

// NOTE (2026-07-15): the legacy classifyOrder/isAdcs/repFromTags helpers
// that used to live here were DELETED — they were unimported dead copies
// that had drifted from the canonical logic (exact-match ADCS, name-shape
// rep guessing). Channel classification lives ONLY in
// lib/xtresseCore.js → classifyChannel()/isAdcs()/findRep(). Import from
// there; never re-add a local variant.

/** Subscription detection. */
export function isSubscription(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /subscription/i.test(t));
}

/** First-order detection. */
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}
