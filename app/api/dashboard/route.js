import { NextResponse } from "next/server";
import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min

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

export async function GET(request) {
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset") || "last_2years";
  const preset = ALLOWED_PRESETS.has(presetParam) ? presetParam : "last_2years";

  try {
    const raw = await fetchWindsorRows(preset);
    const data = buildDashboardData(raw);
    return NextResponse.json({ ok: true, preset, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
