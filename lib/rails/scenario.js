// Scenario planning math. Pure functions over the same dashboard slice
// the other rails already produce — no Windsor calls of its own, no
// mutation, no Anthropic. Everything is deterministic given (trailing
// actuals, assumptions, horizon) so the Claude tool layer and the
// /scenarios UI can call it identically and get the same numbers.
//
// Vocabulary used throughout this file:
//   trailing  — completed days in the window the user has loaded (the
//               run-rate divisor). Today is treated as in-flight and
//               not included in the divisor so a half-day doesn't drag
//               the daily average down.
//   pacing    — actuals through the trailing-day cutoff, plus the
//               linear run rate (sum / completed days).
//   landing   — projected end-of-horizon = actuals_so_far + run_rate ×
//               remaining_days × (1 + growth%).
//   horizon   — "eom" | "eoq" | "eoy" | "custom". Resolved to a
//               concrete remaining-day count + a target date.
//
// Retention is applied as a sanity check on the DTC landing only —
// returning customers drive ~retention% of the new-DTC-customer dollar
// flow forward. B2B retention is conceptually different (rep activity
// drives it, not subscription churn) so we treat that side through the
// rep-activity input.

const DAY_MS = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const round0 = (n) => Math.round(Number(n) || 0);

/**
 * Returns the YYYY-MM-DD for the last completed day relative to `now`.
 * On the 1st of the month this is in the previous month, so callers
 * that need an MTD divisor must guard against that case.
 */
function yesterday(now = new Date()) {
  return new Date(now.getTime() - DAY_MS);
}

/**
 * Resolve a horizon into a concrete end date + remaining-day count.
 * `now` is overridable so unit tests and frozen-clock UIs stay stable.
 *
 * - eom: end of the current calendar month
 * - eoq: end of the current calendar quarter (Mar/Jun/Sep/Dec last day)
 * - eoy: Dec 31 of the current calendar year
 * - custom: caller supplies `endDate` (YYYY-MM-DD)
 *
 * remainingDays counts from tomorrow through endDate INCLUSIVE. Today
 * is treated as in-flight (see top-of-file rationale) so it doesn't
 * inflate the projection.
 */
export function resolveHorizon({ horizon = "eom", endDate, now = new Date() } = {}) {
  const today0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let end;
  if (horizon === "custom") {
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error("horizon=custom requires endDate=YYYY-MM-DD");
    }
    end = new Date(endDate + "T00:00:00Z");
  } else if (horizon === "eom") {
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  } else if (horizon === "eoq") {
    const q = Math.floor(now.getUTCMonth() / 3);
    end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0));
  } else if (horizon === "eoy") {
    end = new Date(Date.UTC(now.getUTCFullYear(), 12, 0));
  } else {
    throw new Error(`Unknown horizon "${horizon}"`);
  }
  // Remaining days = (end - today), capped at 0 if horizon already past.
  const diff = Math.round((end.getTime() - today0.getTime()) / DAY_MS);
  const remainingDays = Math.max(0, diff);
  return {
    horizon,
    endDate: ymd(end),
    todayDate: ymd(today0),
    remainingDays,
  };
}

/**
 * Window start → first-of-month for MTD, first-of-quarter for QTD,
 * first-of-year for YTD. Used by the pacing rail to anchor the "so far"
 * sum to the correct calendar window.
 */
