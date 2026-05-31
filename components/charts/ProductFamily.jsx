"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartShell, COLORS, fmtCurrencyShort, fmtCurrencyFull } from "./_shared.js";

/**
 * Net sales by product family, B2B + DTC stacked per family.
 *
 * Optional `compare` enriches each bar with prior-period values which
 * surface in the tooltip (current $ + prior $ + delta %). We don't add
 * a third visible bar because four families × three bars wide gets noisy
 * fast. The compare strip in the reconciliation panel covers the
 * channel-level deltas — this is family-level context.
 */
export default function ProductFamily({ data, compare }) {
  const merged = mergePrior(data, compare);
  const showPrior = compare && compare.productFamily && compare.productFamily.length > 0;
  const priorLabel = compare && compare.mode === "yoy" ? "last year" : "prior period";

  return (
    <ChartShell>
      <BarChart data={merged} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#d8cab2" vertical={false} />
        <XAxis dataKey="family" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={50} tickFormatter={fmtCurrencyShort} />
        <Tooltip
          content={showPrior ? <FamilyTooltip priorLabel={priorLabel} /> : undefined}
          formatter={(v) => fmtCurrencyFull(v)}
        />
        <Legend wrapperStyle={{ paddingTop: 8 }} />
        <Bar dataKey="B2B" fill={COLORS.B2B} radius={[2, 2, 0, 0]} />
        <Bar dataKey="DTC" fill={COLORS.DTC} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}

function mergePrior(current, compare) {
  if (!current || current.length === 0) return current || [];
  if (!compare || !compare.productFamily || compare.productFamily.length === 0) {
    return current;
  }
  // Family lookup is name-based (Gummies, Serum, XVIE, Sachets) since the
  // bar chart's X-axis is categorical, not positional.
  const priorByFamily = {};
  for (const p of compare.productFamily) priorByFamily[p.family] = p;
  return current.map((bucket) => {
    const p = priorByFamily[bucket.family];
    return {
      ...bucket,
      priorB2B: p ? p.B2B || 0 : null,
      priorDTC: p ? p.DTC || 0 : null,
      priorTotal: p ? (p.B2B || 0) + (p.DTC || 0) + (p.ADCS || 0) : null,
    };
  });
}

function FamilyTooltip({ active, payload, label, priorLabel }) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  const curTotal = (datum.B2B || 0) + (datum.DTC || 0) + (datum.ADCS || 0);
  const prTotal = datum.priorTotal;
  const pct =
    prTotal && prTotal !== 0 ? ((curTotal - prTotal) / prTotal) * 100 : null;
  const arrow = prTotal == null ? "" : curTotal > prTotal ? "▲" : curTotal < prTotal ? "▼" : "·";
  const color =
    prTotal == null ? "#9A8F80" : curTotal >= prTotal ? "#C8860D" : "#AA2D2D";
  return (
    <div className="rounded-md border border-rule bg-card px-3 py-2 shadow-md font-sans text-xs leading-snug min-w-[180px]">
      <div className="font-semibold text-ink mb-1">{label}</div>
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="text-muted">B2B</span>
        <span className="text-ink">{fmtCurrencyFull(datum.B2B || 0)}</span>
      </div>
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="text-muted">DTC</span>
        <span className="text-ink">{fmtCurrencyFull(datum.DTC || 0)}</span>
      </div>
      <div className="flex justify-between gap-4 tabular-nums border-t border-rule/60 mt-1.5 pt-1.5">
        <span className="text-muted">Total</span>
        <span className="text-ink font-semibold">{fmtCurrencyFull(curTotal)}</span>
      </div>
      {prTotal != null && (
        <div
          className="flex justify-between gap-4 tabular-nums mt-1"
          style={{ color }}
        >
          <span>vs {priorLabel}</span>
          <span>
            {fmtCurrencyFull(prTotal)} {arrow}{" "}
            {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
          </span>
        </div>
      )}
    </div>
  );
}
