/**
 * Google Sheets reader for the Budget vs Goal vs Actual feature.
 *
 * Sheet: "Xtresse Net Revenue Budget & Rep Goals 2026"
 * URL:   https://docs.google.com/spreadsheets/d/1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8/edit
 * ID:    1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * Two tabs:
 *   - "Company Budget" — columns: product_family | month | budget_net_revenue_usd
 *   - "Rep Goals"      — columns: rep_name | product_family | month | goal_net_revenue_usd
 *
 * Months are stored as ISO YYYY-MM strings. Product families are
 * "Gummies", "Serum", "XVIE", "Sachet".
 *
 * ───────────────────────────────────────────────────────────────
 * WIRING TO LIVE SHEET DATA — REQUIRED ENV VARS ON VERCEL
 * ───────────────────────────────────────────────────────────────
 *
 * Until the env vars below are set, this file returns null and the
 * /api/budget route falls back to stub data so the section still
 * renders (with placeholder zeros + a "Wire SHEETS env vars to go
 * live" banner). Flip to live by setting:
 *
 *   BUDGET_SHEET_ID
 *     = 1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8
 *
 * Then choose ONE of two auth paths:
 *
 *   A) Published-to-web CSV (simplest, no auth):
 *      • In the Sheet: File → Share → Publish to web → Comma-separated
 *        values (.csv) → Publish, once per tab.
 *      • Set:
 *          BUDGET_CSV_URL_BUDGET = (the published URL for "Company Budget")
 *          BUDGET_CSV_URL_GOALS  = (the published URL for "Rep Goals")
 *      • Anyone with the URLs can read them, but they only contain the
 *        budget numbers — no sensitive data.
 *
 *   B) Service-account JSON (read access via private key):
 *      • Create a service account in Google Cloud Console.
 *      • Enable the Google Sheets API for that project.
 *      • Share the Sheet with the service account's email (Viewer).
 *      • Set:
 *          GOOGLE_SHEETS_SA_EMAIL       = (sa@project.iam.gserviceaccount.com)
 *          GOOGLE_SHEETS_SA_PRIVATE_KEY = (PEM, with literal \n preserved)
 *      • This file will JWT-sign + exchange for an access token + call
 *        the Sheets v4 values.batchGet endpoint.
 *
 * Option A is the recommended path for a "share with execs" sheet.
 * Option B is the production path if the sheet ever holds confidential
 * numbers or you don't want it public.
 * ───────────────────────────────────────────────────────────────
 */

const SHEET_ID = process.env.BUDGET_SHEET_ID || "1_GRiHlLup8Ls7bFcagYD7MlPYLciakNz5qAK0JmFaP8";

// Product families (canonical labels — used as keys throughout).
export const BUDGET_PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachet"];

// Canonicalize various spellings/cases from the sheet to the keys above.
function canonProduct(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("gumm")) return "Gummies";
  if (v.startsWith("serum")) return "Serum";
  if (v.startsWith("xvie")) return "XVIE";
  if (v.startsWith("sach")) return "Sachet";
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

/**
 * Minimal CSV parser. Handles quoted fields with embedded commas and
 * doubled quotes (RFC 4180). Returns an array of arrays.
 */
function parseCsv(text) {
  const rows = [];
  let cur = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ""; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === '\r') { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

/**
 * Fetch a CSV-published Google Sheet tab. Returns array of rows
 * (header + data). null on any error.
 */
async function fetchCsvTab(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const text = await res.text();
    return parseCsv(text);
  } catch (e) {
    console.warn("[budgetSheet] CSV fetch failed:", e?.message || e);
    return null;
  }
}

/**
 * Service-account JWT auth path. Mints an access token good for ~1h
 * and uses it to call Sheets v4 values.batchGet.
 *
 * Returns { values: { [range]: [[...rows]] } } or null on any failure.
 */
