"use client";

import { useEffect, useMemo, useState } from "react";
import ForecastVsBudget from "@/components/charts/ForecastVsBudget";

// =============================================================================
// PROJECTIONS — editable target overlay (Sam). Edit Budget / Base / Stretch, in
// both Gross and Net, per channel × product, for a selected MONTH. Blanks fall
// through to the Google-Sheet value; saved edits persist to Supabase
// (omni_projections) and /api/budget overlays them so the Actual-vs-Goal card
// and the PDF recap read the adjusted targets automatically. Fluctuates with the
// month selector up top.
// =============================================================================

const CHANNELS = ["B2B", "DTC", "ADCS"];
const PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
const TIERS = [
  { k: "budget", l: "Budget" },
  { k: "base", l: "Base" },
  { k: "stretch", l: "Stretch" },
];
const BASES = [
  { k: "gross", l: "Gross" },
  { k: "net", l: "Net" },
];
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const currentYm = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).format(new Date());
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MN[(m || 1) - 1]} ${y}`;
};
function monthOptions(back = 6, fwd = 12) {
  const [Y, M] = currentYm().split("-").map(Number);
  const out = [];
  for (let i = -back; i <= fwd; i++) {
    let y = Y, m = M + i;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}
const cleanNum = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
// Currency display: "$1,210,796" (whole dollars). Blank for empty/zero so the
// nothing-here rows stay clean. parseMoney strips back to a plain number.
const fmtMoney = (n) =>
  n === "" || n == null || Number(n) === 0 || Number.isNaN(Number(n)) ? "" : `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const parseMoney = (s) => {
  const d = String(s).replace(/[^0-9]/g, "");
  return d === "" ? "" : Number(d);
};

export default function ProjectionsPanel() {
  const [month, setMonth] = useState(currentYm());
  const [data, setData] = useState(null); // { ok, configured, overrides:[], sheet:{} }
  const [edits, setEdits] = useState({}); // "CH|PROD" -> { budget_gross, ... }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    fetch("/api/projections", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false }));
  };
  useEffect(load, []);

  const overrideFor = (ch, p) =>
    (data?.overrides || []).find((o) => o.channel === ch && o.product === p && o.month === month) || null;
  const sheetVal = (ch, p, t, b) => Number(data?.sheet?.[ch]?.[p]?.[month]?.[t]?.[b] ?? 0);
  const cellVal = (ch, p, t, b) => {
    const key = `${ch}|${p}`, f = `${t}_${b}`;
    if (edits[key] && edits[key][f] !== undefined) return edits[key][f];
    const ov = overrideFor(ch, p);
    if (ov && ov[f] != null) return ov[f];
    return sheetVal(ch, p, t, b);
  };
  const isOverridden = (ch, p) => {
    const key = `${ch}|${p}`;
    if (edits[key]) return "edited";
    return overrideFor(ch, p) ? "saved" : null;
  };
  const setCell = (ch, p, t, b, val) => {
    const key = `${ch}|${p}`, f = `${t}_${b}`;
    setMsg(null);
    setEdits((e) => ({ ...e, [key]: { ...(e[key] || {}), [f]: val } }));
  };

  const dirtyCount = Object.keys(edits).length;

  async function save() {
    const rows = Object.keys(edits).map((key) => {
      const [channel, product] = key.split("|");
      const row = { channel, product, month };
      for (const t of TIERS) for (const b of BASES) row[`${t.k}_${b.k}`] = cleanNum(cellVal(channel, product, t.k, b.k));
      return row;
    });
    if (!rows.length) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/projections", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save failed");
      setEdits({});
      setMsg(`Saved ${rows.length} row${rows.length > 1 ? "s" : ""} for ${monthLabel(month)}.`);
      load();
    } catch (e) {
      setMsg(`Error: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  async function revertRow(ch, p) {
    setSaving(true); setMsg(null);
    try {
      await fetch("/api/projections", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch, product: p, month }),
      });
      setEdits((e) => { const c = { ...e }; delete c[`${ch}|${p}`]; return c; });
      load();
      setMsg(`Reverted ${ch} ${p} to the sheet value.`);
    } catch (e) {
      setMsg(`Error: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  const months = useMemo(() => monthOptions(), []);
  const notConfigured = data && data.ok !== false && data.configured === false;

  return (
    <div className="font-sans">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="font-serif text-2xl md:text-3xl font-semibold text-ink leading-none">Projections</h2>
          <p className="text-xs md:text-sm text-muted mt-1">
            Adjust Budget / Base / Stretch targets — gross &amp; net — by channel &amp; product. Blank cells use the sheet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-inksoft flex items-center gap-1.5">
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-rule bg-paper2 px-2 py-1.5 text-sm text-ink">
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === currentYm() ? " (current)" : ""}</option>)}
            </select>
          </label>
          <button type="button" onClick={save} disabled={saving || !dirtyCount}
            className="min-h-touch px-4 rounded-md font-sans text-sm font-semibold bg-brown text-ink border border-brown hover:bg-browndeep disabled:opacity-50 transition tracking-[0.04em]">
            {saving ? "Saving…" : dirtyCount ? `Save ${dirtyCount}` : "Saved"}
          </button>
        </div>
      </div>

      <ForecastVsBudget />

      {notConfigured && (
        <div className="xt-error mb-3" style={{ borderLeftColor: "var(--brown)" }}>
          Projections store not connected — set <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> on Vercel.
        </div>
      )}
      {msg && <div className="text-xs mb-3" style={{ color: msg.startsWith("Error") ? "var(--unfavorable)" : "var(--favorable)" }}>{msg}</div>}

      <div className="rounded-xl border border-rule bg-card overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 1180, borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-muted">
              <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-card">Channel / Product</th>
              {TIERS.map((t) => BASES.map((b) => (
                <th key={`${t.k}_${b.k}`} className="text-right font-semibold px-2 py-2 whitespace-nowrap">{t.l} <span className="text-tan">{b.l}</span></th>
              )))}
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((ch) => (
              <FragmentChannel key={ch} ch={ch} PRODUCTS={PRODUCTS} cellVal={cellVal} setCell={setCell} isOverridden={isOverridden} revertRow={revertRow} sheetVal={sheetVal} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-2 leading-relaxed">
        Saved edits overlay the Rep-Goals sheet and flow straight into the Actual-vs-Goal card and the PDF recap for {monthLabel(month)}.
        Highlighted cells differ from the sheet. Use ↺ to revert a row back to the sheet value.
      </p>
    </div>
  );
}

