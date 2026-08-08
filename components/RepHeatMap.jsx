"use client";

import { useEffect, useMemo, useState } from "react";
import { periodRange } from "@/lib/periodWindows.js";

/**
 * Rep daily heat map — rows = reps, columns = days (Scott Stepe via Sam,
 * 2026-08-08).
 *
 *   Net Sales   $ per rep per day. A blank/$0 weekday cell IS a zero-dollar
 *               selling day — the metric Scott is watching. Outlined so it
 *               reads as a deliberate signal rather than missing data.
 *   Ramp Spend  T&E per rep per day. Dark until Ramp is connected (see
 *               lib/ramp.js); rendered as an explicit "Connect Ramp" state
 *               rather than zeros, because zeros would be indistinguishable
 *               from "this rep spent nothing".
 *
 * Period follows the same MTD/QTD/YTD + Range control as the leaderboard, and
 * data comes from the precomputed /api/heatmap — never a per-request rebuild.
 */

const PERIODS = [
  { key: "mtd", label: "MTD", full: "Month To Date" },
  { key: "qtd", label: "QTD", full: "Quarter To Date" },
  { key: "ytd", label: "YTD", full: "Year To Date" },
  { key: "range", label: "Range", full: "Selected Date Range" },
];

const METRICS = [
  { key: "net", label: "Net Sales", unit: "currency" },
  { key: "spend", label: "Ramp Spend", unit: "currency" },
];

const fmt$ = (n) => {
  const v = Math.round(Math.abs(n || 0));
  return `${n < 0 ? "-" : ""}$${v.toLocaleString()}`;
};
const fmt$k = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
};
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const isWeekend = (d) => dow(d) === 0 || dow(d) === 6;
const dayNum = (d) => String(Number(d.slice(8, 10)));
const monthLabel = (d) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

// Brand ramp, cream → orange → espresso. Index 0 is the empty surface.
const RAMP = ["#FAF7F2", "#FBD9B3", "#F7B36B", "#F0922E", "#D8761B", "#A85F28", "#2B1A10"];

function cellColor(value, max) {
  if (!(value > 0) || !(max > 0)) return null;
  // sqrt so a handful of huge days don't flatten everything else to one tone.
  const t = Math.sqrt(value / max);
  const i = Math.min(RAMP.length - 1, Math.max(1, Math.ceil(t * (RAMP.length - 1))));
  return RAMP[i];
}

