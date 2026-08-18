"use client";

// =============================================================================
// FORECAST vs BUDGET — revenue by channel, Result (Actuals Jan–Jul → Forecast
// Aug–Dec) against Budget. Budget is a reference LINE, not a second bar.
//   • Net ⇄ Gross flip. Stored numbers are NET; Gross = Net ÷ channel factor
//     (B2B 0.92, DTC 0.98, ADCS 0.55) — the same factors used to load the
//     Base-Gross forecast into Projections.
//   • Period toggle: Monthly / Quarterly / Half / Annual.
//   • ADCS on/off (default OFF — the exec view Mike asked for is ex-ADCS).
//   • % beat-vs-budget printed on top of each column.
//   • Forecast months (Aug–Dec) render lighter + inside a shaded band, so it's
//     obvious at a glance where we're forecasting vs where it's actuals.
// =============================================================================

import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Cell, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer,
} from "recharts";
import { CHANNEL_COLORS } from "@/lib/constants";

const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FC_FROM = 7; // Aug (0-based) → forecast
const FACTOR = { B2B: 0.92, DTC: 0.98, ADCS: 0.55 }; // net = gross × factor

// FY2026 NET, by channel. Result = actual (Jan–Jul) then forecast (Aug–Dec).
const RES = {
  B2B:  [548578, 1055638, 820000, 983761, 1033130, 1211000, 1110182, 1300000, 1500000, 1600000, 1700000, 2000000],
  DTC:  [0, 0, 0, 0, 98000, 196000, 294000, 392000, 441000, 490000, 539000, 588000],
  ADCS: [66825, 66825, 80190, 80190, 80190, 80190, 80190, 125000, 125000, 125000, 125000, 125000],
};
const BUD = {
  B2B:  [494861, 543060, 716445, 828474, 915072, 1006331, 1106205, 1200775, 1362558, 1477490, 1558682, 1661734],
  DTC:  [0, 0, 0, 0, 78400, 127792, 127792, 200704, 237748, 269804, 327327, 442176],
  ADCS: [66825, 66825, 80190, 80190, 80190, 80190, 80190, 80190, 80190, 80190, 80190, 80190],
};
// Net → Gross: divide each channel's net by its factor.
const grossify = (obj) =>
  Object.fromEntries(Object.entries(obj).map(([ch, arr]) => [ch, arr.map((n) => (FACTOR[ch] ? n / FACTOR[ch] : n))]));

const VIEWS = [
  { k: "month", l: "Monthly", buckets: M.map((m, i) => ({ label: m, months: [i] })) },
  { k: "qtr", l: "Quarterly", buckets: [
    { label: "Q1", months: [0, 1, 2] }, { label: "Q2", months: [3, 4, 5] },
    { label: "Q3", months: [6, 7, 8] }, { label: "Q4", months: [9, 10, 11] }] },
  { k: "half", l: "Half", buckets: [
    { label: "H1", months: [0, 1, 2, 3, 4, 5] }, { label: "H2", months: [6, 7, 8, 9, 10, 11] }] },
  { k: "year", l: "Annual", buckets: [{ label: "FY2026", months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }] },
];

const sum = (arr, idxs) => idxs.reduce((a, i) => a + (arr[i] || 0), 0);
const usdShort = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n ? `$${Math.round(n / 1e3)}K` : "$0");
const usdFull = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

// % beat-vs-budget, printed above each column. Closes over the current rows so it
// can read the bucket totals by index. Green when ahead of budget, red when behind.
const pctLabel = (rows) => (props) => {
  const { x, y, width, index } = props;
  const row = rows[index];
  if (!row || !row.__bud) return null;
  const pct = ((row.__res - row.__bud) / row.__bud) * 100;
  const txt = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return (
    <text
      x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={10.5} fontWeight={700}
      fill={pct >= 0 ? "var(--favorable)" : "var(--unfavorable)"}
      stroke="var(--card)" strokeWidth={3} style={{ paintOrder: "stroke" }}
    >
      {txt}
    </text>
  );
};

