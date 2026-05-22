"use client";

// Top-level Scenario Planning UI. Three columns on desktop:
//   left  → AssumptionsPanel (sticky, ~280 px)
//   mid   → ProjectionPanel (cards, table, rep forecast)
//   right → ScenarioChat (full-height chat)
//
// On mobile this collapses into a single scrolling stack: assumptions →
// projection → chat (with the chat free to expand to full screen
// through a "focus chat" button at the top).
//
// State flow:
//   - assumptions live in this component
//   - any change debounces 350 ms then POSTs /api/scenario/snapshot
//     for a fresh projection
//   - chat gets the current panelState passed in via ref so every send
//     uses the latest values without re-rendering the chat tree

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssumptionsPanel from "./AssumptionsPanel.jsx";
import ProjectionPanel from "./ProjectionPanel.jsx";
import ScenarioChat from "./ScenarioChat.jsx";

const DEFAULT_STATE = () => ({
  horizon: "eom",
  endDate: null,
  growthPct: { B2B: 0, ADCS: 0, DTC: 0 },
  familyGrowthPct: {},
  retentionPct: {},
  repNewAccountsPerDay: {},
});

export default function ScenariosUI() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState("planner"); // "planner" | "chat" (mobile)
  const debounceRef = useRef(null);

  // Build the payload the server endpoint expects. Memoized so we can
  // pass a stable reference into the chat tree.
  const panelState = useMemo(() => {
    return {
      horizon: state.horizon,
      endDate: state.endDate,
      growthPct: state.growthPct,
      familyGrowthPct: state.familyGrowthPct,
      retentionPct: state.retentionPct,
      repNewAccountsPerDay: state.repNewAccountsPerDay,
    };
  }, [state]);

  const fetchSnapshot = useCallback(async (s) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scenario/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      const json = await res.json();
      if (!json?.ok) {
        setError(json?.error || `${res.status} ${res.statusText}`);
      } else {
        setSnapshot(json);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch.
  useEffect(() => {
    fetchSnapshot(DEFAULT_STATE());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced re-fetch on assumption changes.
  function handleChange(next) {
    setState(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Only fetch if the resulting state is valid (custom horizon needs a date).
      if (next.horizon === "custom" && !next.endDate) return;
      fetchSnapshot(next);
    }, 350);
  }

  function handleReset() {
    const fresh = DEFAULT_STATE();
    setState(fresh);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchSnapshot(fresh);
  }

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  const repList = snapshot?.repActivityTrailing30?.reps || [];

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="sticky top-0 z-30 bg-browndeep text-paper border-b border-rule">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <a
            href="/"
            className="font-display text-base sm:text-lg leading-none hover:underline shrink-0"
          >
            ← Dashboard
          </a>
          <div className="flex-1" />
          <div className="font-display text-base sm:text-lg font-semibold leading-none truncate">
            Scenario Planning
          </div>
          <a
            href="/ask"
            className="hidden md:inline-flex shrink-0 px-2.5 py-1 rounded text-[11px] font-sans text-paper/80 border border-paper/30 hover:bg-paper/10"
            title="Open the general analyst"
          >
            Ask
          </a>
        </div>
        {/* Mobile tab switch */}
        <div className="md:hidden border-t border-paper/10 bg-browndeep/95">
          <div className="max-w-7xl mx-auto px-3 py-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setView("planner")}
              className={`min-h-touch rounded font-sans text-[12px] font-semibold tracking-[0.04em] transition ${
                view === "planner"
                  ? "bg-paper text-brown"
                  : "bg-paper/10 text-paper/80"
              }`}
            >
              Planner
            </button>
            <button
              type="button"
              onClick={() => setView("chat")}
              className={`min-h-touch rounded font-sans text-[12px] font-semibold tracking-[0.04em] transition ${
                view === "chat"
                  ? "bg-paper text-brown"
                  : "bg-paper/10 text-paper/80"
              }`}
            >
              Chat
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto md:grid md:grid-cols-[280px_minmax(0,1fr)_360px] md:gap-4 lg:gap-6 md:px-4 lg:px-6 md:py-5 min-w-0">
        {/* Assumptions */}
        <aside
          className={`${
            view === "planner" ? "block" : "hidden"
          } md:block bg-card border border-rule rounded-xl p-3 md:p-4 md:sticky md:top-20 md:max-h-[calc(100vh-110px)] md:overflow-y-auto m-3 md:m-0`}
        >
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-lg font-semibold text-ink leading-tight">
              Assumptions
            </h2>
            {loading && (
              <span className="font-sans text-[10px] text-muted">refreshing…</span>
            )}
          </div>
          <AssumptionsPanel
            state={state}
            onChange={handleChange}
            reps={repList}
            loading={loading && !snapshot}
            onReset={handleReset}
          />
        </aside>

        {/* Projection */}
        <main
          className={`${
            view === "planner" ? "block" : "hidden"
          } md:block min-w-0 px-3 pb-6 md:px-0 md:pb-0`}
        >
          <ProjectionPanel
            snapshot={snapshot}
            loading={loading}
            error={error}
          />
        </main>

        {/* Chat */}
        <aside
          className={`${
            view === "chat" ? "flex" : "hidden"
          } md:flex flex-col bg-card border border-rule rounded-xl overflow-hidden md:sticky md:top-20 md:max-h-[calc(100vh-110px)] m-3 md:m-0 min-h-[60vh]`}
        >
          <ScenarioChat panelState={panelState} />
        </aside>
      </div>
    </div>
  );
}