export default function RepHeatMap({ rangeFrom, rangeTo }) {
  const [period, setPeriod] = useState("mtd");
  const [metric, setMetric] = useState("net");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [cache, setCache] = useState({});

  // Never resolve a period during SSR — app/page.jsx is ISR-cached, so a
  // server-computed date bakes into stale HTML and breaks hydration. Same rule
  // as RepLeaderboard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const range =
    period === "range" ? [rangeFrom, rangeTo] : mounted ? periodRange(period) : null;
  const [from, to] = range || [];
  const key = from && to ? `${from}|${to}` : null;

  useEffect(() => {
    if (!key || cache[key]) return undefined;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams({ from, to });
    fetch(`/api/heatmap?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j?.ok) throw new Error(j?.error || "Load failed");
        setCache((p) => ({ ...p, [key]: j }));
      })
      .catch((e) => !cancelled && setErr(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key, from, to, cache]);

  useEffect(() => {
    if (key && cache[key]) setData(cache[key]);
  }, [key, cache]);

  const showing = key && cache[key] ? cache[key] : null;
  const busy = !mounted || (loading && !showing);
  const spendDark = showing && !showing.spend?.available;
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0];

  const rows = showing?.rows || [];
  const days = showing?.days || [];
  const max = metric === "net" ? showing?.maxNet : showing?.maxSpend;

  // Month boundaries for the column header ruler.
  const monthMarks = useMemo(() => {
    const marks = [];
    days.forEach((d, i) => {
      if (i === 0 || d.slice(0, 7) !== days[i - 1].slice(0, 7)) {
        marks.push({ i, label: monthLabel(d) });
      }
    });
    return marks;
  }, [days]);

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        net: a.net + r.totalNet,
        spend: a.spend + r.totalSpend,
        zero: a.zero + r.zeroDollarDays,
        flagged: a.flagged + (r.spendOnZeroDollarDays > 0 ? 1 : 0),
        spendOnZero: a.spendOnZero + r.spendOnZeroDollarDays,
      }),
      { net: 0, spend: 0, zero: 0, flagged: 0, spendOnZero: 0 }
    );
  }, [rows]);

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="bg-browndeep text-paper px-3 py-2.5 md:px-5 md:py-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
            Rep Daily Heat Map · {activeMetric.label}
          </h3>
          <div className="inline-flex rounded-lg overflow-hidden border border-paper/25 shrink-0">
            {PERIODS.map((p) => {
              if (p.key === "range" && !(rangeFrom && rangeTo)) return null;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPeriod(p.key)}
                  aria-pressed={period === p.key}
                  title={p.full}
                  className={`px-2.5 md:px-3 py-1 font-sans text-[10px] md:text-[11px] uppercase tracking-[0.12em] transition-colors ${
                    period === p.key
                      ? "bg-paper text-browndeep font-semibold"
                      : "text-paper/75 hover:text-paper hover:bg-paper/10"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="font-sans text-[9px] uppercase tracking-[0.18em] text-paper/50 mr-1">
              Show
            </span>
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                aria-pressed={metric === m.key}
                className={`px-2 py-0.5 rounded font-sans text-[10px] md:text-[11px] transition-colors ${
                  metric === m.key
                    ? "bg-brown text-ink font-semibold"
                    : "text-paper/70 hover:text-paper hover:bg-paper/10 border border-paper/20"
                }`}
              >
                {m.label}
                {m.key === "spend" && spendDark ? " ·" : ""}
              </button>
            ))}
          </div>
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] opacity-80 tabular-nums">
            {busy
              ? "Loading…"
              : `${rows.length} Reps · ${days.length} Days · ${totals.zero.toLocaleString()} Zero-Dollar Days`}
          </span>
        </div>
      </div>

      {busy ? (
        <div className="px-4 py-10 text-center font-sans text-sm text-muted">Loading heat map…</div>
      ) : err ? (
        <div className="px-4 py-6 text-center font-sans text-sm text-unfavorable">{err}</div>
      ) : !rows.length ? (
        <div className="px-4 py-6 text-center font-sans text-sm text-muted">
          No rep activity in this period.
        </div>
      ) : (
        <>
          {metric === "spend" && spendDark && (
            <div className="px-3 md:px-5 py-3 bg-paper2 border-b border-rule">
              <p className="font-sans text-[12px] md:text-[13px] text-ink font-semibold">
                Connect Ramp to populate spend
              </p>
              <p className="font-sans text-[11px] text-muted leading-snug mt-1">
                {showing.spend?.detail}
                {showing.spend?.reason === "missing-scope"
                  ? " Add transactions:read to the Ramp OAuth app, then set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET on this project."
                  : " Set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET on this project (and grant transactions:read on the Ramp OAuth app)."}
              </p>
              <p className="font-sans text-[11px] text-muted leading-snug mt-1">
                Showing an empty grid on purpose — zeros here would be
                indistinguishable from a rep who genuinely spent nothing.
              </p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="border-collapse" style={{ minWidth: "100%" }}>
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-10 bg-paper2 text-left py-1.5 px-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted"
                    style={{ minWidth: 150 }}
                  >
                    Rep
                  </th>
                  {days.map((d, i) => {
                    const mark = monthMarks.find((m) => m.i === i);
                    return (
                      <th
                        key={d}
                        title={d}
                        className={`py-1 px-0 font-sans text-[8px] font-normal ${
                          isWeekend(d) ? "text-muted/40" : "text-muted"
                        }`}
                        style={{ minWidth: 11, width: 11 }}
                      >
                        {mark ? (
                          <span className="block text-[8px] text-inksoft font-semibold">
                            {mark.label}
                          </span>
                        ) : dayNum(d) === "15" ? (
                          <span className="block text-[8px]">15</span>
                        ) : null}
                      </th>
                    );
                  })}
                  <th
                    className="sticky right-0 z-10 bg-paper2 text-right py-1.5 px-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted border-l border-rule"
                    style={{ minWidth: 170 }}
                  >
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const series = metric === "net" ? r.net : r.spend;
                  return (
                    <tr key={r.rep} className="border-t border-rule/40">
                      <td
                        className="sticky left-0 z-10 bg-card py-0.5 px-2 font-sans text-[11px] md:text-xs text-ink whitespace-nowrap"
                        title={`${r.rep} · ${r.territory || ""}`}
                      >
                        {r.rep}
                      </td>
                      {days.map((d, i) => {
                        const v = series[i] || 0;
                        const bg = cellColor(v, max);
                        const weekend = isWeekend(d);
                        // A weekday with no net sales is THE signal — outline it.
                        const zeroFlag = metric === "net" && !weekend && !(v > 0);
                        const spendNoSale =
                          metric === "spend" && !weekend && v > 0 && !(r.net[i] > 0);
                        return (
                          <td
                            key={d}
                            title={`${r.rep} · ${d}${weekend ? " (weekend)" : ""}\n${
                              metric === "net" ? "Net" : "Spend"
                            }: ${fmt$(v)}${
                              spendNoSale ? "\n⚠ spend on a zero-dollar selling day" : ""
                            }`}
                            style={{
                              backgroundColor: bg || (weekend ? "#F2EEE7" : "#FBFAF7"),
                              width: 11,
                              minWidth: 11,
                              height: 15,
                              boxShadow: spendNoSale
                                ? "inset 0 0 0 1.5px #5C2F2E"
                                : zeroFlag
                                  ? "inset 0 0 0 1px rgba(92,47,46,0.28)"
                                  : undefined,
                            }}
                          />
                        );
                      })}
                      <td className="sticky right-0 z-10 bg-card py-0.5 px-2 text-right whitespace-nowrap border-l border-rule">
                        <span className="font-display text-[12px] font-semibold text-ink tabular-nums">
                          {metric === "net" ? fmt$k(r.totalNet) : fmt$k(r.totalSpend)}
                        </span>
                        <span className="font-sans text-[10px] text-muted tabular-nums ml-2">
                          {r.zeroDollarDays}z
                        </span>
                        {r.spendOnZeroDollarDays > 0 && (
                          <span
                            className="font-sans text-[10px] tabular-nums ml-2"
                            style={{ color: "#5C2F2E" }}
                            title={`${fmt$(r.spendOnZeroDollarDays)} of T&E on ${r.zeroDollarSpendDays} zero-dollar selling day(s)`}
                          >
                            ⚠ {fmt$k(r.spendOnZeroDollarDays)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-paper2 border-t border-rule px-3 md:px-5 py-2 space-y-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.16em] text-muted">
                {showing.from} – {showing.to} · {totals.zero.toLocaleString()} Zero-Dollar
                Weekdays{spendDark ? "" : ` · ${fmt$(totals.spend)} T&E`}
                {!spendDark && totals.flagged > 0
                  ? ` · ${totals.flagged} Reps Spending On Zero-Dollar Days (${fmt$(totals.spendOnZero)})`
                  : ""}
              </span>
              <span className="flex items-center gap-1">
                <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-muted mr-1">
                  Low
                </span>
                {RAMP.slice(1).map((c) => (
                  <span key={c} className="inline-block w-4 h-2.5 rounded-[1px]" style={{ backgroundColor: c }} />
                ))}
                <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-muted ml-1">
                  High
                </span>
              </span>
            </div>
            <p className="font-sans text-[10px] md:text-[11px] leading-snug text-muted">
              Rows are reps, columns are days (Pacific). Weekends are shaded and
              excluded from zero-dollar counts. A faint outline marks a weekday
              with no net sales — the zero-dollar selling day. A solid maroon
              outline marks T&amp;E spend on such a day, and{" "}
              <span style={{ color: "#5C2F2E" }}>⚠</span> in the summary totals
              that spend per rep. Net sales use the same order-tag rep
              attribution as the rest of the dashboard. Reps with no sales in
              the window still get a row — an empty row is the signal.
            </p>
            <p className="font-sans text-[10px] leading-snug text-muted/80">
              Row totals are the sum of whole-dollar daily cells, so they can
              read $1–2 below the Rep Leaderboard for the same window, which
              rounds once at the end. Same underlying figures.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
