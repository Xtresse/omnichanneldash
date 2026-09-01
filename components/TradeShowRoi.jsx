"use client";

// =============================================================================
// TRADE SHOW ROI — booth spend vs the B2B revenue each show actually produced.
//
// Reads the pre-computed data/tradeshow-roi.json (regenerated from live Shopify
// by scripts/tradeshow-roi.mjs). A clinic counts as "won" if it ordered with
// the show's booth discount code OR was a scanned badge lead that became a new
// B2B customer after the show. Revenue = post-show B2B. Booth cost = the actual
// 2026 show spend (booth + travel).
//
//   • Headline tiles: clinics won, B2B revenue, blended ROI — COMPLETED shows
//     only (status ≠ upcoming/unmapped, cost present) so future booths don't
//     drag the number; plus "$ spent → $ won".
//   • ROI-by-show bar chart (horizontal, sorted, colored by status, 1.0× break-
//     even reference line, direct ROI labels).
//   • Per-show expandable cards sorted by ROI, with the converted-clinic detail.
//
// Design system: same --* tokens the rest of omni uses (globals.css). Status
// colors are resolved at runtime from the CSS variables so the chart is dark-
// mode aware (the tokens flip under prefers-color-scheme:dark).
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from "recharts";
import { ChartShell } from "./charts/_shared.js";
import roiData from "@/data/tradeshow-roi.json";

