"use client";

import { useEffect, useMemo, useState } from "react";

// B2B MTD status bar — three side-by-side cards (Gummies / Xvié / Serum)
// showing month-to-date B2B sales, linear pacing, user-entered monthly goal,
// % to goal, and a progress bar. Sits above the KPI tiles.
//
// Data source: /api/dashboard?from=<1st-of-month>&to=<today>, which reuses
// the canonical net-sales aggregation (gross − discounts − refunds) and
// already returns a productFamily array keyed by family. We pull the
// .B2B value for Gummies / XVIE / Serum regardless of what the user has
// selected in the main FilterBar — this card is *always* MTD.
//
// Goals are stored server-side at data/b2b-goals.json via /api/b2b-goals.
// Once a goal is entered for a (product, year-month) it's display-locked,
// but a small "edit" affordance allows corrections.

const PRODUCTS = [
  { label: "Gummies", family: "Gummies", skuNote: "Gummy Case (860011740100) + Sachets" },
  { label: "Xvié",    family: "XVIE",    skuNote: "X-XVIE-* family" },
  { label: "Serum",   family: "Serum",   skuNote: "X-FRC-30ML-CASE · B2B Concentrate Case" },
];

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtPct = (n) => `${Math.round((n || 0) * 100)}%`;

// "2026-05" key for the current calendar month (UTC to match the rest of
// the dashboard's month bucketing).
function currentYearMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Returns {completed, total} — days elapsed INCLUDING today, and total
// days in the current month. 2026-05: Sam wants today's sales reflected
// live (on the last day of the month the old "completed = day-1" basis
// left the widget stuck at 30/31 and missing the final day). Today counts
// as elapsed; pace divides by elapsed days (today partial nudges pace down
// slightly, acceptable for a live read).
function dayProgress() {
  const now = new Date();
  const completed = now.getDate(); // include today
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { completed, total };
}

// First-of-month → end of TODAY in YYYY-MM-DD — includes today's sales so
// the MTD number is live (was end-of-yesterday, which went stale / stuck
// at day N-1/N on the last day of the month).
function mtdRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  return { from: ymd(start), to: ymd(now) };
}

