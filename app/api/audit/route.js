import { NextResponse } from "next/server";
import { fetchWindsorRows, buildDashboardData } from "@/lib/windsor.js";

// Audit envelope consumed by xtresse-hub's reconciliation engine.
// Returns the canonical numbers this dashboard claims to show, so the
// hub can diff them against the source (Windsor) and against other apps.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const expectedSecret = process.env.AUDIT_SHARED_SECRET;
  if (expectedSecret) {
    const provided = request.headers.get("x-audit-key") || searchParams.get("key");
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to || !ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json(
      errorEnvelope("from + to (YYYY-MM-DD) required"),
      { status: 400 }
    );
  }

  const warnings = [];
  const errors = [];
  const metrics = [];

  try {
    const rows = await fetchWindsorRows({ from, to });
    const data = buildDashboardData(rows, { from, to });
    const k = data?.kpis ?? {};
    const recon = data?.reconciliation ?? {};

    metrics.push({
      key: "net_sales",
      label: "Total Net Sales",
      value: numOrNull(k.totalNetSales ?? recon?.netSales?.kpiTotal),
      unit: "USD",
      source: "windsor.shopify",
    });
    metrics.push({
      key: "gross_sales",
      label: "Total Gross Sales",
      value: numOrNull(k.totalGrossSales),
      unit: "USD",
      source: "windsor.shopify",
    });
    metrics.push({
      key: "order_count",
      label: "Total Orders",
      value: numOrNull(k.totalOrders ?? data?.orderCount),
      unit: "count",
      source: "windsor.shopify",
    });

    if (!process.env.WINDSOR_API_KEY) warnings.push("WINDSOR_API_KEY not set; numbers may be from stub.");
  } catch (e) {
    errors.push(e?.message || String(e));
  }

  return NextResponse.json({
    app: "omnichanneldash",
    version: 1,
    generated_at: new Date().toISOString(),
    date_range: { from, to },
    metrics,
    warnings,
    errors,
  }, { headers: { "cache-control": "no-store" } });
}

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function errorEnvelope(msg) {
  return {
    app: "omnichanneldash",
    version: 1,
    generated_at: new Date().toISOString(),
    date_range: { from: "", to: "" },
    metrics: [],
    warnings: [],
    errors: [msg],
  };
}
