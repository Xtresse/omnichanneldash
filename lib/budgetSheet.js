/**
 * Google Sheets reader for the 3-tier Targets feature.
 *
 * Sheet: "Xtresse Net Revenue Budget & Rep Goals 2026"
 * URL:   https://docs.google.com/spreadsheets/d/1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8/edit
 * ID:    1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * TWO tabs, each carrying THREE target tiers (Budget / Base / Stretch) on BOTH
 * gross and net basis:
 *
 *   "Company Targets" — Channel | Product | Month |
 *                       Budget Gross | Budget Net | Base Gross | Base Net |
 *                       Stretch Gross | Stretch Net
 *   "Rep Targets"     — Territory | Rep | Product | Month | (same 6 value cols)
 *
 * Channels: B2B / DTC / ADCS.  Products: Gummies / Serum / XVIE / Sachets.
 * Months are ISO YYYY-MM strings.  Empty value cells mean "no target set".
 *
 * Returns a normalized cube:
 *   targets.company[channel][product][month] = { budget:{gross,net}, base:{...}, stretch:{...} }
 *   targets.rep[rep][product][month]         = { budget:{gross,net}, base:{...}, stretch:{...} }
 *
 * Legacy fields (`budget`, `repGoals`, `forecast`) are still returned, derived
 * from the cube, so existing consumers (rails get_budget, /ask) keep working:
 *   budget[product][month]        = Σ company Budget-tier NET across channels
 *   repGoals[rep][product][month] = Base-tier NET (the rep's headline goal)
 *
 * ───────────────────────────────────────────────────────────────
 * WIRING TO LIVE SHEET DATA — REQUIRED ENV VARS ON VERCEL
 * ───────────────────────────────────────────────────────────────
 * Until the env vars below are set, this returns stub data and the UI shows a
 * "wire env vars" banner. Flip to live with BUDGET_SHEET_ID plus ONE of:
 *
 *   A) Published-to-web CSV (simplest):
 *      In the Sheet: File → Share → Publish to web → pick a tab → CSV → Publish.
 *        BUDGET_CSV_URL_BUDGET = (published URL for "Company Targets")
 *        BUDGET_CSV_URL_GOALS  = (published URL for "Rep Targets")
 *
 *   B) Service account (read access via private key):
 *        GOOGLE_SHEETS_SA_EMAIL       = (sa@project.iam.gserviceaccount.com)
 *        GOOGLE_SHEETS_SA_PRIVATE_KEY = (PEM, with literal \n preserved)
 *      Share the Sheet with that email (Viewer) + enable the Sheets API.
 * ───────────────────────────────────────────────────────────────
 */

const SHEET_ID = process.env.BUDGET_SHEET_ID || "1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8";

export const BUDGET_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
export const TARGET_CHANNELS = ["B2B", "DTC", "ADCS"];
export const TARGET_TIERS = ["budget", "base", "stretch"];

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
  if (!v) return null;
  if (v.startsWith("B2B")) return "B2B";
  if (v.startsWith("DTC")) return "DTC";
  if (v.startsWith("ADCS")) return "ADCS";
  return null;
}

function canonMonth(s) {
  const v = String(s || "").trim();
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 7);
  return null;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Minimal RFC-4180 CSV parser → array of arrays. */
