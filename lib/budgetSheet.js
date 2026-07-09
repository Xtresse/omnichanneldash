/**
 * Google Sheets reader for the 3-tier Targets feature — LONG layout.
 *
 * Sheet: "Xtresse Net Revenue Budget & Rep Goals 2026"
 * ID:    1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * ONE tab, "Rep Targets" — one row per (Territory · Rep · Product · Month),
 * with all three tiers × both bases as columns on that same row:
 *
 *   Territory | Rep         | Product | Month   | Budget Gross | Budget Net | Base Gross | Base Net | Stretch Gross | Stretch Net
 *   Existing  | Jamie Bergeron | Gummies | 2026-07 |            |    101,359 |            |          |               |
 *   Company   | DTC            | Gummies | 2026-07 |    122,283 |    117,391 |            |          |               |
 *   Company   | ADCS           | Gummies | 2026-07 |    135,346 |    124,518 |            |          |               |
 *   …
 *
 * Rows where Territory = "Company" and Rep = "DTC"/"ADCS" are channel-level
 * targets. Every other row is a B2B rep target — rolled up into the B2B
 * channel by summing across reps for a given (product, month, tier, basis).
 * (NB: this replaced an earlier horizontal-per-tier-tab design that this file
 * used to implement — see git history if that layout ever comes back.)
 *
 * Returns a normalized cube:
 *   targets.company[channel][product][month] = { budget:{gross,net}, base:{…}, stretch:{…} }
 *   targets.rep[rep][product][month]         = { budget:{gross,net}, base:{…}, stretch:{…} }
 * (month keys are ISO YYYY-MM, taken directly from the sheet's Month column.)
 *
 * Legacy fields (budget, repGoals, forecast) are still returned for the
 * rails/ask consumers.
 *
 * WIRING (env): published-to-web CSV of the "Rep Targets" tab, or the service account.
 *   BUDGET_CSV_URL_REP_TARGETS → "Rep Targets" tab
 * SA path reads range "Rep Targets!A:J".
 */

const SHEET_ID = process.env.BUDGET_SHEET_ID || "1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8";

export const BUDGET_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
export const TARGET_CHANNELS = ["B2B", "DTC", "ADCS"];
export const TARGET_TIERS = ["budget", "base", "stretch"];

const REP_TARGETS_TAB = "Rep Targets";
const REP_TARGETS_ENV = "BUDGET_CSV_URL_REP_TARGETS";

const MONTH_NUM = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const YEAR = "2026"; // named-month columns are the 2026 plan year.

function canonProduct(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("gumm")) return "Gummies";
  if (v.startsWith("serum")) return "Serum";
  if (v.startsWith("xvie")) return "XVIE";
  if (v.startsWith("sach")) return "Sachets";
  return null;
}
function canonChannel(s) {
  const v = String(s || "").trim().toUpperCase();
  if (v.startsWith("DTC")) return "DTC";
  if (v.startsWith("ADCS")) return "ADCS";
  if (v.startsWith("B2B")) return "B2B";
  return null;
}
function num(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
// Header cell → ISO month. Accepts "Jan", "January", "2026-01", "2026-01-01".
function headerToMonth(s) {
  const v = String(s || "").trim();
  if (/^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
  const mm = MONTH_NUM[v.slice(0, 3).toLowerCase()];
  return mm ? `${YEAR}-${mm}` : null;
}

/** Minimal RFC-4180 CSV parser → array of arrays. */
export function parseCsv(text) {
  const rows = [];
  let cur = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ""; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

export async function fetchCsvTab(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    return parseCsv(await res.text());
  } catch (e) {
    console.warn("[budgetSheet] CSV fetch failed:", e?.message || e);
    return null;
  }
}

/** Service-account JWT path → Sheets v4 values.batchGet. null on any failure. */
export async function fetchViaServiceAccount(ranges) {
  const email = process.env.GOOGLE_SHEETS_SA_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_SA_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  const privateKey = rawKey.replace(/\\n/g, "\n");
  try {
    const crypto = await import("node:crypto");
    const now = Math.floor(Date.now() / 1000);
    const b64url = (obj) =>
      Buffer.from(JSON.stringify(obj)).toString("base64")
        .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600, iat: now,
    };
    const signingInput = `${b64url(header)}.${b64url(claims)}`;
    const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey)
      .toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = `${signingInput}.${sig}`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!tokenRes.ok) {
      console.warn("[budgetSheet] token exchange failed:", await tokenRes.text());
      return null;
    }
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
      ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const sheetRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      next: { revalidate: 600 },
    });
    if (!sheetRes.ok) {
      console.warn("[budgetSheet] sheets fetch failed:", await sheetRes.text());
      return null;
    }
    return await sheetRes.json();
  } catch (e) {
    console.warn("[budgetSheet] SA path error:", e?.message || e);
    return null;
  }
}

function emptyTier() {
  return {
    budget: { gross: 0, net: 0 },
    base: { gross: 0, net: 0 },
    stretch: { gross: 0, net: 0 },
  };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[_\s]/g, "");

