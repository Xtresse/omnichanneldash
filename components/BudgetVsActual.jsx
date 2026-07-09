"use client";

import { useEffect, useMemo, useState } from "react";
import { TIERS, hasScenarioGoals, scenarioGoalFor } from "../lib/scenarioGoals.js";

// Brand palette — restrained, used ONLY to signal ahead / behind pace.
const AHEAD    = "#F0922E"; // orange — ≥100% of (prorated) target
const NEAR     = "#9A8F80"; // gray  — 90–100% (on pace)
const BEHIND   = "#5C2F2E"; // maroon — <90% (behind pace)
const NEUTRAL  = "#9A8F80"; // gray  — no target / unknown

const PRODUCTS = ["Gummies", "Serum", "XVIE", "Sachets"]; // the 4 tracked families — "Other" is genuinely-uncategorized SKUs only
const ALL_PRODUCTS = PRODUCTS; // kept as an alias — TARGET sums loop over every tracked product
const CHANNELS = ["B2B", "DTC", "ADCS"];

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

function paceTone(pct) {
  if (pct == null || !isFinite(pct)) return NEUTRAL;
  if (pct >= 1.0) return AHEAD;
  if (pct >= 0.9) return NEAR;
  return BEHIND;
}

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
 * Net OR gross actuals by product across all channels, depending on `basis`.
 * productFamily rows carry both net (B2B/ADCS/DTC) and gross (B2B_gross/…).
 */
function actualsByProduct(productFamily, basis) {
  const totals = { Gummies: 0, Serum: 0, XVIE: 0, Sachets: 0 };
  if (!Array.isArray(productFamily)) return totals;
  const g = basis === "gross";
  for (const row of productFamily) {
    const f = row?.family;
    if (f && totals[f] !== undefined) {
      totals[f] += g
        ? Number(row.B2B_gross || 0) + Number(row.ADCS_gross || 0) + Number(row.DTC_gross || 0)
        : Number(row.B2B || 0) + Number(row.ADCS || 0) + Number(row.DTC || 0);
    }
  }
  return totals;
}

/**
 * Actual-vs-Goal — three target tiers (Budget / Base / Stretch) on the basis
 * (Gross / Net) chosen by the dashboard's global toggle.
 *
 * Targets come from the Google Sheet cube (lib/budgetSheet → /api/budget):
 *   targets.company[channel][product][month][tier][basis]
 * Base/Stretch NET fall back to the deck scenario goals (lib/scenarioGoals) so
 * the section still shows real numbers before the sheet is wired live; Budget
 * and gross targets only ever come from the sheet (else "—").
 *
 * Proration to the loaded window reuses lib/budgetForecast: B2B prorates by
 * SELLING days, DTC by CALENDAR days, so per-product and per-channel targets
 * sum exactly to the headline goal.
 */
