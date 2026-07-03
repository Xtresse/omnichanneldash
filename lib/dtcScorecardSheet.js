/**
 * Google Sheets reader for the DTC Growth Scorecard — Jose/Sam's weekly
 * DTC KPI sheet.
 *
 * Sheet ID: 1vd8Ft3_JmJ678y_TS1MC208XtK-avcVI91qb3DgAoGE (gid 1725783587)
 *
 * Layout (rows down, weeks across):
 *   Section        | Metric  | Source | Owner | Target | W1 May 11-17 | Wk 2 … |
 *   Core KPIs      | Revenue | Shopify| Sam/… | <$15k  | $36,204      | …      |
 *                  | CAC     | Calc…  | …     | < $45  | …            | …      |
 *   CPA by Channel | Meta CPA| Orca   | …     | < $90  | …            | …      |
 *
 * Section labels only appear on the first row of each block (carried forward).
 * The target column header is a #REF! artifact in the sheet — we address
 * columns by the Metric/Source/Owner headers instead. Trailing unnamed
 * columns (scratch $ values) are ignored because their header cells are empty.
 *
 * Returned shape (server-only; the /api/dtc-scorecard route ships it as JSON):
 *   {
 *     mode: "live" | "stub",
 *     weeks: ["W1 May 11–17", …],            // trailing all-empty weeks trimmed
 *     sections: [{ name, metrics: [{
 *       name, source, owner,
 *       target: { raw, cmp, value, inferred } | null,
 *       lowerIsBetter,                        // for WoW delta coloring
 *       values: [{ raw, n } | null, …],       // one per week; n=null when non-numeric
 *     }]}],
 *   }
 *
 * WIRING (env, all optional — the sheet is link-readable so the default
 * export URL works unauthenticated):
 *   DTC_SCORECARD_CSV_URL   → full CSV url override (published-to-web link)
 *   DTC_SCORECARD_SHEET_ID  → sheet id override
 *   DTC_SCORECARD_GID       → tab gid override
 */

import { fetchCsvTab } from "./budgetSheet";

const SHEET_ID =
  process.env.DTC_SCORECARD_SHEET_ID || "1vd8Ft3_JmJ678y_TS1MC208XtK-avcVI91qb3DgAoGE";
const GID = process.env.DTC_SCORECARD_GID || "1725783587";

export const SCORECARD_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${GID}`;

function csvUrl() {
  return (
    process.env.DTC_SCORECARD_CSV_URL ||
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
  );
}

// Cells that mean "no data" — sheet errors, dashes, blanks.
const EMPTY_CELL = new Set(["", "-", "–", "—", "#REF!", "#DIV/0!", "#N/A", "#VALUE!", "#NAME?"]);

const clean = (v) => String(v ?? "").trim();

/** "$36,204" → 36204 · "8.10%" → 8.1 · "96 hrs" → 96 · "-"/"#REF!" → null */
export function cellNum(v) {
  const s = clean(v);
  if (EMPTY_CELL.has(s)) return null;
  const m = s.replace(/[$,]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Metrics where a falling line is the good direction (used when the target
// has no explicit comparator, and for WoW delta coloring).
const LOWER_IS_BETTER =
  /\b(cac|cpa|churn\w*|churned|bounce|refund\w*|complaint\w*|response time|media spend|ae)\b/i;

/** "< $45" → {cmp:"<",value:45} · ">98%" → {cmp:">",value:98} · "45%" → inferred cmp */
function parseTarget(raw, lowerIsBetter) {
  const s = clean(raw);
  if (EMPTY_CELL.has(s)) return null;
  const value = cellNum(s);
  if (value == null) return { raw: s, cmp: null, value: null, inferred: false };
  const m = s.match(/^([<>])/);
  return {
    raw: s,
    cmp: m ? m[1] : lowerIsBetter ? "<" : ">",
    value,
    inferred: !m,
  };
}

/** Parse the raw CSV rows into the scorecard shape above. */
export function parseScorecard(rows) {
  // Header row = the one that names the Metric column.
  const headIx = rows.findIndex((r) => r.some((c) => clean(c).toLowerCase() === "metric"));
  if (headIx < 0) return null;
  const head = rows[headIx];
  const metricIx = head.findIndex((c) => clean(c).toLowerCase() === "metric");
  const sourceIx = head.findIndex((c) => clean(c).toLowerCase() === "source");
  const ownerIx = head.findIndex((c) => clean(c).toLowerCase() === "owner");
  if (metricIx < 0 || ownerIx < 0) return null;

  // Weeks: named header cells after the target column (ownerIx+1). The target
  // header itself is a #REF! artifact; unnamed trailing columns are scratch.
  const weekCols = [];
  for (let i = ownerIx + 2; i < head.length; i++) {
    const label = clean(head[i]).replace(/\s+/g, " ");
    if (label) weekCols.push({ ix: i, label });
  }
  const targetIx = ownerIx + 1;

  const sections = [];
  let cur = null;
  for (const row of rows.slice(headIx + 1)) {
    const sectionCell = clean(row[0]);
    const metric = clean(row[metricIx]);
    if (sectionCell) {
      cur = { name: sectionCell, metrics: [] };
      sections.push(cur);
    }
    if (!metric || !cur) continue;

    // Direction: an explicit </> on the sheet's target wins (e.g. "LTV / CAC
    // > 5" is higher-better even though the name contains "CAC"); the keyword
    // list only decides for metrics without a comparator.
    const keywordLower = LOWER_IS_BETTER.test(metric);
    const target = parseTarget(row[targetIx], keywordLower);
    const lowerIsBetter =
      target && target.cmp && !target.inferred ? target.cmp === "<" : keywordLower;
    cur.metrics.push({
      name: metric,
      source: sourceIx >= 0 ? clean(row[sourceIx]) : "",
      owner: clean(row[ownerIx]),
      target,
      lowerIsBetter,
      values: weekCols.map(({ ix }) => {
        const raw = clean(row[ix]);
        if (EMPTY_CELL.has(raw)) return null;
        return { raw, n: cellNum(raw) };
      }),
    });
  }

  // Trim trailing weeks that are empty across every metric (future weeks).
  let last = -1;
  for (const s of sections)
    for (const m of s.metrics)
      for (let i = m.values.length - 1; i > last; i--) if (m.values[i]) last = i;
  const weeks = weekCols.slice(0, last + 1).map((w) => w.label);
  for (const s of sections) for (const m of s.metrics) m.values = m.values.slice(0, last + 1);

  return { weeks, sections: sections.filter((s) => s.metrics.length) };
}

export async function loadDtcScorecard() {
  const rows = await fetchCsvTab(csvUrl());
  const parsed = rows ? parseScorecard(rows) : null;
  if (!parsed) {
    return {
      mode: "stub",
      weeks: [],
      sections: [],
      sheetUrl: SCORECARD_SHEET_URL,
      reason:
        "Couldn't read the DTC scorecard sheet. Check link-sharing on the sheet or set DTC_SCORECARD_CSV_URL. See lib/dtcScorecardSheet.js.",
    };
  }
  return { mode: "live", sheetUrl: SCORECARD_SHEET_URL, ...parsed };
}