async function fetchViaServiceAccount(ranges) {
  const email = process.env.GOOGLE_SHEETS_SA_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_SA_PRIVATE_KEY;
  if (!email || !rawKey) return null;

  const privateKey = rawKey.replace(/\\n/g, "\n");

  try {
    const crypto = await import("node:crypto");
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };
    const b64url = (obj) =>
      Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const signingInput = `${b64url(header)}.${b64url(claims)}`;
    const sig = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(privateKey)
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
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

/**
 * Public entry point. Returns:
 *   {
 *     mode: "live" | "stub",
 *     reason?: string,           // why stub was returned
 *     budget: { [product]: { [month]: $ } },
 *     repGoals: { [rep]: { [product]: { [month]: $ } } },
 *     reps: string[],            // unique rep names seen on Rep Goals tab
 *   }
 */
export async function loadBudgetAndGoals() {
  const stub = makeStubData();

  const csvBudget = await fetchCsvTab(process.env.BUDGET_CSV_URL_BUDGET);
  const csvGoals = await fetchCsvTab(process.env.BUDGET_CSV_URL_GOALS);

  if (csvBudget && csvGoals) {
    return shapeFromRaw(csvBudget, csvGoals, "live");
  }

  const saData = await fetchViaServiceAccount(["Company Budget!A:C", "Rep Goals!A:D"]);
  if (saData && Array.isArray(saData.valueRanges)) {
    const bRows = saData.valueRanges[0]?.values || [];
    const gRows = saData.valueRanges[1]?.values || [];
    if (bRows.length > 1 && gRows.length > 1) {
      return shapeFromRaw(bRows, gRows, "live");
    }
  }

  return {
    ...stub,
    mode: "stub",
    reason:
      "Set BUDGET_CSV_URL_BUDGET + BUDGET_CSV_URL_GOALS (or GOOGLE_SHEETS_SA_* env vars) on Vercel to read the live sheet. See lib/budgetSheet.js for setup.",
  };
}

/**
 * Shape raw [header, ...rows] arrays from either CSV or Sheets API
 * into the normalized { budget, repGoals, reps } structure.
 *
 * Expects:
 *   budgetRaw header: product_family, month, budget_net_revenue_usd
 *   goalsRaw  header: rep_name, product_family, month, goal_net_revenue_usd
 *
 * Header-name matching is fuzzy (case-insensitive, ignores underscores
 * and spaces) so the sheet can be rearranged or have friendlier labels
 * without breaking the parser.
 */
function shapeFromRaw(budgetRaw, goalsRaw, mode) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[_\s]/g, "");
  const findCol = (header, ...needles) => {
    for (const n of needles) {
      const ix = header.findIndex((h) => norm(h).includes(norm(n)));
      if (ix >= 0) return ix;
    }
    return -1;
  };

  const budget = { Gummies: {}, Serum: {}, XVIE: {}, Sachet: {} };
  if (budgetRaw.length > 1) {
    const h = budgetRaw[0];
    const pi = findCol(h, "product");
    const mi = findCol(h, "month");
    const ai = findCol(h, "budget", "amount", "revenue", "usd");
    for (let r = 1; r < budgetRaw.length; r++) {
      const row = budgetRaw[r];
      if (!row || row.length === 0) continue;
      const p = canonProduct(row[pi]);
      const m = canonMonth(row[mi]);
      const v = num(row[ai]);
      if (p && m) budget[p][m] = (budget[p][m] || 0) + v;
    }
  }

  const repGoals = {};
  const reps = new Set();
  if (goalsRaw.length > 1) {
    const h = goalsRaw[0];
    const ri = findCol(h, "rep");
    const pi = findCol(h, "product");
    const mi = findCol(h, "month");
    const ai = findCol(h, "goal", "amount", "revenue", "usd");
    for (let r = 1; r < goalsRaw.length; r++) {
      const row = goalsRaw[r];
      if (!row || row.length === 0) continue;
      const rep = String(row[ri] || "").trim();
      const p = canonProduct(row[pi]);
      const m = canonMonth(row[mi]);
      const v = num(row[ai]);
      if (!rep || !p || !m) continue;
      reps.add(rep);
      repGoals[rep] = repGoals[rep] || { Gummies: {}, Serum: {}, XVIE: {}, Sachet: {} };
      repGoals[rep][p][m] = (repGoals[rep][p][m] || 0) + v;
    }
  }

  return { mode, budget, repGoals, reps: [...reps].sort() };
}

/**
 * Stub data — all zeros for every (product, month, rep) cell. Sheet
 * tabs in their initial state will look exactly like this, so flipping
 * to live data is just a value-replacement, not a shape change.
 */
function makeStubData() {
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2026-${String(m).padStart(2, "0")}`);
  const budget = { Gummies: {}, Serum: {}, XVIE: {}, Sachet: {} };
  for (const p of BUDGET_PRODUCTS) for (const m of months) budget[p][m] = 0;
  return { mode: "stub", budget, repGoals: {}, reps: [] };
}
