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
  { label: "Gummies", family: "Gummies", skuNote: "X-GN-* family · incl. 860011740100 (B2B case)" },
  { label: "Xvié",    family: "XVIE",    skuNote: "X-XVIE-* family" },
  { label: "Serum",   family: "Serum",   skuNote: "X-FRC-30ML-001 + X-FRC-30ML-CASE" },
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

// Returns {completed, total} — *completed* full days so far this month
// (i.e. day-of-month minus 1, since today is only partial) and total days
// in the current month. Pacing uses completed-day count as the divisor
// so a half-finished today doesn't get treated as a full day of run-rate.
// On the 1st of the month, completed = 0 and pacing is hidden.
function dayProgress() {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const completed = Math.max(0, dayOfMonth - 1);
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return { completed, total };
}

// First-of-month → today in YYYY-MM-DD, matching app/page.jsx's mtdRange().
function mtdRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const ymd = (d) => {
    // Use local YMD so we don't accidentally skew across midnight UTC.
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

  // Fetch MTD product-family data (always MTD, independent of FilterBar state).
  useEffect(() => {
    let cancelled = false;
    const { from, to } = mtdRange();
    const qs = new URLSearchParams({ from, to, granularity: "auto" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setMtdErr(j.error || "Failed to load MTD data");
          return;
        }
        const totals = { Serum: 0, XVIE: 0, Gummies: 0 };
        for (const row of j.productFamily || []) {
          if (row?.family && totals[row.family] !== undefined) {
            totals[row.family] = Number(row.B2B || 0);
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
      <div className="flex items-baseline justify-between gap-3 mb-2.5 md:mb-3">
        <h2 className="font-display text-lg md:text-xl font-semibold text-brown leading-tight">
          B2B Month-to-Date
        </h2>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.14em] text-muted">
          Day {completed}/{total} complete · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
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
      </div>

      <p className="font-sans text-[10px] text-muted leading-snug mt-2.5 md:mt-3">
        MTD B2B net sales (gross − discounts − refunds). Pace = MTD ÷ completed-full-days × days-in-month (today's partial day is excluded from the divisor).
        Goal is set once per product per month and persists in Vercel KV (or <code className="bg-paper px-1 rounded">data/b2b-goals.json</code> locally).
      </p>
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
      ? "#5C8A6F"
      : pctOfGoal >= 0.9
        ? "#C58A2D"
        : "#5C2F2E";

  return (
    <div className="relative bg-card border border-rule rounded-xl px-4 py-3.5 md:px-5 md:py-4 overflow-hidden
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
