import { NextResponse } from "next/server";
import {
  fetchWindsorRows,
  fetchWindsorAllTimeLight,
  buildDashboardData,
  buildCompareSnapshot,
  computeCompareWindow,
} from "@/lib/windsor.js";

// 5-minute cache on the API. Browser still gets a fresh response per query
// (preset/from/to combinations cache independently).
export const revalidate = 300;

const ALLOWED_PRESETS = new Set([
  "last_7d",
  "last_30d",
  "last_3m",
  "last_6m",
  "last_12m",
  "last_year",
  "this_year",
  "last_2years",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_GRANULARITY = new Set(["auto", "day", "week", "biweek", "month"]);
const ALLOWED_COMPARE = new Set(["off", "prior", "yoy"]);

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const granularityParam = url.searchParams.get("granularity");
  const granularity = ALLOWED_GRANULARITY.has(granularityParam) ? granularityParam : "auto";
  const compareParam = url.searchParams.get("compare");
  const compareMode = ALLOWED_COMPARE.has(compareParam) ? compareParam : "off";

  let queryParams;
  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam)) {
    queryParams = { from: fromParam, to: toParam };
  } else {
    const preset = ALLOWED_PRESETS.has(presetParam) ? presetParam : "last_3m";
    queryParams = { preset };
  }

  // Compute the prior-comparison window only when explicit from/to dates
  // are provided (preset-only requests don't carry enough info; the client
  // always passes from/to, so this branch is the common path).
  const compareWindow =
    compareMode !== "off" && queryParams.from && queryParams.to
      ? computeCompareWindow(queryParams.from, queryParams.to, compareMode)
      : null;

  try {
    const [raw, allTimeRows, compareRaw] = await Promise.all([
      fetchWindsorRows(queryParams),
      fetchWindsorAllTimeLight(),
      compareWindow ? fetchWindsorRows(compareWindow) : Promise.resolve(null),
    ]);
    const data = buildDashboardData(
      raw,
      { ...queryParams, granularity },
      allTimeRows
    );
    let compare = null;
    if (compareWindow && compareRaw) {
      const snapshot = buildCompareSnapshot(compareRaw, compareWindow);
      compare = {
        mode: compareMode,
        from: compareWindow.from,
        to: compareWindow.to,
        ...snapshot,
      };
    }
    return NextResponse.json({
      ok: true,
      ...queryParams,
      granularity,
      compareMode,
      compare,
      ...data,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
