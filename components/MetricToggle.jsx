"use client";

// Shared Net/Gross basis toggle. Single source so the Executive Summary,
// the B2B status bar, and the Actual-vs-Goal section all render an identical
// control. value is "net" | "gross"; onChange receives the new value.
export default function MetricToggle({ value, onChange, size = "sm" }) {
  const opts = [
    { k: "net", label: "Net" },
    { k: "gross", label: "Gross" },
  ];
  const pad = size === "xs" ? "px-1.5 py-0.5" : "px-2 py-1";
  return (
    <div className="inline-flex rounded-md border border-rule overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          aria-pressed={value === o.k}
          className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.12em] ${pad} min-h-touch sm:min-h-0 ${
            value === o.k ? "bg-brown text-paper font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
