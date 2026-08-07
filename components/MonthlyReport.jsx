"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { CHANNEL_COLORS, FAMILY_COLORS } from "@/lib/constants";

// =============================================================================
// PDF EXPORT — one-page monthly sales recap.
//
// A "PDF" button (header, next to Export CSV) opens a print-styled report sheet
// portaled to <body>. Print CSS (globals.css, `@media print`) hides everything
// but `.omni-report-sheet`, so the browser's Save-as-PDF produces a clean
// one-pager — no jsPDF/html2canvas, pixel-faithful to the omni design system.
//
// Data: the recap is MONTH-scoped and self-sufficient. It reuses the budget
// cube (`targets` = /api/budget) and, for the current month, the already-loaded
// this-month payload (`monthPayload` = Dashboard's execGoalMtdFull) so the
// common case needs no refetch. For any other month it fetches two windows:
//   • month window   (granularity=month) → month kpis, productFamily,
//                     repPerformance, accountAging  — point-in-time sections
//   • trend window   (13 months, granularity=month) → monthlySeries +
//                     customerDynamics buckets       — growth + new-vs-returning
// Every section is guarded so a missing source renders "—", never a crash.
//
// Sections (Sam's spec): 1 Budget vs actual by channel × product (gross, 3-tier)
// · 2 Growth MoM/QoQ/YoY · 3 New + cumulative accounts · 4 New vs returning ·
// 5 DTC scorecard (B2B-grade) · 6 Top-5 reps (new accts + net) · 7 XVIE & serum
// accounts. #8+ slot is left open at the end — add rows there.
// =============================================================================

const CHANNELS = ["B2B", "DTC", "ADCS"];
const PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"];
const TIERS = [
  { key: "budget", label: "Budget" },
  { key: "base", label: "Base" },
  { key: "stretch", label: "Stretch" },
];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Full dollars WITH thousands separators — the clean, unambiguous format for a
// CEO recap ($1,902,341, not $1902K). Used everywhere money appears.
const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const usdK = usd;
const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const pct0 = (n) => (n == null || !isFinite(n) ? "—" : `${Math.round(n)}%`);
const signPct = (n) => (n == null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const growthColor = (n) => (n == null ? "var(--xt-muted)" : n >= 0 ? "var(--xt-favorable)" : "var(--xt-unfavorable)");
const ymSlice = (d) => (d ? String(d).slice(0, 7) : "");
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
};
// A dashboard payload may arrive flat ({ok, kpis, …}) or wrapped ({ok, data}).
const pick = (j) => (j && j.data ? j.data : j) || {};