// One column per (tier, basis) cell on a data row, in sheet-header order.
const TIER_BASIS_COLS = [
  { tier: "budget", basis: "gross", label: "budgetgross" },
  { tier: "budget", basis: "net", label: "budgetnet" },
  { tier: "base", basis: "gross", label: "basegross" },
  { tier: "base", basis: "net", label: "basenet" },
  { tier: "stretch", basis: "gross", label: "stretchgross" },
  { tier: "stretch", basis: "net", label: "stretchnet" },
];

/**
 * Parse the "Rep Targets" tab's rows — one row per (Territory, Rep, Product,
 * Month), tiers × bases as columns on that row. Mutates `company` and `rep`.
 */
function parseRepTargetsTab(rows, company, rep, reps) {
  if (!rows || rows.length < 2) return;
  const header = rows[0].map(norm);
  const terrIx = header.indexOf("territory");
  const entIx = header.findIndex((c) => ["rep", "entity", "repname"].includes(c));
  const prodIx = header.indexOf("product");
  const monthIx = header.indexOf("month");
  const colIx = TIER_BASIS_COLS.map((c) => header.indexOf(c.label));
  if (entIx < 0 || prodIx < 0 || monthIx < 0) return;

  for (const row of rows.slice(1)) {
    if (!row || row.length === 0) continue;
    const entity = String(row[entIx] || "").trim();
    const product = canonProduct(row[prodIx]);
    const month = headerToMonth(row[monthIx]) || (/^\d{4}-\d{2}/.test(String(row[monthIx] || "")) ? String(row[monthIx]).slice(0, 7) : null);
    if (!entity || !product || !month) continue;

    const territory = terrIx >= 0 ? String(row[terrIx] || "").trim() : "";
    const isChannel = norm(territory) === "company" || ["dtc", "adcs"].includes(norm(entity));

    const cell = isChannel ? null : (() => {
      reps.add(entity);
      rep[entity] = rep[entity] || {};
      rep[entity][product] = rep[entity][product] || {};
      rep[entity][product][month] = rep[entity][product][month] || emptyTier();
      return rep[entity][product][month];
    })();

    let coCell = null;
    if (isChannel) {
      const ch = canonChannel(entity);
      if (!ch || ch === "B2B") continue; // B2B is derived from reps, not entered directly
      company[ch] = company[ch] || {};
      company[ch][product] = company[ch][product] || {};
      company[ch][product][month] = company[ch][product][month] || emptyTier();
      coCell = company[ch][product][month];
    } else {
      company.B2B = company.B2B || {};
      company.B2B[product] = company.B2B[product] || {};
      company.B2B[product][month] = company.B2B[product][month] || emptyTier();
      coCell = company.B2B[product][month];
    }

    TIER_BASIS_COLS.forEach(({ tier, basis }, i) => {
      const ix = colIx[i];
      if (ix < 0) return;
      const v = num(row[ix]);
      if (!v) return;
      if (cell) cell[tier][basis] += v; // per-rep (direct set is fine, one row per rep×product×month)
      coCell[tier][basis] += v; // company rollup (sums across reps for B2B)
    });
  }
}

export async function loadBudgetAndGoals() {
  // Fetch the single "Rep Targets" tab (CSV first, then service account).
  let rows = await fetchCsvTab(process.env[REP_TARGETS_ENV]);
  if (!rows) {
    const sa = await fetchViaServiceAccount([`${REP_TARGETS_TAB}!A:J`]);
    const vr = sa?.valueRanges?.[0]?.values;
    if (Array.isArray(vr) && vr.length > 1) rows = vr;
  }

  if (!rows) {
    return {
      ...makeStubData(),
      reason:
        `Set ${REP_TARGETS_ENV} (or GOOGLE_SHEETS_SA_* env vars) on Vercel to read the live sheet. See lib/budgetSheet.js.`,
    };
  }

  const company = {};
  const rep = {};
  const reps = new Set();
  parseRepTargetsTab(rows, company, rep, reps);

  // Legacy projections for rails/ask.
  const budget = { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} };
  for (const ch of Object.keys(company)) {
    for (const p of Object.keys(company[ch])) {
      for (const m of Object.keys(company[ch][p])) {
        budget[p] = budget[p] || {};
        budget[p][m] = (budget[p][m] || 0) + (company[ch][p][m].budget.net || 0);
      }
    }
  }
  const repGoals = {};
  for (const name of Object.keys(rep)) {
    repGoals[name] = { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} };
    for (const p of Object.keys(rep[name])) {
      for (const m of Object.keys(rep[name][p])) {
        repGoals[name][p][m] = rep[name][p][m].base.net || 0;
      }
    }
  }

  return {
    mode: "live",
    targets: { company, rep },
    budget,
    forecast: { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} },
    repGoals,
    reps: [...reps].sort(),
  };
}

function makeStubData() {
  return {
    mode: "stub",
    targets: { company: {}, rep: {} },
    budget: { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} },
    forecast: { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} },
    repGoals: {},
    reps: [],
  };
}

/**
 * Company target $ for (channel, product, month, tier, basis). 0 when unset.
 * channel "All" sums B2B + DTC + ADCS.
 */
export function companyTargetFor(targets, channel, product, month, tier, basis) {
  const co = targets?.company;
  if (!co) return 0;
  const pick = (ch) => Number(co?.[ch]?.[product]?.[month]?.[tier]?.[basis] || 0);
  if (channel === "All") return pick("B2B") + pick("DTC") + pick("ADCS");
  return pick(channel);
}
