"use client";

/**
 * President's Club — rep leaderboard ranked by weighted sales.
 *
 * Mirrors the logic of the "P Club Rankings" tab in
 * Sales Reporting Master Data v10.xlsx:
 *   - Per rep, split sales into First-Time vs Returning (across all
 *     product families: Gummies, Serum, XVIE, Sachets)
 *   - Weighted Sales = First-Time × 60% + Returning × 40%
 *   - Rank = position in descending sort of weightedSales across all reps
 *
 * "First-Time" = newDollars in productMix (gummies = first-order tag;
 * other families = customer's first-ever purchase of that family inside
 * the loaded window — same convention RepPerformance uses).
 * "Returning" = existingDollars in productMix.
 *
 * Source of all per-rep numbers is the same `data.repPerformance`
 * array the Sales-by-rep section consumes — we just re-aggregate
 * across territories into one ranked list.
 *
 * If compare mode is on, each rep also shows their prior-period
 * weighted sales and a rank delta (▲/▼ vs prior).
 */

const fmt$ = (n) => {
  if (!n || n === 0) return "$0";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString();
};

// Brand-aligned compare colors (mirrors RepPerformance.jsx).
const FAVORABLE = "#5C8A6F";
const UNFAVORABLE = "#5C2F2E";
const NEUTRAL = "#9A8F80";

const FIRST_TIME_WEIGHT = 0.6;
const RETURNING_WEIGHT = 0.4;

function rankColor(rank) {
  if (rank === 1) return "#8C6A1F"; // brass
  if (rank === 2) return "#7A7A7A"; // silver
  if (rank === 3) return "#9C5A2F"; // bronze
  return null;
}

/**
 * Collapse a repPerformance row's productMix (per-family newDollars /
 * existingDollars) into single first-time / returning totals for the
 * "All Products" view that mirrors the Excel "All Products" rollup.
 */
function aggregateRep(r) {
  const mix = r.productMix || {};
  let firstTime = 0;
  let returning = 0;
  for (const key of Object.keys(mix)) {
    firstTime += mix[key]?.newDollars || 0;
    returning += mix[key]?.existingDollars || 0;
  }
  const total = firstTime + returning;
  const weighted =
    firstTime * FIRST_TIME_WEIGHT + returning * RETURNING_WEIGHT;
  return {
    rep: r.rep,
    region: r.region,
    territory: r.territory,
    firstTime: Math.round(firstTime),
    returning: Math.round(returning),
    total: Math.round(total),
    weighted: Math.round(weighted),
  };
}

/**
 * Flatten repPerformance (grouped by territory) into one ranked list.
 * Reps with zero weighted sales drop to the bottom but are still shown
 * so the user can see who's on the roster but hasn't qualified yet.
 */
function flattenAndRank(repPerformance) {
  if (!repPerformance) return [];
  const flat = [];
  for (const sec of repPerformance) {
    const territory = sec.territory;
    for (const r of sec.rows || []) {
      flat.push(aggregateRep({ ...r, territory }));
    }
  }
  flat.sort(
    (a, b) => b.weighted - a.weighted || (a.rep || "").localeCompare(b.rep || "")
  );
  flat.forEach((r, i) => {
    r.rank = r.weighted > 0 ? i + 1 : null;
  });
  return flat;
}

function buildPriorIndex(compare) {
  if (!compare || !Array.isArray(compare.reps)) return null;
  // Compare snapshot rows have `productMix` in the same shape, so we
  // run them through the same aggregator. We then re-rank within the
  // prior set so each rep gets a prior-period rank for delta display.
  const priorAgg = compare.reps.map((r) =>
    aggregateRep({
      rep: r.rep,
      region: r.region,
      productMix: r.productMix,
    })
  );
  priorAgg.sort(
    (a, b) => b.weighted - a.weighted || (a.rep || "").localeCompare(b.rep || "")
  );
  priorAgg.forEach((r, i) => {
    r.rank = r.weighted > 0 ? i + 1 : null;
  });
  return Object.fromEntries(priorAgg.map((r) => [r.rep, r]));
}

function rankDeltaLabel(curRank, priorRank) {
  if (!curRank || !priorRank) return null;
  if (curRank === priorRank) return { text: "—", color: NEUTRAL };
  const diff = priorRank - curRank;
  // Positive diff = improved (lower rank number is better).
  if (diff > 0) return { text: `▲ ${diff}`, color: FAVORABLE };
  return { text: `▼ ${Math.abs(diff)}`, color: UNFAVORABLE };
}

function pctDeltaLabel(cur, prior) {
  if (prior === undefined || prior === null) return { text: "—", color: NEUTRAL };
  if (!prior) {
    return cur > 0
      ? { text: "new", color: FAVORABLE }
      : { text: "—", color: NEUTRAL };
  }
  const x = (cur - prior) / prior;
  if (!isFinite(x)) return { text: "—", color: NEUTRAL };
  const color = x >= 0 ? FAVORABLE : UNFAVORABLE;
  const sign = x >= 0 ? "+" : "";
  return { text: `${sign}${(x * 100).toFixed(0)}%`, color };
}

