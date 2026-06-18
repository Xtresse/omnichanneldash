"use client";

import { useEffect, useMemo, useState } from "react";
import { SCENARIOS, hasScenarioGoals, scenarioGoalFor } from "../lib/scenarioGoals.js";

// Brand palette — restrained, used ONLY to signal ahead / behind pace.
const AHEAD    = "#F0922E"; // orange — ≥100% of (prorated) target
const NEAR     = "#9A8F80"; // gray  — 90–100% (on pace)
const BEHIND   = "#5C2F2E"; // maroon — <90% (behind pace)
const NEUTRAL  = "#9A8F80"; // gray  — no target / unknown

const PRODUCTS = ["Gummies", "Serum", "XVIE"]; // Sachets lump into "Other"

const fmt$ = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(v)).toLocaleString();
};
const fmt$k = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return fmt$(v);
};
const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

/** "2026-06" → "June 2026". */
function monthLabel(ym) {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Color for attainment vs a (prorated) target. >=100% favorable, 90–100% on
// pace, <90% behind. null → neutral gray.
function paceTone(pct) {
  if (pct == null || !isFinite(pct)) return NEUTRAL;
  if (pct >= 1.0) return AHEAD;
  if (pct >= 0.9) return NEAR;
  return BEHIND;
}

/** +/- N month list around a center month, for the goal-month selector. */
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
 * Sum the dashboard's productFamily rows into { Gummies, Serum, XVIE, Sachets }
 * net-sales actuals across ALL channels (B2B + ADCS + DTC + any flat value).
 */
function actualsByProduct(productFamily) {
  const totals = { Gummies: 0, Serum: 0, XVIE: 0, Sachets: 0 };
  if (!Array.isArray(productFamily)) return totals;
  for (const row of productFamily) {
    const f = row?.family;
    if (f && totals[f] !== undefined) {
      totals[f] +=
        Number(row.B2B || 0) + Number(row.ADCS || 0) + Number(row.DTC || 0) +
        Number(row.value || row.net || row.amount || 0);
    }
  }
  return totals;
}

/**
 * Clean exec financial view for Actual vs Goal.
 *
 *   1. ONE "so what" header — window net sales ONCE, with a single pace status
 *      against the GOAL (prorated to the loaded window). Budget + Forecast are
 *      small secondary references.
 *   2. Two breakdowns — BY PRODUCT and BY CHANNEL — each: Actual · Target
 *      (prorated goal) · % to goal · variance.
 *   3. Gross margin as its own section (by product + by channel), PLACEHOLDER
 *      COGS until Sam sends real numbers.
 *
 * Proration reuses lib/budgetForecast.js (window + day-count fractions on the
 * dashboard payload): B2B prorates by SELLING days, DTC by CALENDAR days. The
 * headline "All" goal is the blend (B2B·sellingFraction + DTC·calendarFraction),
 * so the By-Product and By-Channel Target columns sum EXACTLY to the headline.
 * Scenario Base/Stretch goals, the Sheet-backed Budget and run-rate Forecast are
 * all preserved.
 */
export default function BudgetVsActual({
  productFamily,
  totalNetSales,
  channelActuals,
  periodLabel,
  budgetForecast,
  grossMargin,
}) {
  const [budgetData, setBudgetData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [scenario, setScenario] = useState("base"); // "base" | "stretch"

  const usingScenario = hasScenarioGoals(selectedMonth);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setBudgetData(j); })
      .catch((e) => { if (!cancelled) setLoadErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const prodActuals = useMemo(() => actualsByProduct(productFamily), [productFamily]);

  // Proration to the loaded window, reusing the SAME day counts as the
  // dashboard's budgetForecast payload (lib/budgetForecast.js). Only active when
  // the window is a sub-month window that sits inside the selected goal month.
  const pro = useMemo(() => {
    const w = budgetForecast?.window;
    const pr = budgetForecast?.proration;
    const off = {
      active: false, sellingFraction: 1, calendarFraction: 1,
      sellingDaysInWindow: pr?.sellingDaysInWindow ?? null,
      sellingDaysInMonth: pr?.sellingDaysInMonth ?? null,
      calendarDaysInWindow: pr?.calendarDaysInWindow ?? null,
      calendarDaysInMonth: pr?.calendarDaysInMonth ?? null,
    };
    if (!w || !pr || !w.proratable || w.ym !== selectedMonth) return off;
    return {
      active: true,
      sellingFraction: pr.sellingFraction,
      calendarFraction: pr.calendarFraction,
      sellingDaysInWindow: pr.sellingDaysInWindow,
      sellingDaysInMonth: pr.sellingDaysInMonth,
      calendarDaysInWindow: pr.calendarDaysInWindow,
      calendarDaysInMonth: pr.calendarDaysInMonth,
    };
  }, [budgetForecast, selectedMonth]);

  const sf = pro.active ? pro.sellingFraction : 1; // B2B / All basis
  const cf = pro.active ? pro.calendarFraction : 1; // DTC basis

  // Per-product full-month rep-goal sum (fallback when no scenario goals).
  const repGoalProduct = useMemo(() => {
    const goalsByRep = budgetData?.repGoals || {};
    const out = { Gummies: 0, Serum: 0, XVIE: 0 };
    for (const p of PRODUCTS) {
      let s = 0;
      for (const rep of Object.keys(goalsByRep)) s += Number(goalsByRep[rep]?.[p]?.[selectedMonth] || 0);
      out[p] = s;
    }
    return out;
  }, [budgetData, selectedMonth]);

  // ── BY PRODUCT ──────────────────────────────────────────────────────────
  // Target prorates each product's B2B slice by selling days and DTC slice by
  // calendar days, so product targets sum to the headline blend.
  const byProduct = useMemo(() => {
    const rows = PRODUCTS.map((p) => {
      const actual = Number(prodActuals[p] || 0);
      const target = usingScenario
        ? scenarioGoalFor(selectedMonth, scenario, p, "B2B") * sf +
          scenarioGoalFor(selectedMonth, scenario, p, "DTC") * cf
        : Number(repGoalProduct[p] || 0) * sf;
      return makeRow(p, actual, target, true);
    });
    const trackedActual = rows.reduce((a, r) => a + r.actual, 0);
    const grandActual = totalNetSales != null ? Number(totalNetSales) : trackedActual;
    const otherActual = Math.max(0, Math.round(grandActual - trackedActual));
    return { rows, otherActual, grandActual };
  }, [prodActuals, usingScenario, selectedMonth, scenario, sf, cf, repGoalProduct, totalNetSales]);

  // ── BY CHANNEL ──────────────────────────────────────────────────────────
  const byChannel = useMemo(() => {
    const ca = channelActuals || {};
    const monthlyB2B = usingScenario
      ? PRODUCTS.reduce((a, p) => a + scenarioGoalFor(selectedMonth, scenario, p, "B2B"), 0)
      : PRODUCTS.reduce((a, p) => a + Number(repGoalProduct[p] || 0), 0);
    const monthlyDTC = usingScenario
      ? PRODUCTS.reduce((a, p) => a + scenarioGoalFor(selectedMonth, scenario, p, "DTC"), 0)
      : 0;

    // ADCS (Aesthetic Derm + Cosmetic Surgery) orders SPORADICALLY — lumpy, not
    // a steady daily cadence — so it is exempt from day-proration and from the
    // daily-pace (% / behind-pace) framing, which would read wildly off on any
    // given day. Show its actual cleanly, flagged "sporadic".
    const adcs = makeRow("ADCS", Number(ca.ADCS || 0), 0, false);
    adcs.sporadic = true;
    const rows = [
      makeRow("B2B", Number(ca.B2B || 0), monthlyB2B * sf, monthlyB2B > 0),
      makeRow("DTC", Number(ca.DTC || 0), monthlyDTC * cf, monthlyDTC > 0),
      adcs,
    ];
    const trackedActual = rows.reduce((a, r) => a + r.actual, 0);
    const grandActual = totalNetSales != null ? Number(totalNetSales) : trackedActual;
    const otherActual = Math.max(0, Math.round(grandActual - trackedActual));
    return { rows, otherActual, grandActual };
  }, [channelActuals, usingScenario, selectedMonth, scenario, sf, cf, repGoalProduct, totalNetSales]);

  // ── Headline (so-what) ────────────────────────────────────────────────────
  const headline = useMemo(() => {
    const actual = byProduct.grandActual;
    // Goal = blended prorated target = sum of by-product (== by-channel) targets.
    const goal = byProduct.rows.reduce((a, r) => a + (r.target || 0), 0);
    return { actual, goal, hasGoal: goal > 0, pct: goal > 0 ? actual / goal : null, variance: actual - goal };
  }, [byProduct]);

  // Full-month goal (un-prorated) for the "of $X monthly" context line.
  const goalMonthValue = useMemo(() => {
    if (usingScenario) {
      return PRODUCTS.reduce(
        (a, p) => a + scenarioGoalFor(selectedMonth, scenario, p, "B2B") + scenarioGoalFor(selectedMonth, scenario, p, "DTC"),
        0
      );
    }
    return PRODUCTS.reduce((a, p) => a + Number(repGoalProduct[p] || 0), 0);
  }, [usingScenario, selectedMonth, scenario, repGoalProduct]);

  // Secondary references: Sheet-backed Budget (distinct from the deck Goal) and
  // the run-rate / sheet Forecast — both prorated to the window.
  const sheetBudgetMonth = useMemo(
    () => PRODUCTS.reduce((a, p) => a + Number(budgetData?.budget?.[p]?.[selectedMonth] || 0), 0),
    [budgetData, selectedMonth]
  );
  const sheetBudgetWindow = sheetBudgetMonth * sf;
  const sc = budgetForecast?.scenarios?.[scenario] || budgetForecast?.scenarios?.base;
  const forecastWindow = Number(sc?.forecast?.combined || 0);
  const forecastMonth = Number(sc?.forecast?.monthlyCombined || 0);
  const forecastSrc = budgetForecast?.forecastSource === "sheet" ? "sheet" : "run-rate";

  const monthOpts = useMemo(() => monthOffsets(selectedMonth, 3, 3), [selectedMonth]);
  const scenarioLabel = SCENARIOS.find((s) => s.key === scenario)?.label || "Base";

  return (
    <div className="space-y-4 md:space-y-5">
      {loadErr && (
        <div className="rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] text-red-900">
          Couldn&apos;t load /api/budget: {loadErr}
        </div>
      )}

      {/* Controls — goal month + scenario only (channel split lives in the
          By-Channel breakdown below). */}
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

        <span className="font-sans text-[10px] md:text-xs text-muted w-full sm:w-auto sm:ml-auto leading-tight">
          Actuals · {periodLabel || "current dashboard window"}
        </span>
      </div>

      {/* ── 1 · SO-WHAT HEADER ───────────────────────────────────────────── */}
      <Headline
        scenarioLabel={usingScenario ? scenarioLabel : null}
        monthName={monthLabel(selectedMonth)}
        actual={headline.actual}
        goal={headline.goal}
        goalMonth={goalMonthValue}
        hasGoal={headline.hasGoal}
        pct={headline.pct}
        variance={headline.variance}
        prorated={pro.active}
        sellingDaysInWindow={pro.sellingDaysInWindow}
        sellingDaysInMonth={pro.sellingDaysInMonth}
        budgetWindow={sheetBudgetWindow}
        budgetMonth={sheetBudgetMonth}
        forecastWindow={forecastWindow}
        forecastMonth={forecastMonth}
        forecastSrc={forecastSrc}
      />

      {/* ── 2 · BREAKDOWNS ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        <Breakdown
          title="By product"
          subtitle="Net sales vs prorated goal"
          rows={byProduct.rows}
          otherActual={byProduct.otherActual}
          grandActual={byProduct.grandActual}
        />
        <Breakdown
          title="By channel"
          subtitle="Net sales vs prorated goal"
          rows={byChannel.rows}
          otherActual={byChannel.otherActual}
          grandActual={byChannel.grandActual}
          footnote={
            pro.active
              ? "B2B prorated by selling days, DTC by calendar days. ADCS orders sporadically — shown at full-period actual, exempt from daily-pace proration."
              : "ADCS orders sporadically — shown at full-period actual, no daily-pace target."
          }
        />
      </div>

      {/* ── 3 · GROSS MARGIN (separate section) ──────────────────────────── */}
      <MarginSection grossMargin={grossMargin} prodActuals={prodActuals} />

      <div className="font-sans text-[10px] text-muted leading-snug">
        All figures are net sales (gross − discounts − returns).{" "}
        <span style={{ color: AHEAD }} className="font-semibold">Orange</span> ≥100% ·{" "}
        <span style={{ color: NEAR }} className="font-semibold">gray</span> 90–100% (on pace) ·{" "}
        <span style={{ color: BEHIND }} className="font-semibold">maroon</span> &lt;90%.
        {usingScenario
          ? ` Goals are the ${scenarioLabel} targets (B2B + DTC), prorated to the dashboard window.`
          : " Goals fall back to the Sheet-backed per-rep goal sum, prorated to the dashboard window."}
      </div>
    </div>
  );
}

// Build a breakdown row with derived pct + variance.
function makeRow(label, actual, target, hasTarget) {
  const t = Number(target) || 0;
  const a = Number(actual) || 0;
  return {
    label,
    actual: a,
    target: hasTarget ? t : null,
    hasTarget: !!hasTarget,
    pct: hasTarget && t > 0 ? a / t : null,
    variance: hasTarget ? a - t : null,
  };
}

// ─── 1 · So-what header ─────────────────────────────────────────────────────

function Headline({
  scenarioLabel, monthName, actual, goal, goalMonth, hasGoal, pct, variance,
  prorated, sellingDaysInWindow, sellingDaysInMonth,
  budgetWindow, budgetMonth, forecastWindow, forecastMonth, forecastSrc,
}) {
  const tone = hasGoal ? paceTone(pct) : NEUTRAL;
  const ahead = (variance || 0) >= 0;
  return (
    <div className="rounded-xl border border-rule bg-card px-5 py-4 md:px-6 md:py-5">
      <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted">
        Net sales · Actual vs Goal{scenarioLabel ? ` · ${scenarioLabel}` : ""} · {monthName}
      </div>

      <div className="mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="font-display text-4xl md:text-5xl font-semibold text-ink tabular-nums leading-none">
            {fmt$(actual)}
          </div>
          {hasGoal && (
            <div className="mt-1.5 font-sans text-xs md:text-sm text-muted tabular-nums">
              vs goal <span className="font-semibold text-inksoft">{fmt$(goal)}</span>
              {prorated ? " · prorated to window" : ""}
            </div>
          )}
        </div>

        {hasGoal ? (
          <div
            className="self-start sm:self-auto rounded-lg px-3.5 py-2.5 font-sans shrink-0"
            style={{ color: tone, backgroundColor: tone + "1A" }}
          >
            <div className="text-lg md:text-xl font-semibold tabular-nums leading-none">
              {fmtPct(pct)} <span className="text-sm font-medium">to goal</span>
            </div>
            <div className="mt-1 text-[11px] md:text-xs font-medium tabular-nums">
              {fmt$(Math.abs(variance))} {ahead ? "ahead of" : "behind"} pace
            </div>
          </div>
        ) : (
          <div className="self-start rounded-lg px-3.5 py-2.5 font-sans text-sm font-semibold" style={{ color: NEUTRAL, backgroundColor: NEUTRAL + "1A" }}>
            No goal set
          </div>
        )}
      </div>

      {/* Secondary references — small, never full-width boxes. */}
      <div className="mt-3 pt-3 border-t border-rule/60 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-sans text-[11px] text-muted">
        {budgetMonth > 0 && (
          <span>
            Budget{prorated ? " (prorated)" : ""}{" "}
            <span className="font-semibold text-inksoft tabular-nums">{fmt$(budgetWindow)}</span>
            <span className="text-muted"> · of {fmt$k(budgetMonth)} mo</span>
          </span>
        )}
        {forecastMonth > 0 && (
          <span>
            Forecast{prorated ? " (prorated)" : ""}{" "}
            <span className="font-semibold text-inksoft tabular-nums">{fmt$(forecastWindow)}</span>
            <span className="text-muted"> · {forecastSrc} · of {fmt$k(forecastMonth)} mo</span>
          </span>
        )}
        {prorated && sellingDaysInWindow != null && (
          <span className="sm:ml-auto">
            {sellingDaysInWindow}/{sellingDaysInMonth} selling days · goal of {fmt$k(goalMonth)} monthly
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 2 · Breakdown (table on md+, stacked cards on mobile) ──────────────────

function Breakdown({ title, subtitle, rows, otherActual = 0, grandActual = 0, footnote }) {
  const totalActual = grandActual;
  const totalTarget = rows.reduce((a, r) => a + (r.target || 0), 0);
  const totalHasTarget = totalTarget > 0;
  const totalPct = totalHasTarget ? totalActual / totalTarget : null;
  const totalVar = totalHasTarget ? totalActual - totalTarget : null;

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-4 py-3 md:px-5 border-b border-rule/60">
        <h4 className="font-display text-base md:text-lg font-semibold text-ink">{title}</h4>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted">{subtitle}</span>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-[11px] md:text-xs font-sans border-collapse">
          <thead>
            <tr className="text-left">
              <Th align="left">Name</Th>
              <Th align="right">Actual</Th>
              <Th align="right">Target</Th>
              <Th align="right">% Goal</Th>
              <Th align="right">Δ</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-rule/50">
                <Td className="font-medium text-ink">
                  {r.label}
                  {r.sporadic && <SporadicTag />}
                </Td>
                <Td align="right" className="font-semibold text-ink">{fmt$(r.actual)}</Td>
                {r.sporadic ? (
                  <Td align="right" colSpan={3} className="text-muted italic">full-period actual · no daily pace</Td>
                ) : (
                  <>
                    <Td align="right" className="text-inksoft">{r.hasTarget ? fmt$(r.target) : "—"}</Td>
                    <Td align="right" style={{ color: paceTone(r.pct) }} className="font-semibold">
                      {r.pct == null ? "—" : fmtPct(r.pct)}
                    </Td>
                    <Td align="right" style={{ color: paceTone(r.pct) }}>
                      {r.variance == null ? "—" : (r.variance >= 0 ? "+" : "") + fmt$(r.variance)}
                    </Td>
                  </>
                )}
              </tr>
            ))}
            {otherActual > 0 && (
              <tr className="border-t border-rule/50">
                <Td className="italic text-muted">Other</Td>
                <Td align="right" className="text-muted">{fmt$(otherActual)}</Td>
                <Td align="right" className="text-muted">—</Td>
                <Td align="right" className="text-muted">—</Td>
                <Td align="right" className="text-muted">—</Td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-paper2 font-semibold border-t border-rule">
              <Td className="text-inksoft">Total</Td>
              <Td align="right" className="text-ink">{fmt$(totalActual)}</Td>
              <Td align="right" className="text-inksoft">{totalHasTarget ? fmt$(totalTarget) : "—"}</Td>
              <Td align="right" style={{ color: paceTone(totalPct) }}>{totalPct == null ? "—" : fmtPct(totalPct)}</Td>
              <Td align="right" style={{ color: paceTone(totalPct) }}>
                {totalVar == null ? "—" : (totalVar >= 0 ? "+" : "") + fmt$(totalVar)}
              </Td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile stacked cards — no horizontal scroll */}
      <div className="sm:hidden divide-y divide-rule/50">
        {rows.map((r) => (
          <div key={r.label} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-sm font-semibold text-ink">
                {r.label}
                {r.sporadic && <SporadicTag />}
              </span>
              <span className="font-display text-base font-semibold text-ink tabular-nums">{fmt$(r.actual)}</span>
            </div>
            <div className="mt-1 font-sans text-[11px] tabular-nums">
              {r.sporadic ? (
                <span className="text-muted italic">Full-period actual · daily pace n/a</span>
              ) : (
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-muted">Target {r.hasTarget ? fmt$(r.target) : "—"}</span>
                  <span className="font-semibold" style={{ color: paceTone(r.pct) }}>
                    {r.pct == null ? "—" : `${fmtPct(r.pct)} to goal`}
                    {r.variance != null && (
                      <span className="font-medium"> · {(r.variance >= 0 ? "+" : "") + fmt$(r.variance)}</span>
                    )}
                  </span>
                </span>
              )}
            </div>
          </div>
        ))}
        {otherActual > 0 && (
          <div className="px-4 py-3 flex items-baseline justify-between gap-2">
            <span className="font-sans text-sm italic text-muted">Other</span>
            <span className="font-display text-base font-semibold text-muted tabular-nums">{fmt$(otherActual)}</span>
          </div>
        )}
        <div className="px-4 py-3 bg-paper2 flex items-baseline justify-between gap-2">
          <span className="font-sans text-sm font-semibold text-inksoft">Total</span>
          <div className="text-right">
            <div className="font-display text-base font-semibold text-ink tabular-nums">{fmt$(totalActual)}</div>
            {totalHasTarget && (
              <div className="font-sans text-[11px] tabular-nums font-semibold" style={{ color: paceTone(totalPct) }}>
                {fmtPct(totalPct)} to goal
              </div>
            )}
          </div>
        </div>
      </div>

      {footnote && (
        <div className="px-4 py-2 md:px-5 font-sans text-[10px] text-muted leading-snug border-t border-rule/50">
          {footnote}
        </div>
      )}
    </div>
  );
}

// ─── 3 · Gross margin section (PLACEHOLDER COGS) ────────────────────────────

function MarginSection({ grossMargin, prodActuals }) {
  if (!grossMargin || !grossMargin.overall) return null;
  const o = grossMargin.overall;
  const bc = grossMargin.byChannel || {};
  const bf = grossMargin.byFamily || {};

  // By product — revenue from the dashboard window actuals, COGS from byFamily.
  const productRows = PRODUCTS.map((p) => {
    const revenue = Number(prodActuals[p] || 0);
    const cogs = Number(bf[p] || 0);
    const gp = revenue - cogs;
    return {
      label: p,
      revenue,
      grossProfit: Math.round(gp),
      grossMarginPct: revenue > 0 ? Math.round((gp / revenue) * 1000) / 10 : null,
    };
  });

  const channelRows = [
    ["B2B", bc.B2B],
    ["DTC", bc.DTC],
    ["ADCS", bc.ADCS],
  ]
    .filter(([, v]) => v && (v.revenue || 0) > 0)
    .map(([label, v]) => ({ label, revenue: v.revenue, grossProfit: v.grossProfit, grossMarginPct: v.grossMarginPct }));

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-5 border-b border-rule/60">
        <h4 className="font-display text-base md:text-lg font-semibold text-ink">Gross margin</h4>
        <div className="flex items-center gap-2">
          <span className="font-display text-base md:text-lg font-semibold text-ink tabular-nums">{fmt$(o.grossProfit)}</span>
          <span className="font-sans text-xs tabular-nums text-brown">{o.grossMarginPct == null ? "—" : `${o.grossMarginPct}%`}</span>
          {grossMargin.placeholder && (
            <span className="font-sans text-[9px] uppercase tracking-[0.14em] font-semibold text-brown border border-brown/40 rounded px-1.5 py-0.5 whitespace-nowrap">
              Placeholder COGS
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-rule/50">
        <MarginTable title="By product" rows={productRows} />
        <MarginTable title="By channel" rows={channelRows} />
      </div>

      {grossMargin.placeholder && (
        <div className="px-4 py-2 md:px-5 font-sans text-[10px] text-muted leading-snug border-t border-rule/50">
          {grossMargin.note || "PLACEHOLDER COGS — replace with Sam's COGS in lib/cogs.js."}
        </div>
      )}
    </div>
  );
}

function MarginTable({ title, rows }) {
  return (
    <div>
      <div className="px-4 py-2 md:px-5 font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold">
        {title}
      </div>
      <table className="w-full text-[11px] md:text-xs font-sans border-collapse">
        <thead>
          <tr className="text-left">
            <Th align="left">Name</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">GP</Th>
            <Th align="right">GM %</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-rule/50">
              <Td className="font-medium text-ink">{r.label}</Td>
              <Td align="right" className="text-inksoft">{fmt$(r.revenue)}</Td>
              <Td align="right" className="font-semibold text-ink">{fmt$(r.grossProfit)}</Td>
              <Td align="right" className="text-brown font-semibold">{r.grossMarginPct == null ? "—" : `${r.grossMarginPct}%`}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Base / Stretch segmented toggle ────────────────────────────────────────

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

// Small "sporadic" chip — marks a channel (ADCS) whose lumpy order cadence
// makes any daily-pace % misleading, so it's shown at full-period actual only.
function SporadicTag() {
  return (
    <span className="ml-1.5 align-middle inline-block font-sans text-[8px] md:text-[9px] uppercase tracking-[0.12em] font-semibold text-brown border border-brown/40 rounded px-1 py-0.5">
      sporadic
    </span>
  );
}

// ─── Cell helpers ───────────────────────────────────────────────────────────

function Th({ children, align = "left", className = "" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  // Tight first-column inset (aligns under the card title), snug numeric cols so
  // five columns + large variance values fit the card without clipping.
  const padClass = align === "right" ? "px-2 md:px-3" : "pl-4 pr-2 md:pl-5";
  return (
    <th className={`py-2 ${padClass} font-sans text-[10px] uppercase tracking-[0.14em] text-muted font-semibold ${alignClass} ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, align = "left", className = "", style, colSpan }) {
  const alignClass = align === "right" ? "text-right tabular-nums" : "text-left";
  const padClass = align === "right" ? "px-2 md:px-3" : "pl-4 pr-2 md:pl-5";
  return (
    <td colSpan={colSpan} style={style} className={`py-2 ${padClass} text-inksoft whitespace-nowrap ${alignClass} ${className}`}>
      {children}
    </td>
  );
}
