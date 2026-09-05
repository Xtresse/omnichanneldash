// =============================================================================
// Rep daily heat map — rows = reps, columns = days.
// =============================================================================
// Scott Stepe's ask, via Sam (2026-08-08). Two layers over the same grid:
//
//   net    — net sales per rep per day. A $0 cell IS the zero-dollar selling
//            day Scott cares about; no separate activity layer is needed.
//   spend  — Ramp T&E per rep per day (see lib/ramp.js — currently dark).
//
// NO NEW SALES MATH. The net grid comes from buildDashboardData()'s
// `repSalesMonthly` at granularity "day" — the same per-rep, per-bucket series
// the rep trend chart has always plotted, just bucketed daily. Rep attribution
// is therefore the canonical order-tag path (classifyOrderChannel → findRep),
// unchanged.
//
// Days are shop-local (Pacific) because that's how buildDashboardData buckets.

import { REPS, TERRITORY_ORDER } from "./reps.js";
import { PC_EXCLUDED_REPS } from "./repMetrics.js";
import { shopLocalDate } from "./xtresseCore.js";

/** Inclusive list of YYYY-MM-DD days between from and to. */
export function dayRange(from, to) {
  const out = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  let guard = 0;
  while (d <= end && guard++ < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Roll Ramp transactions into { [repName]: { [day]: dollars } }. */
export function spendByRepDay(transactions, userIdToRep) {
  const grid = {};
  for (const t of transactions || []) {
    const rep = userIdToRep[t.userId];
    if (!rep || !t.at) continue;
    let day;
    try {
      day = shopLocalDate(t.at);
    } catch {
      continue;
    }
    if (!grid[rep]) grid[rep] = {};
    grid[rep][day] = (grid[rep][day] || 0) + (t.amount || 0);
  }
  return grid;
}

/**
 * Assemble the payload the heat map component renders.
 *
 * @param {object} args
 * @param {Array}  args.repSalesDaily  buildDashboardData().repSalesMonthly at
 *                                     granularity "day" — [{month:'YYYY-MM-DD', [rep]:net}]
 * @param {object} args.spendGrid      { rep: { day: dollars } } (empty when Ramp is dark)
 * @param {string} args.from
 * @param {string} args.to
 * @param {boolean} args.spendAvailable
 */
export function buildHeatMap({ repSalesDaily, spendGrid, from, to, spendAvailable }) {
  const days = dayRange(from, to);
  const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]));
  // The current in-progress day is NOT a completed selling day — a rep can still
  // book later today — so it must not count as a "zero-dollar day" (that inflated
  // the tally by up to one-per-rep every weekday). Count only weekdays strictly
  // before today.
  const today = shopLocalDate(new Date().toISOString());

  // Territory for each rep, so the UI can group/label consistently with the
  // rest of the dashboard. REPS[rep] = [territory, region].
  const territoryOf = (rep) => (REPS[rep] ? REPS[rep][0] : null);

  // Managers carry no quota, so EVERY selling day is a zero-dollar day for
  // them — and they hold Ramp cards, so they topped the "spent but didn't
  // sell" flag list purely as an artefact (Becky Curry $3,624 / Julie Fetter
  // $2,044, 2026-08-09) and buried the top genuine signal. They stay in REPS
  // so their historical orders still attribute for accounting; they just
  // aren't rep performance. Same list President's Club uses — one definition.
  const isRep = (name) => !!REPS[name] && !PC_EXCLUDED_REPS.has(name);

  // Seed from the sales series so every rep that sold in the window appears.
  const netByRep = {};
  for (const row of repSalesDaily || []) {
    const day = row.month;
    if (!(day in dayIndex)) continue;
    for (const [k, v] of Object.entries(row)) {
      if (k === "month" || k === "label") continue;
      if (!isRep(k)) continue;
      const n = Number(v) || 0;
      if (!netByRep[k]) netByRep[k] = new Array(days.length).fill(0);
      netByRep[k][dayIndex[day]] = n;
    }
  }

  // Reps with spend but no sales still belong on the grid — a rep spending T&E
  // while selling nothing is precisely the signal this panel exists to surface.
  for (const rep of Object.keys(spendGrid || {})) {
    if (!netByRep[rep] && isRep(rep)) netByRep[rep] = new Array(days.length).fill(0);
  }

  const rows = Object.keys(netByRep).map((rep) => {
    const net = netByRep[rep];
    const spend = new Array(days.length).fill(0);
    for (const [day, amt] of Object.entries((spendGrid || {})[rep] || {})) {
      if (day in dayIndex) spend[dayIndex[day]] = amt;
    }

    const totalNet = net.reduce((a, b) => a + b, 0);
    const totalSpend = spend.reduce((a, b) => a + b, 0);
    const sellingDays = net.filter((n) => n > 0).length;
    // Zero-dollar days are counted over WEEKDAYS only — counting Saturdays and
    // Sundays as "didn't sell" would swamp the signal Scott is after.
    const weekdayIdx = days
      .map((d, i) => [d, i])
      .filter(([d]) => {
        const dow = new Date(d + "T00:00:00Z").getUTCDay();
        return dow !== 0 && dow !== 6;
      })
      .map(([, i]) => i);
    const zeroDollarDays = weekdayIdx.filter((i) => days[i] < today && !(net[i] > 0)).length;
    // The cross-reference: weekdays with T&E spend but no sales.
    const spendOnZeroDays = weekdayIdx.filter((i) => days[i] < today && spend[i] > 0 && !(net[i] > 0));
    const spendOnZeroDollarDays = spendOnZeroDays.reduce((a, i) => a + spend[i], 0);

    return {
      rep,
      territory: territoryOf(rep),
      net,
      spend,
      totalNet: Math.round(totalNet),
      totalSpend: Math.round(totalSpend * 100) / 100,
      sellingDays,
      zeroDollarDays,
      zeroDollarSpendDays: spendOnZeroDays.length,
      spendOnZeroDollarDays: Math.round(spendOnZeroDollarDays * 100) / 100,
    };
  });

  rows.sort((a, b) => b.totalNet - a.totalNet || a.rep.localeCompare(b.rep));

  return {
    from,
    to,
    today,
    days,
    rows,
    spendAvailable: !!spendAvailable,
    territories: TERRITORY_ORDER,
    maxNet: Math.max(0, ...rows.flatMap((r) => r.net)),
    maxSpend: Math.max(0, ...rows.flatMap((r) => r.spend)),
    generatedAt: new Date().toISOString(),
  };
}
