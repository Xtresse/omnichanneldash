// =============================================================================
// XTRESSÉ CANONICAL SELLING-DAY CORE  —  SHARED ACROSS ALL DASHBOARDS
// =============================================================================
// BYTE-FOR-BYTE IDENTICAL across every Xtressé dashboard repo that does a
// period-over-period comparison. Sibling to lib/xtresseCore.js; same rule —
// edit the master and propagate, never one copy, so the dashboards can't drift.
//
// Pure date math: NO framework imports, NO server/Shopify deps, so it is safe
// to import from a client component (unlike xtresseCore.js, which pulls in the
// Shopify Admin client).
//
// WHY THIS EXISTS
//   B2B has NO weekend sales (per Becky Curry). A "selling day" is a weekday
//   (Mon–Fri) that is not an observed US holiday. Any period-over-period
//   comparison must therefore match SELLING DAYS, not calendar days. The first
//   5 *calendar* days of a month that starts on a Friday hold only 3 selling
//   days, vs 5 in a month that starts on a Monday — so a naive calendar-matched
//   prior window makes the current month look inflated (the exact thing that
//   made a May-vs-June MTD comparison read "+78%" when it should not). Match the
//   selling-day COUNT on both sides and the comparison is honest, always.
//
//   Example: today is mid-June, 5 selling days elapsed (Jun 1–5). The prior
//   window is the FIRST 5 selling days of May = May 1, 4, 5, 6, 7 (span
//   May 1–7), NOT the first 5 calendar days (May 1–5 = only 3 selling days).
// =============================================================================

const _nthWeekday = (y, m, wd, n) => { const f = new Date(y, m, 1); return new Date(y, m, 1 + ((wd - f.getDay() + 7) % 7) + (n - 1) * 7); };
const _lastWeekday = (y, m, wd) => { const l = new Date(y, m + 1, 0); return new Date(y, m, l.getDate() - ((l.getDay() - wd + 7) % 7)); };
const _obs = (d) => { const wd = d.getDay(); if (wd === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); if (wd === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return d; };
const _key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// Editable US federal / common-retail holiday rules. Observed dates (a holiday
// landing on a weekend is shifted to the nearest weekday) so the weekday-only
// selling-day count never double-removes a day that was already a weekend.
export const US_HOLIDAY_RULES = [
  (y) => _obs(new Date(y, 0, 1)),    // New Year's Day
  (y) => _nthWeekday(y, 0, 1, 3),    // MLK Day
  (y) => _nthWeekday(y, 1, 1, 3),    // Presidents' Day
  (y) => _lastWeekday(y, 4, 1),      // Memorial Day
  (y) => _obs(new Date(y, 5, 19)),   // Juneteenth
  (y) => _obs(new Date(y, 6, 4)),    // Independence Day
  (y) => _nthWeekday(y, 8, 1, 1),    // Labor Day
  (y) => _nthWeekday(y, 10, 4, 4),   // Thanksgiving
  (y) => _obs(new Date(y, 11, 25)),  // Christmas
];
const _holidayCache = {};
const _holidaysForYear = (y) => { if (!_holidayCache[y]) _holidayCache[y] = new Set(US_HOLIDAY_RULES.map((r) => _key(r(y)))); return _holidayCache[y]; };

// Is `d` a selling day? — a weekday (Mon–Fri) that is not an observed holiday.
export function isSellingDay(d) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !_holidaysForYear(d.getFullYear()).has(_key(d));
}

// Inclusive count of selling days in [startD, endD]. (0 if endD < startD.)
export function sellingDaysBetween(startD, endD) {
  if (endD < startD) return 0;
  let count = 0;
  const cur = new Date(startD);
  while (cur <= endD) {
    if (isSellingDay(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
// Back-compat alias — same function, the name older call sites already use.
export const businessDaysBetween = sellingDaysBetween;

// Build the calendar span that holds exactly `n` selling days, anchored at
// `anchor`:
//   dir = +1  walk FORWARD  — span STARTS at `anchor`, ENDS on the n-th selling
//             day on/after it  (use for "first N selling days of the period")
//   dir = -1  walk BACKWARD — span ENDS at `anchor`, STARTS on the n-th selling
//             day on/before it (use for end-aligned / trailing windows)
// The anchor edge is always part of the span even if it is itself a weekend or
// holiday, so the current and prior windows treat their open edge symmetrically
// (the current window likewise starts on the 1st whatever weekday that is).
// n <= 0 yields an empty span (end before start) so any [start,end] date filter
// matches nothing. Returns { start: Date, end: Date }.
export function sellingDayWindow(anchor, n, dir = 1) {
  const a = new Date(anchor);
  if (n <= 0) {
    return dir >= 0
      ? { start: new Date(a), end: new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1) }
      : { start: new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1), end: new Date(a) };
  }
  const step = dir >= 0 ? 1 : -1;
  const cur = new Date(a);
  let far = new Date(a);
  let count = 0;
  for (let i = 0; i < 4000; i++) {
    if (isSellingDay(cur)) {
      count++;
      far = new Date(cur);
      if (count === n) break;
    }
    cur.setDate(cur.getDate() + step);
  }
  return dir >= 0 ? { start: new Date(a), end: far } : { start: far, end: new Date(a) };
}
