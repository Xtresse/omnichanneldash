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

/**
 * Rep performance broken into Existing / New / 1099 sections.
 * Each section is a sortable-by-rank table with totals at the bottom.
 * Mirrors the structure of xtresse-leadershipdash's by-rep view, but
 * scoped to the period currently selected on the omnichannel dashboard.
 */
export default function RepPerformance({ repPerformance, onExport }) {
  if (!repPerformance || repPerformance.length === 0) return null;

  return (
    <div className="space-y-3 md:space-y-4">
      {repPerformance.map(({ territory, rows }) => (
        <RepTable
          key={territory}
          title={TERRITORY_LABEL[territory] || territory}
          rows={rows}
        />
      ))}
    </div>
  );
}

function RepTable({ title, rows }) {
  const totals = rows.reduce(
    (a, r) => ({
      net: a.net + r.net,
      orders: a.orders + r.orders,
      newAccounts: a.newAccounts + r.newAccounts,
      firstOrderGummy: a.firstOrderGummy + (r.firstOrderGummy || 0),
    }),
    { net: 0, orders: 0, newAccounts: 0, firstOrderGummy: 0 }
  );

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="bg-browndeep text-paper px-4 py-2.5 md:px-5 md:py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
          {title}
        </h3>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
          {rows.length} reps · {fmt$(totals.net)} net
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
              <Th width="160" align="left">Last order</Th>
              <Th align="right">Orders</Th>
              <Th align="right">New accts</Th>
              <Th align="right" title="Orders Shopify Flow tagged 'b2b' + 'first order' that contained a gummy line item — matches leadership-dash convention">
                First-order gummy
              </Th>
              <Th align="right" className="border-l border-rule">Net sales</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rep} className="border-t border-rule/60">
                <Td>{r.region}</Td>
                <Td className="text-muted">{r.rank}</Td>
                <Td className="font-medium text-ink">{r.rep}</Td>
                <Td className="text-muted text-[11px]">{fmtLastOrder(r.lastOrderAt)}</Td>
                <Td align="right">{r.orders ? fmtN(r.orders) : "—"}</Td>
                <Td align="right">{r.newAccounts ? fmtN(r.newAccounts) : "—"}</Td>
                <Td align="right">{r.firstOrderGummy ? fmtN(r.firstOrderGummy) : "—"}</Td>
                <Td align="right" className="font-semibold border-l border-rule">
                  {fmt$(r.net)}
                </Td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-muted text-xs">
                  No reps in this territory.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-paper2 font-semibold">
              <Td colSpan={4} className="italic text-inksoft">{title} subtotal</Td>
              <Td align="right">{fmtN(totals.orders)}</Td>
              <Td align="right">{fmtN(totals.newAccounts)}</Td>
              <Td align="right">{fmtN(totals.firstOrderGummy)}</Td>
              <Td align="right" className="text-brown border-l border-rule">
                {fmt$(totals.net)}
              </Td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden divide-y divide-rule/60">
        {rows.map((r) => (
          <div key={r.rep} className="px-4 py-3 flex items-center gap-3">
            <div className="w-6 text-right text-[11px] text-muted tabular-nums">{r.rank}</div>
            <div className="min-w-0 flex-1">
              <div className="font-sans text-sm text-ink truncate">{r.rep}</div>
              <div className="font-sans text-[11px] text-muted">
                {r.region} · {fmtN(r.orders)} ord · {fmtN(r.newAccounts)} new
                {r.firstOrderGummy ? ` · ${fmtN(r.firstOrderGummy)} 1st-gummy` : ""}
              </div>
            </div>
            <div className="font-display text-base font-semibold text-ink tabular-nums">
              {fmt$(r.net)}
            </div>
          </div>
        ))}
        <div className="px-4 py-3 bg-paper2 flex items-center justify-between font-semibold">
          <span className="font-sans text-sm text-inksoft italic">Subtotal</span>
          <span className="font-display text-base text-brown tabular-nums">
            {fmt$(totals.net)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = "left", width, className = "" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <th
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