export function windowStartFor(horizon, now = new Date()) {
  if (horizon === "eom") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (horizon === "eoq") {
    const q = Math.floor(now.getUTCMonth() / 3);
    return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  }
  if (horizon === "eoy") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Daily-average run rate from a sum + a count of completed days.
 * Returns 0 if no days have elapsed yet (e.g. 1st of month, no MTD).
 */
export function dailyRate(sum, completedDays) {
  if (!completedDays || completedDays <= 0) return 0;
  return (Number(sum) || 0) / completedDays;
}

/**
 * Headline scenario projection. Inputs are channel-keyed actuals over
 * the trailing window + a per-channel assumption block. Returns
 * structured pacing + landing for B2B / ADCS / DTC + total.
 *
 * actuals shape:
 *   { B2B: number, ADCS: number, DTC: number, completedDays: number }
 *
 * assumptions shape (all optional; defaults applied):
 *   { growthPct: { B2B, ADCS, DTC }, retentionPct: { B2B, ADCS, DTC } }
 *
 * Each growthPct entry is a percentage applied to the FORWARD piece
 * only — i.e. "I expect the remaining days to perform N% above/below
 * the trailing run rate." 0 means flat to run rate. +10 means 10% lift.
 * Retention is reported alongside the landing but doesn't currently
 * change the channel total (it's a context number for the chat).
 */
export function projectChannels({
  actuals,
  assumptions = {},
  horizon = "eom",
  now = new Date(),
}) {
  const h = resolveHorizon({ horizon, now });
  const completedDays = Math.max(0, Number(actuals?.completedDays) || 0);
  const growth = {
    B2B: Number(assumptions.growthPct?.B2B) || 0,
    ADCS: Number(assumptions.growthPct?.ADCS) || 0,
    DTC: Number(assumptions.growthPct?.DTC) || 0,
  };
  const retention = {
    B2B: Number(assumptions.retentionPct?.B2B) || null,
    ADCS: Number(assumptions.retentionPct?.ADCS) || null,
    DTC: Number(assumptions.retentionPct?.DTC) || null,
  };

  const channels = ["B2B", "ADCS", "DTC"];
  const out = {};
  let totalActual = 0;
  let totalForward = 0;
  let totalLanding = 0;
  for (const ch of channels) {
    const actual = Number(actuals?.[ch]) || 0;
    const rate = dailyRate(actual, completedDays);
    const growthFactor = 1 + growth[ch] / 100;
    const forward = rate * h.remainingDays * growthFactor;
    const landing = actual + forward;
    out[ch] = {
      actualToDate: round0(actual),
      dailyRate: round0(rate),
      growthPct: growth[ch],
      retentionPct: retention[ch],
      remainingDays: h.remainingDays,
      forward: round0(forward),
      landing: round0(landing),
    };
    totalActual += actual;
    totalForward += forward;
    totalLanding += landing;
  }
  out.total = {
    actualToDate: round0(totalActual),
    forward: round0(totalForward),
    landing: round0(totalLanding),
    completedDays,
    remainingDays: h.remainingDays,
  };
  return { ...h, channels: out };
}

/**
 * Product-family projection. Same daily-rate math as projectChannels,
 * but bucketed by Gummies / Serum / XVIE / Sachets (B2B+ADCS+DTC).
 *
 * familyActuals shape:
 *   [{ family: "Gummies", B2B: 1234, ADCS: 0, DTC: 5678 }, ...]
 * Assumes the input numbers cover `completedDays` (passed separately).
 *
 * Per-family growth defaults to the channel weighted average when not
 * supplied, so a user who only tunes channel growth still gets a
 * sensible family roll-forward.
 */
export function projectFamilies({
  familyActuals = [],
  completedDays,
  channelGrowthPct = {},
  familyGrowthPct = {},
  horizon = "eom",
  now = new Date(),
}) {
  const h = resolveHorizon({ horizon, now });
  const days = Math.max(0, Number(completedDays) || 0);
  const channels = ["B2B", "ADCS", "DTC"];
  // Channel-weighted-average growth — used when no per-family override
  // is supplied. Avoids the chat-driven case where the user dials B2B
  // growth + ignores family knobs and gets stale family forecasts.
  const channelTotals = { B2B: 0, ADCS: 0, DTC: 0 };
  for (const f of familyActuals) {
    for (const ch of channels) channelTotals[ch] += Number(f[ch]) || 0;
  }
  const families = familyActuals.map((f) => {
    const actuals = channels.reduce((acc, ch) => {
      acc[ch] = Number(f[ch]) || 0;
      return acc;
    }, {});
    const totalActual = channels.reduce((s, ch) => s + actuals[ch], 0);
    const rate = dailyRate(totalActual, days);
    // Per-channel weight inside this family — drives the blended growth.
    const blended =
      totalActual > 0
        ? channels.reduce(
            (sum, ch) =>
              sum + (actuals[ch] / totalActual) * (Number(channelGrowthPct[ch]) || 0),
            0
          )
        : 0;
    const growth = familyGrowthPct[f.family] != null
      ? Number(familyGrowthPct[f.family])
      : blended;
    const forward = rate * h.remainingDays * (1 + growth / 100);
    return {
      family: f.family,
      actualToDate: round0(totalActual),
      dailyRate: round0(rate),
      growthPct: Math.round(growth * 10) / 10,
      forward: round0(forward),
      landing: round0(totalActual + forward),
    };
  });
  const totalActual = families.reduce((s, x) => s + x.actualToDate, 0);
  const totalForward = families.reduce((s, x) => s + x.forward, 0);
  return {
    ...h,
    families,
    total: {
      actualToDate: round0(totalActual),
      forward: round0(totalForward),
      landing: round0(totalActual + totalForward),
      completedDays: days,
    },
  };
}

/**
 * Rep activity projection. For each rep, compute trailing daily new-
 * account rate from the per-bucket counts dashboard data already
 * surfaces (data.repNewAccountsMonthly), apply optional per-rep
 * override (newAccountsPerDay), and forecast over remainingDays.
 *
 * trailingByRep shape:
 *   { repName: { newAccounts: number, days: number } }
 */
export function projectRepActivity({
  trailingByRep = {},
  overridesPerDay = {},
  horizon = "eom",
  now = new Date(),
}) {
  const h = resolveHorizon({ horizon, now });
  const reps = Object.entries(trailingByRep)
    .map(([rep, t]) => {
      const days = Math.max(0, Number(t.days) || 0);
      const counted = Number(t.newAccounts) || 0;
      const trailingRate = days > 0 ? counted / days : 0;
      const override = overridesPerDay[rep];
      const ratePerDay = override != null ? Number(override) : trailingRate;
      const projected = ratePerDay * h.remainingDays;
      return {
        rep,
        trailingNewAccounts: counted,
        trailingDays: days,
        trailingRatePerDay: Math.round(trailingRate * 1000) / 1000,
        usedRatePerDay: Math.round(ratePerDay * 1000) / 1000,
        overrideApplied: override != null,
        remainingDays: h.remainingDays,
        projectedNewAccounts: Math.round(projected),
      };
    })
    .sort((a, b) => b.projectedNewAccounts - a.projectedNewAccounts);
  const total = reps.reduce((s, r) => s + r.projectedNewAccounts, 0);
  return {
    ...h,
    reps,
    totalProjectedNewAccounts: total,
  };
}

/**
 * Build a single combined snapshot — used by both the UI and the
 * scenario rails. Takes the standard buildDashboardData() output, a
 * choice of horizon, and a (possibly empty) assumptions block, and
 * returns everything the projection cards + chat will need.
 */
export function buildScenarioSnapshot({
  dashboardData,
  trailingData,
  windowDates,
  assumptions = {},
  horizon = "eom",
  now = new Date(),
}) {
  if (!dashboardData) throw new Error("dashboardData is required");
  // completedDays = full days elapsed in the trailing window (the
  // window the caller used to pull `dashboardData`). Cap at 0 just in
  // case the dates are inverted.
  const completedDays = Math.max(
    0,
    Math.round(
      (new Date(windowDates.to + "T00:00:00Z").getTime() -
        new Date(windowDates.from + "T00:00:00Z").getTime()) /
        DAY_MS
    ) + 1
  );

  const channelActuals = {
    B2B: dashboardData.kpis?.b2bNetSales || 0,
    ADCS: dashboardData.kpis?.adcsNetSales || 0,
    DTC: dashboardData.kpis?.dtcNetSales || 0,
    completedDays,
  };
  const channelProjection = projectChannels({
    actuals: channelActuals,
    assumptions,
    horizon,
    now,
  });

  const familyProjection = projectFamilies({
    familyActuals: (dashboardData.productFamily || []).map((f) => ({
      family: f.family,
      B2B: f.B2B,
      ADCS: f.ADCS,
      DTC: f.DTC,
    })),
    completedDays,
    channelGrowthPct: assumptions.growthPct || {},
    familyGrowthPct: assumptions.familyGrowthPct || {},
    horizon,
    now,
  });

  // Rep activity — use the trailing-window dataset if the caller passed
  // it (lets the chat / UI ask for a longer trailing average than the
  // currently-loaded MTD window). Otherwise fall back to dashboardData
  // and use its own completedDays.
  const repNewAcctsRows = (trailingData?.repNewAccountsMonthly || dashboardData.repNewAccountsMonthly || []);
  const trailingDays = trailingData?.trailingDays || completedDays;
  const trailingByRep = {};
  for (const row of repNewAcctsRows) {
    for (const [k, v] of Object.entries(row)) {
      if (k === "month" || k === "label") continue;
      if (!trailingByRep[k]) trailingByRep[k] = { newAccounts: 0, days: trailingDays };
      trailingByRep[k].newAccounts += Number(v) || 0;
    }
  }
  const repProjection = projectRepActivity({
    trailingByRep,
    overridesPerDay: assumptions.repNewAccountsPerDay || {},
    horizon,
    now,
  });

  // Retention context — pulled straight from the period's repeat-
  // purchase rate. We surface latest + window average so the chat can
  // talk about it without a separate rail call.
  const repeatRows = dashboardData.repeatRate || [];
  const latest = repeatRows[repeatRows.length - 1] || { B2B: 0, DTC: 0 };
  const avg = repeatRows.length
    ? {
        B2B: round1(avgKey(repeatRows, "B2B")),
        DTC: round1(avgKey(repeatRows, "DTC")),
      }
    : { B2B: null, DTC: null };
  const retention = {
    latest: { B2B: latest.B2B || 0, DTC: latest.DTC || 0 },
    windowAvg: avg,
    note: "Repeat-purchase rate = returning-customer orders ÷ total orders, per bucket.",
  };

  return {
    horizon: channelProjection.horizon,
    endDate: channelProjection.endDate,
    todayDate: channelProjection.todayDate,
    remainingDays: channelProjection.remainingDays,
    completedDays,
    trailingWindow: windowDates,
    assumptions: {
      growthPct: assumptions.growthPct || { B2B: 0, ADCS: 0, DTC: 0 },
      familyGrowthPct: assumptions.familyGrowthPct || {},
      retentionPct: assumptions.retentionPct || {},
      repNewAccountsPerDay: assumptions.repNewAccountsPerDay || {},
    },
    channels: channelProjection.channels,
    families: familyProjection.families,
    familiesTotal: familyProjection.total,
    reps: repProjection,
    retention,
  };
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}
function avgKey(rows, k) {
  if (!rows.length) return 0;
  let s = 0;
  for (const r of rows) s += Number(r[k]) || 0;
  return s / rows.length;
}
