"use client";

import { useEffect, useMemo, useState } from "react";

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtN = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Prioritized recency buckets — each account lands in exactly one. The
// first four are "active-ish" (ordered this calendar year); the rest are
// dormancy cohorts by the year of their last order.
function buildBuckets() {
  const thisYear = new Date().getFullYear();
  return [
    { key: "0-30", label: "0–30 days", tone: "#2E7D32", test: (a) => a.daysSince <= 30 },
    { key: "31-60", label: "31–60 days", tone: "#C8860D", test: (a) => a.daysSince <= 60 },
    { key: "61-90", label: "61–90 days", tone: "#E6A403", test: (a) => a.daysSince <= 90 },
    { key: "90+", label: "90+ days (this year)", tone: "#9C6F4A", test: (a) => yearOf(a) >= thisYear },
    { key: "since-prev", label: `No order since ${thisYear - 1}`, tone: "#AA2D2D", test: (a) => yearOf(a) === thisYear - 1 },
    { key: "since-prev2", label: `No order since ${thisYear - 2}`, tone: "#7A3D23", test: (a) => yearOf(a) === thisYear - 2 },
    { key: "older", label: "Older / dormant", tone: "#302C29", test: () => true },
  ];
}
const yearOf = (a) => (a.lastOrder ? Number(String(a.lastOrder).slice(0, 4)) : 0);

