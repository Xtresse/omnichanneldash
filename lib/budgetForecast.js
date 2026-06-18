// =============================================================================
// BUDGET + FORECAST BY MONTH, with DAY-LEVEL PRORATION  —  repo-local
// =============================================================================
// Adds a FORECAST series alongside the monthly BUDGET, and prorates BOTH to a
// selected window when that window is shorter than a full month.
//
// Channel split rule (uniform with the rest of the dashboards):
//   - B2B has NO weekend sales (Becky Curry) → prorate by SELLING days
//     (weekdays minus US holidays — lib/sellingDays.js).
//   - DTC is 24/7 → prorate by CALENDAR days.
//   combined target = proratedB2B + proratedDTC.
//
// Monthly targets come from scenarioGoals.js (the canonical channel-split goal
// source, B2B vs DTC, Base/Stretch). The Google-Sheet budget (lib/budgetSheet.js)
// is product×month but NOT channel-split, so for proration we use the scenario
// goals' B2B/DTC split. If a month has no scenario entry, both split goals are
// 0 and the readout simply shows no target (matching the existing UI behavior).
//
// FORECAST:
//   - If the budget sheet carries a forecast column, that value is the forecast
//     (passed in as `sheetForecastMonthly`). Swapping to the sheet column later
//     is then a value-only change — see lib/budgetSheet.js.
//   - Otherwise compute a RUN-RATE forecast: project the month-to-date actual
//     pace to month end. B2B paces on selling days, DTC on calendar days, so a
//     window that's 40% through the month's selling days but only 35% through
//     its calendar days forecasts each channel on its own clock.
//
// Pure date math + lib/sellingDays.js only — NO framework / server deps, so it's
// safe to import from a client component (like budgetSheet.js's sibling rules).
// =============================================================================

import {
  sellingDaysBetween,
  sellingDayWindow,
} from "./sellingDays.js";
import {
  SCENARIO_GOALS,
  scenarioGoalFor,
} from "./scenarioGoals.js";

// ── Date helpers (UTC, to match the dashboard's UTC bucketing) ───────────────

const ymOf = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Parse "YYYY-MM-DD" → UTC Date at midnight. Returns null on bad input.
function parseYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

// First / last calendar day (UTC) of the month containing `d`.
function monthStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function monthEnd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

// Inclusive calendar-day count between two UTC dates.
function calendarDaysBetween(startD, endD) {
  if (endD < startD) return 0;
  return Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1;
}

// Total monthly B2B + DTC goal $ for (month, scenario), summed across products.
// Channel: "B2B" | "DTC". Uses scenarioGoals' canonical split.
const PRODUCTS = ["Gummies", "Serum", "XVIE"];
function monthlyChannelGoal(ym, scenario, channel) {
  let sum = 0;
  for (const p of PRODUCTS) sum += scenarioGoalFor(ym, scenario, p, channel);
  return sum;
}

/**
 * Whether the selected [from,to] window is shorter than the full calendar
 * month it sits in (i.e. proration is meaningful). A single day, a partial
 * MTD window, or any sub-month range → true. A window that exactly spans (or
 * exceeds) the month → false (show the full monthly target).
 */
export function isProratableWindow(from, to) {
  const f = parseYmd(from);
  const t = parseYmd(to);
  if (!f || !t) return false;
  // Different months → not a single-month proration case.
  if (ymOf(f) !== ymOf(t)) return false;
  const ms = monthStart(f);
  const me = monthEnd(f);
  return f > ms || t < me;
}

/**
 * Prorate a single month's B2B + DTC goals to the selected window.
 *   B2B target = monthlyB2BGoal × (sellingDaysInWindow / sellingDaysInMonth)
 *   DTC target = monthlyDTCGoal × (calendarDaysInWindow / calendarDaysInMonth)
 *   combined   = B2B + DTC
 * Returns the channel breakdown + the fractions used (handy for the UI).
 * If the window spans the whole month, fractions are 1 and the full monthly
 * goal is returned unchanged.
 */