function currentYmPT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
  }).format(new Date()); // "2026-08"
}
function monthBounds(ym) {
  const [Y, M] = ym.split("-").map(Number);
  const lastDay = new Date(Y, M, 0).getDate();
  const start = `${ym}-01`;
  const end = `${ym}-${String(lastDay).padStart(2, "0")}`;
  let ty = Y, tm = M - 12;
  while (tm <= 0) { tm += 12; ty -= 1; }
  const trendStart = `${ty}-${String(tm).padStart(2, "0")}-01`;
  return { start, end, trendStart };
}
function lastMonths(n) {
  const now = currentYmPT();
  let [Y, M] = now.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${Y}-${String(M).padStart(2, "0")}`);
    M -= 1; if (M === 0) { M = 12; Y -= 1; }
  }
  return out;
}

// The two CRON-WARMED windows whose merged monthly series powers §2 growth.
// Both are >70 days so the server buckets them by MONTH; requested with NO
// granularity param so the cache key is `{q:{from,to},granularity:"auto",…}` —
// byte-identical to what /api/warm pre-computes (mirrors FilterBar's PT date
// math). last_365d = trailing 12 months; last_year = the prior calendar year.
// Together they span ~Jan(prev yr) → now, covering MoM, QoQ AND YoY for any
// recent month. A bespoke wide window is never warmed → cold → times out.
function warmedTrendWindows() {
  const pt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [py, pm, pd] = pt.split("-").map(Number);
  const t = new Date(`${py}-${String(pm).padStart(2, "0")}-${String(pd).padStart(2, "0")}T00:00:00`);
  const yd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  return [
    { from: yd(addDays(t, -364)), to: yd(t) },                                                       // last_365d
    { from: yd(new Date(t.getFullYear() - 1, 0, 1)), to: yd(new Date(t.getFullYear() - 1, 11, 31)) }, // last_year
  ];
}

// ---- small presentational helpers -------------------------------------------
function Section({ n, title, note, children }) {
  return (
    <section className="omni-report-section">
      <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--xt-tan)] pb-1 mb-2">
        <h2 className="font-serif text-[15px] font-semibold text-[color:var(--xt-ink)] leading-none">
          <span className="text-[color:var(--xt-brown)]">{n}.</span> {title}
        </h2>
        {note ? <span className="font-sans text-[9px] uppercase tracking-[0.12em] text-[color:var(--xt-muted)]">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}
function Stat({ label, value, sub, color }) {
  return (
    <div className="rounded-md border border-[color:var(--xt-rule)] bg-[color:var(--xt-paper-2)] px-2.5 py-1.5">
      <div className="font-sans text-[8.5px] uppercase tracking-[0.1em] text-[color:var(--xt-muted)]">{label}</div>
      <div className="font-serif text-[17px] font-semibold leading-tight" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className="font-sans text-[9px] text-[color:var(--xt-ink-soft)] leading-tight">{sub}</div> : null}
    </div>
  );
}
const Dot = ({ c }) => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c, marginRight: 5, verticalAlign: "middle" }} />;

export default function MonthlyReport({ data, targets, monthPayload, periodLabel }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(currentYmPT());
  const [store, setStore] = useState({}); // { [ym]: { month, trend } }
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const inflight = useRef({});

  useEffect(() => setMounted(true), []);

  const currentYm = currentYmPT();

  // Fetch that surfaces server failures as a clean error instead of choking on
  // a non-JSON timeout page ("An error occurred…" → "Unexpected token 'A'").
  const getJson = async (url) => {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`Server error (${r.status || "timeout"}) — the data pull didn't finish. Try again in a moment.`); }
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `Server error (${r.status}).`);
    return pick(j);
  };

  const load = useCallback(async (targetYm) => {
    if (inflight.current[targetYm]) return;
    inflight.current[targetYm] = true;
    setErr(null); setLoading(true);
    const { start, end, trendStart } = monthBounds(targetYm);
    // 1) MONTH window — the hard dependency (powers every section but growth).
    //    Fetched ALONE first so it isn't throttled by the heavier trend pull,
    //    and the report body can paint as soon as it lands (progressive render).
    try {
      const monthReuse = targetYm === currentYm && monthPayload ? pick(monthPayload) : null;
      const monthJson = monthReuse || await getJson(`/api/dashboard?from=${start}&to=${end}&granularity=month`);
      if (!monthJson || !monthJson.kpis) throw new Error("The month pull returned no data.");
      setStore((s) => ({ ...s, [targetYm]: { ...(s[targetYm] || {}), month: monthJson } }));
    } catch (e) {
      setErr(String(e?.message || e));
      inflight.current[targetYm] = false;
      setLoading(false);
      return;
    }
    // 2) TREND for growth — SOFT. Fetch the two CRON-WARMED windows (last_365d +
    //    last_year, granularity=auto→month) and merge their monthly series. These
    //    hit the warm KV cache and serve instantly/completely, where a bespoke
    //    wide window is cold and comes back partial (only recent months → QoQ/YoY
    //    read $0). Failure marks growth "n/a"; the rest of the recap still renders.
    try {
      const wins = warmedTrendWindows();
      const payloads = await Promise.all(
        wins.map((w) => getJson(`/api/dashboard?from=${w.from}&to=${w.to}`).catch(() => null))
      );
      const merged = new Map();
      for (const p of payloads) for (const s of p?.monthlySeries || []) merged.set(s.month, s);
      if (merged.size === 0) throw new Error("no trend data");
      const monthlySeries = Array.from(merged.values()).sort((a, b) => a.month.localeCompare(b.month));
      setStore((s) => ({ ...s, [targetYm]: { ...(s[targetYm] || {}), trend: { monthlySeries } } }));
    } catch {
      setStore((s) => ({ ...s, [targetYm]: { ...(s[targetYm] || {}), trend: { __error: true } } }));
    } finally {
      setLoading(false);
    }
  }, [currentYm, monthPayload]);

  // Fetch when the overlay opens or the month changes.
  useEffect(() => {
    if (open) load(ym);
  }, [open, ym, load]);

  const bundle = store[ym];
  const month = bundle?.month || null;
  const trend = bundle?.trend || null;

  // ---------- derive every section ----------
  const model = useMemo(() => {
    if (!month) return null;
    const kpis = month.kpis || {};
    const fam = month.productFamily || [];
    const famOf = (p) => fam.find((f) => f.family === p) || {};
    const co = targets?.company || null;
    const tget = (ch, p, tier) => Number(co?.[ch]?.[p]?.[ym]?.[tier]?.gross || 0);
    const actGross = (ch, p) => Number(famOf(p)[`${ch}_gross`] || 0);

    // §1 — channel × product, ACTUAL vs BASE (gross), per Sam. DTC only sells
    // Gummies + Serum. ADCS base is a lump in the sheet, so allocate it across
    // products by the channel's ACTUAL gross mix instead of parking it all on
    // Gummies. Rows with no actual and no base are dropped.
    const prodsFor = (ch) => (ch === "DTC" ? ["Gummies", "Serum"] : PRODUCTS);
    const matrix = CHANNELS.map((ch) => {
      const prods = prodsFor(ch);
      let baseFor;
      if (ch === "ADCS") {
        const adcsBaseTotal = prods.reduce((a, p) => a + tget("ADCS", p, "base"), 0);
        const actTotal = prods.reduce((a, p) => a + actGross("ADCS", p), 0);
        baseFor = (p) => (actTotal > 0 ? adcsBaseTotal * (actGross("ADCS", p) / actTotal) : tget("ADCS", p, "base"));
      } else {
        baseFor = (p) => tget(ch, p, "base");
      }
      const rows = prods
        .map((p) => {
          const actual = actGross(ch, p);
          const base = baseFor(p);
          return { product: p, actual, base, attain: base > 0 ? (actual / base) * 100 : null };
        })
        .filter((r) => r.actual > 0 || r.base > 0);
      const tot = rows.reduce((a, r) => ({ actual: a.actual + r.actual, base: a.base + r.base }), { actual: 0, base: 0 });
      return { channel: ch, rows, tot: { ...tot, attain: tot.base > 0 ? (tot.actual / tot.base) * 100 : null } };
    });
    const grand = matrix.reduce((a, mm2) => ({ actual: a.actual + mm2.tot.actual, base: a.base + mm2.tot.base }), { actual: 0, base: 0 });
    grand.attain = grand.base > 0 ? (grand.actual / grand.base) * 100 : null;

    // §2 — growth MoM / QoQ / YoY (gross). SOFT: needs the trend series; renders
    // "n/a" if the trend pull failed, "…" while still loading.
    const trendOk = !!(trend && !trend.__error);
    const series = (trend?.monthlySeries || []).slice().sort((a, b) => a.month.localeCompare(b.month));
    const byMonth = new Map(series.map((s) => [s.month, s]));
    const gOf = (row) => Number(row?.Total_gross || 0);
    const [yy, mm] = ym.split("-").map(Number);
    const shiftYm = (y, m, back) => { let y2 = y, m2 = m - back; while (m2 <= 0) { m2 += 12; y2 -= 1; } return `${y2}-${String(m2).padStart(2, "0")}`; };
    const prevYm = shiftYm(yy, mm, 1);                       // calendar prior month (not array-adjacent)
    const yoyYm = `${yy - 1}-${String(mm).padStart(2, "0")}`;
    const cur = byMonth.get(ym) || null;
    const prev = byMonth.get(prevYm) || null;
    const yoy = byMonth.get(yoyYm) || null;
    const growth = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
    // QoQ — quarter-to-DATE vs the SAME elapsed span of the prior quarter, so a
    // mid-quarter month isn't unfairly compared to a full prior quarter.
    const q = Math.floor((mm - 1) / 3);
    const elapsed = ((mm - 1) % 3) + 1; // months into the current quarter (1..3)
    const qMonths = (qy, qq, count) => Array.from({ length: count }, (_, k) => `${qy}-${String(qq * 3 + k + 1).padStart(2, "0")}`);
    const sumG = (months) => months.reduce((a, mk) => a + gOf(byMonth.get(mk)), 0);
    const curQ = sumG(qMonths(yy, q, elapsed));
    const prevQY = q === 0 ? yy - 1 : yy;
    const prevQ = q === 0 ? 3 : q - 1;
    const priorQ = sumG(qMonths(prevQY, prevQ, elapsed));
    const growthRow = {
      curGross: gOf(cur), mom: growth(gOf(cur), gOf(prev)), qoq: growth(curQ, priorQ),
      yoy: growth(gOf(cur), gOf(yoy)), curQ, priorQ,
    };
    // Per-channel gross MoM (from the same monthly series) — for the DTC and
    // B2B/rep sections. cur/prev buckets carry B2B_gross/DTC_gross/ADCS_gross.
    const chGrossMoM = (ch) => growth(Number(cur?.[`${ch}_gross`] || 0), Number(prev?.[`${ch}_gross`] || 0));
    const dtcMoM = chGrossMoM("DTC");
    const b2bMoM = chGrossMoM("B2B");

    // §3 — new + cumulative accounts (B2B, rep-attributed), from accountAging
    // (all-time in every payload, so prior-month is a calendar lookup — no trend).
    const aging = month.accountAging || [];
    const newInMonth = aging.filter((a) => ymSlice(a.firstOrder) === ym).length;
    const cumulative = aging.filter((a) => ymSlice(a.firstOrder) <= ym).length;
    const newPrev = aging.filter((a) => ymSlice(a.firstOrder) === prevYm).length;

    // §4 — new vs returning (order counts), from the MONTH payload's bucket
    const cd = (month.customerDynamics || []).find((r) => r.month === ym) || {};
    const nvr = {
      b2bNew: cd.B2B_new || 0, b2bRet: cd.B2B_ret || 0, dtcNew: cd.DTC_new || 0, dtcRet: cd.DTC_ret || 0,
    };

    // §5 — DTC scorecard (B2B-grade)
    const dtcBase = PRODUCTS.reduce((a, p) => a + tget("DTC", p, "base"), 0);
    const dtc = {
      gross: Number(kpis.dtcGrossSales || 0), net: Number(kpis.dtcNetSales || 0),
      orders: Number(kpis.dtcOrders || 0), aov: Number(kpis.dtcAOV || 0),
      base: dtcBase, attain: dtcBase > 0 ? (Number(kpis.dtcGrossSales || 0) / dtcBase) * 100 : null,
      byProduct: PRODUCTS.map((p) => ({ product: p, gross: actGross("DTC", p) })).filter((r) => r.gross > 0),
      newC: nvr.dtcNew, retC: nvr.dtcRet,
    };

    // §6 — top-5 reps (net + new accounts), from month repPerformance
    const allReps = (month.repPerformance || []).flatMap((s) => (s.rows || []).map((r) => ({ ...r, territory: s.territory })));
    const newAcctOf = (r) => Number(r.newAccounts ?? r.chronologicalNewAccounts ?? r.productMix?.Gummies?.newCusts ?? 0);
    const topNet = allReps.filter((r) => (r.net || 0) > 0).sort((a, b) => b.net - a.net).slice(0, 5);
    const topNew = allReps.map((r) => ({ ...r, _new: newAcctOf(r) })).filter((r) => r._new > 0).sort((a, b) => b._new - a._new).slice(0, 5);

    // §7 — XVIE & serum accounts (B2B accounts, all-time distinct + new this month)
    const xvieAll = aging.filter((a) => (a.byProduct?.XVIE || 0) > 0).length;
    const serumAll = aging.filter((a) => (a.byProduct?.Serum || 0) > 0).length;
    const newXvie = allReps.reduce((a, r) => a + Number(r.newXvieAccts || 0), 0);
    const newSerum = allReps.reduce((a, r) => a + Number(r.newSerumAccts || 0), 0);

    return {
      kpis, matrix, grand, growthRow, newInMonth, cumulative, newPrev, nvr, dtc,
      topNet, topNew, xvieAll, serumAll, newXvie, newSerum,
      dtcMoM, b2bMoM,
      growthReady: trendOk, growthFailed: !!(trend && trend.__error),
      isMtd: ym === currentYm,
    };
  }, [month, trend, targets, ym, currentYm]);

  const monthOpts = lastMonths(13);
  const genAt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  function doPrint() { window.print(); }

  const button = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm font-semibold bg-paper text-ink border border-brown hover:bg-paper2 transition tracking-[0.04em] inline-flex items-center gap-1.5"
      title="Generate a one-page monthly sales recap (Save as PDF)"
    >
      <span aria-hidden="true">📄</span>
      <span className="hidden sm:inline">PDF</span>
    </button>
  );

  const overlay = open ? (
    <div className="omni-report-overlay" role="dialog" aria-label="Monthly recap PDF">
      {/* Toolbar — screen only; hidden in print */}
      <div className="omni-report-toolbar">
        <div className="font-sans text-xs font-semibold text-[color:var(--xt-ink)] mr-auto">Monthly Sales Recap</div>
        <label className="font-sans text-[11px] text-[color:var(--xt-ink-soft)] flex items-center gap-1.5">
          Month
          <select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="rounded border border-[color:var(--xt-rule)] bg-white px-2 py-1 text-[13px]"
          >
            {monthOpts.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === currentYm ? " (MTD)" : ""}</option>)}
          </select>
        </label>
        <button type="button" onClick={doPrint} disabled={!model}
          className="rounded-md bg-brown text-ink border border-brown px-3 py-1 font-sans text-[13px] font-semibold hover:bg-browndeep disabled:opacity-50">
          Save as PDF
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-md bg-paper text-ink border border-rule px-3 py-1 font-sans text-[13px] font-semibold hover:bg-paper2">
          Close
        </button>
      </div>

      {/* The printable one-pager */}
      <div className="omni-report-scroll">
        <div className="omni-report-sheet">
          <ReportHeader ym={ym} genAt={genAt} isMtd={model?.isMtd} />
          {loading && !model ? (
            <div className="font-sans text-sm text-[color:var(--xt-muted)] py-12 text-center">Building recap for {monthLabel(ym)}…</div>
          ) : err ? (
            <div className="font-sans text-sm text-[color:var(--xt-unfavorable)] py-12 text-center">Could not build the recap: {err}</div>
          ) : model ? (
            <ReportBody m={model} ym={ym} hasTargets={!!targets?.company} />
          ) : null}
          <ReportFooter />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {button}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}