export default function ForecastVsBudget() {
  const [view, setView] = useState("month");
  const [basis, setBasis] = useState("net");   // 'net' | 'gross'
  const [showAdcs, setShowAdcs] = useState(false);

  const channels = showAdcs ? ["B2B", "DTC", "ADCS"] : ["B2B", "DTC"];
  const V = VIEWS.find((v) => v.k === view);
  const basisLabel = basis === "gross" ? "Gross" : "Net";

  const rows = useMemo(() => {
    const RS = basis === "gross" ? grossify(RES) : RES;
    const BD = basis === "gross" ? grossify(BUD) : BUD;
    return V.buckets.map((b) => {
      const row = { label: b.label };
      let res = 0, bud = 0;
      for (const ch of channels) {
        const r = sum(RS[ch], b.months); row[ch] = r; res += r;
        bud += sum(BD[ch], b.months);
      }
      row.__res = res; row.__bud = bud;
      const fc = b.months.filter((i) => i >= FC_FROM).length;
      row.__fc = fc === b.months.length ? "full" : fc > 0 ? "partial" : "none";
      return row;
    });
  }, [view, showAdcs, basis]);

  // First bucket that contains ANY forecast month → where the shaded band starts.
  const fcFirst = rows.findIndex((r) => r.__fc !== "none");
  const totRes = rows.reduce((a, r) => a + r.__res, 0);
  const totBud = rows.reduce((a, r) => a + r.__bud, 0);
  const dl = totRes - totBud;
  const lastCh = channels[channels.length - 1];

  const btn = (active) =>
    `px-2.5 py-1 rounded-md text-xs font-semibold transition ${active ? "bg-brown text-ink border border-brown" : "text-inksoft border border-rule hover:text-ink"}`;

  return (
    <div className="rounded-xl border border-rule bg-card p-4 md:p-5 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="font-serif text-lg md:text-xl font-semibold text-ink leading-tight">Result vs Budget — {basisLabel} Revenue</h3>
          <p className="text-[11.5px] text-muted mt-0.5">
            Actuals Jan–Jul → Forecast Aug–Dec (lighter + shaded), vs Budget (line). {showAdcs ? "B2B + DTC + ADCS" : "B2B + DTC · ex-ADCS"} · % = beat vs budget.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            <button type="button" className={btn(basis === "net")} onClick={() => setBasis("net")}>Net</button>
            <button type="button" className={btn(basis === "gross")} onClick={() => setBasis("gross")}>Gross</button>
          </div>
          <div className="flex gap-1">{VIEWS.map((v) => (
            <button key={v.k} type="button" className={btn(view === v.k)} onClick={() => setView(v.k)}>{v.l}</button>
          ))}</div>
          <label className="text-xs text-inksoft flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showAdcs} onChange={(e) => setShowAdcs(e.target.checked)} /> ADCS
          </label>
        </div>
      </div>

      <div className="text-xs text-muted mb-2">
        {V.l} · {basisLabel} · Result <b className="text-ink">{usdFull(totRes)}</b> vs Budget <b className="text-ink">{usdFull(totBud)}</b>
        <span style={{ color: dl >= 0 ? "var(--favorable)" : "var(--unfavorable)" }}> · {dl >= 0 ? "+" : ""}{usdFull(dl)} ({((dl / totBud) * 100).toFixed(1)}%)</span>
      </div>

      <div style={{ width: "100%", height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 20, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" strokeOpacity={0.6} />
            {view !== "year" && fcFirst >= 0 && (
              <ReferenceArea
                x1={rows[fcFirst].label} x2={rows[rows.length - 1].label} fill="var(--brown)" fillOpacity={0.06}
                label={{ value: "Forecast", position: "insideTopLeft", fontSize: 10, fill: "var(--tan)", offset: 6 }}
              />
            )}
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--inksoft)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
            <YAxis tickFormatter={usdShort} tick={{ fontSize: 10.5, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={46} />
            <Tooltip cursor={{ fill: "var(--brown)", fillOpacity: 0.06 }} content={<TipBox channels={channels} basisLabel={basisLabel} />} />
            {channels.map((ch, ci) => (
              <Bar key={ch} dataKey={ch} stackId="res" maxBarSize={54}
                radius={ci === channels.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false}>
                {rows.map((r, i) => (
                  <Cell key={i} fill={CHANNEL_COLORS[ch]} fillOpacity={r.__fc !== "none" ? 0.5 : 1} />
                ))}
                {ci === channels.length - 1 && <LabelList content={pctLabel(rows)} />}
              </Bar>
            ))}
            <Line type="monotone" dataKey="__bud" name="Budget" stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4"
              isAnimationActive={false} dot={{ r: 3, fill: "var(--card)", stroke: "var(--ink)", strokeWidth: 1.5 }} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-2 text-[11px] text-muted">
        {channels.map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1.5">
            <span style={{ width: 11, height: 11, borderRadius: 3, background: CHANNEL_COLORS[ch], display: "inline-block" }} /> {ch} result
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 16, height: 0, borderTop: "2px dashed var(--ink)", display: "inline-block" }} /> Budget
        </span>
        <span className="text-tan">▨ Lighter bars = forecast (Aug–Dec)</span>
      </div>
    </div>
  );
}

function TipBox({ active, payload, label, channels, basisLabel }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const res = row.__res || 0, bud = row.__bud || 0, dl = res - bud;
  const pct = bud ? (dl / bud) * 100 : 0;
  return (
    <div className="rounded-lg border border-rule bg-card px-3 py-2 text-xs shadow-lg" style={{ minWidth: 178 }}>
      <div className="font-serif font-semibold text-ink mb-1">
        {label} · {basisLabel}{row.__fc === "full" ? " · Forecast" : row.__fc === "partial" ? " · incl. forecast" : ""}
      </div>
      {channels.map((ch) => (
        <div key={ch} className="flex justify-between gap-4 text-muted"><span>{ch}</span><span className="text-ink font-semibold">{usdFull(row[ch] || 0)}</span></div>
      ))}
      <div className="flex justify-between gap-4 border-t border-rule mt-1.5 pt-1"><span className="text-muted">Result</span><span className="text-ink font-semibold">{usdFull(res)}</span></div>
      <div className="flex justify-between gap-4 text-muted"><span>Budget</span><span className="text-ink font-semibold">{usdFull(bud)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted">Δ vs budget</span>
        <span style={{ color: dl >= 0 ? "var(--favorable)" : "var(--unfavorable)", fontWeight: 600 }}>{dl >= 0 ? "+" : ""}{usdFull(dl)} ({pct >= 0 ? "+" : ""}{pct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}
