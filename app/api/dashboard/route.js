import { NextResponse } from "next/server";
import {
  fetchWindsorRows,
  fetchWindsorAllTimeLight,
  buildDashboardData,
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

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const granularityParam = url.searchParams.get("granularity");
  const granularity = ALLOWED_GRANULARITY.has(granularityParam) ? granularityParam : "auto";

  let queryParams;
  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam)) {
    queryParams = { from: fromParam, to: toParam };
  } else {
    const preset = ALLOWED_PRESETS.has(presetParam) ? presetParam : "last_3m";
    queryParams = { preset };
  }

  try {
    const [raw, allTimeRows] = await Promise.all([
      fetchWindsorRows(queryParams),
      fetchWindsorAllTimeLight(),
    ]);
    const data = buildDashboardData(
      raw,
      { ...queryParams, granularity },
      allTimeRows
    );
    return NextResponse.json({ ok: true, ...queryParams, granularity, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
