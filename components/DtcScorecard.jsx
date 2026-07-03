"use client";

import { useEffect, useMemo, useState } from "react";

// =============================================================================
// DTC Growth Scorecard — weekly KPI grid read from Jose/Sam's Google Sheet
// via /api/dtc-scorecard. Sections (Core KPIs, CPA by Channel, Revenue Mix,
// Website, CRM, Customer Service) render as group rows inside one table with
// the weeks running across, the latest week highlighted, a WoW delta, and an
// on/off-target dot wherever the sheet declares a target.
// =============================================================================

// Latest week's value for a metric (last non-empty cell) + the one before it.
function latestPair(values) {
  let cur = null, curIx = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i]) { cur = values[i]; curIx = i; break; }
  }
  let prev = null;
  for (let i = curIx - 1; i >= 0; i--) {
    if (values[i]?.n != null) { prev = values[i]; break; }
  }
  return { cur, prev, curIx };
}

// On-target check for the latest numeric value. null → no verdict.
function onTarget(metric) {
  const t = metric.target;
  if (!t || t.value == null || !t.cmp) return null;
  const { cur } = latestPair(metric.values);
  if (cur?.n == null) return null;
  return t.cmp === "<" ? cur.n <= t.value : cur.n >= t.value;
}

const GOOD = "rgb(var(--favorable))";
const BAD = "rgb(var(--unfavorable))";

function DeltaBadge({ metric }) {
  const { cur, prev } = latestPair(metric.values);
  if (cur?.n == null || prev?.n == null || prev.n === 0) {
    return <span className="text-muted">—</span>;
  }
  const x = (cur.n - prev.n) / Math.abs(prev.n);
  if (Math.abs(x) < 0.0005) return <span className="text-muted">0%</span>;
  const up = x > 0;
  const good = metric.lowerIsBetter ? !up : up;
  const pct = Math.abs(x * 100);
  return (
    <span className="tabular-nums font-semibold" style={{ color: good ? GOOD : BAD }}>
      {up ? "▲" : "▼"} {pct.toFixed(pct < 10 ? 1 : 0)}%
    </span>
  );
}

function TargetCell({ metric }) {
  const ok = onTarget(metric);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {ok != null && (
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: ok ? GOOD : BAD }}
          title={ok ? "Latest week on target" : "Latest week off target"}
        />
      )}
      <span className={metric.target ? "text-inksoft" : "text-muted"}>
        {metric.target?.raw || "—"}
      </span>
    </span>
  );
}