export default function AccountAging() {
  const [data, setData] = useState(null); // accountAging[]
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null); // expanded bucket key
  const [acct, setAcct] = useState(null); // drilled account (for history)

  useEffect(() => {
    let cancelled = false;
    // accountAging is built server-side from the ALL-TIME pull (sharded,
    // cached) regardless of the requested window, so we ask for the
    // smallest/cheapest window here — the response is fast and the aging
    // payload is still full-history with true lifetime $.
    const qs = new URLSearchParams({ preset: "last_7d", granularity: "month" });
    fetch(`/api/dashboard?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.accountAging)) setData(j.accountAging);
        else setErr(j.error || "No aging data");
      })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, []);

  const buckets = useMemo(() => buildBuckets(), []);

  // Assign each account to its first matching bucket; roll up counts/$.
  const summary = useMemo(() => {
    if (!data) return null;
    const rows = buckets.map((b) => ({ ...b, accounts: [], count: 0, net: 0, Gummies: 0, Serum: 0, XVIE: 0 }));
    for (const a of data) {
      const row = rows.find((r) => r.test(a)) || rows[rows.length - 1];
      row.accounts.push(a);
      row.count += 1;
      row.net += a.lifetimeNet || 0;
      row.Gummies += a.byProduct?.Gummies || 0;
      row.Serum += a.byProduct?.Serum || 0;
      row.XVIE += a.byProduct?.XVIE || 0;
    }
    const totalAccts = data.length || 1;
    rows.forEach((r) => { r.pct = r.count / totalAccts; });
    return { rows, totalAccts, totalNet: data.reduce((s, a) => s + (a.lifetimeNet || 0), 0) };
  }, [data, buckets]);

  if (err) return <div className="rounded-xl border border-rule bg-card p-4 font-sans text-sm text-unfavorable">Couldn’t load aging: {err}</div>;
  if (!summary) return <div className="rounded-xl border border-rule bg-card p-8 text-center font-sans text-sm text-muted">Loading account aging…</div>;

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        <Tile label="Accounts" value={fmtN(summary.totalAccts)} />
        <Tile label="Lifetime net" value={fmt$(summary.totalNet)} />
        <Tile label="Active ≤90d" value={fmtN(summary.rows.filter((r) => ["0-30", "31-60", "61-90"].includes(r.key)).reduce((s, r) => s + r.count, 0))} />
        <Tile label="Dormant (prior yrs)" value={fmtN(summary.rows.filter((r) => ["since-prev", "since-prev2", "older"].includes(r.key)).reduce((s, r) => s + r.count, 0))} />
      </div>

      {/* Bucket summary table */}
      <div className="bg-card border border-rule rounded-xl overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs font-sans border-collapse">
            <thead>
              <tr className="bg-paper2 text-left text-muted">
                <th className="py-2 px-3 font-semibold">Aging bucket</th>
                <th className="py-2 px-3 font-semibold text-right">Accounts</th>
                <th className="py-2 px-3 font-semibold text-right">% of base</th>
                <th className="py-2 px-3 font-semibold text-right">Lifetime net</th>
                <th className="py-2 px-3 font-semibold text-right">Gummies</th>
                <th className="py-2 px-3 font-semibold text-right">Serum</th>
                <th className="py-2 px-3 font-semibold text-right">XVIE</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <BucketRows key={r.key} r={r} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} onAcct={setAcct} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: bucket cards */}
        <div className="md:hidden divide-y divide-rule/60">
          {summary.rows.map((r) => (
            <div key={r.key}>
              <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.tone }} />
                  <span className="font-sans text-sm font-semibold text-ink">{r.label}</span>
                </span>
                <span className="font-sans text-xs text-muted tabular-nums">{fmtN(r.count)} · {Math.round(r.pct * 100)}% · {fmt$(r.net)}</span>
              </button>
              {open === r.key && (
                <div className="px-4 pb-3 space-y-2">
                  {r.accounts.slice(0, 100).map((a, i) => (
                    <button key={i} type="button" onClick={() => setAcct(a)} className="block w-full text-left rounded border border-rule bg-paper2/50 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-sans text-sm font-medium text-ink truncate">{a.name}</span>
                        <span className="font-sans text-xs text-inksoft tabular-nums">{fmt$(a.lifetimeNet)}</span>
                      </div>
                      <div className="font-sans text-[11px] text-muted">{a.rep || "—"} · last {fmtDate(a.lastOrder)} · {fmtN(a.daysSince)}d</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="font-sans text-[10px] text-muted leading-snug">
        Recency aging — every rep-attributed B2B account bucketed by days since its last order (all-history; DTC &amp; ADCS
        excluded; ties to the same account/rep/revenue logic as the other tabs). Click a bucket to list its accounts, then an account for its order history.
      </div>

      {/* Account order-history drawer */}
      {acct && <HistoryDrawer acct={acct} onClose={() => setAcct(null)} />}
    </div>
  );
}

function BucketRows({ r, open, onToggle, onAcct }) {
  return (
    <>
      <tr className="border-t border-rule/60 hover:bg-paper2/40 cursor-pointer" onClick={onToggle}>
        <td className="py-2 px-3">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.tone }} />
            <span className="font-medium text-ink">{r.label}</span>
          </span>
        </td>
        <td className="py-2 px-3 text-right tabular-nums font-semibold">{fmtN(r.count)}</td>
        <td className="py-2 px-3 text-right tabular-nums text-inksoft">{Math.round(r.pct * 100)}%</td>
        <td className="py-2 px-3 text-right tabular-nums font-semibold">{fmt$(r.net)}</td>
        <td className="py-2 px-3 text-right tabular-nums text-muted">{fmt$(r.Gummies)}</td>
        <td className="py-2 px-3 text-right tabular-nums text-muted">{fmt$(r.Serum)}</td>
        <td className="py-2 px-3 text-right tabular-nums text-muted">{fmt$(r.XVIE)}</td>
        <td className="py-2 px-3 text-right text-muted">{open ? "▾" : "▸"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="px-3 pb-3 bg-paper2/30">
            <div className="max-h-72 overflow-auto rounded border border-rule bg-card">
              <table className="w-full text-[11px] font-sans">
                <thead><tr className="text-left text-muted bg-paper2 sticky top-0">
                  <th className="py-1.5 px-2 font-semibold">Account</th>
                  <th className="py-1.5 px-2 font-semibold">Rep</th>
                  <th className="py-1.5 px-2 font-semibold">Last order</th>
                  <th className="py-1.5 px-2 font-semibold text-right">Days</th>
                  <th className="py-1.5 px-2 font-semibold text-right">Lifetime $</th>
                </tr></thead>
                <tbody>
                  {r.accounts.map((a, i) => (
                    <tr key={i} className="border-t border-rule/50 hover:bg-paper2/50 cursor-pointer" onClick={() => onAcct(a)}>
                      <td className="py-1.5 px-2 text-ink font-medium">{a.name}</td>
                      <td className="py-1.5 px-2 text-inksoft">{a.rep || "—"}</td>
                      <td className="py-1.5 px-2 text-inksoft whitespace-nowrap">{fmtDate(a.lastOrder)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{fmtN(a.daysSince)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{fmt$(a.lifetimeNet)}</td>
                    </tr>
                  ))}
                  {r.accounts.length === 0 && (
                    <tr><td colSpan={5} className="py-3 px-2 text-center text-muted italic">No accounts in this bucket.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function HistoryDrawer({ acct, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md bg-card border-l border-rule shadow-xl overflow-y-auto">
        <div className="bg-ink text-paper px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold truncate">{acct.name}</div>
            <div className="font-sans text-[11px] opacity-80">{acct.rep || "—"} · last {fmtDate(acct.lastOrder)} · {fmtN(acct.daysSince)}d ago</div>
          </div>
          <button onClick={onClose} className="shrink-0 font-sans text-xs uppercase tracking-[0.14em] bg-paper/10 hover:bg-paper/20 border border-paper/30 rounded px-2 py-0.5">Close</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Lifetime net" value={fmt$(acct.lifetimeNet)} />
            <Tile label="Orders" value={fmtN(acct.orders)} />
            <Tile label="First order" value={fmtDate(acct.firstOrder)} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-sans text-[11px] text-inksoft">
            <span>Gummies <strong className="text-ink">{fmt$(acct.byProduct?.Gummies)}</strong></span>
            <span>Serum <strong className="text-ink">{fmt$(acct.byProduct?.Serum)}</strong></span>
            <span>XVIE <strong className="text-ink">{fmt$(acct.byProduct?.XVIE)}</strong></span>
          </div>
          <div className="rounded border border-rule overflow-hidden">
            <table className="w-full text-[11px] font-sans">
              <thead><tr className="text-left text-muted bg-paper2">
                <th className="py-1.5 px-2 font-semibold">Order</th>
                <th className="py-1.5 px-2 font-semibold">Date</th>
                <th className="py-1.5 px-2 font-semibold">Ch</th>
                <th className="py-1.5 px-2 font-semibold text-right">Net</th>
              </tr></thead>
              <tbody>
                {(acct.history || []).map((h, i) => (
                  <tr key={i} className="border-t border-rule/50">
                    <td className="py-1.5 px-2 text-brown font-medium">{h.name || "—"}</td>
                    <td className="py-1.5 px-2 text-inksoft whitespace-nowrap">{fmtDate(h.date)}</td>
                    <td className="py-1.5 px-2 text-muted">{h.channel || ""}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{fmt$(h.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="bg-card border border-rule rounded-lg px-3 py-2">
      <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="font-display text-base md:text-lg font-semibold text-ink tabular-nums break-words">{value}</div>
    </div>
  );
}