function FragmentChannel({ ch, PRODUCTS, cellVal, setCell, isOverridden, revertRow, sheetVal }) {
  return (
    <>
      <tr className="bg-paper2">
        <td className="px-3 py-1.5 font-semibold text-ink text-[13px] sticky left-0 bg-paper2" colSpan={8}>{ch}</td>
      </tr>
      {PRODUCTS.map((p) => {
        const state = isOverridden(ch, p);
        return (
          <tr key={p} className="border-t border-rule/50">
            <td className="px-3 py-1 text-ink sticky left-0 bg-card">
              <span className="pl-2">{p}</span>
              {state && <span className="ml-1.5 text-[9px] uppercase tracking-wide" style={{ color: state === "edited" ? "var(--brown)" : "var(--muted)" }}>{state === "edited" ? "· edited" : "· set"}</span>}
            </td>
            {["budget", "base", "stretch"].map((t) =>
              ["gross", "net"].map((b) => {
                const v = cellVal(ch, p, t, b);
                const sv = sheetVal(ch, p, t, b);
                const differs = Number(v || 0) !== Number(sv || 0);
                return (
                  <td key={`${t}_${b}`} className="px-1.5 py-1 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={fmtMoney(v)}
                      placeholder={sv ? fmtMoney(sv) : "—"}
                      onChange={(e) => setCell(ch, p, t, b, parseMoney(e.target.value))}
                      className="w-36 text-right rounded-md border px-3 py-2 text-sm tabular-nums bg-paper2 focus:outline-none transition-colors"
                      style={{ borderColor: differs ? "var(--brown)" : "var(--rule)", color: "var(--ink)" }}
                    />
                  </td>
                );
              })
            )}
            <td className="px-1 py-0.5 text-center">
              {state && <button type="button" title="Revert to sheet" onClick={() => revertRow(ch, p)} className="text-muted hover:text-ink text-sm">↺</button>}
            </td>
          </tr>
        );
      })}
    </>
  );
}
