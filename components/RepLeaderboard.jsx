"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveMetrics } from "@/lib/repMetrics.js";
// Shared Pacific-anchored window math — the SAME module /api/warm and
// /api/leaderboard use, so the from/to strings (and therefore the cache keys)
// line up exactly. A local copy drifting by a day here would silently miss
// every warmed entry and put us back on per-request recompute.
import { periodRange } from "@/lib/periodWindows.js";

/**
 * Rep Leaderboard — the ONE presentation for every per-rep comparison on the
 * dashboard (Mike 2026-08-03, extended by Sam the same day).
 *
 * Mike: the multi-line rep trend charts were unreadable with every rep on
 * them. Sam: make it uniform — every place the dashboard compares reps reads
 * as the same stack-ranked list, not a tangle of lines.
 *
 * So this renders a stack-ranked, top-to-bottom list of EVERY rep for the
 * chosen metric and period: one horizontal bar each (length = value, longest
 * = #1), figure labeled on the row, ranked 1..N. No line crossings, no legend
 * to decode — you read it top down.
 *
 *   metric toggle — whatever `metrics` keys the caller passes (Net Sales,
 *                   Orders, New Serum Accts, Weighted Sales, …). Definitions
 *                   live in lib/repMetrics.js so "New Serum Accts by rep"
 *                   means one thing dashboard-wide.
 *   period toggle — MTD / QTD / YTD (default MTD) + "Range", which follows
 *                   whatever window the dashboard's FilterBar has loaded.
 *   scope chips   — All / Existing / New / 1099 (suppressed when the caller
 *                   pins eligibility, e.g. President's Club is W-2 only).
 *
 * IMPORTANT — no new math anywhere. Every metric reads a field the server
 * already computed onto a `repPerformance` row; MTD/QTD/YTD just refetch
 * `/api/dashboard` for that window and re-read it. The three windows are
 * Pacific-anchored to match FilterBar and /api/warm byte-for-byte (labels
 * "mtd" / "qtd" / "ytd" there resolve to the identical from/to strings built
 * below), so a toggle click normally lands on a pre-warmed KV copy instead of
 * a cold Shopify pull.
 */

const PERIODS = [
  { key: "mtd", label: "MTD", full: "Month To Date" },
  { key: "qtd", label: "QTD", full: "Quarter To Date" },
  { key: "ytd", label: "YTD", full: "Year To Date" },
  { key: "range", label: "Range", full: "Selected Date Range" },
];

const SCOPES = [
  { key: "all", label: "All Reps" },
  { key: "Existing", label: "Existing" },
  { key: "New", label: "New" },
  { key: "1099", label: "1099" },
];

const fmt$ = (n) => {
  const v = Math.round(Math.abs(n || 0));
  return `${n < 0 ? "-" : ""}$${v.toLocaleString()}`;
};
const fmtN = (n) => Math.round(n || 0).toLocaleString();
const fmtBy = (unit) => (unit === "currency" ? fmt$ : fmtN);

const prettyDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// ── Shared payload cache ─────────────────────────────────────────────────────
// Module-level (not per-instance) so the several leaderboards on the page —
// Sales By Rep and President's Club — share one request per window instead of
// each firing their own. Values are the in-flight promise, so a second mount
// on the same window awaits the first rather than starting a duplicate pull.
const PAYLOAD_CACHE = new Map();

