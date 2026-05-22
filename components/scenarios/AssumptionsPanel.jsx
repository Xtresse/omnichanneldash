"use client";

// Side panel of tunable inputs for the scenario projection.
// All values live in the parent's `state`/`onChange` so the projection
// cards + chat both re-render off the same source.
//
// Inputs surfaced (matches the user's request):
//   1. Horizon: rest of month / quarter / year / custom end date
//   2. Per-channel growth % (B2B / ADCS / DTC) — applied to the forward
//      piece only (trailing run rate × remaining days × (1 + growth)).
//   3. Per-channel retention % (B2B / ADCS / DTC) — reported alongside
//      landings as context for the chat; not currently re-bucketing.
//   4. Per-rep new-accounts/day overrides. The full roster is loaded
//      from the latest snapshot once and shown collapsed-by-default;
//      tap to expand the list and tune individual reps.

const CHANNELS = ["B2B", "ADCS", "DTC"];

const HORIZONS = [
  { v: "eom", label: "Rest of month" },
  { v: "eoq", label: "Rest of quarter" },
  { v: "eoy", label: "Rest of year" },
  { v: "custom", label: "Custom" },
];

function NumInput({ value, onChange, suffix, placeholder, step, min, max }) {
  return (
    <div className="flex items-center gap-1 bg-paper2 border border-rule rounded-md px-2">
      <input
        type="number"
        value={value === null || value === undefined ? "" : value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
        placeholder={placeholder ?? ""}
        step={step ?? "1"}
        min={min}
        max={max}
        className="w-full bg-transparent text-ink font-sans text-sm py-1.5 focus:outline-none tabular-nums"
        style={{ fontSize: 16 }} /* prevent iOS auto-zoom */
      />
      {suffix && (
        <span className="font-sans text-[11px] text-muted shrink-0">{suffix}</span>
      )}
    </div>
  );
}

export default function AssumptionsPanel({
  state,
  onChange,
  reps,
  loading,
  onReset,
}) {
  const update = (patch) => onChange({ ...state, ...patch });

  const setGrowth = (ch, v) => {
    update({ growthPct: { ...state.growthPct, [ch]: v ?? 0 } });
  };
  const setRetention = (ch, v) => {
    const next = { ...state.retentionPct };
    if (v === null) delete next[ch];
    else next[ch] = v;
    update({ retentionPct: next });
  };
  const setRepRate = (rep, v) => {
    const next = { ...state.repNewAccountsPerDay };
    if (v === null) delete next[rep];
    else next[rep] = v;
    update({ repNewAccountsPerDay: next });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Horizon</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {HORIZONS.map((h) => {
            const active = state.horizon === h.v;
            return (
              <button
                key={h.v}
                type="button"
                onClick={() => update({ horizon: h.v })}
                className={`min-h-touch rounded-md font-sans text-[12px] font-semibold tracking-[0.02em] transition border ${
                  active
                    ? "bg-brown text-paper border-brown"
                    : "bg-paper2 text-inksoft border-rule hover:border-tan"
                }`}
              >
                {h.label}
              </button>
            );
          })}
        </div>
        {state.horizon === "custom" && (
          <div className="mt-2">
            <input
              type="date"
              value={state.endDate || ""}
              onChange={(e) =>
                update({ endDate: e.target.value || null })
              }
              className="w-full bg-paper2 border border-rule rounded-md px-2 py-1.5 font-sans text-sm text-ink focus:outline-none focus:border-tan"
              style={{ fontSize: 16 }}
            />
          </div>
        )}
      </div>

      <div>
        <Label>Growth vs run rate</Label>
        <p className="font-sans text-[11px] text-muted leading-snug mb-2">
          Applied to the forward piece only. 0 = flat to the trailing daily
          average. +10 = expect remaining days to outperform by 10%.
        </p>
        <div className="space-y-1.5">
          {CHANNELS.map((ch) => (
            <div key={ch} className="grid grid-cols-[60px_1fr] items-center gap-2">
              <div className="font-sans text-[12px] font-semibold text-inksoft">
                {ch}
              </div>
              <NumInput
                value={state.growthPct?.[ch] ?? 0}
                onChange={(v) => setGrowth(ch, v)}
                suffix="%"
                step="0.5"
                min={-90}
                max={500}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label>Retention rate</Label>
        <p className="font-sans text-[11px] text-muted leading-snug mb-2">
          Leave blank to use the trailing window's actual repeat-rate.
          Override (0–100%) to model a churn/recovery scenario the model
          should reason about in chat.
        </p>
        <div className="space-y-1.5">
          {CHANNELS.map((ch) => (
            <div key={ch} className="grid grid-cols-[60px_1fr] items-center gap-2">
              <div className="font-sans text-[12px] font-semibold text-inksoft">
                {ch}
              </div>
              <NumInput
                value={
                  state.retentionPct?.[ch] === undefined
                    ? null
                    : state.retentionPct[ch]
                }
                onChange={(v) => setRetention(ch, v)}
                suffix="%"
                placeholder="auto"
                step="1"
                min={0}
                max={100}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label>New accounts / day — by rep</Label>
        <p className="font-sans text-[11px] text-muted leading-snug mb-2">
          Override the trailing-30d rate per rep. Blank = use the rep's
          own historical average.
        </p>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {(reps || []).length === 0 ? (
            <div className="font-sans text-[11px] text-muted px-1">
              {loading ? "Loading rep activity…" : "No rep activity in the trailing window."}
            </div>
          ) : (
            (reps || []).map((r) => (
              <div
                key={r.rep}
                className="grid grid-cols-[1fr_100px] items-center gap-2"
              >
                <div className="font-sans text-[12px] text-inksoft truncate" title={r.rep}>
                  {r.rep}
                  <span className="ml-1 text-[10px] text-muted tabular-nums">
                    · {r.trailingRatePerDay.toFixed(2)}/d
                  </span>
                </div>
                <NumInput
                  value={
                    state.repNewAccountsPerDay?.[r.rep] === undefined
                      ? null
                      : state.repNewAccountsPerDay[r.rep]
                  }
                  onChange={(v) => setRepRate(r.rep, v)}
                  suffix="/d"
                  placeholder="auto"
                  step="0.05"
                  min={0}
                  max={10}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="w-full min-h-touch rounded-md bg-paper2 border border-rule text-inksoft font-sans text-[12px] font-semibold hover:border-tan transition"
      >
        Reset assumptions to defaults
      </button>
    </div>
  );
}

function Label({ children }) {
  return (
    <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted mb-1.5">
      {children}
    </div>
  );
}