export default function B2BStatusBar() {
  const [mtd, setMtd] = useState(null);      // { Serum, XVIE, Gummies }
  const [mtdErr, setMtdErr] = useState(null);
  const [goals, setGoals] = useState({});    // keyed `${product}|${ym}`
  const [editing, setEditing] = useState(null); // product label currently in edit mode
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);  // last save error msg, cleared on next attempt

  const ym = useMemo(() => currentYearMonth(), []);
  const { completed, total } = useMemo(() => dayProgress(), []);

  // Fetch MTD product-family data through end of yesterday (always MTD-
  // through-completed-days, independent of FilterBar state). On day 1 of
  // the month there are no completed days yet — show zeros.
  useEffect(() => {
    let cancelled = false;
    const range = mtdRange();
    if (!range) {
      // Day 1 of the month — no completed-day data yet.
      setMtd({ Serum: 0, XVIE: 0, Gummies: 0 });
      return () => { cancelled = true; };
    }
    const qs = new URLSearchParams({ from: range.from, to: range.to, granularity: "auto" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setMtdErr(j.error || "Failed to load MTD data");
          return;
        }
        const totals = { Serum: 0, XVIE: 0, Gummies: 0 };
        // Prefer b2bFocusByFamily (case-SKU-filtered) when present. Falls
        // back to productFamily.B2B for old API responses that haven't been
        // redeployed yet — guarantees the widget still renders during the
        // brief window between commits.
        if (j.b2bFocusByFamily && typeof j.b2bFocusByFamily === "object") {
          for (const fam of Object.keys(totals)) {
            totals[fam] = Number(j.b2bFocusByFamily[fam] || 0);
          }
        } else {
          for (const row of j.productFamily || []) {
            if (row?.family && totals[row.family] !== undefined) {
              totals[row.family] = Number(row.B2B || 0);
            }
          }
        }
        setMtd(totals);
      })
      .catch((e) => { if (!cancelled) setMtdErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  // Fetch saved goals once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/b2b-goals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.ok) setGoals(j.goals || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function saveGoal(product, value) {
    const goalNum = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!isFinite(goalNum) || goalNum < 0) {
      setSaveErr("Enter a valid non-negative number.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/b2b-goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, yearMonth: ym, goal: goalNum }),
      });
      let j = null;
      try { j = await res.json(); } catch (_) { /* ignore JSON parse errors */ }
      if (res.ok && j && j.ok) {
        setGoals(j.goals || {});
        setEditing(null);
        setDraft("");
        setSaveErr(null);
      } else {
        const msg = (j && j.error)
          ? String(j.error)
          : `Save failed (HTTP ${res.status}).`;
        setSaveErr(msg);
      }
    } catch (e) {
      setSaveErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-rule bg-paper2/60 p-3 md:p-4">
      <div className="flex items-baseline justify-between gap-2 sm:gap-3 mb-2.5 md:mb-3 flex-wrap">
        <h2 className="font-display text-lg md:text-xl font-semibold text-brown leading-tight">
          B2B Month-to-Date
        </h2>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted leading-snug">
          Day {completed}/{total} · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
      </div>

      {saveErr && (
        <div className="mb-2.5 md:mb-3 rounded-md border border-red-300/60 bg-red-50/60 px-3 py-2 font-sans text-[11px] md:text-xs text-red-900 leading-snug flex items-start justify-between gap-2">
          <span><strong>Couldn&apos;t save goal:</strong> {saveErr}</span>
          <button
            type="button"
            onClick={() => setSaveErr(null)}
            className="shrink-0 font-sans text-[10px] uppercase tracking-[0.12em] text-red-900 hover:underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {PRODUCTS.map((p) => {
          const actual = mtd ? Number(mtd[p.family] || 0) : null;
          // Pace is based on COMPLETED full days only — today's partial day
          // is excluded from the divisor so a slow morning doesn't artificially
          // lower the run-rate projection. On day 1 of the month there are no
          // completed days, so pace is null (renders as "—").
          const pace = actual != null && completed > 0 ? (actual / completed) * total : null;
          const key = `${p.family}|${ym}`;
          const goalEntry = goals[key];
          const goal = goalEntry ? Number(goalEntry.goal) : null;
          const isEditing = editing === p.family;
          const pctOfGoal = goal && goal > 0 && actual != null ? actual / goal : null;
          const pctOfGoalCapped = pctOfGoal != null ? Math.max(0, Math.min(1, pctOfGoal)) : 0;

          return (
            <ProductCard
              key={p.family}
              label={p.label}
              skuNote={p.skuNote}
              loading={mtd == null && !mtdErr}
              error={mtdErr}
              actual={actual}
              pace={pace}
              goal={goal}
              isEditing={isEditing}
              draft={isEditing ? draft : ""}
              saving={saving}
              pctOfGoal={pctOfGoal}
              pctOfGoalCapped={pctOfGoalCapped}
              onStartEdit={() => {
                setEditing(p.family);
                setDraft(goal != null ? String(goal) : "");
              }}
              onCancelEdit={() => { setEditing(null); setDraft(""); }}
              onDraftChange={setDraft}
              onSave={() => saveGoal(p.family, draft)}
            />
          );
        })}
        {(() => {
          const fmt = (n) =>
            n == null
              ? "—"
              : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
          const tActual = mtd ? PRODUCTS.reduce((s, p) => s + Number(mtd[p.family] || 0), 0) : null;
          const tPace = tActual != null && completed > 0 ? (tActual / completed) * total : null;
          const tGoal =
            PRODUCTS.reduce((s, p) => {
              const g = goals[`${p.family}|${ym}`];
              return s + (g ? Number(g.goal) : 0);
            }, 0) || null;
          const tPct = tGoal && tActual != null ? tActual / tGoal : null;
          const ok = tPct != null && tPct >= 1;
          return (
            <div className="relative bg-card border-2 border-brown rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0">
              <div className="flex items-baseline justify-between">
                <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">Total B2B</span>
                <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] text-muted">MTD</span>
              </div>
              <div className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold text-ink leading-none mt-1.5 tabular-nums">
                {fmt(tActual)}
              </div>
              <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1">Pace {fmt(tPace)} (linear)</div>
              <div className="font-sans text-[11px] md:text-xs text-inksoft mt-2 pt-2 border-t border-rule">
                Goal {fmt(tGoal)}
                {tPct != null ? (
                  <>
                    {" · "}
                    <strong style={{ color: ok ? "#C8860D" : "#AA2D2D" }}>{Math.round(tPct * 100)}%</strong> to goal
                  </>
                ) : null}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-rule overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${tPct != null ? Math.max(0, Math.min(1, tPct)) * 100 : 0}%`,
                    background: ok ? "#C8860D" : "#E6A403",
                  }}
                />
              </div>
              <div className="font-sans text-[10px] text-muted mt-2 truncate">Gummies + Xvié + Serum case SKUs</div>
            </div>
          );
        })()}
      </div>

    </div>
  );
}

function ProductCard({
  label, skuNote, loading, error, actual, pace, goal,
  isEditing, draft, saving, pctOfGoal, pctOfGoalCapped,
  onStartEdit, onCancelEdit, onDraftChange, onSave,
}) {
  // Color the % to goal: same conventions as the other dashboards
  // (sage ≥100%, amber 90–100%, maroon <90%, neutral when no goal).
  const pctColor = !goal || pctOfGoal == null
    ? "#9A8F80"
    : pctOfGoal >= 1.0
      ? "#C8860D"
      : pctOfGoal >= 0.9
        ? "#E6A403"
        : "#AA2D2D";

  return (
    <div className="relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
                    before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-brown">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-sans text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-muted leading-tight">
          {label}
        </div>
        <div className="font-sans text-[10px] text-muted">B2B</div>
      </div>

      {/* MTD value */}
      <div className="font-display text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1.5 md:mt-2 tabular-nums break-words">
        {loading ? <span className="text-muted">…</span> : error ? <span className="text-muted text-base">—</span> : fmt$(actual)}
      </div>

      {/* Pace */}
      <div className="font-sans text-[11px] md:text-xs text-inksoft mt-1 leading-snug">
        Pace {loading || pace == null ? "—" : <span className="tabular-nums font-semibold">{fmt$(pace)}</span>}
        <span className="text-muted"> (linear)</span>
      </div>

      {/* Goal + edit affordance */}
      <div className="mt-2.5 pt-2 border-t border-rule/60">
        {isEditing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onSave(); }}
            className="flex items-center gap-1.5"
          >
            <span className="font-sans text-[11px] text-muted">Goal $</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="e.g. 50000"
              className="min-w-0 flex-1 rounded border border-rule bg-paper px-2 py-1 font-sans text-sm text-ink tabular-nums"
              disabled={saving}
            />
            <button
              type="submit"
              disabled={saving || !draft}
              className="shrink-0 rounded border border-brown bg-brown text-paper px-2 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] disabled:opacity-50"
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              className="shrink-0 rounded border border-rule bg-paper px-2 py-1 font-sans text-[11px] uppercase tracking-[0.08em] text-inksoft hover:bg-paper2"
            >
              ×
            </button>
          </form>
        ) : (
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-sans text-[11px] md:text-xs text-inksoft leading-snug">
              Goal{" "}
              <span className="tabular-nums font-semibold text-ink">
                {goal != null ? fmt$(goal) : "—"}
              </span>
              {goal != null && (
                <>
                  {" · "}
                  <span className="tabular-nums font-semibold" style={{ color: pctColor }}>
                    {fmtPct(pctOfGoal || 0)}
                  </span>
                  <span className="text-muted"> to goal</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onStartEdit}
              className="shrink-0 font-sans text-[10px] uppercase tracking-[0.12em] text-brown hover:underline"
              title={goal != null ? "Override saved goal (locked once entered)" : "Set monthly goal"}
            >
              {goal != null ? "Edit" : "Set goal"}
            </button>
          </div>
        )}

        {/* Progress bar */}
        <div className="mt-2 h-1.5 w-full rounded-full bg-paper2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pctOfGoalCapped * 100}%`,
              background: pctColor,
            }}
            aria-label={`Progress to goal: ${fmtPct(pctOfGoal || 0)}`}
          />
        </div>
      </div>

      <div className="font-sans text-[10px] text-muted leading-snug mt-1.5">
        {skuNote}
      </div>
    </div>
  );
}
