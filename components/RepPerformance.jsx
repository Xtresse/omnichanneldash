"use client";

const fmt$ = (n) => {
  if (!n || n === 0) return "$0";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString();
};
const fmtN = (n) => Math.round(n || 0).toLocaleString();

const fmtLastOrder = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const TERRITORY_LABEL = {
  Existing: "Existing Territories",
  New: "New Territories",
  "1099": "1099 Territories",
};

const FAMILIES = [
  { key: "Gummies", label: "Gummies" },
  { key: "Serum", label: "Serum" },
  { key: "XVIE", label: "XVIE" },
  { key: "Sachets", label: "Sachet" },
];

const blankSlot = { newUnits: 0, newDollars: 0, existingUnits: 0, existingDollars: 0 };

// Brand-aligned compare colors. Green sage = favorable; brand maroon =
// unfavorable; muted brown = neutral / no comparison data. Tabular nums
// keep delta percentages aligned across rows.
const FAVORABLE = "#5C8A6F";
const UNFAVORABLE = "#5C2F2E";
const NEUTRAL = "#9A8F80";

function deltaColor(cur, prior, higherIsBetter = true) {
  if (prior === undefined || prior === null) return NEUTRAL;
  if (cur === prior) return NEUTRAL;
  const up = cur > prior;
  if (higherIsBetter) return up ? FAVORABLE : UNFAVORABLE;
  return up ? UNFAVORABLE : FAVORABLE;
}

