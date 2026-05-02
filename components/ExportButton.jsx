"use client";

const csvEscape = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const isoDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
};

/**
 * Single export button that downloads a multi-sheet CSV bundle:
 *   - kpis_<period>.csv      : the three KPI buckets
 *   - reps_<period>.csv      : per-rep performance
 *   - orders_<period>.csv    : full order audit list
 *
 * Browsers don't natively support multi-file downloads, so we trigger
 * three sequential downloads (most browsers will prompt once and then
 * allow subsequent downloads silently).
 */
export default function ExportButton({ data, periodLabel }) {
  const safeLabel =
    (periodLabel || "period")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .toLowerCase()
      .slice(0, 60) || "period";

  function downloadCsv(filename, lines) {
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  function exportKpis() {
    const k = data.kpis;
    const headers = ["Bucket", "Net sales", "Orders", "AOV", "Share of total"];
    const rows = [
      ["B2B", k.b2bNetSales, k.b2bOrders, k.b2bAOV, k.b2bShare],
      ["ADCS", k.adcsNetSales, k.adcsOrders, k.adcsAOV, k.adcsShare],
      ["DTC", k.dtcNetSales, k.dtcOrders, k.dtcAOV, k.dtcShare],
      ["Total", k.totalNetSales, k.totalOrders, "", 1],
    ];
    const lines = [headers.map(csvEscape).join(",")];
    for (const r of rows) {
      lines.push([
        csvEscape(r[0]),
        Number(r[1] || 0).toFixed(2),
        r[2],
        r[3] === "" ? "" : Number(r[3] || 0).toFixed(2),
        Number(r[4] || 0).toFixed(4),
      ].join(","));
    }
    downloadCsv(`omnichannel_kpis_${safeLabel}.csv`, lines);
  }

  function exportReps() {
    const headers = [
      "Territory", "Region", "Rank", "Rep", "Net sales", "Orders",
      "New gummy accts (first-order tag)", "Chronological new accts (sanity)",
      "Last order",
    ];
    const lines = [headers.map(csvEscape).join(",")];
    for (const section of data.repPerformance || []) {
      for (const r of section.rows) {
        lines.push([
          csvEscape(section.territory),
          csvEscape(r.region),
          r.rank,
          csvEscape(r.rep),
          Number(r.net || 0).toFixed(2),
          r.orders,
          r.firstOrderGummy || 0,
          r.chronologicalNewAccounts || 0,
          isoDay(r.lastOrderAt),
        ].join(","));
      }
    }
    downloadCsv(`omnichannel_reps_${safeLabel}.csv`, lines);
  }

  function exportOrders() {
    const headers = [
      "Order ID", "Order #", "Date", "Channel", "ADCS", "Sub", "Rep",
      "Email", "State", "Country", "Discount codes",
      "Gross", "Discounts", "Returns", "Net"
    ];
    const lines = [headers.map(csvEscape).join(",")];
    for (const o of data.orders || []) {
      lines.push([
        csvEscape(o.id),
        csvEscape(o.name || ""),
        isoDay(o.date),
        csvEscape(o.channel),
        o.adcs ? "1" : "",
        o.sub ? "1" : "",
        csvEscape(o.rep || ""),
        csvEscape(o.email || ""),
        csvEscape(o.state || ""),
        csvEscape(o.country || ""),
        csvEscape((o.codes || []).join("; ")),
        Number(o.gross || 0).toFixed(2),
        Number(o.discounts || 0).toFixed(2),
        Number(o.returns || 0).toFixed(2),
        Number(o.net || 0).toFixed(2),
      ].join(","));
    }
    downloadCsv(`omnichannel_orders_${safeLabel}.csv`, lines);
  }

  function exportAll() {
    exportKpis();
    setTimeout(exportReps, 200);
    setTimeout(exportOrders, 400);
  }

  return (
    <button
      type="button"
      onClick={exportAll}
      className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-brown text-paper border border-brown hover:bg-browndeep transition tracking-[0.04em]"
      title="Download CSVs for KPIs, rep performance, and the full order audit"
    >
      Export CSV
    </button>
  );
}
