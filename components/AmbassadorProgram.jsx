"use client";

import { useEffect, useMemo, useState } from "react";

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtN = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function Badge({ ok }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold"
      style={ok ? { background: "rgba(46,125,50,0.14)", color: "#2E7D32" } : { background: "rgba(48,44,41,0.06)", color: "#9a9089" }}
    >
      {ok ? "Yes" : "No"}
    </span>
  );
}

function Tile({ label, value }) {
  return (
    <div className="bg-card border border-rule rounded-lg px-3 py-2">
      <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="font-display text-base md:text-lg font-semibold text-ink tabular-nums break-words">{value}</div>
    </div>
  );
}

// Table header cell — matches the house style used in BudgetVsActual.jsx so
// the XVIE50 tables read consistently with the rest of the dashboard.
function Th({ children, align = "left" }) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th className={`py-2 px-3 font-sans text-[10px] uppercase tracking-[0.14em] text-muted font-semibold ${alignClass}`}>
      {children}
    </th>
  );
}

export default function AmbassadorProgram() {
  const [data, setData] = useState(null); // ambassadorProgram[]
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // ambassadorProgram is built server-side from the ALL-TIME pull regardless
    // of the requested window, so ask for the cheapest window for a fast load.
    const qs = new URLSearchParams({ preset: "last_7d", granularity: "month" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.ambassadorProgram)) setData(j.ambassadorProgram);
        else setErr(j.error || "No ambassador data");
      })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const totals = { accounts: data.length, reordered: 0, reorderOrders: 0, units: 0, gross: 0 };
    const byRep = new Map();
    for (const a of data) {
      if (a.reordered) totals.reordered += 1;
      totals.reorderOrders += a.reorderOrders || 0;
      totals.units += a.reorderUnits || 0;
      totals.gross += a.reorderGross || 0;
      const rep = a.rep || "Unattributed";
      let g = byRep.get(rep);
      if (!g) { g = { rep, accts: [], reordered: 0, units: 0, gross: 0, reorderOrders: 0 }; byRep.set(rep, g); }
      g.accts.push(a);
      if (a.reordered) g.reordered += 1;
      g.units += a.reorderUnits || 0;
      g.gross += a.reorderGross || 0;
      g.reorderOrders += a.reorderOrders || 0;
    }
    const reps = Array.from(byRep.values())
      .sort((x, y) => y.gross - x.gross || y.accts.length - x.accts.length);
    reps.forEach((r) =>
      r.accts.sort((a, b) => (b.reorderGross || 0) - (a.reorderGross || 0) || (a.entryDate || "").localeCompare(b.entryDate || ""))
    );
    return { totals, reps };
  }, [data]);

  if (err) return <div className="rounded-xl border border-rule bg-card p-4 font-sans text-sm text-unfavorable">Couldn’t load ambassador program: {err}</div>;
  if (!model) return <div className="rounded-xl border border-rule bg-card p-8 text-center font-sans text-sm text-muted">Loading ambassador program…</div>;

  const t = model.totals;
  const rate = t.accounts ? Math.round((t.reordered / t.accounts) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Program summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 md:gap-3">
        <Tile label="Program accounts" value={fmtN(t.accounts)} />
        <Tile label="Reordered" value={`${fmtN(t.reordered)} · ${rate}%`} />
        <Tile label="Reorder orders" value={fmtN(t.reorderOrders)} />
        <Tile label="Xvie reorder units" value={fmtN(t.units)} />
        <Tile label="Reorder $ (full-price)" value={fmt$(t.gross)} />
      </div>

      {/* Per-rep groups */}
      {model.reps.map((g) => (
        <div key={g.rep} className="bg-card border border-rule rounded-xl overflow-hidden">
          <div className="flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap px-4 py-2.5 bg-paper2 border-b border-rule">
            <span className="font-display text-sm font-semibold text-ink truncate">{g.rep}</span>
            <span className="font-sans text-[11px] text-muted tabular-nums">
              <span className="font-semibold text-inksoft">{fmtN(g.accts.length)}</span> acct ·{" "}
              <span className="font-semibold text-inksoft">{fmtN(g.reordered)}</span> reordered ·{" "}
              <span className="font-semibold text-inksoft">{fmtN(g.units)}</span>u ·{" "}
              <span className="font-semibold text-inksoft">{fmt$(g.gross)}</span>
            </span>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs font-sans border-collapse">
              <thead>
                <tr className="bg-paper2 border-b border-rule">
                  <Th>Account / company</Th>
                  <Th>XVIE50 entry</Th>
                  <Th align="right">Reorders</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Reorder $</Th>
                  <Th align="right">Days → 1st</Th>
                  <Th align="center">Reordered</Th>
                </tr>
              </thead>
              <tbody>
                {g.accts.map((a, i) => (
                  <tr key={i} className="border-t border-rule/60 hover:bg-paper2/40">
                    <td className="py-2 px-3 text-ink font-medium">{a.name}</td>
                    <td className="py-2 px-3 text-inksoft whitespace-nowrap">{fmtDate(a.entryDate)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtN(a.reorderOrders)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtN(a.reorderUnits)}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">{fmt$(a.reorderGross)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-inksoft">{a.daysToFirstReorder == null ? "—" : fmtN(a.daysToFirstReorder)}</td>
                    <td className="py-2 px-3 text-center"><Badge ok={a.reordered} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-rule/60">
            {g.accts.map((a, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans text-sm font-medium text-ink truncate">{a.name}</span>
                  <Badge ok={a.reordered} />
                </div>
                <div className="font-sans text-[11px] text-muted mt-0.5">
                  XVIE50 {fmtDate(a.entryDate)} · {fmtN(a.reorderOrders)} reorder{a.reorderOrders === 1 ? "" : "s"} · {fmtN(a.reorderUnits)}u · {fmt$(a.reorderGross)}
                  {a.daysToFirstReorder != null ? ` · ${fmtN(a.daysToFirstReorder)}d → 1st` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="font-sans text-[10px] text-muted leading-snug">
        Ambassador (XVIE50) program — entry = the XVIE50-coded order (50% off the $3,600 Xvie case); reorder = a later full-price
        Xvie purchase (any X-XVIE SKU) by the same account without the XVIE50 code. Grouped by the rep on the entry order (shared
        findRep). The bundled free serums/gummies aren’t tracked — they aren’t represented in Shopify orders.
      </div>
    </div>
  );
}
