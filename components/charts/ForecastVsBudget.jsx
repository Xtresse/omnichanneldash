"use client";

// =============================================================================
// ACTUAL + FORECAST vs BUDGET — revenue by channel vs the board plan.
//
//   • JAN–JUL ARE LOCKED (closed / actualized — these months are done and will
//     not move). Values below are the real per-channel actuals that tie to the
//     "Total Sales by Channel" cards (Shopify monthlySeries as of 2026-08-18).
//     When a new month closes, append its actuals here and bump FC_FROM.
//   • AUG–DEC = forecast (the Base-Gross forecast loaded into Projections).
//   • BUDGET = board financial model "Budget — Master P&L" (Monthly Pro Forma),
//     gross-to-net as the model computes it. Ties to FY2026: Gross $18,679,442 →
//     Net $16,959,470. Split B2B / DTC / ADCS.
//   • Layout: "By channel" (grouped B2B|DTC|ADCS bars, each with a dashed budget
//     tick so the beat is visible) or "Combined" (stacked, total vs budget line).
//   • Net ⇄ Gross · Monthly / Quarterly / Half / Full Year · ADCS on/off.
// =============================================================================

import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Cell, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ResponsiveContainer,
} from "recharts";
import { CHANNEL_COLORS } from "@/lib/constants";

const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FC_FROM = 7; // Aug — first forecast month. Jan–Jul (0–6) are locked actuals.
const FACTOR = { B2B: 0.92, DTC: 0.98, ADCS: 0.55 }; // forecast gross = net ÷ factor
const CHS = ["B2B", "DTC", "ADCS"];

// ---- LOCKED ACTUALS (Jan–Jul), real per-channel, tie to the channel cards.
const ACT_NET = {
  B2B:  [417454, 1069243, 1047481, 1000440, 1037857, 1209157, 1103467],
  DTC:  [0, 70, 835, 36129, 174126, 247816, 317831],
  ADCS: [0, 68040, 150060, 13260, 110040, 122760, 229998],
};
const ACT_GROSS = {
  B2B:  [467438, 1147355, 1148477, 1069830, 1122968, 1316303, 1206721],
  DTC:  [0, 78, 858, 36210, 175495, 250998, 322708],
  ADCS: [0, 121500, 269250, 22740, 195420, 216293, 371930],
};
// ---- FORECAST (net), Aug–Dec — Base-Gross forecast. Jan–Jul slots = 0 (unused).
const FCAST_NET = {
  B2B:  [0, 0, 0, 0, 0, 0, 0, 1300000, 1500000, 1600000, 1700000, 2000000],
  DTC:  [0, 0, 0, 0, 0, 0, 0, 392000, 441000, 490000, 539000, 588000],
  ADCS: [0, 0, 0, 0, 0, 0, 0, 125000, 125000, 125000, 125000, 125000],
};
// ---- BUDGET (board model). NET by channel. FY: B2B 13.80M · DTC 1.85M · ADCS 1.31M → 16.96M.
const BUD_NET = {
  B2B:  [530194, 581887, 767379, 887731, 980429, 1078942, 1185924, 1287675, 1460588, 1584112, 1671456, 1781912],
  DTC:  [0, 0, 0, 0, 80000, 130400, 130400, 204800, 242600, 275310, 334008, 451200],
  ADCS: [90720, 90720, 111942, 118292, 118292, 118293, 110711, 110711, 110711, 110711, 110710, 110711],
};
const S2_GROSS = [704131, 760936, 982181, 1122176, 1223242, 1330648, 1447288, 1558225, 1746747, 1881422, 1976651, 2097079];
const BUD_GROSS = {
  B2B:  BUD_NET.B2B.map((n, i) => (S2_GROSS[i] * n) / (BUD_NET.B2B[i] + BUD_NET.ADCS[i])),
  DTC:  BUD_NET.DTC.slice(),
  ADCS: BUD_NET.ADCS.map((n, i) => (S2_GROSS[i] * n) / (BUD_NET.B2B[i] + BUD_NET.ADCS[i])),
};

// Result per channel (12): locked actual Jan–Jul, forecast Aug–Dec.
const RES_NET = {}, RES_GROSS = {};
for (const ch of CHS) {
  RES_NET[ch] = Array.from({ length: 12 }, (_, i) => (i < FC_FROM ? ACT_NET[ch][i] : FCAST_NET[ch][i]));
  RES_GROSS[ch] = Array.from({ length: 12 }, (_, i) => (i < FC_FROM ? ACT_GROSS[ch][i] : (FACTOR[ch] ? FCAST_NET[ch][i] / FACTOR[ch] : FCAST_NET[ch][i])));
}

