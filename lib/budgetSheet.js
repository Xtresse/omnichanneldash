/**
 * Google Sheets reader for the 3-tier Targets feature — LONG layout, TWO tabs.
 *
 * Sheet: "Xtresse Net Revenue Budget & Rep Goals 2026"
 * ID:    1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * "Rep Targets" — B2B rep-level goals only, one row per (Territory · Rep ·
 * Product · Month), tiers × bases as columns:
 *
 *   Territory | Rep            | Product | Month   | Budget Gross | Budget Net | Base Gross | Base Net | Stretch Gross | Stretch Net
 *   Existing  | Jamie Bergeron | Gummies | 2026-07 |       128012 |     117771 |     118330 |   108863 |               |
 *   …
 *
 * Rolled up into targets.company.B2B by summing across reps for a given
 * (product, month, tier, basis).
 *
 * "Company Targets" — channel-level goals (B2B/DTC/ADCS), one row per
 * (Channel · Product · Month), same tier/basis columns:
 *
 *   Channel | Product | Month   | Budget Gross | Budget Net | Base Gross | Base Net | Stretch Gross | Stretch Net
 *   DTC     | Gummies | 2026-07 |        127604|     117396 |     244565 |   225000 |               |
 *   ADCS    | Gummies | 2026-07 |        135346|     124518 |     134783 |   124000 |               |
 *
 * Used for DTC and ADCS (no rep-level breakdown makes sense for those). Its
 * B2B rows exist too (legacy top-down entries, e.g. the June 2026 deck
 * figures) but are NOT read here — B2B always comes from the Rep Targets
 * rollup so per-rep detail stays authoritative and the two can't disagree.
 *
 * Returns a normalized cube:
 *   targets.company[channel][product][month] = { budget:{gross,net}, base:{…}, stretch:{…} }
 *   targets.rep[rep][product][month]         = { budget:{gross,net}, base:{…}, stretch:{…} }
 * (month keys are ISO YYYY-MM, taken directly from the sheet's Month column.)
 *
 * Legacy fields (budget, repGoals, forecast) are still returned for the
 * rails/ask consumers.
 *
 * WIRING (env): published-to-web CSV per tab, or the service account.
 *   BUDGET_CSV_URL_REP_TARGETS     → "Rep Targets" tab
 *   BUDGET_CSV_URL_COMPANY_TARGETS → "Company Targets" tab
 * SA path reads ranges "Rep Targets!A:J" and "Company Targets!A:I".
 *
 * NOTE: this sheet also has a "Budget" tab (Territory/Entity/Product, months
 * across as columns, NET TARGETS only) left over from an earlier design —
 * it is NOT read by this file. "Rep Targets" + "Company Targets" are the
 * live source of truth.
 */

const SHEET_ID = process.env.BUDGET_SHEET_ID || "1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8";

export const BUDGET_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
export const TARGET_CHANNELS = ["B2B", "DTC", "ADCS"];
export const TARGET_TIERS = ["budget", "base", "stretch"];

const REP_TARGETS_TAB = "Rep Targets";
const REP_TARGETS_ENV = "BUDGET_CSV_URL_REP_TARGETS";
const COMPANY_TARGETS_TAB = "Company Targets";
const COMPANY_TARGETS_ENV = "BUDGET_CSV_URL_COMPANY_TARGETS";

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

/** Locate the Territory/Rep-or-Channel/Product/Month + tier-basis columns shared by both tabs. */
function findCols(header) {
  return {
    terrIx: header.indexOf("territory"), // "Rep Targets" only
    chanIx: header.indexOf("channel"), // "Company Targets" only
    entIx: header.findIndex((c) => ["rep", "entity", "repname", "channel"].includes(c)),
    prodIx: header.indexOf("product"),
    monthIx: header.indexOf("month"),
    colIx: TIER_BASIS_COLS.map((c) => header.indexOf(c.label)),
  };
}

function rowMonth(row, monthIx) {
  const raw = String(row[monthIx] || "");
  return headerToMonth(raw) || (/^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : null);
}

