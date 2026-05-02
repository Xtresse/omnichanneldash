"use client";

const PRESETS = [
  { value: "last_7d", label: "7 days" },
  { value: "last_30d", label: "30 days" },
  { value: "last_3m", label: "3 months" },
  { value: "last_6m", label: "6 months" },
  { value: "this_year", label: "YTD" },
  { value: "last_year", label: "Last year" },
  { value: "last_2years", label: "All time" },
];

export default function FilterBar({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomChange,
  loading,
}) {
  const customActive = Boolean(customFrom && customTo);

  return (
    <div className="bg-paper2 border border-rule rounded-md px-3 py-2.5 md:px-4 md:py-3 space-y-2.5 md:space-y-0 md:flex md:items-center md:gap-4 md:flex-wrap">
      {/* Quick presets */}
      <div className="flex items-center gap-2 md:gap-3 flex-nowrap overflow-x-auto no-scrollbar -mx-1 px-1">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-muted shrink-0">
          Quick
        </span>
        {PRESETS.map((p) => {
          const active = !customActive && preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onPresetChange(p.value)}
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
        {customActive && (
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
