"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, LabelList,
} from "recharts";
import { SCENARIOS, hasScenarioGoals, scenarioGoalFor } from "../lib/scenarioGoals.js";

// Brand palette (mirrors KpiTiles + RepPerformance for consistency).
const FAVORABLE = "#F0922E";   // orange — ≥100% of target (on/over goal)
const PARTIAL   = "#9A8F80";   // gray — 90–100% of target (almost)
const UNFAVORABLE = "#5C2F2E"; // brand maroon — <90% of target
const NEUTRAL   = "#9A8F80";   // gray — no target / unknown

// Goal vs Actual: brand maroon reference (Goal) + brand orange (Actual).
// Was near-black (#2B1A10) which read as a heavy all-black block — swapped
// to the brand maroon so charts sit in the cream/maroon/orange palette.
// (Names kept for minimal churn downstream.)
const BRAND_SAGE  = "#5C2F2E"; // Goal — brand maroon reference
const BRAND_AMBER = "#F0922E"; // Actual — brand orange

const PRODUCTS = ["Gummies", "Serum", "XVIE"]; // Sachets lumped into Gummies (2026-05)

// Distinct per-product colors (warm, on-brand) so products are tellable apart
// in the % to goal chart — Gummies orange, Serum terracotta, XVIE maroon.
const PRODUCT_COLOR = {
  Gummies: "#F0922E",
  Serum:   "#B85042",
  XVIE:    "#5C2F2E",
};

const fmt$ = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(v)).toLocaleString();
};
const fmt$k = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return fmt$(v);
};
const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

/** "2026-05" → label like "May 2026". */
function monthLabel(ym) {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function colorForPct(pct) {
  if (!isFinite(pct)) return NEUTRAL;
  if (pct >= 1.0)  return FAVORABLE;
  if (pct >= 0.9)  return PARTIAL;
  return UNFAVORABLE;
}

// Fraction of `ym` (YYYY-MM) elapsed today: full month in the past → 1,
// future month → 0, current month → day-of-month / days-in-month. Used to
// judge whether a product's MTD attainment is ahead of or behind pace.
function monthProgressFraction(ym) {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!ym || ym < cur) return 1;
  if (ym > cur) return 0;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() / daysInMonth;
}

