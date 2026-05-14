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

// Product families to break out in the leaderboard. Order matches the
// leadership dashboard's column order so tie-out is visual.
const FAMILIES = [
  { key: "Gummies", label: "Gummies" },
  { key: "Serum", label: "Serum" },
  { key: "XVIE", label: "XVIE" },
  { key: "Sachets", label: "Sachets" },
];

function rankColor(rank) {
  if (rank === 1) return "#8C6A1F"; // brass
  if (rank === 2) return "#7A7A7A"; // silver
  if (rank === 3) return "#9C5A2F"; // bronze
  return null;
}

/**
 * Collapse a repPerformance row's productMix into:
 *   - per-family newDollars / existingDollars / totals (for the
 *     leaderboard table's product columns)
 *   - rolled-up firstTime / returning / total / weighted (for ranking)
 *
 * Tie-out: the per-family totals here match the omnichannel Sales-by-rep
 * table's hover tooltips ("New: N units · $X / Existing: ...") and the
 * leadership dashboard's product columns. Leadership shows the New/Returning
 * split for Gummies only; this component shows the split for all four
 * families so the weighted-sales math is fully transparent.
 */
function aggregateRep(r) {
  const mix = r.productMix || {};
  let firstTime = 0;
  let returning = 0;
  const families = {};
  for (const f of FAMILIES) {
    const slot = mix[f.key] || {};
    const fNew = slot.newDollars || 0;
    const fRet = slot.existingDollars || 0;
    firstTime += fNew;
    returning += fRet;
    families[f.key] = {
      firstTime: Math.round(fNew),
      returning: Math.round(fRet),
      total: Math.round(fNew + fRet),
      newUnits: slot.newUnits || 0,
      existingUnits: slot.existingUnits || 0,
    };
  }
  const total = firstTime + returning;
  const weighted =
    firstTime * FIRST_TIME_WEIGHT + returning * RETURNING_WEIGHT;
  return {
    rep: r.rep,
    region: r.region,
    territory: r.territory,
    families,
    firstTime: Math.round(firstTime),
    returning: Math.round(returning),
    total: Math.round(total),
    weighted: Math.round(weighted),
  };
}

/**
 * Flatten repPerformance (grouped by territory) into one ranked list.
 *
 * President's Club eligibility:
 *   - W-2 reps only — territory must be 'Existing' or 'New'.
 *     1099 contractor reps (Lexi Cavaliere, Jim & Anne Weeks,
 *     Sevi McCutcheon, Krista Taylor, Ryan Masa) are excluded.
 *   - Active sales reps only — managers and former reps who no longer
 *     carry a quota are excluded by name (PC_EXCLUDED_REPS below).
 *     Their historical orders still attribute to them in the rep
 *     table for accounting, but they don't show in the leaderboard.
 *   - B2B sales only — guaranteed upstream because rep attribution in
 *     classifyOrderChannel() only fires when the order's channel resolves
 *     to "B2B" (ADCS orders are flagged "__EXCLUDE__" and never reach
 *     repAgg; DTC orders force rep=null).
 *
 * Reps with zero weighted sales drop to the bottom but are still shown
 * so the user can see who's on the W-2 roster but hasn't qualified yet.
 */
const ELIGIBLE_TERRITORIES = new Set(["Existing", "New"]);

// Reps in REPS for historical-attribution purposes but NOT eligible for
// President's Club (managers, former reps without a quota, etc.).
const PC_EXCLUDED_REPS = new Set([
  "Julie Fetter",   // now a manager
  "Becky Curry",    // now a manager
]);