export default function PresidentsClub({ repPerformance, compare }) {
  const ranked = flattenAndRank(repPerformance);
  const priorByRep = buildPriorIndex(compare);

  if (!ranked.length) {
    return (
      <div className="bg-card border border-rule rounded-xl p-6 text-center text-muted text-sm font-sans">
        No rep performance data in this window yet.
      </div>
    );
  }

  // Subtotals row so reps can see the team aggregate.
  const totals = ranked.reduce(
    (acc, r) => {
      acc.firstTime += r.firstTime;
      acc.returning += r.returning;
      acc.total += r.total;
      acc.weighted += r.weighted;
      return acc;
    },
    { firstTime: 0, returning: 0, total: 0, weighted: 0 }
  );

  // Anyone with weighted sales > 0 qualifies as "in the running" — we
  // separate them from $0 reps with a subtle visual break in the table.
  const qualified = ranked.filter((r) => r.weighted > 0);
  const unqualified = ranked.filter((r) => !r.weighted);

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="bg-card border border-rule rounded-xl px-3 py-2.5 md:px-4 md:py-3">
        <p className="font-sans text-[11px] md:text-xs leading-snug text-inksoft">
          <span className="font-semibold text-ink">Weighted Sales formula</span>{" "}
          — First-Time × 60% + Returning × 40%, summed across all four product
          families (Gummies, Serum, XVIE, Sachets). Rank is by weighted sales in
          the selected window; ties broken by alphabetical rep name.
        </p>
      </div>

      <div className="bg-card border border-rule rounded-xl overflow-hidden">
        <div className="bg-browndeep text-paper px-4 py-2.5 md:px-5 md:py-3 flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
            Leaderboard
          </h3>
          <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
            {qualified.length} qualified · {fmt$(totals.weighted)} team weighted
          </span>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs font-sans border-collapse">
            <thead>
              <tr className="bg-paper2 text-left">
                <Th width="56" align="center">
                  Rank
                </Th>
                {priorByRep && (
                  <Th
                    width="64"
                    align="center"
                    title="Change in rank vs the prior period"
                  >
                    Δ
                  </Th>
                )}
                <Th align="left">Rep</Th>
                <Th width="80" align="left">
                  Region
                </Th>
                <Th align="right" title="Sales to first-time customers in window">
                  First-Time
                </Th>
                <Th align="right" title="Sales to returning customers in window">
                  Returning
                </Th>
                <Th align="right">Total</Th>
                <Th
                  align="right"
                  className="border-l border-rule"
                  title="First-Time × 60% + Returning × 40%"
                >
                  Weighted
                </Th>
                {priorByRep && (
                  <Th align="right" width="80">
                    vs Prior
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {qualified.map((r) => {
                const prior = priorByRep ? priorByRep[r.rep] : null;
                const rankDelta = priorByRep
                  ? rankDeltaLabel(r.rank, prior?.rank)
                  : null;
                const weightDelta = priorByRep
                  ? pctDeltaLabel(r.weighted, prior?.weighted)
                  : null;
                const rankClr = rankColor(r.rank);
                return (
                  <tr key={r.rep} className="border-t border-rule/60">
                    <Td align="center" className="font-semibold tabular-nums">
                      <span
                        style={rankClr ? { color: rankClr } : undefined}
                        className={rankClr ? "font-display text-base" : "text-inksoft"}
                      >
                        {r.rank}
                      </span>
                    </Td>
                    {priorByRep && (
                      <Td align="center">
                        {rankDelta ? (
                          <span
                            className="font-sans text-[11px] tabular-nums"
                            style={{ color: rankDelta.color }}
                            title={
                              prior
                                ? `Prior rank: ${prior.rank ?? "—"}`
                                : "No prior-period data"
                            }
                          >
                            {rankDelta.text}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    )}
                    <Td className="font-medium text-ink">{r.rep}</Td>
                    <Td className="text-muted text-[11px]">{r.region}</Td>
                    <Td align="right" className="text-brown">
                      {fmt$(r.firstTime)}
                    </Td>
                    <Td align="right" className="text-inksoft">
                      {fmt$(r.returning)}
                    </Td>
                    <Td align="right">{fmt$(r.total)}</Td>
                    <Td
                      align="right"
                      className="font-semibold border-l border-rule"
                    >
                      {fmt$(r.weighted)}
                    </Td>
                    {priorByRep && (
                      <Td align="right">
                        {weightDelta && (
                          <span
                            className="font-sans text-[11px] tabular-nums"
                            style={{ color: weightDelta.color }}
                            title={
                              prior
                                ? `Prior weighted: ${fmt$(prior.weighted)}`
                                : "No prior-period data"
                            }
                          >
                            {weightDelta.text}
                          </span>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}

              {/* Reps on the roster with no qualifying sales — kept
                  visible but visually quieted so the qualified list
                  reads cleanly. */}
              {unqualified.length > 0 && (
                <tr className="border-t-2 border-rule">
                  <Td
                    colSpan={priorByRep ? 9 : 7}
                    className="bg-paper text-muted italic text-[11px] py-1"
                  >
                    Roster — no qualifying weighted sales in this window
                  </Td>
                </tr>
              )}
              {unqualified.map((r) => (
                <tr key={r.rep} className="border-t border-rule/40 text-muted">
                  <Td align="center" className="tabular-nums">
                    —
                  </Td>
                  {priorByRep && <Td align="center">—</Td>}
                  <Td>{r.rep}</Td>
                  <Td className="text-[11px]">{r.region}</Td>
                  <Td align="right">$0</Td>
                  <Td align="right">$0</Td>
                  <Td align="right">$0</Td>
                  <Td align="right" className="border-l border-rule">
                    $0
                  </Td>
                  {priorByRep && <Td align="right">—</Td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-paper2 font-semibold">
                <Td
                  colSpan={priorByRep ? 4 : 3}
                  className="italic text-inksoft"
                >
                  Team total ({ranked.length} reps)
                </Td>
                <Td align="right" className="text-brown">
                  {fmt$(totals.firstTime)}
                </Td>
                <Td align="right" className="text-inksoft">
                  {fmt$(totals.returning)}
                </Td>
                <Td align="right">{fmt$(totals.total)}</Td>
                <Td align="right" className="text-brown border-l border-rule">
                  {fmt$(totals.weighted)}
                </Td>
                {priorByRep && <Td align="right">—</Td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-rule/60">
          {qualified.map((r) => {
            const prior = priorByRep ? priorByRep[r.rep] : null;
            const rankDelta = priorByRep
              ? rankDeltaLabel(r.rank, prior?.rank)
              : null;
            const weightDelta = priorByRep
              ? pctDeltaLabel(r.weighted, prior?.weighted)
              : null;
            const rankClr = rankColor(r.rank);
            return (
              <div key={r.rep} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 text-center tabular-nums"
                    style={rankClr ? { color: rankClr } : undefined}
                  >
                    <div
                      className={
                        rankClr
                          ? "font-display text-2xl font-semibold leading-none"
                          : "font-display text-xl text-inksoft font-semibold leading-none"
                      }
                    >
                      {r.rank}
                    </div>
                    {rankDelta && (
                      <div
                        className="text-[10px] tabular-nums mt-0.5"
                        style={{ color: rankDelta.color }}
                      >
                        {rankDelta.text}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-sans text-sm text-ink truncate">
                      {r.rep}
                    </div>
                    <div className="font-sans text-[11px] text-muted">
                      {r.region} · {fmt$(r.total)} total
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-base font-semibold text-ink tabular-nums">
                      {fmt$(r.weighted)}
                    </div>
                    {weightDelta && (
                      <div
                        className="text-[10px] tabular-nums"
                        style={{ color: weightDelta.color }}
                      >
                        {weightDelta.text}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-2 pl-12">
                  <ProductChip label="First-Time" value={r.firstTime} accent />
                  <ProductChip label="Returning" value={r.returning} />
                </div>
              </div>
            );
          })}
          {unqualified.length > 0 && (
            <div className="px-4 py-2 text-muted italic text-[11px] bg-paper">
              Roster — no qualifying weighted sales
            </div>
          )}
          {unqualified.map((r) => (
            <div
              key={r.rep}
              className="px-4 py-2 flex items-center gap-3 text-muted"
            >
              <div className="w-10 text-center tabular-nums">—</div>
              <div className="min-w-0 flex-1 text-[12px]">
                {r.rep}
                <span className="text-[10px] ml-2">{r.region}</span>
              </div>
              <div className="font-sans text-[12px] tabular-nums">$0</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductChip({ label, value, accent }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1 rounded border font-sans text-[11px] ${
        value > 0 ? "bg-paper2 border-tan" : "bg-paper border-rule"
      }`}
    >
      <span className={value > 0 ? "text-inksoft font-semibold" : "text-muted"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          accent && value > 0 ? "text-brown font-semibold" : "text-inksoft"
        }`}
      >
        {fmt$(value)}
      </span>
    </div>
  );
}

function Th({
  children,
  align = "left",
  width,
  className = "",
  title,
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      title={title}
      style={width ? { width: `${width}px` } : undefined}
      className={`py-2 px-3 font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left", className = "", colSpan }) {
  const alignClass =
    align === "right"
      ? "text-right tabular-nums"
      : align === "center"
      ? "text-center"
      : "text-left";
  return (
    <td
      colSpan={colSpan}
      className={`py-2 px-3 text-inksoft whitespace-nowrap ${alignClass} ${className}`}
    >
      {children}
    </td>
  );
}
