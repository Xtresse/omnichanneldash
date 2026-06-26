/**
 * Google Sheets reader for the 3-tier Targets feature — HORIZONTAL layout.
 *
 * Sheet: "Xtresse Net Revenue Budget & Rep Goals 2026"
 * ID:    1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * ONE tab per tier — "Budget", "Base Goal", "Stretch". Each tab has a NET block
 * and a GROSS block; rows are (Territory · Entity · Product) and the 12 months
 * run ACROSS as columns:
 *
 *   NET TARGETS ($)
 *   Territory | Entity        | Product | Jan | Feb | … | Dec
 *   Existing  | Becky Curry    | Gummies |     |     |   |
 *   …
 *   Company   | DTC            | Gummies |     |     |   |
 *   Company   | ADCS           | Serum   |     |     |   |
 *   GROSS TARGETS ($)
 *   Territory | Entity        | Product | Jan | … | Dec
 *   …
 *
 * Entities with Territory ≠ "Company" are B2B reps (and roll up to the B2B
 * channel). Territory "Company" rows are the DTC / ADCS channel targets.
 *
 * Returns a normalized cube:
 *   targets.company[channel][product][month] = { budget:{gross,net}, base:{…}, stretch:{…} }
 *   targets.rep[rep][product][month]         = { budget:{gross,net}, base:{…}, stretch:{…} }
 * (month keys are ISO YYYY-MM; year is 2026 for the named-month columns.)
 *
 * Legacy fields (budget, repGoals, forecast) are still returned for the
 * rails/ask consumers.
 *
 * WIRING (env): published-to-web CSV per tier tab, or the service account.
 *   BUDGET_CSV_URL_BUDGET   → "Budget" tab
 *   BUDGET_CSV_URL_BASE     → "Base Goal" tab
 *   BUDGET_CSV_URL_STRETCH  → "Stretch" tab
 * SA path reads ranges "Budget!A:Z", "Base Goal!A:Z", "Stretch!A:Z".
 */

const SHEET_ID = process.env.BUDGET_SHEET_ID || "1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8";

export const BUDGET_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
export const TARGET_CHANNELS = ["B2B", "DTC", "ADCS"];
export const TARGET_TIERS = ["budget", "base", "stretch"];

const TIER_TABS = [
  { tier: "budget", tab: "Budget", env: "BUDGET_CSV_URL_BUDGET" },
  { tier: "base", tab: "Base Goal", env: "BUDGET_CSV_URL_BASE" },
  { tier: "stretch", tab: "Stretch", env: "BUDGET_CSV_URL_STRETCH" },
];

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

/**
 * Parse one tier tab's rows (NET + GROSS blocks, months across) into the cube.
 * Mutates `company` and `rep`.
 */
function parseTierTab(rows, tier, company, rep, reps) {
  let basis = null;          // "net" | "gross"
  let monthCols = null;      // [{ix, month}]
  let entIx = -1, prodIx = -1, terrIx = -1;

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const a0 = norm(row[0]);

    // Section labels set the basis.
    if (a0.includes("nettargets") || a0 === "net") { basis = "net"; monthCols = null; continue; }
    if (a0.includes("grosstargets") || a0 === "gross") { basis = "gross"; monthCols = null; continue; }

    // Header row: locate Territory/Entity/Product + month columns.
    if (a0 === "territory" || a0 === "entity" || a0 === "rep") {
      terrIx = row.findIndex((c) => norm(c) === "territory");
      entIx = row.findIndex((c) => ["entity", "rep", "repname", "channel"].includes(norm(c)));
      prodIx = row.findIndex((c) => norm(c).includes("product"));
      monthCols = [];
      for (let i = 0; i < row.length; i++) {
        const m = headerToMonth(row[i]);
        if (m) monthCols.push({ ix: i, month: m });
      }
      continue;
    }

    // Data row (needs an active basis + a parsed header).
    if (!basis || !monthCols || entIx < 0 || prodIx < 0) continue;
    const entity = String(row[entIx] || "").trim();
    const product = canonProduct(row[prodIx]);
    if (!entity || !product) continue;
    const territory = terrIx >= 0 ? String(row[terrIx] || "").trim() : "";
    const isChannel = norm(territory) === "company" || ["dtc", "adcs"].includes(norm(entity));

    for (const { ix, month } of monthCols) {
      const v = num(row[ix]);
      if (!v) continue;
      if (isChannel) {
        const ch = canonChannel(entity);
        if (!ch || ch === "B2B") continue; // B2B is derived from reps, not entered directly
        company[ch] = company[ch] || {};
        company[ch][product] = company[ch][product] || {};
        company[ch][product][month] = company[ch][product][month] || emptyTier();
        company[ch][product][month][tier][basis] += v;
      } else {
        // B2B rep — record per-rep AND roll up to company B2B.
        reps.add(entity);
        rep[entity] = rep[entity] || {};
        rep[entity][product] = rep[entity][product] || {};
        rep[entity][product][month] = rep[entity][product][month] || emptyTier();
        rep[entity][product][month][tier][basis] += v;
        company.B2B = company.B2B || {};
        company.B2B[product] = company.B2B[product] || {};
        company.B2B[product][month] = company.B2B[product][month] || emptyTier();
        company.B2B[product][month][tier][basis] += v;
      }
    }
  }
}

export async function loadBudgetAndGoals() {
  // Fetch the three tier tabs (CSV first, then service account).
  const csv = {};
  for (const t of TIER_TABS) csv[t.tier] = await fetchCsvTab(process.env[t.env]);
  let raws = null;
  if (TIER_TABS.some((t) => csv[t.tier])) {
    raws = TIER_TABS.map((t) => csv[t.tier] || []);
  } else {
    const sa = await fetchViaServiceAccount(TIER_TABS.map((t) => `${t.tab}!A:Z`));
    if (sa && Array.isArray(sa.valueRanges)) {
      const vr = sa.valueRanges;
      if (vr.some((x) => (x?.values || []).length > 2)) {
        raws = TIER_TABS.map((_, i) => vr[i]?.values || []);
      }
    }
  }

  if (!raws) {
    return {
      ...makeStubData(),
      reason:
        "Set BUDGET_CSV_URL_BUDGET/BASE/STRETCH (or GOOGLE_SHEETS_SA_* env vars) on Vercel to read the live sheet. See lib/budgetSheet.js.",
    };
  }

  const company = {};
  const rep = {};
  const reps = new Set();
  TIER_TABS.forEach((t, i) => parseTierTab(raws[i], t.tier, company, rep, reps));

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
