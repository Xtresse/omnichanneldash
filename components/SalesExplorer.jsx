"use client";

import { useMemo, useState } from "react";

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

// Normalize a zip to its 5-digit base so "90210-1234" and "90210" group
// together (Shopify returns ZIP+4 on some B2B orders).
const zip5 = (z) => {
  const s = String(z || "").trim();
  if (!s) return "";
  const m = s.match(/\d{5}/);
  return m ? m[0] : s;
};

// Channel options drive the same B2B/DTC/ADCS split used everywhere else.
const CHANNELS = [
  { v: "all", l: "All" },
  { v: "B2B", l: "B2B" },
  { v: "DTC", l: "DTC" },
  { v: "ADCS", l: "ADCS" },
];

const ALL = "__all__";
const NO_REP = "__norep__"; // DTC / untagged orders have no rep

/**
 * Sales Explorer — filter sales by State, Rep, and Zip simultaneously.
 *
 * Works off the already-classified `orders` array (windowed, net > 0). The
 * three dropdowns cross-filter: each one's options reflect what's still
 * reachable under the other active selections, so you can drill State →
 * Rep → Zip (in any order) and never land on an empty combination. The
 * breakdown table below re-groups the surviving orders by whichever
 * dimension you pick, sorted by sales. Honors the global Net/Gross toggle.
 */