export function prorateGoalsToWindow(from, to, scenario = "base") {
  const f = parseYmd(from);
  const t = parseYmd(to);
  const empty = {
    valid: false,
    B2B: 0, DTC: 0, combined: 0,
    monthlyB2B: 0, monthlyDTC: 0, monthlyCombined: 0,
    sellingFraction: 0, calendarFraction: 0,
    sellingDaysInWindow: 0, sellingDaysInMonth: 0,
    calendarDaysInWindow: 0, calendarDaysInMonth: 0,
  };
  if (!f || !t || ymOf(f) !== ymOf(t)) return empty;

  const ym = ymOf(f);
  const ms = monthStart(f);
  const me = monthEnd(f);

  const monthlyB2B = monthlyChannelGoal(ym, scenario, "B2B");
  const monthlyDTC = monthlyChannelGoal(ym, scenario, "DTC");

  const sellingDaysInMonth = sellingDaysBetween(ms, me);
  const sellingDaysInWindow = sellingDaysBetween(f, t);
  const calendarDaysInMonth = calendarDaysBetween(ms, me);
  const calendarDaysInWindow = calendarDaysBetween(f, t);

  const sellingFraction = sellingDaysInMonth > 0 ? sellingDaysInWindow / sellingDaysInMonth : 0;
  const calendarFraction = calendarDaysInMonth > 0 ? calendarDaysInWindow / calendarDaysInMonth : 0;

  const B2B = monthlyB2B * sellingFraction;
  const DTC = monthlyDTC * calendarFraction;

  return {
    valid: true,
    ym, scenario,
    B2B, DTC, combined: B2B + DTC,
    monthlyB2B, monthlyDTC, monthlyCombined: monthlyB2B + monthlyDTC,
    sellingFraction, calendarFraction,
    sellingDaysInWindow, sellingDaysInMonth,
    calendarDaysInWindow, calendarDaysInMonth,
  };
}

/**
 * Run-rate forecast for the month containing [from,to], per channel.
 *   - B2B: project on SELLING days — monthForecastB2B = mtdB2BActual ×
 *     (sellingDaysInMonth / sellingDaysElapsed).
 *   - DTC: project on CALENDAR days — monthForecastDTC = mtdDTCActual ×
 *     (calendarDaysInMonth / calendarDaysElapsed).
 * "Elapsed" is measured from the month start through `to` (the right edge of
 * the loaded window), so an MTD window forecasts the full month from its
 * pace-to-date. Returns 0s when the elapsed denominator is 0.
 *
 * mtdActuals — { B2B, DTC } net-sales actuals for the loaded window. For an
 * MTD window these ARE the month-to-date actuals; for an arbitrary sub-month
 * window the projection still scales that window's pace to the month, which
 * is the intended run-rate behavior.
 */
export function runRateForecast(from, to, mtdActuals = {}) {
  const f = parseYmd(from);
  const t = parseYmd(to);
  const empty = { valid: false, B2B: 0, DTC: 0, combined: 0 };
  if (!f || !t || ymOf(f) !== ymOf(t)) return empty;

  const ms = monthStart(f);
  const me = monthEnd(f);

  const sellingDaysInMonth = sellingDaysBetween(ms, me);
  const sellingDaysElapsed = sellingDaysBetween(f, t);
  const calendarDaysInMonth = calendarDaysBetween(ms, me);
  const calendarDaysElapsed = calendarDaysBetween(f, t);

  const b2bActual = Number(mtdActuals.B2B || 0);
  const dtcActual = Number(mtdActuals.DTC || 0);

  const B2B = sellingDaysElapsed > 0 ? b2bActual * (sellingDaysInMonth / sellingDaysElapsed) : 0;
  const DTC = calendarDaysElapsed > 0 ? dtcActual * (calendarDaysInMonth / calendarDaysElapsed) : 0;

  return { valid: true, B2B, DTC, combined: B2B + DTC };
}

