"use client";

const PRESETS = [
  { value: "last_30_days", label: "30 days" },
  { value: "last_3_months", label: "3 months" },
  { value: "last_6_months", label: "6 months" },
  { value: "this_year", label: "YTD" },
  { value: "last_12_months", label: "12 months" },
  { value: "last_year", label: "Last year" },
  { value: "last_2years", label: "All time" },
];

export default function FilterBar({ preset, onChange, loading }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
      {PRESETS.map((p) => {
        const active = preset === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            className={`shrink-0 min-h-touch px-3 md:px-4 rounded-full font-sans text-xs md:text-sm transition border ${
              active
                ? "bg-accent text-paper border-accent"
                : "bg-paper2 text-inksoft border-rule hover:bg-paper2/80"
            }`}
            aria-pressed={active}
          >
            {p.label}
          </button>
        );
      })}
      {loading && (
        <span className="shrink-0 ml-1 font-sans text-[11px] text-muted animate-pulse">
          loading...
        </span>
      )}
    </div>
  );
}
