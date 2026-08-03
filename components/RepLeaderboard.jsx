"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Rep Leaderboard — the PRIMARY view of rep performance (Mike, 2026-08-03).
 *
 * Replaces the multi-line "spaghetti" rep trend chart as the lead-in to the
 * Sales By Rep section: a stack-ranked, top-to-bottom list of EVERY rep by
 * net sales for the selected period, one horizontal bar each (length = net
 * sales, longest = #1), value labeled on the row. No line crossings, no
 * legend to decode — you read it top down.
 *
 * Period toggle: MTD / QTD / YTD (default MTD) + "Range" which uses whatever
 * window the dashboard's own FilterBar has loaded.
 *
 * IMPORTANT — no new math. MTD/QTD/YTD each refetch `/api/dashboard` for that
 * window and read `repPerformance`, the exact same server-side rep
 * attribution + net-sales rollup the rep table and President's Club use. The
 * three windows are already pre-warmed every 10 min by /api/warm (labels
 * "mtd" / "qtd" / "ytd" there resolve to the identical Pacific-anchored
 * from/to strings built below), so a toggle click normally lands on a warm
 * KV copy instead of a cold Shopify pull.
 */

// ── Pacific (shop tz) date math — MUST mirror FilterBar.jsx + /api/warm ──────
// A browser-local anchor drifts a full day for an ET viewer late in the
// evening, which would both show the wrong window AND miss the warmed cache
// entry (keys are the literal from/to strings).
const SHOP_TZ = "America/Los_Angeles";
const shopTodayStr = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shopTodayD = () => new Date(shopTodayStr() + "T00:00:00");
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function periodRange(key) {
  const t = shopTodayD();
  if (key === "mtd") return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
  if (key === "qtd") {
    const q = Math.floor(t.getMonth() / 3);
    return [ymd(new Date(t.getFullYear(), q * 3, 1)), ymd(t)];
  }
  if (key === "ytd") return [ymd(new Date(t.getFullYear(), 0, 1)), ymd(t)];
  return null;
}

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

const prettyDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Flatten the territory-grouped repPerformance payload into one list. */
function flatten(repPerformance, scope) {
  if (!Array.isArray(repPerformance)) return [];
  const rows = [];
  for (const sec of repPerformance) {
    if (scope !== "all" && sec.territory !== scope) continue;
    for (const r of sec.rows || []) {
      rows.push({ ...r, territory: sec.territory });
    }
  }
  return rows
    .sort((a, b) => (b.net || 0) - (a.net || 0) || String(a.rep).localeCompare(String(b.rep)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export default function RepLeaderboard({ repPerformance, rangeFrom, rangeTo }) {
  const [period, setPeriod] = useState("mtd");
  const [scope, setScope] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  // Fetched payloads keyed by "<from>|<to>" so flipping back to a period
  // already pulled is instant and never refetches.
  const [fetched, setFetched] = useState({});
  const cacheRef = useRef({});

  const range = period === "range" ? [rangeFrom, rangeTo] : periodRange(period);
  const [from, to] = range || [];
  const cacheKey = from && to ? `${from}|${to}` : null;
  // If the dashboard's own FilterBar already has this exact window loaded
  // (e.g. Sam is sitting on the MTD preset), reuse the payload we were handed
  // instead of firing a second identical request.
  const propCoversPeriod =
    period !== "range" && !!from && from === rangeFrom && to === rangeTo;

  useEffect(() => {
    if (period === "range" || propCoversPeriod) return undefined;
    if (!cacheKey || cacheRef.current[cacheKey]) return undefined;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams({ from, to, granularity: "auto" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j?.ok) throw new Error(j?.error || "Load failed");
        cacheRef.current[cacheKey] = j.repPerformance || [];
        setFetched((prev) => ({ ...prev, [cacheKey]: j.repPerformance || [] }));
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
  }, [period, cacheKey, from, to, propCoversPeriod]);

  const source =
    period === "range" || propCoversPeriod
      ? repPerformance
      : (cacheKey && (fetched[cacheKey] || cacheRef.current[cacheKey])) || null;

  const rows = useMemo(() => flatten(source, scope), [source, scope]);

  const total = rows.reduce((a, r) => a + (r.net || 0), 0);
  const orders = rows.reduce((a, r) => a + (r.orders || 0), 0);
  const max = rows.length ? Math.max(...rows.map((r) => r.net || 0)) : 0;
  const busy = loading && !source;
  const periodMeta = PERIODS.find((p) => p.key === period);

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      {/* Header — title, period toggle, scope toggle, live totals */}
      <div className="bg-browndeep text-paper px-3 py-2.5 md:px-5 md:py-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
            Rep Leaderboard · Net Sales
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
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] opacity-80 tabular-nums">
            {busy
              ? "Loading…"
              : `${rows.length} Reps · ${fmt$(total)} Net · ${fmtN(orders)} Orders`}
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
          No rep sales in this period.
        </div>
      ) : (
        <ol className="divide-y divide-rule/50">
          {rows.map((r) => {
            const pct = max > 0 ? Math.max(0, (r.net || 0) / max) : 0;
            const share = total > 0 ? (r.net || 0) / total : 0;
            const top3 = r.rank <= 3;
            return (
              <li
                key={`${r.territory}-${r.rep}`}
                className="px-3 md:px-5 py-1.5"
                title={`${r.rep} · ${r.region || r.territory} · ${fmt$(r.net)} net · ${fmtN(
                  r.orders
                )} orders · ${(share * 100).toFixed(1)}% of ${periodMeta?.label} team net`}
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
                  {/* Bar — length is net sales relative to #1 */}
                  <span className="flex-1 min-w-0 hidden sm:block">
                    <span
                      className={`block h-3 rounded-sm ${top3 ? "bg-brown" : "bg-brown/55"}`}
                      style={{ width: `${Math.max(pct * 100, r.net > 0 ? 1.5 : 0)}%` }}
                    />
                  </span>
                  <span className="ml-auto sm:ml-0 shrink-0 w-[86px] md:w-[104px] text-right font-display text-sm md:text-base font-semibold text-ink tabular-nums leading-none">
                    {fmt$(r.net)}
                  </span>
                  <span className="hidden sm:block shrink-0 w-[92px] text-right font-sans text-[10px] text-muted tabular-nums leading-none">
                    {(share * 100).toFixed(1)}% · {fmtN(r.orders)} Ord
                  </span>
                </div>
                {/* Mobile: bar + meta sit under the row so name + figure keep one line */}
                <div className="sm:hidden mt-1 pl-7 flex items-center gap-2">
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block h-2 rounded-sm ${top3 ? "bg-brown" : "bg-brown/55"}`}
                      style={{ width: `${Math.max(pct * 100, r.net > 0 ? 2 : 0)}%` }}
                    />
                  </span>
                  <span className="shrink-0 font-sans text-[9.5px] text-muted tabular-nums leading-none">
                    {(share * 100).toFixed(1)}% · {fmtN(r.orders)} Ord
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Footer — team total */}
      {!busy && rows.length > 0 && (
        <div className="bg-paper2 border-t border-rule px-3 md:px-5 py-2 flex items-center justify-between gap-3">
          <span className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.16em] text-muted">
            {periodMeta?.full} Total · {SCOPES.find((s) => s.key === scope)?.label}
          </span>
          <span className="font-display text-base md:text-lg font-semibold text-ink tabular-nums">
            {fmt$(total)}
          </span>
        </div>
      )}
    </div>
  );
}