export default function SalesExplorer({ orders = [], metric = "net" }) {
  const [state, setState] = useState(ALL);
  const [rep, setRep] = useState(ALL);
  const [zip, setZip] = useState(ALL);
  const [channel, setChannel] = useState("all");
  const [groupBy, setGroupBy] = useState("state"); // state | rep | zip

  const val = (o) => (metric === "gross" ? o.gross : o.net) || 0;

  // Pre-derive the normalized dimension values once per order.
  const rows = useMemo(
    () =>
      (orders || []).map((o) => ({
        ...o,
        _state: (o.state || "").trim(),
        _rep: o.rep || NO_REP,
        _zip: zip5(o.zip),
      })),
    [orders]
  );

  // A predicate per dimension; passing `except` lets us build each
  // dropdown's option list from everything EXCEPT its own filter (so the
  // options stay populated as you narrow the others).
  const matchChannel = (o) =>
    channel === "all" ? true : channel === "ADCS" ? o.adcs : o.channel === channel;
  const matchState = (o) => state === ALL || o._state === state;
  const matchRep = (o) => rep === ALL || o._rep === rep;
  const matchZip = (o) => zip === ALL || o._zip === zip;

  const passes = (o, except) =>
    matchChannel(o) &&
    (except === "state" || matchState(o)) &&
    (except === "rep" || matchRep(o)) &&
    (except === "zip" || matchZip(o));

  // Build sorted, sales-ranked option lists for each dropdown.
  const options = useMemo(() => {
    const collect = (except, keyOf, isRep) => {
      const m = new Map();
      for (const o of rows) {
        if (!passes(o, except)) continue;
        const k = keyOf(o);
        if (isRep ? false : !k) continue; // skip blank state/zip; keep NO_REP
        m.set(k, (m.get(k) || 0) + val(o));
      }
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    };
    return {
      states: collect("state", (o) => o._state, false),
      reps: collect("rep", (o) => o._rep, true),
      zips: collect("zip", (o) => o._zip, false),
    };
  }, [rows, state, rep, zip, channel, metric]);

  // Final filtered set (all filters applied).
  const filtered = useMemo(
    () => rows.filter((o) => passes(o, null)),
    [rows, state, rep, zip, channel, metric]
  );

  const summary = useMemo(() => {
    let sales = 0;
    const accounts = new Set();
    for (const o of filtered) {
      sales += val(o);
      accounts.add(o.account || o.email || o.id);
    }
    return { sales, orders: filtered.length, accounts: accounts.size };
  }, [filtered, metric]);

  // Group the filtered orders by the selected dimension for the table.
  const breakdown = useMemo(() => {
    const keyOf =
      groupBy === "rep"
        ? (o) => (o._rep === NO_REP ? "— (DTC / no rep)" : o._rep)
        : groupBy === "zip"
        ? (o) => o._zip || "— (no zip)"
        : (o) => o._state || "— (no state)";
    const m = new Map();
    for (const o of filtered) {
      const k = keyOf(o);
      let g = m.get(k);
      if (!g) {
        g = { key: k, sales: 0, orders: 0, accounts: new Set() };
        m.set(k, g);
      }
      g.sales += val(o);
      g.orders += 1;
      g.accounts.add(o.account || o.email || o.id);
    }
    return Array.from(m.values())
      .map((g) => ({ key: g.key, sales: g.sales, orders: g.orders, accounts: g.accounts.size }))
      .sort((a, b) => b.sales - a.sales);
  }, [filtered, groupBy, metric]);

  const repLabel = (k) => (k === NO_REP ? "— (DTC / no rep)" : k);
  const anyActive = state !== ALL || rep !== ALL || zip !== ALL || channel !== "all";
  const clearAll = () => {
    setState(ALL);
    setRep(ALL);
    setZip(ALL);
    setChannel("all");
  };

  const M = metric === "gross" ? "Gross" : "Net";
  const maxSales = breakdown.length ? breakdown[0].sales : 0;

  return (
    <div className="bg-card border border-rule rounded-xl p-3 md:p-5">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 md:gap-3 mb-3 md:mb-4">
        <Dropdown
          label="State"
          value={state}
          onChange={setState}
          allLabel="All states"
          options={options.states.map(([k, v]) => ({ value: k, label: `${k} · ${fmtMoney(v)}` }))}
        />
        <Dropdown
          label="Rep"
          value={rep}
          onChange={setRep}
          allLabel="All reps"
          options={options.reps.map(([k, v]) => ({ value: k, label: `${repLabel(k)} · ${fmtMoney(v)}` }))}
        />
        <Dropdown
          label="Zip"
          value={zip}
          onChange={setZip}
          allLabel="All zips"
          options={options.zips.map(([k, v]) => ({ value: k, label: `${k} · ${fmtMoney(v)}` }))}
        />
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Channel</span>
          <div className="flex items-center gap-1">
            {CHANNELS.map((opt) => {
              const active = channel === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setChannel(opt.v)}
                  aria-pressed={active}
                  className={`shrink-0 min-h-touch px-2.5 rounded-md font-sans text-xs border transition ${
                    active
                      ? "bg-brown text-paper border-brown"
                      : "bg-paper text-inksoft border-rule hover:bg-paper2 hover:border-tan"
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
        </div>
        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="min-h-touch px-3 rounded-md font-sans text-xs border border-rule text-inksoft hover:bg-paper2 hover:border-tan transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary of the current selection */}
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
        <Stat label={`${M} Sales`} value={fmtMoney(summary.sales)} />
        <Stat label="Orders" value={summary.orders.toLocaleString()} />
        <Stat label="Accounts" value={summary.accounts.toLocaleString()} />
      </div>

      {/* Group-by toggle */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Break down by</span>
          {[
            { v: "state", l: "State" },
            { v: "rep", l: "Rep" },
            { v: "zip", l: "Zip" },
          ].map((opt) => {
            const active = groupBy === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setGroupBy(opt.v)}
                aria-pressed={active}
                className={`min-h-touch px-3 rounded-md font-sans text-xs border transition ${
                  active
                    ? "bg-brown text-paper border-brown"
                    : "bg-paper text-inksoft border-rule hover:bg-paper2 hover:border-tan"
                }`}
              >
                {opt.l}
              </button>
            );
          })}
        </div>
        <span className="font-sans text-[11px] text-muted">
          {breakdown.length.toLocaleString()} {groupBy === "state" ? "states" : groupBy === "rep" ? "reps" : "zips"}
        </span>
      </div>

      {/* Breakdown table */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs font-sans border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted border-b border-rule">
              <th className="py-2 pr-3 capitalize">{groupBy}</th>
              <th className="py-2 pr-3 text-right">Orders</th>
              <th className="py-2 pr-3 text-right">Accounts</th>
              <th className="py-2 pr-0 text-right">{M} Sales</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((g) => (
              <tr key={g.key} className="border-b border-rule/60">
                <td className="py-2 pr-3 text-inksoft font-medium relative">
                  <span className="relative z-10">{g.key}</span>
                  {/* Subtle in-row bar for quick magnitude scan */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1 bottom-1 bg-brown/10 rounded-sm"
                    style={{ width: maxSales ? `${Math.max(2, (g.sales / maxSales) * 100)}%` : 0 }}
                  />
                </td>
                <td className="py-2 pr-3 text-right text-muted tabular-nums">{g.orders.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right text-muted tabular-nums">{g.accounts.toLocaleString()}</td>
                <td className="py-2 pr-0 text-right text-ink font-semibold tabular-nums">{fmtMoney(g.sales)}</td>
              </tr>
            ))}
            {!breakdown.length && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted">
                  No sales match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dropdown({ label, value, onChange, options, allLabel }) {
  return (
    <label className="flex flex-col gap-1 min-w-[150px]">
      <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-paper text-inksoft border border-rule rounded-md px-2 min-h-touch font-sans text-xs md:text-sm hover:border-tan focus:border-brown outline-none"
      >
        <option value="__all__">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-rule bg-paper2/50 px-3 py-2.5">
      <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="font-display text-xl md:text-2xl font-semibold text-ink leading-none tabular-nums mt-1">
        {value}
      </div>
    </div>
  );
}
