"use client";

import { useMemo } from "react";

/**
 * Six compact "executive scorecard" tiles surfacing metrics that used to
 * live only inside the reconciliation panel or as chart subtitles. The
 * primary KpiTiles row (B2B / ADCS / DTC) is the channel breakdown; this
 * strip is the at-a-glance health of the period overall.
 *
 *   Total net sales · Orders · Blended AOV · Discount rate · Returns rate · New gummy accts
 *
 * Each tile takes an optional `prior` value (pulled from data.compare)
 * and renders a colored delta — sage for favorable, maroon for
 * unfavorable, muted brown for neutral / missing. Tone awareness is
 * per-metric: returns and discount rates flag *down* as the good
 * direction; everything else flags up.
 */

const fmtCurrency = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
const fmtNum = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const fmtPctRound = (n) => `${(Math.round((n || 0) * 10) / 10).toFixed(1)}%`;

const FAVORABLE   = "rgb(var(--status-good))";
const UNFAVORABLE = "rgb(var(--status-bad))";
const NEUTRAL     = "rgb(var(--status-neutral))";

function deltaColor(cur, prior, higherIsBetter) {
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
  const v = x * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(v >= 10 || v <= -10 ? 0 : 1)}%`;
}

function DeltaArrow({ cur, prior }) {
  if (prior === undefined || prior === null || cur === prior) return null;
  const up = cur > prior;
  return (
    <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {up ? <path d="M6 2 L10 8 L2 8 Z" fill="currentColor" /> : <path d="M6 10 L10 4 L2 4 Z" fill="currentColor" />}
    </svg>
  );
}

export default function SecondaryKpis({ kpis, compare, reconciliation }) {
  const tiles = useMemo(() => {
    if (!kpis) return [];
    const cmp = compare?.kpis || null;
    const grossSafe = kpis.totalGrossSales || 0;

    const totalNet     = kpis.totalNetSales || 0;
    const totalOrders  = kpis.totalOrders   || 0;
    const blendedAOV   = totalOrders ? totalNet / totalOrders : 0;
    const discountRate = grossSafe ? (kpis.totalDiscounts || 0) / grossSafe : 0;
    const returnsRate  = grossSafe ? Math.abs(kpis.totalReturns || 0) / grossSafe : 0;

    // Compare-mode equivalents.
    const cmpGross   = cmp ? cmp.totalGrossSales || 0 : null;
    const cmpNet     = cmp ? cmp.totalNetSales   || 0 : null;
    const cmpOrders  = cmp ? cmp.totalOrders     || 0 : null;
    const cmpAOV     = cmp && cmpOrders ? cmpNet / cmpOrders : null;
    const cmpDiscRate = cmp && cmpGross ? (cmp.totalDiscounts || 0) / cmpGross : null;
    const cmpRetRate  = cmp && cmpGross ? Math.abs(cmp.totalReturns || 0) / cmpGross : null;

    const newGummy = reconciliation?.newAccounts?.firstOrderGummyTotal ?? null;

    return [
      {
        label: "Total net sales",
        value: fmtCurrency(totalNet),
        cur: totalNet, prior: cmpNet, fmt: fmtCurrency, higherIsBetter: true,
        sub: "All channels, period total",
      },
      {
        label: "Orders",
        value: fmtNum(totalOrders),
        cur: totalOrders, prior: cmpOrders, fmt: fmtNum, higherIsBetter: true,
        sub: "Test & cancelled excluded",
      },
      {
        label: "Blended AOV",
        value: fmtCurrency(blendedAOV),
        cur: blendedAOV, prior: cmpAOV, fmt: fmtCurrency, higherIsBetter: true,
        sub: "Net ÷ orders",
      },
      {
        label: "Discount rate",
        value: fmtPctRound(discountRate * 100),
        cur: discountRate, prior: cmpDiscRate, fmt: (n) => fmtPctRound((n || 0) * 100), higherIsBetter: false,
        sub: "Discounts ÷ gross",
      },
      {
        label: "Returns rate",
        value: fmtPctRound(returnsRate * 100),
        cur: returnsRate, prior: cmpRetRate, fmt: (n) => fmtPctRound((n || 0) * 100), higherIsBetter: false,
        sub: "|Returns| ÷ gross",
      },
      {
        label: "New gummy accts",
        value: newGummy == null ? "—" : fmtNum(newGummy),
        cur: newGummy ?? 0, prior: null, fmt: fmtNum, higherIsBetter: true,
        sub: "First-order tagged",
      },
    ];
  }, [kpis, compare, reconciliation]);

  if (!tiles.length) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 md:gap-3">
      {tiles.map((t) => (
        <MicroTile key={t.label} {...t} />
      ))}
    </div>
  );
}

function MicroTile({ label, value, sub, cur, prior, fmt, higherIsBetter }) {
  const showDelta = prior !== null && prior !== undefined;
  const color = showDelta ? deltaColor(cur, prior, higherIsBetter) : NEUTRAL;
  return (
    <div className="card-tile card-surface-hover px-3 py-2.5 md:px-3.5 md:py-3 min-w-0">
      <div className="eyebrow text-muted leading-tight truncate" title={label}>{label}</div>
      <div className="font-display text-xl md:text-[1.6rem] font-semibold text-ink leading-tight mt-1.5 tabular-nums truncate">
        {value}
      </div>
      <div className="font-sans text-[10px] text-muted mt-0.5 leading-snug truncate" title={sub}>
        {sub}
      </div>
      {showDelta ? (
        <div
          className="font-sans text-[10px] tabular-nums leading-tight mt-1 inline-flex items-center gap-1"
          style={{ color }}
          title={`Prior: ${fmt(prior)}`}
        >
          <DeltaArrow cur={cur} prior={prior} />
          <span>{deltaPctText(cur, prior)}</span>
          <span className="text-muted ml-0.5">vs prior</span>
        </div>
      ) : (
        <div className="font-sans text-[10px] text-muted/70 mt-1">—</div>
      )}
    </div>
  );
}
