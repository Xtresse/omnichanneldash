// Resolve the CURRENT territory rep for every ship-to location, using the
// canonical Sales-Rep-Dashboards engine (lib/repTerritory.js + repRoster.js) —
// tag-primary (fresh <=120d) then declared overrides -> ZIP prefix -> region ->
// state -> nearest-rep proximity, over an 18-month recency window.
//
//   node assign_reps.mjs [orders.json] [out.json]
//     orders.json default /tmp/xtresse_orders.json   (from pull_orders.mjs)
//     out.json     default /tmp/territory_reps.json
//
// Output: { "<locationKey>": {rep, tagRep, basis, reassignedFrom} } keyed by the
// SAME location key the report uses: norm(shipCompany|shipName|email) + "|" + zip5.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRD = resolve(here, "../../../Sales-Rep-Dashboards/lib");
// The rep-dashboard repo is a CJS-context Next app; copy the two self-contained
// territory libs to .mjs so we can ESM-import them unchanged.
mkdirSync("/tmp/_terr", { recursive: true });
writeFileSync("/tmp/_terr/repRoster.mjs", readFileSync(resolve(SRD, "repRoster.js"), "utf8"));
writeFileSync("/tmp/_terr/repTerritory.mjs",
  readFileSync(resolve(SRD, "repTerritory.js"), "utf8").replace(/['"]\.\/repRoster\.js['"]/g, "'./repRoster.mjs'"));
const { matchRepFromTags, getRepBySlug } = await import("/tmp/_terr/repRoster.mjs");
const { buildRepTerritory, resolveRepForAccount } = await import("/tmp/_terr/repTerritory.mjs");

const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const z5 = (s) => { const d = String(s || "").replace(/[^0-9]/g, ""); return d.length >= 5 ? d.slice(0, 5) : ""; };
const name = (slug) => (slug ? (getRepBySlug(slug)?.name || slug) : "");

const orders = JSON.parse(readFileSync(process.argv[2] || "/tmp/xtresse_orders.json", "utf8"));
const tagged = [];          // {repSlug, zip, state, date, netSales} for the territory map
const acc = new Map();       // locationKey -> rolling account facts
for (const o of orders) {
  if (o.cancelled || !o.date) continue;
  const slug = matchRepFromTags(o.tags);
  if (slug === "__EXCLUDE__") continue;            // ADCS
  const repSlug = slug || null;
  const tl = String(o.tags || "").toLowerCase();
  if (!(repSlug || tl.includes("b2b") || tl.includes("wholesale"))) continue;   // B2B only
  const label = o.shipCo || o.shipName || o.email; if (!label) continue;
  const z = z5(o.zip), key = norm(label) + "|" + z;
  if (repSlug) tagged.push({ repSlug, zip: o.zip, state: o.prov, date: o.date, netSales: Number(o.total) || 0 });
  let a = acc.get(key);
  if (!a) { a = { key, lastOrderDate: "", zip: z, state: o.prov, lastTaggedRep: null, lastTaggedDate: "" }; acc.set(key, a); }
  if (o.date > a.lastOrderDate) { a.lastOrderDate = o.date; a.zip = z; a.state = o.prov; }
  if (repSlug && o.date >= a.lastTaggedDate) { a.lastTaggedRep = repSlug; a.lastTaggedDate = o.date; }
}

const territory = buildRepTerritory(tagged);
const out = {};
let reassigned = 0, unassigned = 0;
for (const a of acc.values()) {
  const r = resolveRepForAccount(
    { lastTaggedRep: a.lastTaggedRep, lastTaggedDate: a.lastTaggedDate, lastOrderDate: a.lastOrderDate, zip: a.zip, state: a.state },
    territory);
  if (r.reassignedFrom) reassigned++;
  if (!r.rep) unassigned++;
  out[a.key] = { rep: name(r.rep), tagRep: name(a.lastTaggedRep), basis: r.basis, reassignedFrom: name(r.reassignedFrom) };
}
writeFileSync(process.argv[3] || "/tmp/territory_reps.json", JSON.stringify(out));
console.error(`resolved ${acc.size} locations | tagged orders ${tagged.length} | territory-reassigned ${reassigned} | unassigned ${unassigned}`);
