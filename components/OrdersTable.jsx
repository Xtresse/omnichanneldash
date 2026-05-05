"use client";

import { useMemo, useState } from "react";

const SHOPIFY_STORE_SLUG = "ace1d0-26"; // matches the connected Shopify store
const PAGE_SIZE = 50;

const fmtMoney = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/**
 * Audit-trail table of every order in the current period.
 * - Search across order id / email / discount codes
 * - Filter by channel
 * - Sort by date or net (asc/desc)
 * - Paginated (50 rows/page) so 'All time' stays usable
 * - Each row links to the Shopify Admin order page
 */
export default function OrdersTable({ orders }) {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("all"); // all | B2B | DTC | ADCS
  const [sortKey, setSortKey] = useState("date"); // date | net
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = orders || [];

    if (channelFilter !== "all") {
      list = list.filter((o) =>
        channelFilter === "ADCS" ? o.adcs : o.channel === channelFilter
      );
    }

    if (q) {
      list = list.filter((o) => {
        if (o.id && o.id.toLowerCase().includes(q)) return true;
        if (o.name && o.name.toLowerCase().includes(q)) return true;
        if (o.email && o.email.toLowerCase().includes(q)) return true;
        if (o.rep && o.rep.toLowerCase().includes(q)) return true;
        if (o.state && o.state.toLowerCase().includes(q)) return true;
        if (o.codes && o.codes.some((c) => c.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    const sorted = [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === "net") {
        av = a.net || 0;
        bv = b.net || 0;
      } else {
        av = a.date ? new Date(a.date).getTime() : 0;
        bv = b.date ? new Date(b.date).getTime() : 0;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [orders, query, channelFilter, sortKey, sortDir]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  function shopifyUrl(id) {
    return `https://admin.shopify.com/store/${SHOPIFY_STORE_SLUG}/orders/${id}`;
  }

  return (
    <div className="bg-card border border-rule rounded-xl p-3 md:p-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search id / email / rep / code"
          className="flex-1 min-w-[180px] bg-paper text-inksoft border border-rule rounded-md px-3 min-h-touch font-sans text-xs md:text-sm placeholder:text-muted/60"
        />
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { v: "all", l: "All" },
            { v: "B2B", l: "B2B" },
            { v: "DTC", l: "DTC" },
            { v: "ADCS", l: "ADCS" },
          ].map((opt) => {
            const active = channelFilter === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => {
                  setChannelFilter(opt.v);
                  setPage(0);
                }}
                className={`shrink-0 min-h-touch px-3 rounded-md font-sans text-xs md:text-sm border transition ${
                  active
                    ? "bg-brown text-paper border-brown"
                    : "bg-paper text-inksoft border-rule hover:bg-paper2 hover:border-tan"
                }`}
                aria-pressed={active}
              >
                {opt.l}
              </button>
            );
          })}
        </div>
        <span className="font-sans text-[11px] md:text-xs text-muted ml-auto whitespace-nowrap">
          {total.toLocaleString()} {total === 1 ? "order" : "orders"}
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs font-sans border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted border-b border-rule">
              <th className="py-2 pr-3">
                <SortHeader
                  active={sortKey === "date"}
                  dir={sortDir}
                  onClick={() => toggleSort("date")}
                >
                  Date
                </SortHeader>
              </th>
              <th className="py-2 pr-3">Order</th>
              <th className="py-2 pr-3">Channel</th>
              <th className="py-2 pr-3">Customer / Rep</th>
              <th className="py-2 pr-3">State</th>
              <th className="py-2 pr-3">Codes</th>
              <th className="py-2 pr-3 text-right">Gross</th>
              <th className="py-2 pr-3 text-right">Disc</th>
              <th className="py-2 pr-3 text-right">Ret</th>
              <th className="py-2 pr-0 text-right">
                <SortHeader
                  active={sortKey === "net"}
                  dir={sortDir}
                  onClick={() => toggleSort("net")}
                  align="right"
                >
                  Net
                </SortHeader>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => (
              <tr key={o.id} className="border-b border-rule/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-inksoft">
                  <div>{fmtDate(o.date)}</div>
                  <div className="text-[10px] text-muted">{fmtTime(o.date)}</div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <a
                    href={shopifyUrl(o.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brown underline-offset-2 hover:underline"
                    title={`Open ${o.name || o.id} in Shopify Admin`}
                  >
                    {o.name || `#${o.id.slice(-8)}`}
                  </a>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <ChannelBadge channel={o.channel} adcs={o.adcs} sub={o.sub} />
                </td>
                <td className="py-2 pr-3 max-w-[220px]">
                  <div className="truncate text-inksoft" title={o.rep || o.email || ""}>
                    {o.rep || o.email || "—"}
                  </div>
                </td>
                <td className="py-2 pr-3 text-inksoft whitespace-nowrap">
                  {o.state || "—"}
                </td>
                <td className="py-2 pr-3 max-w-[160px]">
                  <div className="truncate text-muted text-[11px]" title={(o.codes || []).join(", ")}>
                    {(o.codes && o.codes.length) ? o.codes.join(", ") : "—"}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right text-inksoft tabular-nums whitespace-nowrap">
                  {fmtMoney(o.gross)}
                </td>
                <td className="py-2 pr-3 text-right text-muted tabular-nums whitespace-nowrap">
                  {o.discounts ? `−${fmtMoney(o.discounts)}` : "—"}
                </td>
                <td className="py-2 pr-3 text-right text-muted tabular-nums whitespace-nowrap">
                  {o.returns ? fmtMoney(o.returns) : "—"}
                </td>
                <td className="py-2 pr-0 text-right text-ink font-semibold tabular-nums whitespace-nowrap">
                  {fmtMoney(o.net)}
                </td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  No orders match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {pageRows.map((o) => (
          <div key={o.id} className="border border-rule rounded-md p-3 bg-paper2/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-sans text-xs text-muted">{fmtDate(o.date)}</div>
                <a
                  href={shopifyUrl(o.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans text-sm text-brown underline-offset-2 hover:underline"
                >
                  {o.name || `#${o.id.slice(-8)}`}
                </a>
              </div>
              <div className="text-right">
                <div className="font-display text-lg font-semibold text-ink leading-none">
                  {fmtMoney(o.net)}
                </div>
                <ChannelBadge channel={o.channel} adcs={o.adcs} sub={o.sub} />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-sans">
              <div className="text-muted">{o.rep ? "Rep" : "Email"}</div>
              <div className="text-inksoft truncate">{o.rep || o.email || "—"}</div>
              <div className="text-muted">State</div>
              <div className="text-inksoft">{o.state || "—"}</div>
              {o.codes && o.codes.length > 0 && (
                <>
                  <div className="text-muted">Codes</div>
                  <div className="text-inksoft truncate">{o.codes.join(", ")}</div>
                </>
              )}
              <div className="text-muted">Gross</div>
              <div className="text-inksoft tabular-nums">{fmtMoney(o.gross)}</div>
              {o.discounts > 0 && (
                <>
                  <div className="text-muted">Discounts</div>
                  <div className="text-inksoft tabular-nums">−{fmtMoney(o.discounts)}</div>
                </>
              )}
              {o.returns !== 0 && (
                <>
                  <div className="text-muted">Returns</div>
                  <div className="text-inksoft tabular-nums">{fmtMoney(o.returns)}</div>
                </>
              )}
            </div>
          </div>
        ))}
        {!pageRows.length && (
          <div className="py-8 text-center text-muted text-sm">
            No orders match the current filter.
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-rule">
          <div className="font-sans text-[11px] text-muted">
            Page {safePage + 1} of {totalPages} · {total.toLocaleString()} total
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              className="min-h-touch px-2 md:px-3 rounded-md font-sans text-xs border border-rule text-inksoft disabled:opacity-40 disabled:cursor-not-allowed hover:bg-paper2"
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="min-h-touch px-2 md:px-3 rounded-md font-sans text-xs border border-rule text-inksoft disabled:opacity-40 disabled:cursor-not-allowed hover:bg-paper2"
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="min-h-touch px-2 md:px-3 rounded-md font-sans text-xs border border-rule text-inksoft disabled:opacity-40 disabled:cursor-not-allowed hover:bg-paper2"
              aria-label="Next page"
            >
              Next ›
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              className="min-h-touch px-2 md:px-3 rounded-md font-sans text-xs border border-rule text-inksoft disabled:opacity-40 disabled:cursor-not-allowed hover:bg-paper2"
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({ active, dir, onClick, align = "left", children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${
        align === "right" ? "justify-end w-full" : ""
      } font-sans text-[10px] uppercase tracking-[0.16em] ${
        active ? "text-brown" : "text-muted hover:text-inksoft"
      }`}
    >
      {children}
      <span aria-hidden="true" className="text-[9px]">
        {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

function ChannelBadge({ channel, adcs, sub }) {
  const base =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-sans text-[10px] font-medium";
  if (channel === "B2B") {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`${base} bg-brown text-paper`}>B2B</span>
        {adcs && (
          <span className={`${base} bg-accent text-paper`}>ADCS</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`${base} bg-dtc text-paper`}>DTC</span>
      {sub && <span className={`${base} bg-tan text-paper`}>Sub</span>}
    </span>
  );
}

