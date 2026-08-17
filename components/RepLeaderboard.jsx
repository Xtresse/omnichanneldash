"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveMetrics } from "@/lib/repMetrics.js";
// Shared Pacific-anchored window math — the SAME module /api/warm and
// /api/leaderboard use, so the from/to strings (and therefore the cache keys)
// line up exactly. A local copy drifting by a day here would silently miss
// every warmed entry and put us back on per-request recompute.
import { periodRange, shopTodayD } from "@/lib/periodWindows.js";

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
 *                   YTD is calendar-year (Jan 1) by default; a caller may
 *                   pass `ytdRange` to override the start for a program
 *                   year that isn't the calendar year (President's Club
 *                   runs Feb 1 – Jan 31, so Dashboard.jsx passes
 *                   `presidentsClubYtdRange` only into that instance —
 *                   Sales By Rep's leaderboard is untouched and stays
 *                   calendar-year YTD).
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

const DEFAULT_PERIODS = [
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

// MTD/QTD/YTD land on /api/warm's precomputed trio, so they normally settle
// in well under a second. RANGE lets someone pick ANY window — including one
// nobody has ever loaded — which falls through to a cold Shopify pull on the
// server (up to the route's 300s maxDuration) with no client-side backstop.
// fetch() has no built-in timeout, so if that request hangs (a slow cold
// compute on a wide span, or a dropped connection somewhere between here and
// Vercel) the promise this resolves into never settles — and since the
// effect below only clears `loading` in a .then/.catch/.finally attached to
// THIS promise, a request that never settles leaves the skeleton rows
// spinning forever with no way out short of a full reload (2026-08-16, Sam:
// RANGE stuck on "LOADING…" for a Feb 1 – Aug 15 span). Bound every request
// with an AbortController so it always settles one way or the other.
const LOAD_TIMEOUT_MS = 45000;

function loadWindow(from, to) {
  const key = `${from}|${to}`;
  if (PAYLOAD_CACHE.has(key)) return PAYLOAD_CACHE.get(key);
  // /api/leaderboard, NOT /api/dashboard: it returns only repPerformance
  // (~50 KB) instead of the full payload (6.75 MB for YTD, 87% of it the raw
  // orders array this component never reads). /api/warm precomputes the three
  // periods every 10 min, so this is normally a warm cache hit.
  const qs = new URLSearchParams({ from, to });
  const controller = new AbortController();
  // No custom reason: an argument-less abort() sets signal.reason to a
  // DOMException named "AbortError" (the same one a native fetch abort
  // produces), which is what the .catch below keys off of. Passing a plain
  // Error("timeout") here would defeat that check — its .name is "Error",
  // not "AbortError" — and leak the raw "timeout" string to the user instead
  // of the friendly message below.
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  const p = fetch(`/api/leaderboard?${qs}`, {
    cache: "no-store",
    signal: controller.signal,
  })
    .then((r) => r.json())
    .then((j) => {
      if (!j?.ok) throw new Error(j?.error || "Load failed");
      return j.repPerformance || [];
    })
    .catch((e) => {
      // Drop the rejected promise so a later toggle can retry instead of
      // replaying the same failure forever.
      PAYLOAD_CACHE.delete(key);
      if (e?.name === "AbortError") {
        throw new Error(
          `Timed out after ${Math.round(LOAD_TIMEOUT_MS / 1000)}s — this range ` +
            "isn't pre-warmed (only MTD/QTD/YTD are). Try again or narrow it."
        );
      }
      throw e;
    })
    .finally(() => clearTimeout(timer));
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
  ytdRange,           // optional (today) => [from, to] override for the YTD
                       // preset — e.g. presidentsClubYtdRange for a Feb 1
                       // program year. Omit to keep calendar-year YTD.
  ytdFull,            // optional label override for the YTD preset's
                       // "full" name (footer/tooltip text) when ytdRange
                       // is set, so it doesn't read "Year To Date" for a
                       // Feb-1-anchored window.
}) {
  const metrics = useMemo(() => resolveMetrics(metricKeys), [metricKeys]);
  const PERIODS = useMemo(
    () =>
      ytdFull
        ? DEFAULT_PERIODS.map((p) => (p.key === "ytd" ? { ...p, full: ytdFull } : p))
        : DEFAULT_PERIODS,
    [ytdFull]
  );
  const [metricKey, setMetricKey] = useState(
    () => defaultMetric || (metricKeys && metricKeys[0]) || "net"
  );
  const [period, setPeriod] = useState("mtd");
  const [scope, setScope] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fetched, setFetched] = useState({});
  // RANGE used to be a no-op: it just mirrored whatever preset/custom window
  // the top-level FilterBar happened to have loaded (rangeFrom/rangeTo props)
  // rather than letting the user pick a window independently for THIS
  // leaderboard. These two inputs are local overrides — null until touched,
  // in which case we fall back to the props (so the button still works
  // before any edit, and stays hydration-safe: both server and first client
  // render start null).
  const [rangeInputs, setRangeInputs] = useState({ from: null, to: null });

  const metric = metrics.find((m) => m.key === metricKey) || metrics[0];

  // ---- Never resolve MTD/QTD/YTD during SSR ----
  // periodRange() calls new Date(). app/page.jsx is ISR-cached
  // (revalidate = 300) and this section renders eagerly, so a server-computed
  // date gets BAKED into HTML that Next may serve for far longer than 5
  // minutes on this low-traffic app. Once that cached HTML crosses a day
  // boundary the baked "Aug 1 – Aug 8" no longer matches what the browser
  // computes, and React bails out of hydration (minified errors #418/#423/
  // #425 were live in prod from 2026-08-03 until this fix).
  //
  // Same rule CLAUDE.md sets for Dashboard's "today": resolve it on the
  // client. Pre-mount we render the skeleton, which is date-free and
  // therefore identical on server and first client render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const range =
    period === "range"
      ? [rangeInputs.from ?? rangeFrom, rangeInputs.to ?? rangeTo] // local override, else props (server-provided, hydration-safe)
      : mounted
        ? period === "ytd" && typeof ytdRange === "function"
          ? ytdRange(shopTodayD())
          : periodRange(period)
        : null;
  const [from, to] = range || [];
  const cacheKey = from && to ? `${from}|${to}` : null;
  // If the dashboard's own FilterBar already has this exact window loaded
  // (e.g. Sam is sitting on the MTD preset, or hasn't touched the Range
  // inputs yet so Range still matches rangeFrom/rangeTo), reuse the payload
  // we were handed instead of firing a second identical request. Once the
  // user edits the Range inputs to something else, this stops matching and
  // the effect below fetches that window on its own via /api/leaderboard —
  // same path MTD/QTD/YTD already use.
  const propCoversPeriod = !!from && !!to && from === rangeFrom && to === rangeTo;

  useEffect(() => {
    if (propCoversPeriod || !cacheKey) return undefined;
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

  const source = propCoversPeriod
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
  // Pre-mount counts as busy so SSR emits the date-free skeleton (see the
  // hydration note above) rather than an empty "no activity" state.
  const busy = !mounted || (loading && !source);
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

        {/* Range inputs — only when RANGE is the active period. Independent
            of the top FilterBar's own Custom date pair; edits here just
            change what THIS leaderboard fetches (via /api/leaderboard, same
            as MTD/QTD/YTD), starting from whatever window was already
            loaded. */}
        {period === "range" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-sans text-[9px] uppercase tracking-[0.18em] text-paper/50">
              Range
            </span>
            <input
              type="date"
              aria-label="Range start date"
              value={rangeInputs.from ?? rangeFrom ?? ""}
              max={rangeInputs.to ?? rangeTo ?? undefined}
              onChange={(e) =>
                setRangeInputs((prev) => ({ ...prev, from: e.target.value }))
              }
              className="bg-paper text-browndeep border border-paper/30 rounded px-1.5 py-0.5 font-sans text-[11px] min-w-0"
            />
            <span className="font-sans text-[10px] text-paper/60">–</span>
            <input
              type="date"
              aria-label="Range end date"
              value={rangeInputs.to ?? rangeTo ?? ""}
              min={rangeInputs.from ?? rangeFrom ?? undefined}
              onChange={(e) =>
                setRangeInputs((prev) => ({ ...prev, to: e.target.value }))
              }
              className="bg-paper text-browndeep border border-paper/30 rounded px-1.5 py-0.5 font-sans text-[11px] min-w-0"
            />
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
      ) : err && !source ? (
        // Gated on !source, not just err: a failed RANGE fetch (or the new
        // 45s timeout above) sets err and is never explicitly cleared when
        // the user then switches to a period served straight from the
        // repPerformance prop (propCoversPeriod — no fetch, no setErr(null)
        // ever runs). Without this guard that stale err outlives the period
        // it belongs to and blanks out perfectly good MTD/QTD/YTD rows with
        // an error message from an unrelated, already-abandoned RANGE
        // request.
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
