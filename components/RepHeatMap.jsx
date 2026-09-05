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
const dowInitial = (d) => ["S", "M", "T", "W", "T", "F", "S"][dow(d)];
const longDate = (d) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });

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
  // Clicked cell -> { rep, i }. Drives the detail readout in the header, so
  // you can interrogate a day without hunting for a tooltip (Sam, 2026-08-09).
  const [sel, setSel] = useState(null);
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

  // A day index means nothing once the window moves, so drop the selection.
  useEffect(() => { setSel(null); }, [key]);

  const showing = key && cache[key] ? cache[key] : null;
  const busy = !mounted || (loading && !showing);
  const spendDark = showing && !showing.spend?.available;
  const activeMetric = METRICS.find((m) => m.key === metric) || METRICS[0];

  const rows = showing?.rows || [];
  const days = showing?.days || [];
  // Today is in progress, so its cell isn't a "zero-dollar day" yet — don't
  // outline it as one (matches the server's zeroDollarDays count). Far-future
  // fallback so an older payload without `today` still counts every day.
  const today = showing?.today || "9999-12-31";
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

  // Cell width scales with the window. Short periods get columns wide enough to
  // carry a readable date label; long ones shrink and scroll.
  const cellW =
    days.length <= 7 ? 44 : days.length <= 14 ? 34 : days.length <= 31 ? 24 : days.length <= 45 ? 18 : days.length <= 120 ? 13 : 10;
  // Per-day numbers only fit above a certain width; below it fall back to
  // month markers so the ruler stays legible instead of turning to mush.
  const showEveryDay = cellW >= 18;
  // Only pin the Rep/Summary columns when the grid actually overflows. Pinning
  // Summary on a short window shoved it to the far right of the viewport and
  // left a dead gap mid-table, which is what made this hard to read.
  const wide = days.length > 40;

  // Rows grouped Existing / New / 1099 (Sam, 2026-08-09) — a flat list mixed
  // W-2 and contractor territories together, so you couldn't compare like with
  // like. Sorted by the ACTIVE metric within each group.
  const groups = useMemo(() => {
    const order = showing?.territories || ["Existing", "New", "1099"];
    const label = { Existing: "Existing Territories", New: "New Territories", "1099": "1099 Territories" };
    const byTerr = new Map(order.map((t) => [t, []]));
    const orphans = [];
    for (const r of rows) {
      if (byTerr.has(r.territory)) byTerr.get(r.territory).push(r);
      else orphans.push(r);
    }
    const val = (r) => (metric === "net" ? r.totalNet : r.totalSpend);
    const out = order
      .filter((t) => (byTerr.get(t) || []).length)
      .map((t) => ({
        territory: t,
        label: label[t] || t,
        rows: [...byTerr.get(t)].sort((a, b) => val(b) - val(a) || a.rep.localeCompare(b.rep)),
      }));
    if (orphans.length) out.push({ territory: "other", label: "Unassigned", rows: orphans });
    return out;
  }, [rows, metric, showing]);

  // Resolve the click into everything worth showing about that rep-day.
  const selDetail = useMemo(() => {
    if (!sel) return null;
    const row = rows.find((r) => r.rep === sel.rep);
    if (!row || !days[sel.i]) return null;
    const day = days[sel.i];
    const net = row.net[sel.i] || 0;
    const spend = row.spend[sel.i] || 0;
    return {
      rep: row.rep,
      territory: row.territory,
      day,
      weekend: isWeekend(day),
      net,
      spend,
      zeroDollar: !isWeekend(day) && !(net > 0) && day < today,
      spendNoSale: !isWeekend(day) && spend > 0 && !(net > 0) && day < today,
      periodNet: row.totalNet,
      periodSpend: row.totalSpend,
      shareOfPeriod: row.totalNet > 0 ? net / row.totalNet : 0,
    };
  }, [sel, rows, days]);

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
    // Short windows (a handful of days) made a narrow grid that left a big white
    // void to the right on wide screens. Cap the card on desktop so it doesn't
    // sprawl, and let the grid FILL that width (day cells grow — see the table),
    // so there's no void. Wide windows keep full width + horizontal scroll.
    <div className={`bg-card border border-rule rounded-xl overflow-hidden ${wide ? "" : "lg:max-w-4xl"}`}>
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

        {/* Legend lives UP HERE, not buried under the grid — you need to know
            what the colours mean before you scroll (Sam, 2026-08-09). */}
        {!busy && rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-0.5">
            <span className="flex items-center gap-1">
              <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-paper/50 mr-1">
                {activeMetric.label} Low
              </span>
              {RAMP.slice(1).map((c) => (
                <span
                  key={c}
                  className="inline-block w-5 h-2.5 rounded-[1px] border border-paper/15"
                  style={{ backgroundColor: c }}
                />
              ))}
              <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-paper/50 ml-1">
                High
              </span>
              <span className="font-sans text-[9px] uppercase tracking-[0.14em] text-paper/35 ml-3">
                Click Any Cell For That Day
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Clicked-cell readout. Sits at the top so it's visible wherever you
          are in the grid, rather than a tooltip you have to keep hovering. */}
      {selDetail && (
        <div className="bg-paper2 border-b border-rule px-3 md:px-5 py-2 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap min-w-0">
            <span className="font-display text-sm md:text-base font-semibold text-ink">
              {selDetail.rep}
            </span>
            <span className="font-sans text-[11px] text-muted">
              {selDetail.territory} · {longDate(selDetail.day)}
              {selDetail.weekend ? " · weekend" : ""}
            </span>
          </div>
          <div className="flex items-center gap-4 md:gap-6 flex-wrap">
            <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">
              Net Sales{" "}
              <span className="font-display text-sm font-semibold text-ink tabular-nums normal-case tracking-normal ml-1">
                {fmt$(selDetail.net)}
              </span>
              {selDetail.periodNet > 0 && (
                <span className="text-muted/70 normal-case tracking-normal ml-1">
                  ({(selDetail.shareOfPeriod * 100).toFixed(1)}% of {fmt$k(selDetail.periodNet)})
                </span>
              )}
            </span>
            <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">
              Ramp T&amp;E{" "}
              <span className="font-display text-sm font-semibold text-ink tabular-nums normal-case tracking-normal ml-1">
                {spendDark ? "—" : fmt$(selDetail.spend)}
              </span>
            </span>
            {selDetail.spendNoSale ? (
              <span
                className="font-sans text-[11px] font-semibold"
                style={{ color: "#5C2F2E" }}
              >
                ⚠ Spend on a zero-dollar selling day
              </span>
            ) : selDetail.zeroDollar ? (
              <span className="font-sans text-[11px] text-muted">Zero-dollar selling day</span>
            ) : null}
            <button
              type="button"
              onClick={() => setSel(null)}
              className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted hover:text-ink border border-rule rounded px-2 py-0.5"
            >
              Close
            </button>
          </div>
        </div>
      )}

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
            {/* Fill the card width. On short windows the day columns grow (they
                have no fixed width below), so the extra space lands IN the grid
                instead of as a dead gap before Summary — Summary is pinned. On
                wide windows day cells are fixed and the table scrolls. */}
            <table className="border-collapse" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th
                    className={`${wide ? "sticky left-0 z-10 " : ""}bg-paper2 text-left py-1 px-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted align-bottom`}
                    style={{ minWidth: 150 }}
                  >
                    Rep
                  </th>
                  {days.map((d, i) => {
                    const mark = monthMarks.find((m) => m.i === i);
                    const we = isWeekend(d);
                    return (
                      <th
                        key={d}
                        title={longDate(d)}
                        className={`py-1 px-0 font-sans font-normal align-bottom ${
                          we ? "bg-paper2/60" : ""
                        }`}
                        style={{ minWidth: cellW, ...(wide ? { width: cellW } : {}) }}
                      >
                        {mark && (
                          <span className="block text-[9px] text-inksoft font-semibold leading-tight">
                            {mark.label}
                          </span>
                        )}
                        {showEveryDay ? (
                          <>
                            <span
                              className={`block text-[8px] leading-tight ${
                                we ? "text-muted/45" : "text-muted/70"
                              }`}
                            >
                              {dowInitial(d)}
                            </span>
                            <span
                              className={`block text-[10px] tabular-nums leading-tight ${
                                we ? "text-muted/45" : "text-inksoft"
                              }`}
                            >
                              {dayNum(d)}
                            </span>
                          </>
                        ) : !mark && dayNum(d) === "15" ? (
                          <span className="block text-[8px] text-muted leading-tight">15</span>
                        ) : null}
                      </th>
                    );
                  })}
                  <th
                    className={`${wide ? "sticky right-0 z-10 " : ""}bg-paper2 text-right py-1 px-2 font-sans text-[10px] uppercase tracking-[0.14em] text-muted border-l border-rule align-bottom`}
                    style={{ width: 170, minWidth: 170 }}
                  >
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) => [
                  <tr key={`h-${g.territory}`} className="border-t border-rule">
                    <td
                      colSpan={days.length + 2}
                      className="bg-paper2 py-1 px-2 font-sans text-[10px] uppercase tracking-[0.16em] text-inksoft font-semibold"
                    >
                      {g.label}
                      <span className="text-muted font-normal ml-2 tracking-normal normal-case">
                        {g.rows.length} reps ·{" "}
                        {metric === "net"
                          ? fmt$(g.rows.reduce((a, r) => a + r.totalNet, 0))
                          : fmt$(g.rows.reduce((a, r) => a + r.totalSpend, 0))}
                      </span>
                    </td>
                  </tr>,
                  ...g.rows.map((r) => {
                  const series = metric === "net" ? r.net : r.spend;
                  return (
                    <tr key={r.rep} className="border-t border-rule/40">
                      <td
                        className={`${wide ? "sticky left-0 z-10 " : ""}bg-card py-0.5 px-2 font-sans text-[11px] md:text-xs text-ink whitespace-nowrap`}
                        title={`${r.rep} · ${r.territory || ""}`}
                      >
                        {r.rep}
                      </td>
                      {days.map((d, i) => {
                        const v = series[i] || 0;
                        const bg = cellColor(v, max);
                        const weekend = isWeekend(d);
                        // A weekday with no net sales is THE signal — outline it.
                        const zeroFlag = metric === "net" && !weekend && !(v > 0) && d < today;
                        const spendNoSale =
                          metric === "spend" && !weekend && v > 0 && !(r.net[i] > 0) && d < today;
                        const isSel = sel && sel.rep === r.rep && sel.i === i;
                        return (
                          <td
                            key={d}
                            onClick={() =>
                              setSel(isSel ? null : { rep: r.rep, i })
                            }
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSel(isSel ? null : { rep: r.rep, i });
                              }
                            }}
                            title={`${r.rep} · ${longDate(d)}${weekend ? " (weekend)" : ""}\n${
                              metric === "net" ? "Net" : "Spend"
                            }: ${fmt$(v)}${
                              spendNoSale ? "\n⚠ spend on a zero-dollar selling day" : ""
                            }\nClick for detail`}
                            className="cursor-pointer"
                            style={{
                              backgroundColor: bg || (weekend ? "#F2EEE7" : "#FBFAF7"),
                              minWidth: cellW,
                              ...(wide ? { width: cellW } : {}),
                              height: 15,
                              // Selection outline wins over the flag outlines so
                              // you can always see what you just clicked.
                              boxShadow: isSel
                                ? "inset 0 0 0 2px #2B1A10"
                                : spendNoSale
                                  ? "inset 0 0 0 1.5px #5C2F2E"
                                  : zeroFlag
                                    ? "inset 0 0 0 1px rgba(92,47,46,0.28)"
                                    : undefined,
                            }}
                          />
                        );
                      })}
                      <td className={`${wide ? "sticky right-0 z-10 " : ""}bg-card py-0.5 px-2 text-right whitespace-nowrap border-l border-rule`}>
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
                  }),
                ])}
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
