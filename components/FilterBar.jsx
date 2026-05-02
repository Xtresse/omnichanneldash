"use client";

// Date helpers — kept identical to xtresse-leadershipdash so omni and
// leadership compute the same windows for matching presets.
const today = () => new Date().toISOString().slice(0, 10);
const todayD = () => new Date(today() + "T00:00:00");
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
const endOfYear = (d) => new Date(d.getFullYear(), 11, 31);
const startOfWeek = (d) => {
  // Week starts Monday (matches leadership)
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
};

// All-time start anchor (Windsor doesn't have data before this).
const ALL_TIME_START = "2024-01-01";

// Each preset returns [from, to] (ISO YYYY-MM-DD).
const PRESETS = [
  { value: "today", label: "Today", range: () => { const t = todayD(); return [ymd(t), ymd(t)]; } },
  { value: "this_week", label: "This week", range: () => { const t = todayD(); return [ymd(startOfWeek(t)), ymd(t)]; } },
  { value: "last_week", label: "Last week", range: () => { const t = todayD(); const ws = startOfWeek(t); return [ymd(addDays(ws, -7)), ymd(addDays(ws, -1))]; } },
  { value: "mtd", label: "MTD", range: () => { const t = todayD(); return [ymd(startOfMonth(t)), ymd(t)]; } },
  { value: "last_month", label: "Last month", range: () => { const t = todayD(); const sm = startOfMonth(t); const lm = addDays(sm, -1); return [ymd(startOfMonth(lm)), ymd(lm)]; } },
  { value: "qtd", label: "QTD", range: () => { const t = todayD(); const q = Math.floor(t.getMonth() / 3); return [ymd(new Date(t.getFullYear(), q * 3, 1)), ymd(t)]; } },
  { value: "ytd", label: "YTD", range: () => { const t = todayD(); return [ymd(startOfYear(t)), ymd(t)]; } },
  { value: "last_year", label: "Last year", range: () => { const t = todayD(); return [ymd(new Date(t.getFullYear() - 1, 0, 1)), ymd(new Date(t.getFullYear() - 1, 11, 31))]; } },
  { value: "last_30d", label: "Last 30d", range: () => { const t = todayD(); return [ymd(addDays(t, -29)), ymd(t)]; } },
  { value: "last_90d", label: "Last 90d", range: () => { const t = todayD(); return [ymd(addDays(t, -89)), ymd(t)]; } },
  { value: "all_time", label: "All time", range: () => [ALL_TIME_START, today()] },
];

export default function FilterBar({
  activePreset,        // string preset value, or null when custom dates are active
  customFrom,
  customTo,
  onPresetChange,      // (presetValue, from, to) => void
  onCustomChange,      // ({from, to}) => void
  loading,
}) {
  return (
    <div className="bg-paper2 border border-rule rounded-md px-3 py-2.5 md:px-4 md:py-3 space-y-2.5 md:space-y-0 md:flex md:items-center md:gap-4 md:flex-wrap">
      {/* Quick presets */}
      <div className="flex items-center gap-2 md:gap-3 flex-nowrap overflow-x-auto no-scrollbar -mx-1 px-1">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-muted shrink-0">
          Quick
        </span>
        {PRESETS.map((p) => {
          const active = activePreset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                const [from, to] = p.range();
                onPresetChange(p.value, from, to);
              }}
              className={`shrink-0 min-h-touch px-3 md:px-4 rounded-md font-sans text-xs md:text-sm transition border ${
                active
                  ? "bg-brown text-paper border-brown"
                  : "bg-paper text-inksoft border-rule hover:bg-paper2 hover:border-tan"
              }`}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap md:flex-nowrap md:ml-auto">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-muted shrink-0">
          Custom
        </span>
        <input
          type="date"
          aria-label="Start date"
          value={customFrom || ""}
          max={customTo || undefined}
          onChange={(e) =>
            onCustomChange({ from: e.target.value, to: customTo || "" })
          }
          className="bg-paper text-inksoft border border-rule rounded-md px-2 md:px-3 min-h-touch font-sans text-xs md:text-sm"
        />
        <span className="font-sans text-xs text-muted">→</span>
        <input
          type="date"
          aria-label="End date"
          value={customTo || ""}
          min={customFrom || undefined}
          onChange={(e) =>
            onCustomChange({ from: customFrom || "", to: e.target.value })
          }
          className="bg-paper text-inksoft border border-rule rounded-md px-2 md:px-3 min-h-touch font-sans text-xs md:text-sm"
        />
        {(customFrom || customTo) && !activePreset && (
          <button
            type="button"
            onClick={() => onCustomChange({ from: "", to: "" })}
            className="shrink-0 min-h-touch px-2 md:px-3 rounded-md font-sans text-[11px] text-inksoft border border-rule hover:bg-paper hover:border-tan"
            aria-label="Clear custom date range"
          >
            Clear
          </button>
        )}
        {loading && (
          <span
            className="shrink-0 ml-1 font-sans text-[11px] text-muted animate-pulse"
            aria-live="polite"
          >
            loading…
          </span>
        )}
      </div>
    </div>
  );
}

// Exported for Dashboard so the initial preset value resolves to a label.
export const PRESET_LABELS = Object.fromEntries(
  PRESETS.map((p) => [p.value, p.label])
);

// Compute initial dates for the default preset (used on first SSR load).
export function defaultPresetRange(value) {
  const p = PRESETS.find((x) => x.value === value);
  return p ? p.range() : null;
}