function parseCsv(text) {
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

async function fetchCsvTab(url) {
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
async function fetchViaServiceAccount(ranges) {
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

// Column finder — fuzzy header match (case/space/underscore-insensitive).
function makeFindCol(header) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[_\s]/g, "");
  return (...needles) => {
    for (const n of needles) {
      const ix = header.findIndex((h) => norm(h).includes(norm(n)));
      if (ix >= 0) return ix;
    }
    return -1;
  };
}

// Pull the 6 tier×basis columns out of a header row → index map.
function valueCols(header) {
  const find = makeFindCol(header);
  return {
    budget_gross: find("budgetgross", "budget gross"),
    budget_net: find("budgetnet", "budget net"),
    base_gross: find("basegross", "base gross"),
    base_net: find("basenet", "base net"),
    stretch_gross: find("stretchgross", "stretch gross"),
    stretch_net: find("stretchnet", "stretch net"),
  };
}

function emptyTier() {
  return {
    budget: { gross: 0, net: 0 },
    base: { gross: 0, net: 0 },
    stretch: { gross: 0, net: 0 },
  };
}

// Read the 6 value cells of a row into a {budget,base,stretch}×{gross,net} object.
function readTiers(row, vc) {
  const get = (ix) => (ix >= 0 ? num(row[ix]) : 0);
  return {
    budget: { gross: get(vc.budget_gross), net: get(vc.budget_net) },
    base: { gross: get(vc.base_gross), net: get(vc.base_net) },
    stretch: { gross: get(vc.stretch_gross), net: get(vc.stretch_net) },
  };
}

// Merge tier values into an existing cube node (sum — supports duplicate rows).
function addTiers(into, t) {
  for (const tier of TARGET_TIERS) {
    into[tier].gross += t[tier].gross;
    into[tier].net += t[tier].net;
  }
}

/**
 * Public entry point.
 */
export async function loadBudgetAndGoals() {
  const csvCompany = await fetchCsvTab(process.env.BUDGET_CSV_URL_BUDGET);
  const csvRep = await fetchCsvTab(process.env.BUDGET_CSV_URL_GOALS);
  if (csvCompany && csvRep) {
    return shapeFromRaw(csvCompany, csvRep, "live");
  }

  const saData = await fetchViaServiceAccount(["Company Targets!A:I", "Rep Targets!A:J"]);
  if (saData && Array.isArray(saData.valueRanges)) {
    const cRows = saData.valueRanges[0]?.values || [];
    const rRows = saData.valueRanges[1]?.values || [];
    if (cRows.length > 1 && rRows.length > 1) {
      return shapeFromRaw(cRows, rRows, "live");
    }
  }

  return {
    ...makeStubData(),
    reason:
      "Set BUDGET_CSV_URL_BUDGET + BUDGET_CSV_URL_GOALS (or GOOGLE_SHEETS_SA_* env vars) on Vercel to read the live sheet. See lib/budgetSheet.js for setup.",
  };
}

/**
 * Shape raw [header, ...rows] arrays into the normalized targets cube +
 * legacy { budget, repGoals, forecast } fields.
 */
function shapeFromRaw(companyRaw, repRaw, mode) {
  const company = {}; // channel → product → month → tiers
  const rep = {};     // rep → product → month → tiers
  const reps = new Set();

  // ── Company Targets ──────────────────────────────────────────────────────
  if (companyRaw.length > 1) {
    const h = companyRaw[0];
    const find = makeFindCol(h);
    const ci = find("channel");
    const pi = find("product");
    const mi = find("month");
    const vc = valueCols(h);
    for (let r = 1; r < companyRaw.length; r++) {
      const row = companyRaw[r];
      if (!row || row.length === 0) continue;
      const ch = canonChannel(row[ci]);
      const p = canonProduct(row[pi]);
      const m = canonMonth(row[mi]);
      if (!ch || !p || !m) continue;
      company[ch] = company[ch] || {};
      company[ch][p] = company[ch][p] || {};
      company[ch][p][m] = company[ch][p][m] || emptyTier();
      addTiers(company[ch][p][m], readTiers(row, vc));
    }
  }

  // ── Rep Targets ──────────────────────────────────────────────────────────
  if (repRaw.length > 1) {
    const h = repRaw[0];
    const find = makeFindCol(h);
    const ri = find("rep", "name");
    const pi = find("product");
    const mi = find("month");
    const vc = valueCols(h);
    for (let r = 1; r < repRaw.length; r++) {
      const row = repRaw[r];
      if (!row || row.length === 0) continue;
      const name = String(row[ri] || "").trim();
      const p = canonProduct(row[pi]);
      const m = canonMonth(row[mi]);
      if (!name || !p || !m) continue;
      reps.add(name);
      rep[name] = rep[name] || {};
      rep[name][p] = rep[name][p] || {};
      rep[name][p][m] = rep[name][p][m] || emptyTier();
      addTiers(rep[name][p][m], readTiers(row, vc));
    }
  }

  // ── Legacy projections (keep old consumers working) ──────────────────────
  // budget[product][month] = Σ company Budget-tier NET across channels.
  const budget = { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} };
  for (const ch of Object.keys(company)) {
    for (const p of Object.keys(company[ch])) {
      for (const m of Object.keys(company[ch][p])) {
        budget[p] = budget[p] || {};
        budget[p][m] = (budget[p][m] || 0) + (company[ch][p][m].budget.net || 0);
      }
    }
  }
  // repGoals[rep][product][month] = Base-tier NET.
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
    mode,
    targets: { company, rep },
    budget,
    forecast: { Gummies: {}, Serum: {}, XVIE: {}, Sachets: {} },
    repGoals,
    reps: [...reps].sort(),
  };
}

/** Stub — empty cube + legacy zeros. Flipping to live is value-only. */
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