const VIEWS = [
  { k: "month", l: "Monthly", buckets: M.map((m, i) => ({ label: m, months: [i] })) },
  { k: "qtr", l: "Quarterly", buckets: [
    { label: "Q1", months: [0, 1, 2] }, { label: "Q2", months: [3, 4, 5] },
    { label: "Q3", months: [6, 7, 8] }, { label: "Q4", months: [9, 10, 11] }] },
  { k: "half", l: "Half", buckets: [
    { label: "H1", months: [0, 1, 2, 3, 4, 5] }, { label: "H2", months: [6, 7, 8, 9, 10, 11] }] },
  { k: "year", l: "Full Year", buckets: [{ label: "FY2026", months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }] },
];

const sum = (arr, idxs) => idxs.reduce((a, i) => a + (arr[i] || 0), 0);
const usdShort = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n ? `$${Math.round(n / 1e3)}K` : "$0");
const usdFull = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const k000 = (n) => (Math.round(n) === 0 ? "—" : `$${Math.round(n / 1000).toLocaleString("en-US")}`);
const phaseWord = (fc) => (fc === "full" ? "Forecast" : fc === "none" ? "Actual" : "Actual + forecast");
const pctStr = (res, bud) => (bud ? `${res - bud >= 0 ? "+" : ""}${(((res - bud) / bud) * 100).toFixed(0)}%` : "—");

// Grouped-bar shape: result rect + a dashed budget tick across the bar, so the gap
// between the bar top and the tick = how much we beat (or missed) plan.
function ResultBar(props) {
  const { x, y, width, height, payload, ch } = props;
  const res = payload[ch] || 0, bud = payload[`${ch}__bud`] || 0;
  const isFc = payload.__fc !== "none";
  let markY = null;
  if (res > 0 && bud > 0 && height > 0) markY = y + (height * (res - bud)) / res;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={CHANNEL_COLORS[ch]} fillOpacity={isFc ? 0.5 : 1} />
      {markY != null && markY >= y - 40 && (
        <line x1={x - 1.5} x2={x + width + 1.5} y1={markY} y2={markY} stroke="#fff" strokeOpacity={0.9} strokeWidth={2} strokeDasharray="3 2" />
      )}
    </g>
  );
}