export default function BudgetVsActual({
  productFamily,
  totalNetSales,
  totalGrossSales,
  channelActuals,
  channelActualsGross,
  periodLabel,
  budgetForecast,
  grossMargin,
  metric = "net",
}) {
  const [budgetData, setBudgetData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [tier, setTier] = useState("base"); // "budget" | "base" | "stretch"

  const basis = metric === "gross" ? "gross" : "net";
  const basisLabel = basis === "gross" ? "Gross" : "Net";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/budget", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setBudgetData(j); })
      .catch((e) => { if (!cancelled) setLoadErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const targets = budgetData?.targets || { company: {}, rep: {} };

  // Company target $ for (channel, product) at the selected month/tier/basis.
  // Falls back to the deck scenario goals for NET Base/Stretch only.
  const coTarget = useMemo(() => {
    const co = targets.company || {};
    const pick = (ch, p) => Number(co?.[ch]?.[p]?.[selectedMonth]?.[tier]?.[basis] || 0);
    return (channel, product) => {
      let v = channel === "All"
        ? pick("B2B", product) + pick("DTC", product) + pick("ADCS", product)
        : pick(channel, product);
      if (!v && basis === "net" && (tier === "base" || tier === "stretch") && hasScenarioGoals(selectedMonth)) {
        v = scenarioGoalFor(selectedMonth, tier, product, channel);
      }
      return v;
    };
  }, [targets, selectedMonth, tier, basis]);

  // Metric-aware actuals.
  const prodActuals = useMemo(() => actualsByProduct(productFamily, basis), [productFamily, basis]);
  const channelAct = (basis === "gross" ? channelActualsGross : channelActuals) || {};
  const grandActualRaw = basis === "gross" ? totalGrossSales : totalNetSales;

  // Month-end RUN-RATE factor — projects the partial-month actual to month-end
  // at the current selling-day pace. The TARGET is never prorated: it's always
  // the full-month tier number. % Goal = actual ÷ full target (progress so far);
  // run-rate = actual × factor; Proj % = run-rate ÷ full target (on-track signal).
  const rr = useMemo(() => {
    const w = budgetForecast?.window;
    const pr = budgetForecast?.proration;
    const swin = pr?.sellingDaysInWindow, smon = pr?.sellingDaysInMonth;
    const active = !!(w && pr && w.proratable && w.ym === selectedMonth && swin && smon && swin < smon);
    return { active, factor: active ? smon / swin : 1, sellingDaysInWindow: swin ?? null, sellingDaysInMonth: smon ?? null };
  }, [budgetForecast, selectedMonth]);
  const rrf = rr.factor;

  // ── BY PRODUCT ────────────────────────────────────────────────────────────
  const byProduct = useMemo(() => {
    const rows = PRODUCTS.map((p) => {
      const actual = Number(prodActuals[p] || 0);
      // FULL month, not prorated. Actuals already roll up B2B+ADCS+DTC
      // (see actualsByProduct), so the target must too, or % Goal is wrong.
      const target = coTarget("All", p);
      return makeRow(p, actual, target, target > 0, rrf);
    });
    const trackedActual = rows.reduce((a, r) => a + r.actual, 0);
    const grandActual = grandActualRaw != null ? Number(grandActualRaw) : trackedActual;
    const otherActual = Math.max(0, Math.round(grandActual - trackedActual));
    return { rows, otherActual, grandActual };
  }, [prodActuals, coTarget, rrf, grandActualRaw]);

  // ── BY CHANNEL ────────────────────────────────────────────────────────────
  const byChannel = useMemo(() => {
    const monthlyB2B = ALL_PRODUCTS.reduce((a, p) => a + coTarget("B2B", p), 0);
    const monthlyDTC = ALL_PRODUCTS.reduce((a, p) => a + coTarget("DTC", p), 0);
    const monthlyADCS = ALL_PRODUCTS.reduce((a, p) => a + coTarget("ADCS", p), 0);
    const adcs = makeRow("ADCS", Number(channelAct.ADCS || 0), monthlyADCS, monthlyADCS > 0, 1);
    adcs.sporadic = true;
    const rows = [
      makeRow("B2B", Number(channelAct.B2B || 0), monthlyB2B, monthlyB2B > 0, rrf),
      makeRow("DTC", Number(channelAct.DTC || 0), monthlyDTC, monthlyDTC > 0, rrf),
      adcs,
    ];
    const trackedActual = rows.reduce((a, r) => a + r.actual, 0);
    const grandActual = grandActualRaw != null ? Number(grandActualRaw) : trackedActual;
    const otherActual = Math.max(0, Math.round(grandActual - trackedActual));
    return { rows, otherActual, grandActual };
  }, [channelAct, coTarget, rrf, grandActualRaw]);

  // ── Headline ──────────────────────────────────────────────────────────────
  const headline = useMemo(() => {
    const actual = byProduct.grandActual;
    // True company total — every channel × every product, not just the
    // 3 products broken out in the By-product table.
    const goal = ALL_PRODUCTS.reduce((a, p) => a + coTarget("All", p), 0);
    const runRate = Math.round(actual * rrf);
    return {
      actual, goal, hasGoal: goal > 0,
      pct: goal > 0 ? actual / goal : null,
      runRate, projPct: goal > 0 ? runRate / goal : null,
    };
  }, [byProduct, coTarget, rrf]);

  // Full-month (un-prorated) totals for ALL three tiers — secondary reference.
  const tierMonthTotals = useMemo(() => {
    const co = targets.company || {};
    const out = {};
    for (const t of TIERS) {
      let s = 0;
      for (const ch of CHANNELS) {
        for (const p of ALL_PRODUCTS) {
          let v = Number(co?.[ch]?.[p]?.[selectedMonth]?.[t.key]?.[basis] || 0);
          if (!v && basis === "net" && (t.key === "base" || t.key === "stretch") && hasScenarioGoals(selectedMonth)) {
            v = scenarioGoalFor(selectedMonth, t.key, p, ch);
          }
          s += v;
        }
      }
      out[t.key] = s;
    }
    return out;
  }, [targets, selectedMonth, basis]);

  const monthOpts = useMemo(() => monthOffsets(selectedMonth, 3, 3), [selectedMonth]);
  const tierLabel = TIERS.find((t) => t.key === tier)?.label || "Base";
  const liveMode = budgetData?.mode === "live";

  return (
    <div className="space-y-4 md:space-y-5">
      {loadErr && (
        <div className="rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] text-red-900">
          Couldn&apos;t load /api/budget: {loadErr}
        </div>
      )}
      {budgetData && !liveMode && (
        <div className="rounded-md border border-brown/40 bg-tan/30 px-3 py-2 font-sans text-[11px] text-brown leading-snug">
          Targets sheet not wired yet — showing the deck Base/Stretch (net) only.
          Publish the “Company Targets” + “Rep Targets” tabs to web (CSV) and set
          the env vars to go live with Budget + gross + per-rep numbers.
        </div>
      )}

      {/* Controls — goal month + tier. Basis follows the global Gross/Net toggle. */}
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

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted font-semibold hidden sm:inline">
            Target
          </span>
          <TierToggle value={tier} onChange={setTier} />
        </div>

        <span className="font-sans text-[10px] md:text-xs text-muted w-full sm:w-auto sm:ml-auto leading-tight">
          {basisLabel} sales · {periodLabel || "current dashboard window"}
        </span>
      </div>

      {/* ── 1 · SO-WHAT HEADER ───────────────────────────────────────────── */}
      <Headline
        tierLabel={tierLabel}
        basisLabel={basisLabel}
        monthName={monthLabel(selectedMonth)}
        actual={headline.actual}
        goal={headline.goal}
        hasGoal={headline.hasGoal}
        pct={headline.pct}
        runRate={headline.runRate}
        projPct={headline.projPct}
        rrActive={rr.active}
        sellingDaysInWindow={rr.sellingDaysInWindow}
        sellingDaysInMonth={rr.sellingDaysInMonth}
        tierMonthTotals={tierMonthTotals}
        currentTier={tier}
      />

      {/* ── 2 · BREAKDOWNS ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        <Breakdown
          title="By product"
          subtitle={`Actual + run-rate vs full ${tierLabel.toLowerCase()}`}
          rows={byProduct.rows}
          otherActual={byProduct.otherActual}
          grandActual={byProduct.grandActual}
        />
        <Breakdown
          title="By channel"
          subtitle={`Actual + run-rate vs full ${tierLabel.toLowerCase()}`}
          rows={byChannel.rows}
          otherActual={byChannel.otherActual}
          grandActual={byChannel.grandActual}
          footnote={
            rr.active
              ? `Run-rate projects month-end at the current pace (${rr.sellingDaysInWindow}/${rr.sellingDaysInMonth} selling days). Targets are full-month, never prorated. ADCS orders sporadically — actual only.`
              : "Targets are full-month. ADCS orders sporadically — actual only, no target."
          }
        />
      </div>

      {/* ── 3 · GROSS MARGIN (separate section) ──────────────────────────── */}
      <MarginSection grossMargin={grossMargin} prodActuals={actualsByProduct(productFamily, "net")} />

      <div className="font-sans text-[10px] text-muted leading-snug">
        Figures are {basisLabel.toLowerCase()} sales
        {basis === "net" ? " (gross − discounts − returns)" : " (before discounts & returns)"}.{" "}
        % Goal = sales-so-far ÷ the full-month {tierLabel} target. Run-rate projects month-end
        at the current pace; Proj % (color-coded){" "}
        <span style={{ color: AHEAD }} className="font-semibold">≥100%</span> ·{" "}
        <span style={{ color: NEAR }} className="font-semibold">90–100%</span> ·{" "}
        <span style={{ color: BEHIND }} className="font-semibold">&lt;90%</span> is run-rate ÷ target. Nothing is prorated.
        {!liveMode && " Base/Stretch net fall back to the deck; Budget + gross come from the sheet."}
      </div>
    </div>
  );
}

function makeRow(label, actual, target, hasTarget, rrFactor = 1) {
  const t = Number(target) || 0;
  const a = Number(actual) || 0;
  const runRate = Math.round(a * (rrFactor || 1));
  return {
    label,
    actual: a,
    target: hasTarget ? t : null,
    hasTarget: !!hasTarget,
    pct: hasTarget && t > 0 ? a / t : null,          // % to goal so far (actual ÷ full target)
    runRate,                                          // projected month-end at current pace
    projPct: hasTarget && t > 0 ? runRate / t : null, // run-rate ÷ full target (on-track signal)
    variance: hasTarget ? a - t : null,
  };
}

// ─── 1 · So-what header ─────────────────────────────────────────────────────

function Headline({
  tierLabel, basisLabel, monthName, actual, goal, hasGoal, pct, variance,
  prorated, sellingDaysInWindow, sellingDaysInMonth, tierMonthTotals, currentTier,
}) {
  const tone = hasGoal ? paceTone(pct) : NEUTRAL;
  const ahead = (variance || 0) >= 0;
  return (
    <div className="rounded-xl border border-rule bg-card px-5 py-4 md:px-6 md:py-5">
      <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted">
        {basisLabel} sales · Actual vs {tierLabel} · {monthName}
      </div>

      <div className="mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="font-display text-4xl md:text-5xl font-semibold text-ink tabular-nums leading-none">
            {fmt$(actual)}
          </div>
          {hasGoal && (
            <div className="mt-1.5 font-sans text-xs md:text-sm text-muted tabular-nums">
              vs {tierLabel.toLowerCase()} <span className="font-semibold text-inksoft">{fmt$(goal)}</span>
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
              {fmtPct(pct)} <span className="text-sm font-medium">to {tierLabel.toLowerCase()}</span>
            </div>
            <div className="mt-1 text-[11px] md:text-xs font-medium tabular-nums">
              {fmt$(Math.abs(variance))} {ahead ? "ahead of" : "behind"} pace
            </div>
          </div>
        ) : (
          <div className="self-start rounded-lg px-3.5 py-2.5 font-sans text-sm font-semibold" style={{ color: NEUTRAL, backgroundColor: NEUTRAL + "1A" }}>
            No {tierLabel.toLowerCase()} set
          </div>
        )}
      </div>

      {/* Secondary references — all three tiers' full-month totals. */}
      <div className="mt-3 pt-3 border-t border-rule/60 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-sans text-[11px] text-muted">
        {TIERS.map((t) => {
          const v = Number(tierMonthTotals?.[t.key] || 0);
          if (!v) return null;
          const active = t.key === currentTier;
          return (
            <span key={t.key}>
              {t.label}{" "}
              <span className={`tabular-nums ${active ? "font-semibold text-inksoft" : ""}`}>{fmt$k(v)}</span>
              <span className="text-muted"> mo</span>
            </span>
          );
        })}
        {prorated && sellingDaysInWindow != null && (
          <span className="sm:ml-auto">
            {sellingDaysInWindow}/{sellingDaysInMonth} selling days
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
                {r.sporadic && !r.hasTarget ? (
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

      {/* Mobile stacked cards */}
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
              {r.sporadic && !r.hasTarget ? (
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
        <h4 className="font-display text-base md:text-lg font-semibold text-ink">Gross profit <span className="font-sans text-[10px] font-normal text-muted">(COGS only)</span></h4>
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

      {/* Full Gross Margin waterfall — gross profit less merchant fees &
          fulfillment (both flat % of net revenue, Sam 2026-07-09). Always
          computed, no sheet required. */}
      <div className="border-t border-rule/50 px-4 py-3 md:px-5">
        <div className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold mb-2">
          Gross Margin (fully loaded)
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 font-sans text-[11px] md:text-xs tabular-nums">
          <WaterStep label="Gross profit" value={o.grossProfit} />
          <WaterStep
            label={`− Merchant fees (${grossMargin.feeRatePct}% of net)`}
            value={-(grossMargin.merchantFees || 0)}
            neg
          />
          <WaterStep
            label={`− Fulfillment (${grossMargin.fulfillmentPct}% of net)`}
            value={-(grossMargin.fulfillment || 0)}
            neg
          />
          <span className="font-semibold text-ink">
            = Gross Margin{" "}
            <span className="text-ink">{fmt$(grossMargin.contribution)}</span>
            {grossMargin.contributionMarginPct != null && (
              <span className="text-brown"> · {grossMargin.contributionMarginPct}%</span>
            )}
          </span>
        </div>
      </div>

      <div className="px-4 py-2 md:px-5 font-sans text-[10px] text-muted leading-snug border-t border-rule/50">
        {grossMargin.placeholder
          ? (grossMargin.note || "PLACEHOLDER COGS — replace with Sam's COGS in lib/cogs.js.")
          : "COGS from lib/cogs.js (or the Google Sheet COGS tab when wired). Merchant fees + fulfillment are flat % of net revenue."}
      </div>
    </div>
  );
}

function WaterStep({ label, value, neg }) {
  return (
    <span className="text-muted">
      {label} <span className={neg ? "text-unfavorable" : "text-inksoft"}>{fmt$(value)}</span>
    </span>
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

// ─── Budget / Base / Stretch segmented toggle ───────────────────────────────

function TierToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-rule overflow-hidden">
      {TIERS.map((o) => (
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