function flattenAndRank(repPerformance) {
  if (!repPerformance) return [];
  const flat = [];
  for (const sec of repPerformance) {
    const territory = sec.territory;
    if (!ELIGIBLE_TERRITORIES.has(territory)) continue;
    for (const r of sec.rows || []) {
      if (PC_EXCLUDED_REPS.has(r.rep)) continue;
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
          <span className="font-semibold text-ink">Weighted Sales</span>{" "}
          = First-Time × 60% + Returning × 40%, summed across all four product
          families.{" "}
          <span className="font-semibold text-ink">B2B only</span> — DTC and
          ADCS orders are excluded upstream by the channel classifier.{" "}
          <span className="font-semibold text-ink">Active W-2 reps only</span> —
          1099 contractors and managers (Julie Fetter, Becky Curry) are
          excluded. Their historical orders still attribute to them in
          the rep table for accounting; they just don't appear in the
          leaderboard. Rank is by weighted sales in the selected window;
          ties broken alphabetically.
        </p>
        <p className="font-sans text-[10px] md:text-[11px] leading-snug text-muted mt-1.5">
          Product columns show{" "}
          <span className="text-brown font-semibold">first-time $</span> on top,{" "}
          <span className="text-inksoft">returning $</span> below. First-time
          definition matches the Sales-by-rep table above: Gummies = order
          tagged <code className="bg-paper2 px-1 rounded">first order</code>;
          Serum / XVIE / Sachets = customer's first-ever purchase of that
          family falls inside the window. Numbers tie to{" "}
          xtresse-leadershipdash for the same date window — first-time-Gummies
          and returning-Gummies match column-for-column; Serum / XVIE / Sachets
          there show the total (first-time + returning combined).
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
                <Th width="64" align="left">
                  Region
                </Th>
                {FAMILIES.map((f) => (
                  <Th
                    key={f.key}
                    align="right"
                    title={`${f.label} — first-time (top, brown) / returning (bottom). Hover for units.`}
                  >
                    {f.label}
                  </Th>
                ))}
                <Th
                  align="right"
                  className="border-l border-rule"
                  title="Sum of first-time dollars across all four product families"
                >
                  First-Time
                </Th>
                <Th
                  align="right"
                  title="Sum of returning dollars across all four product families"
                >
                  Returning
                </Th>
                <Th align="right">Total</Th>
                <Th
                  align="right"
                  className="border-l border-rule bg-paper"
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
                    {FAMILIES.map((f) => {
                      const fam = r.families?.[f.key];
                      return (
                        <Td key={f.key} align="right">
                          <ProductDollarCell fam={fam} />
                        </Td>
                      );
                    })}
                    <Td
                      align="right"
                      className="text-brown font-semibold border-l border-rule"
                    >
                      {fmt$(r.firstTime)}
                    </Td>
                    <Td align="right" className="text-inksoft">
                      {fmt$(r.returning)}
                    </Td>
                    <Td align="right">{fmt$(r.total)}</Td>
                    <Td
                      align="right"
                      className="font-semibold border-l border-rule bg-paper"
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
                  reads cleanly. Column count:
                    base 11 = Rank + Rep + Region + 4 families + FT + Ret + Total + Weighted
                    + 2 when prior is on (Δ + vs Prior) = 13. */}
              {unqualified.length > 0 && (
                <tr className="border-t-2 border-rule">
                  <Td
                    colSpan={priorByRep ? 13 : 11}
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
                  {FAMILIES.map((f) => (
                    <Td key={f.key} align="right">
                      —
                    </Td>
                  ))}
                  <Td align="right" className="border-l border-rule">
                    $0
                  </Td>
                  <Td align="right">$0</Td>
                  <Td align="right">$0</Td>
                  <Td align="right" className="border-l border-rule bg-paper">
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
                {FAMILIES.map((f) => {
                  const famTotal = ranked.reduce(
                    (acc, r) => ({
                      first: acc.first + (r.families?.[f.key]?.firstTime || 0),
                      ret: acc.ret + (r.families?.[f.key]?.returning || 0),
                    }),
                    { first: 0, ret: 0 }
                  );
                  return (
                    <Td key={f.key} align="right">
                      <ProductDollarCell
                        fam={{
                          firstTime: famTotal.first,
                          returning: famTotal.ret,
                        }}
                      />
                    </Td>
                  );
                })}
                <Td align="right" className="text-brown border-l border-rule">
                  {fmt$(totals.firstTime)}
                </Td>
                <Td align="right" className="text-inksoft">
                  {fmt$(totals.returning)}
                </Td>
                <Td align="right">{fmt$(totals.total)}</Td>
                <Td
                  align="right"
                  className="text-brown border-l border-rule bg-paper"
                >
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
                {/* Rep totals row */}
                <div className="grid grid-cols-2 gap-1.5 mt-2 pl-12">
                  <ProductChip label="First-Time" value={r.firstTime} accent />
                  <ProductChip label="Returning" value={r.returning} />
                </div>
                {/* Per-product breakdown */}
                <div className="grid grid-cols-2 gap-1.5 mt-1.5 pl-12">
                  {FAMILIES.map((f) => {
                    const fam = r.families?.[f.key];
                    return (
                      <ProductMobileCell
                        key={f.key}
                        label={f.label}
                        fam={fam}
                      />
                    );
                  })}
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

/**
 * Per-family dollar cell — stacked first-time over returning so both
 * numbers stay legible without doubling the table width. First-time in
 * brand brown (the metric we weight at 60%), returning in muted
 * inksoft. Tooltip surfaces unit counts to tie out against the
 * Sales-by-rep table directly above this section.
 */
function ProductDollarCell({ fam }) {
  const first = fam?.firstTime || 0;
  const ret = fam?.returning || 0;
  if (!first && !ret) return <span className="text-muted">—</span>;
  const tooltip = [
    `New: ${fam?.newUnits || 0} units · ${fmt$(first)}`,
    `Existing: ${fam?.existingUnits || 0} units · ${fmt$(ret)}`,
  ].join("\n");
  return (
    <div
      title={tooltip}
      className="flex flex-col items-end tabular-nums leading-tight"
    >
      <span className={first > 0 ? "text-brown font-semibold" : "text-muted/60"}>
        {first ? fmt$(first) : "—"}
      </span>
      <span className={ret > 0 ? "text-inksoft text-[10px]" : "text-muted/60 text-[10px]"}>
        {ret ? fmt$(ret) : "—"}
      </span>
    </div>
  );
}

/**
 * Mobile per-product cell — shows the family label plus stacked
 * first-time / returning dollars. Matches the desktop ProductDollarCell
 * styling so the same color cues (brown first-time, muted returning)
 * carry across breakpoints.
 */
function ProductMobileCell({ label, fam }) {
  const first = fam?.firstTime || 0;
  const ret = fam?.returning || 0;
  const tooltip = [
    `New: ${fam?.newUnits || 0} units · ${fmt$(first)}`,
    `Existing: ${fam?.existingUnits || 0} units · ${fmt$(ret)}`,
  ].join("\n");
  const hasData = first > 0 || ret > 0;
  return (
    <div
      title={tooltip}
      className={`flex items-center justify-between gap-2 px-2 py-1 rounded border font-sans text-[11px] ${
        hasData ? "bg-paper2 border-tan" : "bg-paper border-rule"
      }`}
    >
      <span className={hasData ? "text-inksoft font-semibold" : "text-muted"}>
        {label}
      </span>
      <span className="tabular-nums text-right leading-tight">
        <span className={first > 0 ? "text-brown font-semibold" : "text-muted/60"}>
          {first ? fmt$(first) : "—"}
        </span>
        <span className="text-muted/60 mx-1">·</span>
        <span className={ret > 0 ? "text-inksoft" : "text-muted/60"}>
          {ret ? fmt$(ret) : "—"}
        </span>
      </span>
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
