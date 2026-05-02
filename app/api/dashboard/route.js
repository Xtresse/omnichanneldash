import { NextResponse } from "next/server";
import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";

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

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let queryParams;
  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam)) {
    queryParams = { from: fromParam, to: toParam };
  } else {
    const preset = ALLOWED_PRESETS.has(presetParam) ? presetParam : "last_3m";
    queryParams = { preset };
  }

  try {
    const raw = await fetchWindsorRows(queryParams);
    const data = buildDashboardData(raw, queryParams);
    return NextResponse.json({ ok: true, ...queryParams, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