// ---- formatters -------------------------------------------------------------
// Whole-dollar display (drop cents — floor, so quoted figures tie exactly:
// 40950.75 → $40,950, 160335.15 → $160,335).
const usd = (n) => `$${Math.floor(Number(n) || 0).toLocaleString("en-US")}`;
const usdShort = (n) => {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n || 0)}`;
};
// roi.json stores its own natural precision (15.5, 6.28, 4.8, 0) — echo it.
const roiText = (r) => (r == null ? "—" : `${r}×`);
const pctText = (p) => (p == null ? "—" : `${p}%`);
const intText = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// Strip the parenthetical long-form so axis labels stay short.
const shortName = (name) => String(name || "").replace(/\s*\(.*?\)\s*/g, "").trim();

// Generic mail hosts — when a clinic's "company" is only its email domain we
// show the email instead (a real practice name is more useful than "gmail.com").
const GENERIC_HOSTS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "msn.com", "live.com", "aol.com",
  "icloud.com", "outlook.com", "me.com", "comcast.net",
]);
function clinicLabel(c) {
  const company = String(c.company || "").trim();
  const email = String(c.email || "").trim();
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (!company) return { primary: email, secondary: null };
  if (company.toLowerCase() === domain || GENERIC_HOSTS.has(company.toLowerCase())) {
    return { primary: email, secondary: null };
  }
  return { primary: company, secondary: email };
}

// ---- status → token + label -------------------------------------------------
// tok = the CSS-variable name whose resolved rgb we paint with.
const STATUS = {
  strong:   { tok: "favorable",   label: "Strong",    chip: "≥ 2× return" },
  ok:       { tok: "partial",     label: "OK",        chip: "above break-even" },
  weak:     { tok: "unfavorable", label: "Weak",      chip: "below break-even" },
  none:     { tok: "unfavorable", label: "No wins",   chip: "no converts yet" },
  maturing: { tok: "neutral",     label: "Maturing",  chip: "recent · still converting" },
  upcoming: { tok: "neutral",     label: "Upcoming",  chip: "booked · not yet run" },
  unmapped: { tok: "neutral",     label: "Unmapped",  chip: "show TBD" },
};
const statusOf = (s) => STATUS[s] || STATUS.unmapped;

// ---- dark-mode-aware token resolution --------------------------------------
// The status/brand hues live as space-separated rgb triplets in globals.css and
// flip under prefers-color-scheme:dark. We read the computed values so Recharts
// SVG fills get concrete rgb() strings that are correct in both themes. Light
// fallbacks keep SSR / first paint sane before the effect runs.
const TOKEN_KEYS = ["favorable", "partial", "unfavorable", "neutral", "brown", "ink", "inksoft", "muted", "tan", "card", "rule", "grid", "b2b"];
const LIGHT = {
  favorable: "rgb(92 138 111)", partial: "rgb(197 138 45)", unfavorable: "rgb(92 47 46)",
  neutral: "rgb(154 143 128)", brown: "rgb(240 146 46)", ink: "rgb(43 26 16)",
  inksoft: "rgb(90 66 50)", muted: "rgb(138 115 89)", tan: "rgb(168 148 120)",
  card: "rgb(255 255 255)", rule: "rgb(212 208 200)", grid: "rgb(216 202 178)", b2b: "rgb(240 146 46)",
};
function useTokens() {
  const [t, setT] = useState(LIGHT);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      for (const k of TOKEN_KEYS) {
        const v = cs.getPropertyValue(`--${k}`).trim();
        out[k] = v ? `rgb(${v})` : LIGHT[k];
      }
      setT(out);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // Safari <14 uses addListener; guard for both.
    if (mq.addEventListener) mq.addEventListener("change", read);
    else mq.addListener(read);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", read);
      else mq.removeListener(read);
    };
  }, []);
  return t;
}

export default function TradeShowRoi({ embedded = false }) {
  const tok = useTokens();
  const [openKey, setOpenKey] = useState(null);

  const shows = roiData.shows || [];

  // Completed = has been run AND has a booth cost. Upcoming/unmapped are excluded
  // from every headline number so future spend never drags the ROI.
  const completed = useMemo(
    () => shows.filter((s) => s.status !== "upcoming" && s.status !== "unmapped" && s.cost != null),
    [shows]
  );

  const totals = useMemo(() => {
    const clinics = completed.reduce((a, s) => a + (s.converts || 0), 0);
    const revenue = completed.reduce((a, s) => a + (s.revenue || 0), 0);
    const cost = completed.reduce((a, s) => a + (s.cost || 0), 0);
    const leads = completed.reduce((a, s) => a + (s.leads || 0), 0);
    return { clinics, revenue, cost, leads, roi: cost ? revenue / cost : 0, shows: completed.length };
  }, [completed]);

  // Chart rows — completed shows keep roi-desc order from the file. Recharts
  // vertical layout draws the first row at the TOP, so the ranking reads down.
  const chartRows = useMemo(
    () => completed.map((s) => ({ ...s, short: shortName(s.name), tok: statusOf(s.status).tok })),
    [completed]
  );
  const maxRoi = Math.max(1, ...chartRows.map((r) => r.roi || 0));

  const tiles = [
    { label: "Clinics won", value: intText(totals.clinics), sub: `new B2B doors · ${totals.shows} shows run`, tone: "primary" },
    { label: "B2B revenue won", value: usd(totals.revenue), sub: "post-show, attributed", tone: "accent" },
    { label: "Blended ROI", value: `${totals.roi.toFixed(2)}×`, sub: "completed shows only", tone: "accent" },
    { label: "Booth spend", value: usd(totals.cost), sub: `→ ${usd(totals.revenue)} won`, tone: "muted" },
  ];

  return (
    <div className="font-sans">
      {/* ---- header (standalone only; the collapsible Section supplies the title when embedded) ---- */}
      {!embedded && (
      <div className="mb-4">
        <h2 className="font-serif text-2xl md:text-3xl font-semibold text-ink leading-none">Trade Show ROI</h2>
        <p className="text-xs md:text-sm text-muted mt-1">
          Booth spend vs the B2B revenue each show produced. A clinic is a win when it ordered with the show&rsquo;s
          booth code or a scanned lead became a new B2B customer after the show.
        </p>
      </div>
      )}

      {/* ---- headline tiles ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-5">
        {tiles.map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </div>

      {/* ---- ROI by show ---- */}
      <div className="rounded-xl border border-rule bg-card p-4 md:p-5 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h3 className="font-serif text-lg md:text-xl font-semibold text-ink leading-tight">Return on booth spend, by show</h3>
            <p className="text-[11.5px] text-muted mt-0.5">
              Revenue ÷ cost. The dashed line is break-even (1.0×) — bars to its right paid for the booth.
            </p>
          </div>
        </div>

        <ChartShell height="h-[420px] md:h-[460px]">
          <BarChart data={chartRows} layout="vertical" margin={{ top: 6, right: 44, left: 4, bottom: 4 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="var(--grid)" strokeOpacity={0.6} />
            <XAxis
              type="number"
              domain={[0, Math.ceil(maxRoi * 1.12)]}
              tickFormatter={(v) => `${v}×`}
              tick={{ fontSize: 10.5, fill: "var(--muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="short"
              width={128}
              interval={0}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine
              x={1}
              stroke={tok.ink}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
              label={{ value: "break-even", position: "top", fontSize: 10, fill: tok.muted }}
            />
            <Tooltip cursor={{ fill: "var(--brown)", fillOpacity: 0.06 }} content={<RoiTip />} />
            <Bar dataKey="roi" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
              {chartRows.map((r) => (
                <Cell key={r.key} fill={tok[r.tok]} />
              ))}
              <LabelList
                dataKey="roi"
                position="right"
                formatter={(v) => `${v}×`}
                style={{ fontSize: 11, fontWeight: 700, fill: tok.ink }}
              />
            </Bar>
          </BarChart>
        </ChartShell>

        {/* status legend — identity is never color-alone (labelled swatches) */}
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2 text-[11px] text-muted">
          {[
            { tok: "favorable", l: "Strong (≥ 2×)" },
            { tok: "partial", l: "OK (≥ 1×)" },
            { tok: "unfavorable", l: "Below break-even" },
            { tok: "neutral", l: "Maturing" },
          ].map((s) => (
            <span key={s.tok} className="inline-flex items-center gap-1.5">
              <span style={{ width: 11, height: 11, borderRadius: 3, background: tok[s.tok], display: "inline-block" }} />
              {s.l}
            </span>
          ))}
        </div>
      </div>

      {/* ---- per-show detail ---- */}
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-serif text-lg md:text-xl font-semibold text-ink leading-tight">Every show</h3>
          <span className="text-[11px] text-muted">Sorted by ROI · tap a row to see the clinics</span>
        </div>
        {shows.map((s) => (
          <ShowCard key={s.key} show={s} open={openKey === s.key} onToggle={() => setOpenKey(openKey === s.key ? null : s.key)} />
        ))}
      </div>

      {/* ---- methodology ---- */}
      <p className="text-[11px] text-muted mt-5 leading-relaxed max-w-3xl">
        <strong className="text-inksoft">Methodology.</strong> A clinic counts as converted if it ordered with the
        show&rsquo;s booth code <em>or</em> was a scanned lead that became a new B2B customer after the show. Revenue =
        post-show B2B. Booth costs are the actual 2026 show budget (booth + travel). Recent shows are still maturing, so
        their ROI will keep rising. Each clinic is credited to a single show. Upcoming booths are excluded from the
        headline ROI.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
function Tile({ label, value, sub, tone }) {
  const stripe = tone === "primary" ? "before:bg-brown" : tone === "accent" ? "before:bg-accent" : "before:bg-tan";
  return (
    <div
      className={`relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
        before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripe}`}
    >
      <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">{label}</div>
      <div className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold text-ink leading-tight mt-1.5 sm:mt-2 md:mt-3 break-words">
        {value}
      </div>
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1.5 leading-snug">{sub}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function ShowCard({ show, open, onToggle }) {
  const st = statusOf(show.status);
  const isUpcoming = show.status === "upcoming";
  const isUnmapped = show.status === "unmapped";
  const expandable = (show.clinics || []).length > 0;

  const roiColor =
    show.roi == null ? "var(--muted)"
      : show.status === "strong" ? "var(--favorable)"
      : show.status === "ok" ? "var(--partial)"
      : show.status === "maturing" ? "var(--neutral)"
      : "var(--unfavorable)";

  return (
    <div className="rounded-xl border border-rule bg-card overflow-hidden">
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={open}
        className={`w-full text-left px-4 py-3 md:px-5 md:py-3.5 flex flex-col gap-2 ${expandable ? "cursor-pointer hover:bg-paper2 transition" : "cursor-default"}`}
      >
        {/* title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {expandable && (
              <span className="text-muted text-xs shrink-0" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} aria-hidden>▸</span>
            )}
            <span className="font-serif text-[15px] md:text-base font-semibold text-ink truncate">{shortName(show.name)}</span>
            <span className="text-[11px] text-muted shrink-0">{show.dates}</span>
          </div>
          <StatusChip status={show.status} />
        </div>

        {/* metric strip */}
        {isUpcoming ? (
          <div className="flex items-center gap-4 text-[12px] text-muted">
            <Metric label="cost" value={usd(show.cost)} />
            <span className="text-inksoft">Booked · not yet run</span>
          </div>
        ) : isUnmapped ? (
          <div className="flex items-center gap-4 text-[12px] text-muted">
            <Metric label="leads" value={intText(show.leads)} />
            <span className="text-inksoft">Show TBD — leads not yet matched to a booth</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1.5 text-[12px]">
            <Metric label="leads" value={intText(show.leads)} />
            <Metric label="clinics" value={intText(show.converts)} />
            <Metric label="conv" value={pctText(show.convPct)} />
            <Metric label="revenue" value={usd(show.revenue)} />
            <Metric label="cost" value={usd(show.cost)} />
            <Metric label="ROI" value={roiText(show.roi)} valueStyle={{ color: roiColor, fontWeight: 700 }} />
          </div>
        )}

        {show.status === "maturing" && (
          <div className="text-[11px]" style={{ color: "var(--neutral)" }}>
            Recent show — still converting; ROI will keep rising.
          </div>
        )}
      </button>

      {/* expanded clinic list */}
      {open && expandable && (
        <div className="border-t border-rule bg-paper2/60 px-4 py-2.5 md:px-5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">
            {show.clinics.length} clinic{show.clinics.length === 1 ? "" : "s"} won
          </div>
          <ul className="divide-y divide-rule/60">
            {show.clinics.map((c, i) => {
              const { primary, secondary } = clinicLabel(c);
              return (
                <li key={c.email || i} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink truncate">{primary}</div>
                    {secondary && <div className="text-[11px] text-muted truncate">{secondary}</div>}
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    {c.rep ? <span className="text-[11px] text-inksoft hidden sm:inline">{c.rep}</span> : null}
                    <ScanChip viaCode={c.viaCode} />
                    <span className="text-[13px] tabular-nums text-ink font-semibold w-[72px] text-right">{usd(c.rev)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, valueStyle }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.12em] text-muted leading-none">{label}</div>
      <div className="text-[13px] tabular-nums text-ink mt-0.5" style={valueStyle}>{value}</div>
    </div>
  );
}

function StatusChip({ status }) {
  const st = statusOf(status);
  const color = `var(--${st.tok})`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap shrink-0"
      style={{ borderColor: color, color }}
      title={st.chip}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, display: "inline-block" }} />
      {st.label}
    </span>
  );
}

function ScanChip({ viaCode }) {
  // viaCode true = ordered via the booth discount code; false = scanned-lead match.
  return viaCode ? (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border border-brown text-brown" title="Ordered with the booth discount code">
      code
    </span>
  ) : (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border border-tan text-tan" title="Scanned lead that became a new B2B customer">
      scan
    </span>
  );
}

// Recharts tooltip — styled to match the paper card aesthetic.
function RoiTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const s = payload[0]?.payload;
  if (!s) return null;
  const st = statusOf(s.status);
  const row = (k, v) => (
    <div className="flex justify-between gap-4 text-muted">
      <span>{k}</span>
      <span className="text-ink font-semibold tabular-nums">{v}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-rule bg-card px-3 py-2 text-xs shadow-lg" style={{ minWidth: 190 }}>
      <div className="font-serif font-semibold text-ink mb-1 leading-tight">{s.name}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] mb-1.5" style={{ color: `var(--${st.tok})` }}>{st.label} · {s.dates}</div>
      {row("ROI", roiText(s.roi))}
      {row("Revenue", usd(s.revenue))}
      {row("Cost", usd(s.cost))}
      {row("Clinics won", intText(s.converts))}
      {s.leads != null && row("Leads · conv", `${intText(s.leads)} · ${pctText(s.convPct)}`)}
    </div>
  );
}