/**
 * One-call builder for the dashboard payload. Given the loaded window and the
 * window's per-channel net-sales actuals, returns everything the budget +
 * forecast readout needs, for both Base and Stretch scenarios:
 *
 *   {
 *     window: { from, to, ym, proratable },
 *     scenarios: {
 *       base:    { budget:{B2B,DTC,combined, monthly...}, forecast:{...}, ... },
 *       stretch: { ... },
 *     },
 *     forecastSource: "sheet" | "runrate",
 *     proration: { sellingFraction, calendarFraction, ...day counts },
 *   }
 *
 * `sheetForecastMonthly` (optional): { B2B, DTC } monthly forecast totals read
 * from the budget sheet's forecast column for this month. When present (and
 * non-zero) it is used as the forecast and prorated the same way as budget;
 * otherwise the run-rate forecast is used.
 */
export function buildBudgetForecast(from, to, actualsByChannel = {}, opts = {}) {
  const f = parseYmd(from);
  const t = parseYmd(to);
  const ym = f ? ymOf(f) : null;
  const proratable = isProratableWindow(from, to);
  const sheetForecastMonthly = opts.sheetForecastMonthly || null;

  const out = {
    window: { from: from || null, to: to || null, ym, proratable },
    forecastSource: "runrate",
    scenarios: {},
    proration: null,
    hasGoals: ym ? !!SCENARIO_GOALS[ym] : false,
  };
  if (!f || !t || !ym) return out;

  // Shared proration fractions (scenario-independent — same day counts).
  const proBase = prorateGoalsToWindow(from, to, "base");
  out.proration = {
    sellingFraction: proBase.sellingFraction,
    calendarFraction: proBase.calendarFraction,
    sellingDaysInWindow: proBase.sellingDaysInWindow,
    sellingDaysInMonth: proBase.sellingDaysInMonth,
    calendarDaysInWindow: proBase.calendarDaysInWindow,
    calendarDaysInMonth: proBase.calendarDaysInMonth,
  };

  const rr = runRateForecast(from, to, {
    B2B: actualsByChannel.B2B,
    DTC: actualsByChannel.DTC,
  });

  // Decide forecast source once (applies to both scenarios; the sheet forecast
  // is a single company number, not scenario-split).
  const haveSheetForecast =
    sheetForecastMonthly &&
    (Number(sheetForecastMonthly.B2B || 0) > 0 || Number(sheetForecastMonthly.DTC || 0) > 0);
  out.forecastSource = haveSheetForecast ? "sheet" : "runrate";

  for (const scenario of ["base", "stretch"]) {
    const pro = prorateGoalsToWindow(from, to, scenario);

    // BUDGET: monthly goal, plus the prorated-to-window figure.
    const budget = {
      monthlyB2B: pro.monthlyB2B,
      monthlyDTC: pro.monthlyDTC,
      monthlyCombined: pro.monthlyCombined,
      B2B: proratable ? pro.B2B : pro.monthlyB2B,
      DTC: proratable ? pro.DTC : pro.monthlyDTC,
      combined: proratable ? pro.combined : pro.monthlyCombined,
    };

    // FORECAST: month-level figure (sheet column if present, else run-rate),
    // then prorated to the window with the same fractions as budget so the
    // window readout compares like-for-like against actuals.
    let monthForecastB2B, monthForecastDTC;
    if (haveSheetForecast) {
      monthForecastB2B = Number(sheetForecastMonthly.B2B || 0);
      monthForecastDTC = Number(sheetForecastMonthly.DTC || 0);
    } else {
      monthForecastB2B = rr.B2B;
      monthForecastDTC = rr.DTC;
    }
    const forecast = {
      monthlyB2B: monthForecastB2B,
      monthlyDTC: monthForecastDTC,
      monthlyCombined: monthForecastB2B + monthForecastDTC,
      B2B: proratable ? monthForecastB2B * pro.sellingFraction : monthForecastB2B,
      DTC: proratable ? monthForecastDTC * pro.calendarFraction : monthForecastDTC,
      combined: 0,
    };
    forecast.combined = forecast.B2B + forecast.DTC;

    out.scenarios[scenario] = { budget, forecast };
  }

  return out;
}