function loadWindow(from, to) {
  const key = `${from}|${to}`;
  if (PAYLOAD_CACHE.has(key)) return PAYLOAD_CACHE.get(key);
  // /api/leaderboard, NOT /api/dashboard: it returns only repPerformance
  // (~50 KB) instead of the full payload (6.75 MB for YTD, 87% of it the raw
  // orders array this component never reads). /api/warm precomputes the three
  // periods every 10 min, so this is normally a warm cache hit.
  const qs = new URLSearchParams({ from, to });
  const p = fetch(`/api/leaderboard?${qs}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => {
      if (!j?.ok) throw new Error(j?.error || "Load failed");
      return j.repPerformance || [];
    })
    .catch((e) => {
      // Drop the rejected promise so a later toggle can retry instead of
      // replaying the same failure forever.
      PAYLOAD_CACHE.delete(key);
      throw e;
    });
  PAYLOAD_CACHE.set(key, p);
  return p;
}

/**
 * Flatten the territory-grouped repPerformance payload into one list ranked
 * by `metric`. Ties break alphabetically so the order is deterministic across
 * renders (a rep must never swap places with a tied peer on a re-render).
 */
function flattenAndRank(repPerformance, scope, metric, rowFilter) {
  if (!Array.isArray(repPerformance) || !metric) return [];
  const rows = [];
  for (const sec of repPerformance) {
    if (scope !== "all" && sec.territory !== scope) continue;
    for (const r of sec.rows || []) {
      const row = { ...r, territory: sec.territory };
      if (rowFilter && !rowFilter(row, sec.territory)) continue;
      rows.push({ ...row, value: metric.value(row) || 0 });
    }
  }
  return rows
    .sort((a, b) => b.value - a.value || String(a.rep).localeCompare(String(b.rep)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export default function RepLeaderboard({
  repPerformance,
  rangeFrom,
  rangeTo,
  title = "Rep Leaderboard",
  metrics: metricKeys,
  defaultMetric,
  rowFilter,          // (row, territory) => bool — pins eligibility (P-Club)
  showScope = true,
  scopeNote,          // replaces the scope chips when eligibility is pinned
}) {
  const metrics = useMemo(() => resolveMetrics(metricKeys), [metricKeys]);
  const [metricKey, setMetricKey] = useState(
    () => defaultMetric || (metricKeys && metricKeys[0]) || "net"
  );
  const [period, setPeriod] = useState("mtd");
  const [scope, setScope] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fetched, setFetched] = useState({});

  const metric = metrics.find((m) => m.key === metricKey) || metrics[0];
  const range = period === "range" ? [rangeFrom, rangeTo] : periodRange(period);
  const [from, to] = range || [];
  const cacheKey = from && to ? `${from}|${to}` : null;
  // If the dashboard's own FilterBar already has this exact window loaded
  // (e.g. Sam is sitting on the MTD preset), reuse the payload we were handed
  // instead of firing a second identical request.
  const propCoversPeriod =
    period !== "range" && !!from && from === rangeFrom && to === rangeTo;

  useEffect(() => {
    if (period === "range" || propCoversPeriod || !cacheKey) return undefined;
    if (fetched[cacheKey]) return undefined;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    loadWindow(from, to)
      .then((rp) => {
        if (!cancelled) setFetched((prev) => ({ ...prev, [cacheKey]: rp }));
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, cacheKey, from, to, propCoversPeriod, fetched]);

  const source =
    period === "range" || propCoversPeriod
      ? repPerformance
      : (cacheKey && fetched[cacheKey]) || null;

  const rows = useMemo(
    () => flattenAndRank(source, scope, metric, rowFilter),
    [source, scope, metric, rowFilter]
  );

  const isMoney = metric?.unit === "currency";
  const fmtV = fmtBy(metric?.unit);
  const total = rows.reduce((a, r) => a + (r.value || 0), 0);
  const max = rows.length ? Math.max(...rows.map((r) => r.value || 0)) : 0;
  const busy = loading && !source;
  const periodMeta = PERIODS.find((p) => p.key === period);
  const unitSuffix = metric?.suffix ? ` ${metric.suffix}` : "";

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      {/* Header — title, metric toggle, period toggle, scope, live totals */}
      <div className="bg-browndeep text-paper px-3 py-2.5 md:px-5 md:py-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
            {title} · {metric?.label}
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

        {/* Metric chips — only when the caller offers more than one */}
        {metrics.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-sans text-[9px] uppercase tracking-[0.18em] text-paper/50 mr-1">
              Rank By
            </span>
            {metrics.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetricKey(m.key)}
                aria-pressed={metricKey === m.key}
                title={m.note}
                className={`px-2 py-0.5 rounded font-sans text-[10px] md:text-[11px] transition-colors ${
                  metricKey === m.key
                    ? "bg-brown text-ink font-semibold"
                    : "text-paper/70 hover:text-paper hover:bg-paper/10 border border-paper/20"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {showScope ? (
            <div className="inline-flex rounded-lg overflow-hidden border border-paper/20 shrink-0">
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  aria-pressed={scope === s.key}
                  className={`px-2 md:px-2.5 py-0.5 font-sans text-[9.5px] md:text-[10px] uppercase tracking-[0.12em] transition-colors ${
                    scope === s.key
                      ? "bg-paper/90 text-browndeep font-semibold"
                      : "text-paper/65 hover:text-paper hover:bg-paper/10"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="font-sans text-[9.5px] md:text-[10px] uppercase tracking-[0.12em] text-paper/60">
              {scopeNote || ""}
            </span>
          )}
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] opacity-80 tabular-nums">
            {busy
              ? "Loading…"
              : `${rows.length} Reps · ${fmtV(total)}${unitSuffix} Total`}
            {from && to ? ` · ${prettyDate(from)} – ${prettyDate(to)}` : ""}
          </span>
        </div>
      </div>

      {/* Ranked bars */}
      {busy ? (
        <div className="divide-y divide-rule/50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-3 md:px-5 py-2.5 flex items-center gap-3">
              <div className="h-3 w-6 rounded bg-paper2" />
              <div className="h-3 flex-1 rounded bg-paper2" />
              <div className="h-3 w-16 rounded bg-paper2" />
            </div>
          ))}
        </div>
      ) : err ? (
        <div className="px-4 py-6 text-center font-sans text-sm text-unfavorable">
          Couldn’t load {periodMeta?.full}: {err}
        </div>
      ) : !rows.length ? (
        <div className="px-4 py-6 text-center font-sans text-sm text-muted">
          No rep activity for {metric?.label} in this period.
        </div>
      ) : (
        <ol className="divide-y divide-rule/50">
          {rows.map((r) => {
            const pct = max > 0 ? Math.max(0, (r.value || 0) / max) : 0;
            const share = total > 0 ? (r.value || 0) / total : 0;
            const top3 = r.rank <= 3 && r.value > 0;
            return (
              <li
                key={`${r.territory}-${r.rep}`}
                className="px-3 md:px-5 py-1.5"
                title={`${r.rep} · ${r.region || r.territory} · ${fmtV(r.value)}${unitSuffix} ${
                  metric?.label
                } · ${(share * 100).toFixed(1)}% of the ${periodMeta?.label} team total`}
              >
                <div className="flex items-center gap-2 md:gap-3">
                  <span
                    className={`shrink-0 w-5 md:w-6 text-right font-display text-sm md:text-base tabular-nums leading-none ${
                      top3 ? "text-brown font-bold" : "text-muted"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <span className="shrink-0 w-[112px] md:w-[164px] font-sans text-[12px] md:text-[13px] text-ink truncate leading-none">
                    {r.rep}
                  </span>
                  {/* Bar — length is this rep's value relative to #1 */}
                  <span className="flex-1 min-w-0 hidden sm:block">
                    <span
                      className={`block h-3 rounded-sm ${top3 ? "bg-brown" : "bg-brown/55"}`}
                      style={{ width: `${Math.max(pct * 100, r.value > 0 ? 1.5 : 0)}%` }}
                    />
                  </span>
                  <span className="ml-auto sm:ml-0 shrink-0 w-[86px] md:w-[104px] text-right font-display text-sm md:text-base font-semibold text-ink tabular-nums leading-none">
                    {fmtV(r.value)}
                  </span>
                  <span className="hidden sm:block shrink-0 w-[92px] text-right font-sans text-[10px] text-muted tabular-nums leading-none">
                    {(share * 100).toFixed(1)}%
                    {isMoney ? ` · ${fmtN(r.orders)} Ord` : ""}
                  </span>
                </div>
                {/* Mobile: bar + meta sit under the row so name + figure keep one line */}
                <div className="sm:hidden mt-1 pl-7 flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block h-2 rounded-sm ${top3 ? "bg-brown" : "bg-brown/55"}`}
                      style={{ width: `${Math.max(pct * 100, r.value > 0 ? 2 : 0)}%` }}
                    />
                  </span>
                  <span className="shrink-0 font-sans text-[9.5px] text-muted tabular-nums leading-none">
                    {(share * 100).toFixed(1)}%
                    {isMoney ? ` · ${fmtN(r.orders)} Ord` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Footer — team total + the metric's definition, so no ranked list on
          this dashboard is ever ambiguous about what it's ranking. */}
      {!busy && rows.length > 0 && (
        <div className="bg-paper2 border-t border-rule px-3 md:px-5 py-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.16em] text-muted">
              {periodMeta?.full} · {metric?.label}
              {showScope ? ` · ${SCOPES.find((s) => s.key === scope)?.label}` : ""}
            </span>
            <span className="font-display text-base md:text-lg font-semibold text-ink tabular-nums">
              {fmtV(total)}
            </span>
          </div>
          {metric?.note && (
            <p className="font-sans text-[10px] md:text-[11px] leading-snug text-muted">
              {metric.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