function ReportHeader({ ym, genAt, isMtd }) {
  return (
    <header className="flex items-end justify-between border-b-2 border-[color:var(--xt-ink)] pb-2 mb-3">
      <div>
        <div className="font-sans text-[9px] uppercase tracking-[0.22em] text-[color:var(--xt-muted)]">Xtressé · Omni-Channel Sales</div>
        <h1 className="font-serif text-[26px] font-semibold text-[color:var(--xt-ink)] leading-none mt-0.5">Monthly Sales Recap</h1>
      </div>
      <div className="text-right">
        <div className="font-serif text-[18px] font-semibold text-[color:var(--xt-brown)] leading-none">{monthLabel(ym)}{isMtd ? " · MTD" : ""}</div>
        <div className="font-sans text-[9px] text-[color:var(--xt-muted)] mt-1">Generated {genAt}</div>
      </div>
    </header>
  );
}

function ReportFooter() {
  return (
    <footer className="mt-3 pt-1.5 border-t border-[color:var(--xt-rule)] font-sans text-[8px] text-[color:var(--xt-muted)] leading-snug">
      Net = subtotal (post-discount, pre-ship/tax) − refunds · Gross = subtotal + discounts. Budget tiers from the Rep Goals sheet;
      3-tier gross targets require the live sheet. Accounts &amp; reps are B2B rep-attributed (location grain). DTC reliable from Apr 2026.
      New-vs-returning is order counts (B2B cohort = gummy-case buyers). Confidential — internal use only.
    </footer>
  );
}

