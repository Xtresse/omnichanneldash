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

export default function FilterBar({ preset, onChange, loading }) {
  return (
    <div className="bg-paper2 border border-rule rounded-md px-3 py-2.5 md:px-4 md:py-3">
      <div className="flex items-center gap-2 md:gap-3 flex-nowrap overflow-x-auto no-scrollbar -mx-1 px-1">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-muted shrink-0">
          Quick
        </span>
        {PRESETS.map((p) => {
          const active = preset === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
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
        {loading && (
          <span className="shrink-0 ml-1 font-sans text-[11px] text-muted animate-pulse">
            loading…
          </span>
        )}
      </div>
    </div>
  );
}
