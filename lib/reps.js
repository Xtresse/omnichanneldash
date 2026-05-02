// Canonical rep registry — mirrors xtresse-leadershipdash/lib/reps.js so
// omnichannel and leadership classify B2B orders identically.
// Each rep entry is [territory, region].
//   territory: 'Existing' | 'New' | '1099'
//   region   : 'East' | 'West'
export const REPS = {
  "Jamie Bergeron": ["Existing", "West"],
  "Michelle Spencer": ["Existing", "East"],
  "Dia Lamport": ["Existing", "East"],
  "Cheryl Greiber": ["Existing", "West"],
  "Denisse Schimelpfening": ["Existing", "West"],
  "Tyler De Masi": ["Existing", "East"],
  "Laura Mann": ["Existing", "West"],
  "Sherry Quinn": ["Existing", "East"],
  "Michelle Boehle": ["Existing", "West"],
  "Sonia Mace": ["Existing", "East"],
  "Taylor Bates": ["Existing", "East"],
  "Heidi Fisher": ["New", "West"],
  "Gina Napoli": ["New", "East"],
  "Amy Pierre": ["New", "East"],
  "Megan Gilbert": ["New", "East"],
  "Bridget Selberg": ["New", "West"],
  "Carrie Dodge": ["New", "West"],
  "Morgan Hood": ["New", "East"],
  "James Tuckett": ["New", "West"],
  "Lexi Cavaliere": ["1099", "West"],
  "Jim & Anne Weeks": ["1099", "East"],
  "Sevi McCutcheon": ["1099", "East"],
};

export const TERRITORY_ORDER = ["Existing", "New", "1099"];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Variant tag string -> canonical rep
const VARIANTS = (() => {
  const m = {};
  for (const r of Object.keys(REPS)) m[norm(r)] = r;
  m[norm("Tyler DeMasi")] = "Tyler De Masi";
  m[norm("jim and anne weeks")] = "Jim & Anne Weeks";
  m[norm("Dia Spangler Lamport")] = "Dia Lamport";
  m[norm("lexi Calaviere")] = "Lexi Cavaliere";
  return m;
})();

/**
 * Find the canonical rep name from a Windsor order_tags string.
 * Returns:
 *   - the canonical rep name (string) if a recognized rep tag is present
 *   - "__EXCLUDE__" if the order is ADCS / advanced derm (treat as ADCS)
 *   - null if no recognized rep tag (treat as DTC if no other B2B signals)
 *
 * Accepts the Python-list-literal format Shopify Flow writes
 * (e.g. "['b2b', 'Jamie Bergeron', 'Subscription']").
 */
export function findRep(tagsStr) {
  if (!tagsStr) return null;
  let tags;
  if (Array.isArray(tagsStr)) {
    tags = tagsStr;
  } else {
    const matches =
      String(tagsStr).match(/'([^']*)'/g) ||
      String(tagsStr).match(/"([^"]*)"/g) ||
      String(tagsStr).split(",");
    tags = matches.map((m) => m.replace(/^['"]|['"]$/g, "").trim());
  }
  if (!Array.isArray(tags) || tags.length === 0) return null;

  for (const t of tags) {
    const lower = String(t || "").toLowerCase();
    if (lower.includes("adcs") || lower.includes("advanced derm")) {
      return "__EXCLUDE__";
    }
  }
  for (const t of tags) {
    const nt = norm(t);
    if (VARIANTS[nt]) return VARIANTS[nt];
  }
  return null;
}

/** Quick territory lookup. Returns null for unknown reps. */
export function territoryFor(rep) {
  return REPS[rep] ? REPS[rep][0] : null;
}