function AttainPill({ v }) {
  if (v == null) return <span className="text-[color:var(--xt-muted)]">—</span>;
  const c = v >= 100 ? "var(--xt-favorable)" : v >= 80 ? "var(--xt-partial)" : "var(--xt-unfavorable)";
  return <span style={{ color: c, fontWeight: 600 }}>{pct0(v)}</span>;
}

function ReportBody({ m, ym, hasTargets }) {
  const k = m.kpis;
  const total = Number(k.totalGrossSales || 0);
  const gv = (n) => (m.growthReady ? signPct(n) : m.growthFailed ? "n/a" : "…");
  const gc = (n) => (m.growthReady ? growthColor(n) : "var(--xt-muted)");
  return (
    <div className="omni-report-grid">
      {/* Headline strip */}
      <div className="grid grid-cols-6 gap-1.5 mb-1">
        <Stat label="Total Gross" value={usdK(total)} sub={`${num(k.totalOrders)} orders`} />
        <Stat label="B2B Gross" value={usdK(k.b2bGrossSales)} sub={`${pct0((k.b2bNetSales / (k.totalNetSales || 1)) * 100)} of net`} color="var(--xt-b2b)" />
        <Stat label="DTC Gross" value={usdK(k.dtcGrossSales)} sub={`${pct0((k.dtcNetSales / (k.totalNetSales || 1)) * 100)} of net`} color="var(--xt-dtc)" />
        <Stat label="ADCS Gross" value={usdK(k.adcsGrossSales)} sub={`${pct0((k.adcsNetSales / (k.totalNetSales || 1)) * 100)} of net`} color="var(--xt-adcs)" />
        <Stat label="MoM" value={gv(m.growthRow.mom)} color={gc(m.growthRow.mom)} sub="gross" />
        <Stat label="YoY" value={gv(m.growthRow.yoy)} color={gc(m.growthRow.yoy)} sub="gross" />
      </div>

      {/* §1 Budget vs actual by channel × product */}
      <Section n={1} title="Performance vs Base — Channel × Product" note={hasTargets ? "Gross · Actual vs Base" : "No targets loaded"}>
        <table className="omni-tbl">
          <thead>
            <tr>
              <th className="text-left">Channel / Product</th>
              <th>Actual</th><th>Base</th><th>% Base</th>
            </tr>
          </thead>
          <tbody>
            {m.matrix.map((mx) => (
              <FragmentChannel key={mx.channel} mx={mx} />
            ))}
            <tr className="omni-tbl-grand">
              <td className="text-left">Company Total</td>
              <td>{usdK(m.grand.actual)}</td><td>{usdK(m.grand.base)}</td>
              <td><AttainPill v={m.grand.attain} /></td>
            </tr>
          </tbody>
        </table>
      </Section>

      {/* Two-up: §2 growth + §3 accounts */}
      <div className="grid grid-cols-2 gap-3">
        <Section n={2} title="Growth" note="Gross">
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="MoM" value={gv(m.growthRow.mom)} color={gc(m.growthRow.mom)} />
            <Stat label="QoQ" value={gv(m.growthRow.qoq)} color={gc(m.growthRow.qoq)} sub={m.growthReady ? "quarter-to-date" : null} />
            <Stat label="YoY" value={gv(m.growthRow.yoy)} color={gc(m.growthRow.yoy)} />
          </div>
        </Section>

        <Section n={3} title="New & Cumulative Accounts" note="B2B · location grain">
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="New This Month" value={num(m.newInMonth)} sub={m.newPrev != null ? `${signPct(m.newPrev ? ((m.newInMonth - m.newPrev) / m.newPrev) * 100 : null)} vs prior` : null} color="var(--xt-brown)" />
            <Stat label="Cumulative" value={num(m.cumulative)} sub="distinct accounts" />
            <Stat label="Prior Month" value={m.newPrev == null ? "—" : num(m.newPrev)} sub="new accts" />
          </div>
        </Section>
      </div>

      {/* Two-up: §4 new vs returning + §7 xvie/serum */}
      <div className="grid grid-cols-2 gap-3">
        <Section n={4} title="New vs Returning" note="Order counts">
          <table className="omni-tbl">
            <thead><tr><th className="text-left">Channel</th><th>New</th><th>Returning</th><th>Repeat %</th></tr></thead>
            <tbody>
              <tr>
                <td className="text-left"><Dot c="var(--xt-b2b)" />B2B</td>
                <td>{num(m.nvr.b2bNew)}</td><td>{num(m.nvr.b2bRet)}</td>
                <td>{pct0((m.nvr.b2bRet / ((m.nvr.b2bNew + m.nvr.b2bRet) || 1)) * 100)}</td>
              </tr>
              <tr>
                <td className="text-left"><Dot c="var(--xt-dtc)" />DTC</td>
                <td>{num(m.nvr.dtcNew)}</td><td>{num(m.nvr.dtcRet)}</td>
                <td>{pct0((m.nvr.dtcRet / ((m.nvr.dtcNew + m.nvr.dtcRet) || 1)) * 100)}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section n={7} title="XVIE & Serum Accounts" note="B2B accounts">
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="XVIE Accounts" value={num(m.xvieAll)} sub={`+${num(m.newXvie)} new this month`} color="var(--xt-ink)" />
            <Stat label="Serum Accounts" value={num(m.serumAll)} sub={`+${num(m.newSerum)} new this month`} color="var(--xt-unfavorable)" />
          </div>
        </Section>
      </div>

      {/* §5 DTC scorecard */}
      <Section n={5} title="DTC Performance" note="B2B-grade breakout">
        <div className="grid grid-cols-6 gap-1.5 mb-1.5">
          <Stat label="DTC Gross" value={usdK(m.dtc.gross)} color="var(--xt-dtc)" />
          <Stat label="DTC Net" value={usdK(m.dtc.net)} />
          <Stat label="Orders" value={num(m.dtc.orders)} />
          <Stat label="AOV" value={usd(m.dtc.aov)} />
          <Stat label="vs Base" value={m.dtc.attain == null ? "—" : pct0(m.dtc.attain)} color={m.dtc.attain >= 100 ? "var(--xt-favorable)" : "var(--xt-partial)"} />
          <Stat label="MoM" value={gv(m.dtcMoM)} color={gc(m.dtcMoM)} sub="gross vs prior" />
        </div>
        {m.dtc.byProduct.length > 0 && (
          <div className="font-sans text-[10px] text-[color:var(--xt-ink-soft)]">
            By product (gross): {m.dtc.byProduct.map((r) => (
              <span key={r.product} className="mr-3"><Dot c={FAMILY_COLORS[r.product] || "var(--xt-tan)"} />{r.product} {usdK(r.gross)}</span>
            ))}
          </div>
        )}
      </Section>

      {/* §6 top reps */}
      <Section n={6} title="Top Reps" note="This month">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="font-sans text-[9px] uppercase tracking-[0.1em] text-[color:var(--xt-muted)] mb-1">By Net Sales</div>
            <table className="omni-tbl omni-tbl-sm">
              <tbody>
                {m.topNet.length ? m.topNet.map((r, i) => (
                  <tr key={r.rep || i}><td className="text-left"><span className="text-[color:var(--xt-muted)]">{i + 1}.</span> {r.rep}</td><td>{usdK(r.net)}</td></tr>
                )) : <tr><td className="text-left text-[color:var(--xt-muted)]" colSpan={2}>No rep sales this month</td></tr>}
              </tbody>
            </table>
          </div>
          <div>
            <div className="font-sans text-[9px] uppercase tracking-[0.1em] text-[color:var(--xt-muted)] mb-1">By New Accounts</div>
            <table className="omni-tbl omni-tbl-sm">
              <tbody>
                {m.topNew.length ? m.topNew.map((r, i) => (
                  <tr key={r.rep || i}><td className="text-left"><span className="text-[color:var(--xt-muted)]">{i + 1}.</span> {r.rep}</td><td>{num(r._new)}</td></tr>
                )) : <tr><td className="text-left text-[color:var(--xt-muted)]" colSpan={2}>No new accounts this month</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}

// One channel block inside the §1 matrix table.
function FragmentChannel({ mx }) {
  return (
    <>
      <tr className="omni-tbl-sub">
        <td className="text-left" colSpan={4}><Dot c={CHANNEL_COLORS[mx.channel] || "var(--xt-tan)"} />{mx.channel}</td>
      </tr>
      {mx.rows.map((r) => (
        <tr key={r.product}>
          <td className="text-left pl-4">{r.product}</td>
          <td>{usdK(r.actual)}</td>
          <td>{r.base ? usdK(r.base) : "—"}</td>
          <td><AttainPill v={r.attain} /></td>
        </tr>
      ))}
      <tr className="omni-tbl-subtot">
        <td className="text-left pl-4">{mx.channel} total</td>
        <td>{usdK(mx.tot.actual)}</td>
        <td>{mx.tot.base ? usdK(mx.tot.base) : "—"}</td>
        <td><AttainPill v={mx.tot.attain} /></td>
      </tr>
    </>
  );
}