function deltaPctText(cur, prior) {
  if (prior === undefined || prior === null) return "—";
  if (!prior) return cur > 0 ? "new" : "—";
  const x = (cur - prior) / prior;
  if (!isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
}

function arrow(cur, prior) {
  if (prior === undefined || prior === null) return "";
  if (cur > prior) return "▲";
  if (cur < prior) return "▼";
  return "·";
}

/**
 * Rep performance broken into Existing / New / 1099 sections.
 * Each section is a sortable-by-rank table with totals at the bottom.
 *
 * The per-product columns show "Nu · Eu" — units sold to NEW customers
 * (left, in brand maroon) and units to EXISTING customers (right, muted).
 * Hovering the cell reveals the dollar split.
 *   - Gummies "new" = order has Shopify Flow's `b2b` + `first order` tags
 *   - Serum / XVIE / Sachets "new" = customer's first-EVER purchase of
 *     that product (across all time) lands inside the loaded window
 *
 * `compare` (optional) carries prior-period values keyed by rep name:
 *   { mode, from, to, reps: [{rep, net, orders, productMix}] }
 * When provided, every numeric cell gets a small subtext showing the
 * prior value, an arrow, and the percent delta — green sage if favorable,
 * brand maroon if unfavorable, muted brown for "no prior data".
 */
export default function RepPerformance({ repPerformance, compare }) {
  if (!repPerformance || repPerformance.length === 0) return null;
  const priorByRep =
    compare && compare.reps
      ? Object.fromEntries(compare.reps.map((r) => [r.rep, r]))
      : null;
  // Explicit human label like "prior 30d (Apr 4 – May 4, 2026)" used in
  // every delta cell's hover/tap tooltip so the comparison context is
  // unambiguous. Built once at the top so we don't redo the work per cell.
  const compareLabel = compare ? buildCompareLabel(compare) : null;

  return (
    <div className="space-y-3 md:space-y-4">
      {repPerformance.map(({ territory, rows }) => (
        <RepTable
          key={territory}
          title={TERRITORY_LABEL[territory] || territory}
          rows={rows}
          priorByRep={priorByRep}
          compareLabel={compareLabel}
        />
      ))}
    </div>
  );
}

function buildCompareLabel(compare) {
  if (!compare || !compare.from || !compare.to) return null;
  const f = new Date(compare.from + "T00:00:00Z");
  const t = new Date(compare.to + "T00:00:00Z");
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return null;
  const days = Math.round((t - f) / 86400000) + 1;
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  const fStr = f.toLocaleDateString("en-US", opts);
  const tStr = t.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  const window =
    compare.mode === "yoy" ? "last year" :
    days === 1 ? "yesterday" :
    `prior ${days}d`;
  return `${window} (${fStr} – ${tStr})`;
}

function RepTable({ title, rows, priorByRep, compareLabel }) {
  // Sum each family's slot for the subtotal row.
  const totals = {
    net: 0,
    orders: 0,
    productMix: {
      Gummies: { ...blankSlot },
      Serum: { ...blankSlot },
      XVIE: { ...blankSlot },
      Sachets: { ...blankSlot },
    },
  };
  // Prior subtotals so the footer also shows a delta when compare is on.
  const priorTotals = priorByRep
    ? {
        net: 0,
        orders: 0,
        productMix: {
          Gummies: { ...blankSlot },
          Serum: { ...blankSlot },
          XVIE: { ...blankSlot },
          Sachets: { ...blankSlot },
        },
      }
    : null;
  for (const r of rows) {
    totals.net += r.net || 0;
    totals.orders += r.orders || 0;
    for (const f of FAMILIES) {
      const slot = (r.productMix && r.productMix[f.key]) || blankSlot;
      totals.productMix[f.key].newUnits += slot.newUnits || 0;
      totals.productMix[f.key].newDollars += slot.newDollars || 0;
      totals.productMix[f.key].existingUnits += slot.existingUnits || 0;
      totals.productMix[f.key].existingDollars += slot.existingDollars || 0;
    }
    if (priorByRep) {
      const p = priorByRep[r.rep];
      if (p) {
        priorTotals.net += p.net || 0;
        priorTotals.orders += p.orders || 0;
        for (const f of FAMILIES) {
          const ps = (p.productMix && p.productMix[f.key]) || blankSlot;
          priorTotals.productMix[f.key].newUnits += ps.newUnits || 0;
          priorTotals.productMix[f.key].newDollars += ps.newDollars || 0;
          priorTotals.productMix[f.key].existingUnits += ps.existingUnits || 0;
          priorTotals.productMix[f.key].existingDollars += ps.existingDollars || 0;
        }
      }
    }
  }

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="bg-browndeep text-paper px-4 py-2.5 md:px-5 md:py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
          {title}
        </h3>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
          {rows.length} reps · {fmt$(totals.net)} net · units shown as <span className="text-paper">N</span> new ·{" "}
          E existing
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs font-sans border-collapse">
          <thead>
            <tr className="bg-paper2 text-left">
              <Th width="56" align="left">Region</Th>
              <Th width="56" align="left">Rank</Th>
              <Th align="left">Rep</Th>
              <Th width="140" align="left">Last order</Th>
              <Th align="right">Orders</Th>
              {FAMILIES.map((f) => (
                <Th
                  key={f.key}
                  align="right"
                  title={
                    f.key === "Gummies"
                      ? "Units in orders Shopify tagged 'first order' (N) vs all other orders (E). Hover the cell for $."
                      : `Units sold to customers whose first-ever ${f.label} purchase is inside this window (N) vs returning customers (E). Hover the cell for $.`
                  }
                >
                  {f.label}
                </Th>
              ))}
              <Th align="right" className="border-l border-rule">Net sales</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const prior = priorByRep ? priorByRep[r.rep] : null;
              return (
                <tr key={r.rep} className="border-t border-rule/60">
                  <Td>{r.region}</Td>
                  <Td className="text-muted">{r.rank}</Td>
                  <Td className="font-medium text-ink">{r.rep}</Td>
                  <Td className="text-muted text-[11px]">
                    {fmtLastOrder(r.lastOrderAt)}
                    {r.lastShipment && <ShipmentPill ship={r.lastShipment} />}
                  </Td>
                  <Td align="right">
                    {r.orders ? fmtN(r.orders) : "—"}
                    {priorByRep && (
                      <DeltaBelow
                        cur={r.orders || 0}
                        prior={prior ? prior.orders : null}
                        fmt={fmtN}
                        compareLabel={compareLabel}
                      />
                    )}
                  </Td>
                  {FAMILIES.map((f) => {
                    const cur = (r.productMix && r.productMix[f.key]) || blankSlot;
                    const pri =
                      prior && prior.productMix ? prior.productMix[f.key] : null;
                    return (
                      <Td key={f.key} align="right">
                        <ProductCell slot={cur} />
                        {priorByRep && <ProductDeltaBelow cur={cur} prior={pri} compareLabel={compareLabel} />}
                      </Td>
                    );
                  })}
                  <Td align="right" className="font-semibold border-l border-rule">
                    {fmt$(r.net)}
                    {priorByRep && (
                      <DeltaBelow
                        cur={r.net || 0}
                        prior={prior ? prior.net : null}
                        fmt={fmt$}
                        compareLabel={compareLabel}
                      />
                    )}
                  </Td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5 + FAMILIES.length + 1} className="py-4 text-center text-muted text-xs">
                  No reps in this territory.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-paper2 font-semibold">
              <Td colSpan={4} className="italic text-inksoft">{title} subtotal</Td>
              <Td align="right">
                {fmtN(totals.orders)}
                {priorTotals && (
                  <DeltaBelow cur={totals.orders} prior={priorTotals.orders} fmt={fmtN} compareLabel={compareLabel} />
                )}
              </Td>
              {FAMILIES.map((f) => (
                <Td key={f.key} align="right">
                  <ProductCell slot={totals.productMix[f.key]} />
                  {priorTotals && (
                    <ProductDeltaBelow
                      cur={totals.productMix[f.key]}
                      prior={priorTotals.productMix[f.key]}
                      compareLabel={compareLabel}
                    />
                  )}
                </Td>
              ))}
              <Td align="right" className="text-brown border-l border-rule">
                {fmt$(totals.net)}
                {priorTotals && (
                  <DeltaBelow cur={totals.net} prior={priorTotals.net} fmt={fmt$} compareLabel={compareLabel} />
                )}
              </Td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden divide-y divide-rule/60">
        {rows.map((r) => {
          const prior = priorByRep ? priorByRep[r.rep] : null;
          return (
            <div key={r.rep} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-6 text-right text-[11px] text-muted tabular-nums">{r.rank}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-sans text-sm text-ink truncate">{r.rep}</div>
                  <div className="font-sans text-[11px] text-muted">
                    {r.region} · {fmtN(r.orders)} ord · {fmtLastOrder(r.lastOrderAt)}
                    {r.lastShipment && (
                      <span className="ml-1.5 inline-block align-middle">
                        <ShipmentPill ship={r.lastShipment} />
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-base font-semibold text-ink tabular-nums">
                    {fmt$(r.net)}
                  </div>
                  {priorByRep && (
                    <DeltaBelow
                      cur={r.net || 0}
                      prior={prior ? prior.net : null}
                      fmt={fmt$}
                      compareLabel={compareLabel}
                    />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pl-9">
                {FAMILIES.map((f) => {
                  const cur = (r.productMix && r.productMix[f.key]) || blankSlot;
                  const pri =
                    prior && prior.productMix ? prior.productMix[f.key] : null;
                  return (
                    <ProductChip
                      key={f.key}
                      label={f.label}
                      slot={cur}
                      prior={priorByRep ? pri : undefined}
                      compareLabel={compareLabel}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Desktop cell: "5N · 28E". N in brand maroon, E in muted color, dot
 * separator. Tooltip shows the dollar split so the user can verify
 * the breakdown without losing the units-first scan.
 */
function ProductCell({ slot }) {
  const n = slot.newUnits || 0;
  const e = slot.existingUnits || 0;
  if (n === 0 && e === 0) return <span className="text-muted">—</span>;
  const tooltip = `New: ${fmtN(n)} units · ${fmt$(slot.newDollars)}
Existing: ${fmtN(e)} units · ${fmt$(slot.existingDollars)}`;
  return (
    <span title={tooltip} className="inline-flex items-baseline gap-1 tabular-nums">
      <span className={n > 0 ? "text-brown font-semibold" : "text-muted"}>
        {fmtN(n)}N
      </span>
      <span className="text-muted/60">·</span>
      <span className={e > 0 ? "text-inksoft" : "text-muted"}>
        {fmtN(e)}E
      </span>
    </span>
  );
}

/** Delta subtext under any single numeric value. Tooltip is explicit
 * about the comparison window so "vs prior 30d" can never be ambiguous. */
function DeltaBelow({ cur, prior, fmt, compareLabel }) {
  if (prior === undefined || prior === null) {
    return (
      <div
        className="font-sans text-[9.5px] text-muted tabular-nums leading-tight mt-0.5"
        title={compareLabel ? `No data for ${compareLabel}` : "No prior-period data"}
      >
        —
      </div>
    );
  }
  const color = deltaColor(cur, prior, true);
  const ar = arrow(cur, prior);
  const tooltip = compareLabel
    ? `vs ${compareLabel}: ${fmt(prior)}`
    : `Prior: ${fmt(prior)}`;
  return (
    <div
      className="font-sans text-[9.5px] tabular-nums leading-tight mt-0.5"
      style={{ color }}
      title={tooltip}
    >
      {fmt(prior)} {ar} {deltaPctText(cur, prior)}
    </div>
  );
}

/** Delta subtext for product cells — compares total units (N + E). */
function ProductDeltaBelow({ cur, prior, compareLabel }) {
  if (!prior) {
    return (
      <div
        className="font-sans text-[9.5px] text-muted tabular-nums leading-tight mt-0.5"
        title={compareLabel ? `No data for ${compareLabel}` : "No prior-period data"}
      >
        —
      </div>
    );
  }
  const curT = (cur.newUnits || 0) + (cur.existingUnits || 0);
  const priorT = (prior.newUnits || 0) + (prior.existingUnits || 0);
  const color = deltaColor(curT, priorT, true);
  const ar = arrow(curT, priorT);
  const tooltip = compareLabel
    ? `vs ${compareLabel}: ${prior.newUnits || 0}N · ${prior.existingUnits || 0}E (${priorT} units)`
    : `Prior: ${prior.newUnits || 0}N · ${prior.existingUnits || 0}E (${priorT} units)`;
  return (
    <div
      className="font-sans text-[9.5px] tabular-nums leading-tight mt-0.5"
      style={{ color }}
      title={tooltip}
    >
      {priorT}u {ar} {deltaPctText(curT, priorT)}
    </div>
  );
}

/** Mobile chip — same N/E split, label visible. Adds delta when compare is on. */
function ProductChip({ label, slot, prior, compareLabel }) {
  const n = slot.newUnits || 0;
  const e = slot.existingUnits || 0;
  const total = n + e;
  const showDelta = prior !== undefined;
  const priorTotal = prior ? (prior.newUnits || 0) + (prior.existingUnits || 0) : 0;
  const tooltip = !showDelta
    ? null
    : prior
      ? compareLabel
        ? `vs ${compareLabel}: ${prior.newUnits || 0}N · ${prior.existingUnits || 0}E (${priorTotal} units)`
        : `Prior: ${prior.newUnits || 0}N · ${prior.existingUnits || 0}E (${priorTotal} units)`
      : compareLabel
        ? `No data for ${compareLabel}`
        : "No prior-period data";
  return (
    <div
      className={`flex flex-col gap-0.5 px-2 py-1 rounded border font-sans text-[11px] ${
        total > 0 ? "bg-paper2 border-tan" : "bg-paper border-rule"
      }`}
      title={tooltip || undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold ${total > 0 ? "text-inksoft" : "text-muted"}`}>
          {label}
        </span>
        <span className="tabular-nums">
          <span className={n > 0 ? "text-brown font-semibold" : "text-muted"}>
            {fmtN(n)}N
          </span>
          <span className="text-muted/60 mx-0.5">·</span>
          <span className={e > 0 ? "text-inksoft" : "text-muted"}>
            {fmtN(e)}E
          </span>
        </span>
      </div>
      {showDelta && (
        <div
          className="font-sans text-[9.5px] tabular-nums leading-tight"
          style={{ color: prior ? deltaColor(total, priorTotal, true) : NEUTRAL }}
        >
          {prior
            ? `${priorTotal}u ${arrow(total, priorTotal)} ${deltaPctText(total, priorTotal)}`
            : "—"}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny status pill rendered next to "Last order" on each rep row. Shows
 * the most recent shipment status — Pending / Shipped / In transit /
 * Delivered / Issue — with the ship date and days-in-transit on hover.
 *
 * Source: data.repPerformance[i].rows[j].lastShipment from windsor.js
 * deriveFulfillment(). Null when no order for this rep has shipped yet.
 */
function ShipmentPill({ ship }) {
  if (!ship) return null;
  const STATUS = {
    pending:    { color: "#9A8F80", label: "Pending" },
    shipped:    { color: "#a89478", label: "Shipped" },
    in_transit: { color: "#7a3a2d", label: "In transit" },
    delivered:  { color: "#5C8A6F", label: "Delivered" },
    exception:  { color: "#5C2F2E", label: "Issue" },
  };
  const s = STATUS[ship.status] || STATUS.shipped;
  const days = ship.daysInTransit;
  const tip = [
    `Last shipment: ${ship.label || s.label}`,
    ship.shippedAt ? `Shipped ${new Date(ship.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : null,
    days !== null && days !== undefined ? `${days}d ago` : null,
    ship.carrier ? `via ${ship.carrier}` : null,
    ship.trackingNumber ? `#${ship.trackingNumber}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9.5px] tabular-nums border align-middle"
      style={{ borderColor: s.color + "55", color: s.color, lineHeight: 1 }}
      title={tip}
    >
      <span className="w-1 h-1 rounded-full" style={{ background: s.color }} />
      <span>
        {s.label}
        {days !== null && days !== undefined ? ` · ${days}d` : ""}
      </span>
    </span>
  );
}

function Th({ children, align = "left", width, className = "", title, rowSpan, colSpan }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <th
      title={title}
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={width ? { width: `${width}px` } : undefined}
      className={`py-2 px-3 font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left", className = "", colSpan }) {
  const alignClass = align === "right" ? "text-right tabular-nums" : "text-left";
  return (
    <td
      colSpan={colSpan}
      className={`py-2 px-3 text-inksoft whitespace-nowrap ${alignClass} ${className}`}
    >
      {children}
    </td>
  );
}