const pctLabelCh = (rows, ch) => (props) => {
  const { x, y, width, index } = props;
  const row = rows[index];
  if (!row) return null;
  const res = row[ch] || 0, bud = row[`${ch}__bud`] || 0;
  if (!bud || !res) return null;
  const pct = ((res - bud) / bud) * 100;
  return (
    <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={9} fontWeight={700}
      fill={pct >= 0 ? "var(--favorable)" : "var(--unfavorable)"} stroke="var(--card)" strokeWidth={2.5} style={{ paintOrder: "stroke" }}>
      {`${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
    </text>
  );
};

const pctLabelTotal = (rows) => (props) => {
  const { x, y, width, index } = props;
  const row = rows[index];
  if (!row || !row.__bud) return null;
  const pct = ((row.__res - row.__bud) / row.__bud) * 100;
  return (
    <text x={x + width / 2} y={y - 7} textAnchor="middle" fontSize={10.5} fontWeight={700}
      fill={pct >= 0 ? "var(--favorable)" : "var(--unfavorable)"} stroke="var(--card)" strokeWidth={3} style={{ paintOrder: "stroke" }}>
      {`${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
    </text>
  );
};

export default function ForecastVsBudget() {
  const [view, setView] = useState("month");
  const [basis, setBasis] = useState("net");
  const [layout, setLayout] = useState("channel"); // 'channel' (grouped) | 'combined' (stacked)
  const [showAdcs, setShowAdcs] = useState(false);

  const channels = showAdcs ? ["B2B", "DTC", "ADCS"] : ["B2B", "DTC"];
  const V = VIEWS.find((v) => v.k === view);
  const basisLabel = basis === "gross" ? "Gross" : "Net";
  const grouped = layout === "channel";

  const rows = useMemo(() => {
    const RS = basis === "gross" ? RES_GROSS : RES_NET;
    const BD = basis === "gross" ? BUD_GROSS : BUD_NET;
    return V.buckets.map((b) => {
      const mAct = b.months.filter((i) => i < FC_FROM), mFc = b.months.filter((i) => i >= FC_FROM);
      const row = { label: b.label };
      let res = 0, bud = 0, act = 0, fcst = 0;
      for (const ch of channels) {
        const cres = sum(RS[ch], b.months), cbud = sum(BD[ch], b.months);
        row[ch] = cres; row[`${ch}__bud`] = cbud;
        res += cres; bud += cbud;
        act += sum(RS[ch], mAct); fcst += sum(RS[ch], mFc);
      }
      row.__res = res; row.__bud = bud; row.__act = act; row.__fcst = fcst;
      row.__fc = mFc.length === b.months.length ? "full" : mFc.length > 0 ? "partial" : "none";
      return row;
    });
  }, [view, showAdcs, basis]);

  const fcFirst = rows.findIndex((r) => r.__fc !== "none");
  const lastAct = fcFirst < 0 ? rows.length - 1 : fcFirst - 1;
  const totRes = rows.reduce((a, r) => a + r.__res, 0);
  const totBud = rows.reduce((a, r) => a + r.__bud, 0);
  const dl = totRes - totBud;
  const anyFc = rows.some((r) => r.__fc !== "none"), anyAct = rows.some((r) => r.__fc !== "full");
  const overallWord = anyFc && anyAct ? "Actual + Forecast" : anyFc ? "Forecast" : "Actual";

  const btn = (active) =>
    `px-2.5 py-1 rounded-md text-xs font-semibold transition ${active ? "bg-brown text-ink border border-brown" : "text-inksoft border border-rule hover:text-ink"}`;

  return (
    <div className="rounded-xl border border-rule bg-card p-4 md:p-5 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="font-serif text-lg md:text-xl font-semibold text-ink leading-tight">Actual + Forecast vs Budget — {basisLabel} Revenue</h3>
          <p className="text-[11.5px] text-muted mt-0.5">
            Actuals Jan–Jul (locked) → Forecast Aug–Dec (lighter + shaded), vs board plan.
            {" "}{showAdcs ? "B2B + DTC + ADCS" : "B2B + DTC · ex-ADCS"} · {grouped ? "dashed tick = budget, % = beat vs budget" : "line = budget"}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            <button type="button" className={btn(grouped)} onClick={() => setLayout("channel")}>By channel</button>
            <button type="button" className={btn(!grouped)} onClick={() => setLayout("combined")}>Combined</button>
          </div>
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
        {V.l} · {basisLabel} · {overallWord} <b className="text-ink">{usdFull(totRes)}</b> vs Budget <b className="text-ink">{usdFull(totBud)}</b>
        <span style={{ color: dl >= 0 ? "var(--favorable)" : "var(--unfavorable)" }}> · {dl >= 0 ? "+" : ""}{usdFull(dl)} ({((dl / totBud) * 100).toFixed(1)}%)</span>
      </div>

      <div style={{ width: "100%", height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 22, right: 8, bottom: 4, left: 4 }} barCategoryGap={grouped ? "16%" : "22%"} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--rule)" strokeOpacity={0.6} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--inksoft)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
            <YAxis tickFormatter={usdShort} tick={{ fontSize: 10.5, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={46} />
            {view !== "year" && fcFirst > 0 && (
              <ReferenceArea x1={rows[0].label} x2={rows[lastAct].label} fill="transparent"
                label={{ value: "Actuals (locked)", position: "insideTopLeft", fontSize: 10, fill: "var(--muted)", offset: 6 }} />
            )}
            {view !== "year" && fcFirst >= 0 && (
              <ReferenceArea x1={rows[fcFirst].label} x2={rows[rows.length - 1].label} ifOverflow="visible"
                fill="var(--brown)" fillOpacity={0.06}
                label={{ value: "Forecast", position: "insideTopRight", fontSize: 10, fill: "var(--tan)", offset: 6 }} />
            )}
            <Tooltip cursor={{ fill: "var(--brown)", fillOpacity: 0.06 }} content={<TipBox channels={channels} basisLabel={basisLabel} grouped={grouped} />} />

            {grouped
              ? channels.map((ch) => (
                  <Bar key={ch} dataKey={ch} maxBarSize={30} shape={(p) => <ResultBar {...p} ch={ch} />}>
                    <LabelList content={pctLabelCh(rows, ch)} />
                  </Bar>
                ))
              : channels.map((ch, ci) => (
                  <Bar key={ch} dataKey={ch} stackId="res" maxBarSize={54}
                    radius={ci === channels.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false}>
                    {rows.map((r, i) => <Cell key={i} fill={CHANNEL_COLORS[ch]} fillOpacity={r.__fc !== "none" ? 0.5 : 1} />)}
                    {ci === channels.length - 1 && <LabelList content={pctLabelTotal(rows)} />}
                  </Bar>
                ))}

            {!grouped && (
              <Line type="monotone" dataKey="__bud" name="Budget" stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4"
                isAnimationActive={false} dot={{ r: 3, fill: "var(--card)", stroke: "var(--ink)", strokeWidth: 1.5 }} activeDot={{ r: 4 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-2 text-[11px] text-muted">
        {channels.map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1.5">
            <span style={{ width: 11, height: 11, borderRadius: 3, background: CHANNEL_COLORS[ch], display: "inline-block" }} /> {ch}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 16, height: 0, borderTop: `2px dashed ${grouped ? "#999" : "var(--ink)"}`, display: "inline-block" }} /> Budget (board plan)
        </span>
        <span className="text-tan">▨ Lighter = forecast</span>
      </div>

      <PeriodTable rows={rows} />
    </div>
  );
}

function TipBox({ active, payload, label, channels, basisLabel, grouped }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const res = row.__res || 0, bud = row.__bud || 0, dl = res - bud;
  return (
    <div className="rounded-lg border border-rule bg-card px-3 py-2 text-xs shadow-lg" style={{ minWidth: grouped ? 208 : 178 }}>
      <div className="font-serif font-semibold text-ink mb-1">{label} · {basisLabel}{row.__fc === "full" ? " · Forecast" : row.__fc === "partial" ? " · incl. forecast" : ""}</div>
      {channels.map((ch) => {
        const cr = row[ch] || 0, cb = row[`${ch}__bud`] || 0;
        return (
          <div key={ch} className="flex justify-between gap-3 text-muted">
            <span>{ch}</span>
            <span className="text-ink font-semibold">{usdFull(cr)}{grouped ? <span style={{ color: cr - cb >= 0 ? "var(--favorable)" : "var(--unfavorable)", fontWeight: 600 }}>{"  "}{pctStr(cr, cb)}</span> : null}</span>
          </div>
        );
      })}
      <div className="flex justify-between gap-3 border-t border-rule mt-1.5 pt-1"><span className="text-muted">{phaseWord(row.__fc)}</span><span className="text-ink font-semibold">{usdFull(res)}</span></div>
      <div className="flex justify-between gap-3 text-muted"><span>Budget</span><span className="text-ink font-semibold">{usdFull(bud)}</span></div>
      <div className="flex justify-between gap-3"><span className="text-muted">Δ vs budget</span>
        <span style={{ color: dl >= 0 ? "var(--favorable)" : "var(--unfavorable)", fontWeight: 600 }}>{dl >= 0 ? "+" : ""}{usdFull(dl)} ({pctStr(res, bud)})</span>
      </div>
    </div>
  );
}

function PeriodTable({ rows }) {
  const cell = "px-2 py-1 text-right whitespace-nowrap tabular-nums";
  const lbl = "px-2 py-1 text-left sticky left-0 bg-card";
  const isFc = (r) => r.__fc !== "none";
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="text-[11px]" style={{ borderCollapse: "collapse", width: "100%", minWidth: (rows.length + 1) * 66 }}>
        <thead>
          <tr className="text-muted">
            <th className={`${lbl} font-semibold`}>$ in thousands</th>
            {rows.map((r) => (
              <th key={r.label} className={`${cell} font-semibold`} style={isFc(r) ? { color: "var(--tan)" } : undefined}>{r.label}{isFc(r) ? " ƒ" : ""}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink">
          <tr className="border-t border-rule/60"><td className={`${lbl} text-muted`}>Actual</td>{rows.map((r) => <td key={r.label} className={cell}>{k000(r.__act)}</td>)}</tr>
          <tr><td className={`${lbl} text-muted`}>Forecast</td>{rows.map((r) => <td key={r.label} className={cell} style={{ color: "var(--inksoft)" }}>{k000(r.__fcst)}</td>)}</tr>
          <tr className="border-t border-rule/60 font-semibold"><td className={lbl}>Total</td>{rows.map((r) => <td key={r.label} className={cell}>{k000(r.__res)}</td>)}</tr>
          <tr><td className={`${lbl} text-muted`}>Budget</td>{rows.map((r) => <td key={r.label} className={cell}>{k000(r.__bud)}</td>)}</tr>
          <tr className="border-t border-rule/60"><td className={`${lbl} text-muted`}>Δ vs budget</td>{rows.map((r) => {
            const p = r.__bud ? ((r.__res - r.__bud) / r.__bud) * 100 : null;
            return <td key={r.label} className={cell} style={{ color: p == null ? "var(--muted)" : p >= 0 ? "var(--favorable)" : "var(--unfavorable)", fontWeight: 600 }}>{p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`}</td>;
          })}</tr>
        </tbody>
      </table>
      <p className="text-[10px] text-tan mt-1">ƒ = forecast period · Jan–Jul locked (actualized)</p>
    </div>
  );
}