/** Build the +/- N month list around a center month. */
function monthOffsets(center, before = 3, after = 3) {
  if (!center) return [];
  const [y, m] = center.split("-").map(Number);
  const out = [];
  for (let d = -before; d <= after; d++) {
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Map omnichanneldash productFamily entries → BudgetVsActual products.
 * The dashboard's productFamily has entries with `family` field:
 *   "Gummies" | "Serum" | "XVIE" | "Sachets" | "Other" | "Excluded"
 * We only consume the four targeted families and ignore Other/Excluded.
 */
function actualsFromProductFamily(productFamily) {
  const totals = { Gummies: 0, Serum: 0, XVIE: 0, Sachets: 0 };
  if (!Array.isArray(productFamily)) return totals;
  for (const row of productFamily) {
    const f = row?.family;
    if (f && totals[f] !== undefined) {
      // Dashboard's productFamily rows are { family, B2B, ADCS, DTC }.
      // Actuals for budget comparison = sum across all channels. We
      // also fall back to flat-shape entries (value/net/amount) in case
      // upstream schema ever changes.
      totals[f] +=
        Number(row.B2B || 0) +
        Number(row.ADCS || 0) +
        Number(row.DTC || 0) +
        Number(row.value || row.net || row.amount || 0);
    }
  }
  return totals;
}

/**
 * Actual vs Goal section. Renders inside a Section (the collapsible
 * wrapper) in Dashboard.jsx. Reads:
 *   - /api/budget for rep goals (Sheet-backed; stub when env vars not
 *     set). The same endpoint also returns company-budget numbers, but
 *     they're intentionally not displayed here — Sam only wants the
 *     Actual-vs-Goal comparison surfaced. Budget data is still fetched
 *     so it's available if we ever want to flip it back on.
 *   - data.productFamily from the parent dashboard load for the
 *     current period's actuals
 *
 * Headline: a per-product table comparing the SELECTED month's rep-goal
 * total to the dashboard's currently-loaded actuals. Recharts
 * visualizations sit below the table.
 */
export default function BudgetVsActual({ productFamily, totalNetSales, periodLabel }) {
  const [budgetData, setBudgetData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [scenario, setScenario] = useState("base"); // "base" | "stretch"
  const [drillRep, setDrillRep] = useState(null);

  // When the selected month has Base/Stretch scenario goals defined, the
  // Goal column is driven by the chosen scenario (company-level product
  // targets). Months without a scenario fall back to the Sheet-backed
  // per-rep goal sum (legacy behavior).
  const usingScenario = hasScenarioGoals(selectedMonth);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setBudgetData(j); })
      .catch((e) => { if (!cancelled) setLoadErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const actuals = useMemo(() => actualsFromProductFamily(productFamily), [productFamily]);

  // Build the per-product rows for the selected month.
  const rows = useMemo(() => {
    const b = budgetData?.budget || {};
    const goalsByRep = budgetData?.repGoals || {};
    const out = PRODUCTS.map((p) => {
      const budget = Number(b[p]?.[selectedMonth] || 0);
      let repGoalSum = 0;
      for (const rep of Object.keys(goalsByRep)) {
        repGoalSum += Number(goalsByRep[rep]?.[p]?.[selectedMonth] || 0);
      }
      // Scenario goal (Base/Stretch) takes precedence when defined for this
      // month; otherwise fall back to the summed per-rep goals.
      const goalSum = usingScenario
        ? scenarioGoalFor(selectedMonth, scenario, p)
        : repGoalSum;
      const actual = Number(actuals[p] || 0);
      const dBudget = actual - budget;
      const dGoal = actual - goalSum;
      const pctBudget = budget > 0 ? actual / budget : null;
      const pctGoal = goalSum > 0 ? actual / goalSum : null;
      return { product: p, budget, goal: goalSum, actual, dBudget, dGoal, pctBudget, pctGoal };
    });
    return out;
  }, [budgetData, selectedMonth, actuals, usingScenario, scenario]);

  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, r) => ({
        budget: acc.budget + r.budget,
        goal: acc.goal + r.goal,
        actual: acc.actual + r.actual,
      }),
      { budget: 0, goal: 0, actual: 0 }
    );
    // The four product families don't cover every SKU (apparel / shipping /
    // uncategorized roll up to "Other"), so summing them lands short of the
    // dashboard's headline net sales. Reconcile to the canonical total so
    // the Total row TIES to the number up top; the gap is surfaced as an
    // "Other (unbudgeted)" line below.
    const trackedActual = t.actual;
    const grandActual = totalNetSales != null ? totalNetSales : trackedActual;
    const otherActual = Math.max(0, Math.round(grandActual - trackedActual));
    return {
      ...t,
      trackedActual,
      otherActual,
      actual: grandActual,
      dBudget: grandActual - t.budget,
      dGoal: grandActual - t.goal,
      pctBudget: t.budget > 0 ? grandActual / t.budget : null,
      pctGoal: t.goal > 0 ? grandActual / t.goal : null,
    };
  }, [rows, totalNetSales]);

  const monthOpts = useMemo(() => monthOffsets(selectedMonth, 3, 3), [selectedMonth]);
  const isStub = budgetData?.mode === "stub";

  // Label for the goal column / readouts: scenario-aware when active.
  const scenarioLabel = SCENARIOS.find((s) => s.key === scenario)?.label || "Base";
  const goalColLabel = usingScenario ? `Goal · ${scenarioLabel}` : "Rep Goal";

  return (
    <div className="space-y-3 md:space-y-4">
      {loadErr && (
        <div className="rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] text-red-900">
          Couldn&apos;t load /api/budget: {loadErr}
        </div>
      )}

      {/* Month selector + actuals window */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted font-semibold shrink-0">
          Goal month
        </span>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="min-w-0 rounded border border-rule bg-paper px-2 py-1 font-sans text-xs md:text-sm text-inksoft min-h-touch sm:min-h-0"
        >
          {monthOpts.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSelectedMonth(currentMonth())}
          className="shrink-0 rounded border border-rule bg-paper hover:bg-paper2 px-2 py-1 font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-inksoft min-h-touch sm:min-h-0"
          title="Reset to the current calendar month"
        >
          This month
        </button>

        {usingScenario && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted font-semibold hidden sm:inline">
              Goal
            </span>
            <ScenarioToggle value={scenario} onChange={setScenario} />
          </div>
        )}

        <span className="font-sans text-[9px] md:text-[10px] uppercase tracking-[0.16em] font-semibold text-brown border border-brown/40 rounded px-1.5 py-0.5 shrink-0">
          Net sales
        </span>
        <span className="font-sans text-[10px] md:text-xs text-muted w-full sm:w-auto sm:ml-auto leading-tight">
          Actuals · {periodLabel || "current dashboard window"}
        </span>
      </div>

      {/* Combined TOTAL vs Goal + made-budget indicator */}
      {(() => {
        const noGoal = !(totals.goal > 0);
        const made = !noGoal && totals.actual >= totals.goal;
        const short = totals.goal - totals.actual;
        const tone = noGoal ? NEUTRAL : made ? FAVORABLE : UNFAVORABLE;
        return (
          <div className="rounded-xl border border-rule bg-card px-4 py-3 md:px-5 md:py-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted">
                Total · Actual vs Goal · Net{usingScenario ? ` · ${scenarioLabel}` : ""} · {monthLabel(selectedMonth)}
              </div>
              <div className="flex items-baseline gap-2 md:gap-3 mt-0.5">
                <span className="font-display text-2xl md:text-3xl font-semibold text-ink tabular-nums">{fmt$(totals.actual)}</span>
                <span className="font-sans text-xs md:text-sm text-muted tabular-nums">/ goal {fmt$(totals.goal)}</span>
              </div>
            </div>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 font-sans font-semibold"
              style={{ color: tone, backgroundColor: tone + "1A" }}
            >
              {noGoal ? (
                <span className="text-sm">No goal set</span>
              ) : made ? (
                <span className="text-sm md:text-base">{"✔"} Budget met · {fmtPct(totals.pctGoal)}</span>
              ) : (
                <span className="text-sm md:text-base">{fmtPct(totals.pctGoal)} to goal · {fmt$(Math.abs(short))} short</span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Per-product table */}
      <div className="bg-card border border-rule rounded-xl overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs font-sans border-collapse">
            <thead>
              <tr className="bg-paper2 text-left">
                <Th align="left">Product</Th>
                <Th align="right">{goalColLabel}</Th>
                <Th align="right">Actual</Th>
                <Th align="right">Δ Goal→Actual</Th>
                <Th align="right">% to Goal</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product} className="border-t border-rule/60">
                  <Td className="font-medium text-ink">{r.product}</Td>
                  <Td align="right">{fmt$(r.goal)}</Td>
                  <Td align="right" className="font-semibold">{fmt$(r.actual)}</Td>
                  <Td align="right" style={{ color: colorForPct(r.pctGoal) }}>
                    {(r.dGoal >= 0 ? "+" : "") + fmt$(r.dGoal)}
                  </Td>
                  <Td align="right" style={{ color: colorForPct(r.pctGoal) }}>
                    {r.pctGoal == null ? "—" : fmtPct(r.pctGoal)}
                  </Td>
                </tr>
              ))}
              {totals.otherActual > 0 && (
                <tr className="border-t border-rule/60">
                  <Td className="italic text-muted">Other (unbudgeted)</Td>
                  <Td align="right" className="text-muted">—</Td>
                  <Td align="right" className="text-muted">{fmt$(totals.otherActual)}</Td>
                  <Td align="right" className="text-muted">—</Td>
                  <Td align="right" className="text-muted">—</Td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-paper2 font-semibold border-t border-rule/60">
                <Td className="italic text-inksoft">Total</Td>
                <Td align="right">{fmt$(totals.goal)}</Td>
                <Td align="right" className="text-ink">{fmt$(totals.actual)}</Td>
                <Td align="right" style={{ color: colorForPct(totals.pctGoal) }}>
                  {(totals.dGoal >= 0 ? "+" : "") + fmt$(totals.dGoal)}
                </Td>
                <Td align="right" style={{ color: colorForPct(totals.pctGoal) }}>
                  {totals.pctGoal == null ? "—" : fmtPct(totals.pctGoal)}
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile: stacked cards */}
        <div className="md:hidden divide-y divide-rule/60">
          {rows.map((r) => (
            <button
              key={r.product}
              type="button"
              onClick={() => setDrillRep("ALL")}
              className="block w-full text-left px-4 py-3 hover:bg-paper2 focus:outline-none"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-sans text-sm font-semibold text-ink">{r.product}</span>
                <span className="font-display text-base font-semibold text-ink tabular-nums">{fmt$(r.actual)}</span>
              </div>
              <div className="font-sans text-[11px] text-muted tabular-nums mt-1">
                Goal {fmt$(r.goal)}
              </div>
              <div className="font-sans text-[11px] tabular-nums mt-0.5" style={{ color: colorForPct(r.pctGoal) }}>
                {r.pctGoal == null ? "—" : fmtPct(r.pctGoal)} of goal
              </div>
            </button>
          ))}
          {totals.otherActual > 0 && (
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-sans text-sm font-semibold text-muted italic">Other (unbudgeted)</span>
                <span className="font-display text-base font-semibold text-muted tabular-nums">{fmt$(totals.otherActual)}</span>
              </div>
              <div className="font-sans text-[11px] text-muted tabular-nums mt-1">No goal</div>
            </div>
          )}
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <ChartCell title="Goal vs Actual" subtitle="Per product · click a bar to drill in">
          <GroupedBars rows={rows} onSelect={setDrillRep} />
        </ChartCell>
        <ChartCell title="Variance" subtitle="Actual · Goal · Variance">
          <Waterfall totals={totals} onSelect={setDrillRep} />
        </ChartCell>
        <ChartCell title="% to goal" subtitle="By product · lines at pace & 100% · click to drill" wide>
          <PaceBars rows={rows} monthProgress={monthProgressFraction(selectedMonth)} onSelect={setDrillRep} />
        </ChartCell>
      </div>

      {/* Per-rep drill-down drawer */}
      {drillRep && (
        <RepDrillDrawer
          rep={drillRep}
          selectedMonth={selectedMonth}
          repGoals={budgetData?.repGoals || {}}
          actuals={actuals}
          onClose={() => setDrillRep(null)}
        />
      )}

      <div className="font-sans text-[10px] text-muted leading-snug">
        Table % to goal: <span style={{ color: FAVORABLE }} className="font-semibold">orange</span> ≥100% ·{" "}
        <span style={{ color: PARTIAL }} className="font-semibold">gray</span> 90–100% ·{" "}
        <span style={{ color: UNFAVORABLE }} className="font-semibold">maroon</span> &lt;90%.
        In the charts, each product has its own color — click any bar to drill into rep goals.
        {usingScenario
          ? " All figures are net sales (gross − discounts − returns). Goals are the June Base / Stretch targets — B2B + DTC ($120k DTC: 90% gummies / 10% serum) — toggle above; actuals come from the dashboard's current date window."
          : " All figures are net sales. Actuals come from the dashboard's current date window — change the date range above to see other periods."}
      </div>
    </div>
  );
}

// ─── Base / Stretch segmented toggle (mirrors Dashboard.jsx MetricToggle) ─

function ScenarioToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-rule overflow-hidden">
      {SCENARIOS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.12em] px-2 py-1 min-h-touch sm:min-h-0 ${
            value === o.key ? "bg-brown text-ink font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Chart cell wrapper (mirrors Dashboard.jsx ChartCell) ──────────────

function ChartCell({ title, subtitle, children, wide }) {
  return (
    <div className={`bg-card border border-rule rounded-xl p-3 md:p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="flex items-baseline justify-between gap-2 mb-2 md:mb-3">
        <h4 className="font-display text-base md:text-lg font-semibold text-ink">{title}</h4>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted">{subtitle}</span>
      </div>
      <div className="h-64 md:h-72">{children}</div>
    </div>
  );
}

// Rich tooltip for the Goal-vs-Actual grouped bars: shows Goal, Actual,
// variance and % to goal for the hovered product.
function GoalActualTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const goal = Number(payload.find((p) => p.dataKey === "Goal")?.value || 0);
  const actual = Number(payload.find((p) => p.dataKey === "Actual")?.value || 0);
  const dv = actual - goal;
  const pct = goal > 0 ? actual / goal : null;
  return (
    <div className="rounded-md border border-rule bg-card px-3 py-2 shadow-sm font-sans text-[11px] text-inksoft">
      <div className="font-semibold text-ink mb-1">{label}</div>
      <div>Goal <span className="tabular-nums font-semibold text-ink">{fmt$(goal)}</span></div>
      <div>Actual <span className="tabular-nums font-semibold text-ink">{fmt$(actual)}</span></div>
      <div style={{ color: colorForPct(pct) }}>
        {dv >= 0 ? "+" : ""}{fmt$(dv)}{pct != null ? ` · ${fmtPct(pct)} to goal` : ""}
      </div>
      <div className="text-muted mt-1">Click to drill into reps</div>
    </div>
  );
}

// ─── Chart: grouped bars (Goal vs Actual per product) ──────────────────

function GroupedBars({ rows, onSelect }) {
  const data = rows.map((r) => ({ product: r.product, Goal: r.goal, Actual: r.actual }));
  const handleClick = (d) => { if (onSelect && d?.product) onSelect(d.product); };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="product" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={fmt$k} tickLine={false} axisLine={false} width={56} />
        <Tooltip cursor={{ fill: "#5C2F2E0F" }} content={<GoalActualTooltip />} />
        <Legend wrapperStyle={{ paddingTop: 4 }} />
        <Bar dataKey="Goal" fill={BRAND_SAGE} cursor="pointer" onClick={handleClick} />
        <Bar dataKey="Actual" fill={BRAND_AMBER} cursor="pointer" onClick={handleClick} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Chart: Actual · Goal · Variance ───────────────────────────────────

function Waterfall({ totals, onSelect }) {
  // Three plain bars in Sam's order — Actual, Goal, then Variance (signed:
  // negative renders below the zero line). Orange = actual / favorable,
  // maroon = goal / shortfall.
  const goal = totals.goal;
  const actual = totals.actual;
  const variance = actual - goal;

  const data = [
    { name: "Actual", value: actual, color: BRAND_AMBER },
    { name: "Goal", value: goal, color: BRAND_SAGE },
    { name: "Variance", value: variance, color: variance >= 0 ? FAVORABLE : UNFAVORABLE },
  ];
  const handleClick = () => { if (onSelect) onSelect("ALL"); };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <YAxis tickFormatter={fmt$k} tickLine={false} axisLine={false} width={56} />
        <Tooltip cursor={{ fill: "#5C2F2E0F" }} formatter={(v) => [fmt$(v), ""]} labelClassName="font-semibold" />
        <ReferenceLine y={0} stroke="#9A8F80" />
        <Bar dataKey="value" cursor="pointer" onClick={handleClick}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
          <LabelList dataKey="value" position="top" formatter={(v) => fmt$k(v)} style={{ fontSize: 11, fill: "#5A4F40" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Chart: % to goal (horizontal, per-product colors) ─────────────────

function PaceTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-rule bg-card px-3 py-2 shadow-sm font-sans text-[11px] text-inksoft">
      <div className="font-semibold text-ink mb-1">{p.product}</div>
      <div>Actual <span className="tabular-nums font-semibold text-ink">{fmt$(p.actual)}</span></div>
      <div>Goal <span className="tabular-nums font-semibold text-ink">{fmt$(p.goal)}</span></div>
      <div className="tabular-nums font-semibold" style={{ color: p.color }}>{p.pctGoal}% to goal</div>
      <div className="text-muted mt-1">Click to drill into reps</div>
    </div>
  );
}

function PaceBars({ rows, monthProgress = 0, onSelect }) {
  const data = rows.map((r) => ({
    product: r.product,
    pctGoal: Math.round((r.pctGoal || 0) * 100),
    actual: r.actual,
    goal: r.goal,
    color: PRODUCT_COLOR[r.product] || BRAND_AMBER,
  }));
  const pacePct = Math.round((monthProgress || 0) * 100);
  const handleClick = (d) => { if (onSelect && d?.product) onSelect(d.product); };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" horizontal={false} />
        <XAxis type="number" domain={[0, "dataMax + 20"]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="product" tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11 }} />
        <Tooltip cursor={{ fill: "#5C2F2E0F" }} content={<PaceTooltip />} />
        {pacePct > 0 && pacePct < 100 && (
          <ReferenceLine x={pacePct} stroke="#9A8F80" strokeDasharray="4 4" label={{ value: `pace ${pacePct}%`, fill: "#9A8F80", fontSize: 10, position: "top" }} />
        )}
        <ReferenceLine x={100} stroke="#5A4F40" strokeDasharray="4 4" label={{ value: "100% target", fill: "#5A4F40", fontSize: 10, position: "right" }} />
        <Bar dataKey="pctGoal" name="% of Goal" cursor="pointer" onClick={handleClick}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
          <LabelList dataKey="pctGoal" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: "#5A4F40" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Per-rep drill-down drawer ────────────────────────────────────────

function RepDrillDrawer({ rep, selectedMonth, repGoals, actuals, onClose }) {
  // For v0: just show the rep-goal table for the selected month. Actuals
  // are dashboard-wide (no per-rep actual computation in this section
  // yet — that lives in the existing rep performance table).
  const repList = Object.keys(repGoals);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="Close drill-down"
      />
      <div className="relative w-full max-w-md bg-card border-l border-rule shadow-xl overflow-y-auto">
        <div className="bg-browndeep text-paper px-4 py-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Per-rep goal · {monthLabel(selectedMonth)}</h3>
          <button onClick={onClose} className="font-sans text-xs uppercase tracking-[0.14em] bg-paper/10 hover:bg-paper/20 border border-paper/30 rounded px-2 py-0.5">
            Close
          </button>
        </div>
        <div className="p-4 space-y-3">
          {repList.length === 0 ? (
            <p className="font-sans text-sm text-muted">
              No rep goals entered yet for any month. Once the &quot;Rep Goals&quot; tab is populated,
              each rep&apos;s per-product target shows here.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs font-sans border-collapse">
                <thead>
                  <tr className="bg-paper2 text-left">
                    <Th align="left">Rep</Th>
                    {PRODUCTS.map((p) => <Th key={p} align="right">{p}</Th>)}
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {repList.map((r) => {
                    const cells = PRODUCTS.map((p) => Number(repGoals[r]?.[p]?.[selectedMonth] || 0));
                    const tot = cells.reduce((a, b) => a + b, 0);
                    return (
                      <tr key={r} className="border-t border-rule/60">
                        <Td className="font-medium text-ink">{r}</Td>
                        {cells.map((v, i) => <Td key={i} align="right">{fmt$(v)}</Td>)}
                        <Td align="right" className="font-semibold">{fmt$(tot)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="font-sans text-[10px] text-muted leading-snug">
            Per-rep <em>actual</em> contribution is in the &quot;Sales by rep&quot; section above.
            This drawer just lists rep-level targets for the selected month.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Cell helpers ─────────────────────────────────────────────────────

function Th({ children, align = "left", className = "" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <th className={`py-2 px-3 font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ${alignClass} ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, align = "left", className = "", style }) {
  const alignClass = align === "right" ? "text-right tabular-nums" : "text-left";
  return (
    <td
      style={style}
      className={`py-2 px-3 text-inksoft whitespace-nowrap ${alignClass} ${className}`}
    >
      {children}
    </td>
  );
}
