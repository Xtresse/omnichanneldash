// Period resolution + comparison-window math used by every rail.
// Single source of truth so a query like { period: "mtd" } resolves
// identically whether it came from the UI or from a Claude tool call.

import { sellingDaysBetween, sellingDayWindow } from "../sellingDays.js";

const DAY_MS = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const today = () => new Date();

// Map of named presets → ({from, to}) resolver. Mirrors what FilterBar
// exposes in the UI plus a few FP&A-friendly aliases (mtd, qtd, ytd).
const PRESETS = {
  mtd: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: ymd(start), to: ymd(now) };
  },
  qtd: () => {
    const now = today();
    const q = Math.floor(now.getUTCMonth() / 3) * 3;
    const start = new Date(Date.UTC(now.getUTCFullYear(), q, 1));
    return { from: ymd(start), to: ymd(now) };
  },
  ytd: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { from: ymd(start), to: ymd(now) };
  },
  last_7d: () => {
    const now = today();
    return { from: ymd(new Date(now.getTime() - 6 * DAY_MS)), to: ymd(now) };
  },
  last_30d: () => {
    const now = today();
    return { from: ymd(new Date(now.getTime() - 29 * DAY_MS)), to: ymd(now) };
  },
  last_3m: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    return { from: ymd(start), to: ymd(now) };
  },
  last_6m: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    return { from: ymd(start), to: ymd(now) };
  },
  last_12m: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
    return { from: ymd(start), to: ymd(now) };
  },
  last_year: () => {
    const now = today();
    const y = now.getUTCFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  },
  last_2years: () => {
    const now = today();
    const start = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1));
    return { from: ymd(start), to: ymd(now) };
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve { from?, to?, preset? } → canonical { from, to, preset|null }.
 * Throws on malformed input rather than silently substituting a default
 * so Claude tool calls don't drift onto the wrong window.
 */
export function resolvePeriod(input = {}) {
  const { from, to, preset } = input;
  if (from && to) {
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      throw new Error("from/to must be YYYY-MM-DD");
    }
    if (from > to) throw new Error("from must be <= to");
    return { from, to, preset: null };
  }
  const key = (preset || "mtd").toLowerCase();
  const fn = PRESETS[key];
  if (!fn) {
    throw new Error(
      `Unknown preset "${preset}". Allowed: ${Object.keys(PRESETS).join(", ")}`
    );
  }
  const range = fn();
  return { ...range, preset: key };
}

/** Days inclusive in a resolved period. */
export function periodLengthDays({ from, to }) {
  const f = new Date(from + "T00:00:00Z").getTime();
  const t = new Date(to + "T00:00:00Z").getTime();
  return Math.round((t - f) / DAY_MS) + 1;
}

/**
 * Compare-window helper. mode = "prior" | "yoy".
 * Mirrors lib/windsor.js#computeCompareWindow but exposed via the rail
 * layer so tools can request a paired snapshot without re-implementing
 * the math.
 */
export function compareWindow({ from, to }, mode = "prior") {
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  if (mode === "yoy") {
    return {
      from: shiftYearClamped(fromD, -1),
      to: shiftYearClamped(toD, -1),
      mode: "yoy",
    };
  }
  // SELLING-DAY-matched prior window (weekdays minus US holidays) — identical
  // rule to lib/windsor.js#computeCompareWindow. MTD → first N selling days of
  // the prior month; else the N selling days immediately before the window.
  const n = sellingDaysBetween(fromD, toD);
  const startsFirst = fromD.getUTCDate() === 1;
  const sameMonth =
    fromD.getUTCFullYear() === toD.getUTCFullYear() &&
    fromD.getUTCMonth() === toD.getUTCMonth();
  const w = (startsFirst && sameMonth)
    ? sellingDayWindow(new Date(Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth() - 1, 1)), n, 1)
    : sellingDayWindow(new Date(fromD.getTime() - DAY_MS), n, -1);
  return { from: ymd(w.start), to: ymd(w.end), mode: "prior" };
}

function shiftYearClamped(d, years) {
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export const PRESET_NAMES = Object.keys(PRESETS);