/**
 * Parse the "Rep Targets" tab's rows — one row per (Territory, Rep, Product,
 * Month), tiers × bases as columns on that row. Mutates `company.B2B` and `rep`.
 */
function parseRepTargetsTab(rows, company, rep, reps) {
  if (!rows || rows.length < 2) return;
  const { entIx, prodIx, monthIx, colIx } = findCols(rows[0].map(norm));
  if (entIx < 0 || prodIx < 0 || monthIx < 0) return;

  for (const row of rows.slice(1)) {
    if (!row || row.length === 0) continue;
    const entity = String(row[entIx] || "").trim();
    const product = canonProduct(row[prodIx]);
    const month = rowMonth(row, monthIx);
    if (!entity || !product || !month) continue;

    reps.add(entity);
    rep[entity] = rep[entity] || {};
    rep[entity][product] = rep[entity][product] || {};
    const cell = rep[entity][product][month] = rep[entity][product][month] || emptyTier();

    company.B2B = company.B2B || {};
    company.B2B[product] = company.B2B[product] || {};
    const coCell = company.B2B[product][month] = company.B2B[product][month] || emptyTier();

    TIER_BASIS_COLS.forEach(({ tier, basis }, i) => {
      const ix = colIx[i];
      if (ix < 0) return;
      const v = num(row[ix]);
      if (!v) return;
      cell[tier][basis] += v; // per-rep (one row per rep×product×month, so += is a plain set)
      coCell[tier][basis] += v; // company rollup — sums across reps
    });
  }
}

/**
 * Parse the "Company Targets" tab's rows — one row per (Channel, Product,
 * Month). Only DTC/ADCS are used; B2B rows here are ignored (see file header).
 * Mutates `company`.
 */
function parseCompanyTargetsTab(rows, company) {
  if (!rows || rows.length < 2) return;
  const { entIx, prodIx, monthIx, colIx } = findCols(rows[0].map(norm));
  if (entIx < 0 || prodIx < 0 || monthIx < 0) return;

  for (const row of rows.slice(1)) {
    if (!row || row.length === 0) continue;
    const ch = canonChannel(row[entIx]);
    const product = canonProduct(row[prodIx]);
    const month = rowMonth(row, monthIx);
    if (!ch || ch === "B2B" || !product || !month) continue;

    company[ch] = company[ch] || {};
    company[ch][product] = company[ch][product] || {};
    const coCell = company[ch][product][month] = company[ch][product][month] || emptyTier();

    TIER_BASIS_COLS.forEach(({ tier, basis }, i) => {
      const ix = colIx[i];
      if (ix < 0) return;
      const v = num(row[ix]);
      if (v) coCell[tier][basis] += v;
    });
  }
}

export async function loadBudgetAndGoals() {
  // Fetch both tabs (CSV first, then service account).
  let repRows = await fetchCsvTab(process.env[REP_TARGETS_ENV]);
  let coRows = await fetchCsvTab(process.env[COMPANY_TARGETS_ENV]);
  if (!repRows || !coRows) {
    const sa = await fetchViaServiceAccount([`${REP_TARGETS_TAB}!A:J`, `${COMPANY_TARGETS_TAB}!A:I`]);
    const vr = sa?.valueRanges;
    if (!repRows && (vr?.[0]?.values?.length > 1)) repRows = vr[0].values;
    if (!coRows && (vr?.[1]?.values?.length > 1)) coRows = vr[1].values;
  }

  if (!repRows && !coRows) {
    return {
      ...makeStubData(),
      reason:
        `Set ${REP_TARGETS_ENV} and ${COMPANY_TARGETS_ENV} (or GOOGLE_SHEETS_SA_* env vars) on Vercel to read the live sheet. See lib/budgetSheet.js.`,
    };
  }

  const company = {};
  const rep = {};
  const reps = new Set();
  parseRepTargetsTab(repRows, company, rep, reps);
  parseCompanyTargetsTab(coRows, company);

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