// Tiny inline trend line over the metric's numeric weekly values.
function Sparkline({ values, lowerIsBetter }) {
  const pts = values.map((v) => (v?.n != null ? v.n : null));
  const nums = pts.filter((n) => n != null);
  if (nums.length < 2) return <span className="text-muted">—</span>;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const W = 64, H = 18, PAD = 2;
  const step = (W - PAD * 2) / (pts.length - 1);
  const coords = pts
    .map((n, i) => (n == null ? null : `${(PAD + i * step).toFixed(1)},${(H - PAD - ((n - min) / span) * (H - PAD * 2)).toFixed(1)}`))
    .filter(Boolean);
  const first = nums[0], lastN = nums[nums.length - 1];
  const rising = lastN > first;
  const flat = lastN === first;
  const tone = flat ? "rgb(var(--muted))" : (lowerIsBetter ? !rising : rising) ? GOOD : BAD;
  return (
    <svg width={W} height={H} aria-hidden="true" className="block">
      <polyline points={coords.join(" ")} fill="none" stroke={tone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Headline tiles for the latest week — the Core KPI numbers Sam checks first.
const TILE_PICKS = [
  { match: /^revenue$/i, label: "Revenue" },
  { match: /^media spend$/i, label: "Media Spend" },
  { match: /acquisition cost/i, label: "CAC" },
  { match: /^aov$/i, label: "AOV" },
  { match: /^ltv \/ cac$/i, label: "LTV / CAC" },
  { match: /^churn rate/i, label: "Churn (mo est.)" },
];

function Tiles({ sections }) {
  const core = sections.find((s) => /core/i.test(s.name));
  if (!core) return null;
  const tiles = TILE_PICKS.map((p) => {
    const m = core.metrics.find((x) => p.match.test(x.name));
    if (!m) return null;
    const { cur } = latestPair(m.values);
    if (!cur) return null;
    return { label: p.label, value: cur.raw, metric: m };
  }).filter(Boolean);
  if (!tiles.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card border border-rule rounded-xl px-3 py-2.5">
          <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">{t.label}</div>
          <div className="font-display text-xl md:text-2xl font-semibold text-ink leading-tight tabular-nums">
            {t.value}
          </div>
          <div className="font-sans text-[10px] mt-0.5">
            <DeltaBadge metric={t.metric} /> <span className="text-muted">WoW</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DtcScorecard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dtc-scorecard", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok && j.mode === "live") setData(j);
        else setErr(j.reason || j.error || "Scorecard sheet unavailable");
      })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  // Index of the latest week that has any data at all — that column gets the
  // highlight even for metrics whose own latest entry is older.
  const lastIx = useMemo(() => (data ? data.weeks.length - 1 : -1), [data]);

  if (err) {
    return (
      <div className="rounded-xl border border-rule bg-card p-4 font-sans text-sm text-inksoft">
        <span className="text-unfavorable font-semibold">Scorecard unavailable.</span> {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-rule bg-card p-8 text-center font-sans text-sm text-muted">
        Loading DTC scorecard…
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <Tiles sections={data.sections} />

      <div className="bg-card border border-rule rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-sans border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-paper2 text-left text-muted">
                <th className="py-2 px-3 font-semibold sticky left-0 bg-paper2 z-10 min-w-[160px]">Metric</th>
                <th className="py-2 px-3 font-semibold">Target</th>
                <th className="py-2 px-3 font-semibold">Trend</th>
                {data.weeks.map((w, i) => (
                  <th
                    key={w}
                    className={`py-2 px-3 font-semibold text-right ${i === lastIx ? "text-ink bg-brown/20" : ""}`}
                  >
                    {w}
                  </th>
                ))}
                <th className="py-2 px-3 font-semibold text-right">Δ WoW</th>
              </tr>
            </thead>
            <tbody>
              {data.sections.map((s) => (
                <SectionRows key={s.name} section={s} lastIx={lastIx} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="font-sans text-[10px] md:text-xs text-muted leading-relaxed">
        Weekly, entered by hand in the{" "}
        <a href={data.sheetUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          DTC scorecard sheet
        </a>{" "}
        (sources: Shopify · Orca · Recharge · Google Analytics · Klaviyo · Gorgias). Cached 10 min.
        ● on / ● off target compares the latest week to the sheet&apos;s target column; LTV and
        churn are monthly estimates.
      </p>
    </div>
  );
}

function SectionRows({ section, lastIx }) {
  return (
    <>
      <tr className="bg-browndeep/90">
        {/* The cell spans the whole (scrolling) row, so the label itself is
            what sticks — keeps the section name visible mid-scroll. */}
        <td colSpan={4 + (section.metrics[0]?.values.length || 0)} className="py-1.5 px-3">
          <span className="inline-block sticky left-3 font-display text-sm font-semibold text-brown tracking-wide">
            {section.name}
          </span>
        </td>
      </tr>
      {section.metrics.map((m) => (
        <tr key={m.name} className="border-t border-rule/60 hover:bg-paper2/60">
          <td className="py-1.5 px-3 sticky left-0 bg-card z-10 font-medium text-ink max-w-[220px] overflow-hidden text-ellipsis" title={`${m.name} · ${m.source} · ${m.owner}`}>
            {m.name}
          </td>
          <td className="py-1.5 px-3"><TargetCell metric={m} /></td>
          <td className="py-1.5 px-3"><Sparkline values={m.values} lowerIsBetter={m.lowerIsBetter} /></td>
          {m.values.map((v, i) => (
            <td
              key={i}
              className={`py-1.5 px-3 text-right tabular-nums ${
                i === lastIx ? "bg-brown/10 font-semibold text-ink" : "text-inksoft"
              }`}
            >
              {v ? v.raw : <span className="text-muted">·</span>}
            </td>
          ))}
          <td className="py-1.5 px-3 text-right"><DeltaBadge metric={m} /></td>
        </tr>
      ))}
    </>
  );
}
