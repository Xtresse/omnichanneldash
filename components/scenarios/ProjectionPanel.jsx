"use client";

// Live forecast cards rendered from the /api/scenario/snapshot payload.
// Three sections, top to bottom:
//   1. Top-line strip — total landing, channel landings, completed/remaining-days
//      pacing meter.
//   2. Channel-by-channel detail cards (actuals to date, daily rate, forward,
//      landing, growth assumption applied).
//   3. Product-family landing table.
//   4. Rep new-account forecast (top 10 by projected count).
//
// Everything renders straight from the JSON; no recharts here. Mobile-first
// like the rest of the dashboard.

const fmt$ = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const fmtNum = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

const HORIZON_LABELS = {
  eom: "End of month",
  eoq: "End of quarter",
  eoy: "End of year",
  custom: "Custom horizon",
};

const CHANNEL_STRIPE = {
  B2B: "before:bg-brown",
  ADCS: "before:bg-accent",
  DTC: "before:bg-tan",
};

export default function ProjectionPanel({ snapshot, loading, error }) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-300/60 bg-red-50/40 px-4 py-3 font-sans text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="space-y-3">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  const channels = snapshot.channels || {};
  const chKeys = ["B2B", "ADCS", "DTC"];
  const total = channels.total || { landing: 0, actualToDate: 0, forward: 0 };
  const pctElapsed =
    snapshot.completedDays + snapshot.remainingDays
      ? Math.round(
          (snapshot.completedDays /
            (snapshot.completedDays + snapshot.remainingDays)) *
            100
        )
      : 0;

  return (
    <div className="space-y-4">
      {loading && (
        <div className="rounded-md bg-paper2 border border-rule px-3 py-2 font-sans text-[11px] text-muted">
          Recalculating projection…
        </div>
      )}

      {/* Headline */}
      <div className="rounded-xl border border-rule bg-card p-3 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
              {HORIZON_LABELS[snapshot.horizon] || "Forecast"}
            </div>
            <div className="font-display text-3xl md:text-5xl font-semibold text-ink leading-tight mt-1 tabular-nums">
              {fmt$(total.landing)}
            </div>
            <div className="font-sans text-[12px] text-inksoft mt-1.5 leading-snug">
              Projected landing on{" "}
              <strong className="text-ink">{snapshot.endDate}</strong>.{" "}
              {fmt$(total.actualToDate)} actual to date, +{fmt$(total.forward)}{" "}
              projected forward.
            </div>
          </div>
          <div className="font-sans text-[11px] text-muted text-right">
            <div>
              Trailing: {snapshot.trailingWindow.from} →{" "}
              {snapshot.trailingWindow.to}
            </div>
            <div>
              {snapshot.completedDays} of{" "}
              {snapshot.completedDays + snapshot.remainingDays} days complete (
              {pctElapsed}%)
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full bg-paper2 rounded overflow-hidden">
          <div
            className="h-full bg-brown transition-all"
            style={{ width: `${Math.min(100, pctElapsed)}%` }}
          />
        </div>
      </div>

      {/* Channel cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {chKeys.map((ch) => {
          const d = channels[ch] || {};
          return (
            <div
              key={ch}
              className={`relative bg-card border border-rule rounded-xl px-3 py-3 sm:px-4 sm:py-3.5 md:px-5 md:py-4 overflow-hidden min-w-0
                before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${CHANNEL_STRIPE[ch]}`}
            >
              <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
                {ch} landing
              </div>
              <div className="font-display text-2xl md:text-3xl font-semibold text-ink leading-tight mt-1 tabular-nums">
                {fmt$(d.landing)}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-sans text-[11px] tabular-nums">
                <dt className="text-muted">Actual</dt>
                <dd className="text-inksoft text-right">{fmt$(d.actualToDate)}</dd>
                <dt className="text-muted">Forward</dt>
                <dd className="text-inksoft text-right">{fmt$(d.forward)}</dd>
                <dt className="text-muted">Daily rate</dt>
                <dd className="text-inksoft text-right">{fmt$(d.dailyRate)}/d</dd>
                <dt className="text-muted">Growth</dt>
                <dd
                  className={`text-right font-semibold ${
                    d.growthPct > 0
                      ? "text-favorable"
                      : d.growthPct < 0
                      ? "text-unfavorable"
                      : "text-inksoft"
                  }`}
                >
                  {d.growthPct > 0 ? "+" : ""}
                  {d.growthPct ?? 0}%
                </dd>
                {d.retentionPct != null && (
                  <>
                    <dt className="text-muted">Retention</dt>
                    <dd className="text-inksoft text-right">{d.retentionPct}%</dd>
                  </>
                )}
              </dl>
            </div>
          );
        })}
      </div>

      {/* Product family table */}
      <div className="rounded-xl border border-rule bg-card p-3 md:p-5">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="font-display text-base md:text-lg font-semibold text-ink leading-tight">
            By product family
          </h3>
          <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
            Channels combined
          </div>
        </div>
        <div className="overflow-x-auto -mx-3 md:-mx-0">
          <table className="w-full font-sans text-[12px] tabular-nums">
            <thead className="text-muted text-[10px] uppercase tracking-[0.14em]">
              <tr className="border-b border-rule">
                <th className="text-left py-1.5 pl-3 md:pl-0">Family</th>
                <th className="text-right py-1.5">Actual</th>
                <th className="text-right py-1.5">Daily rate</th>
                <th className="text-right py-1.5">Growth</th>
                <th className="text-right py-1.5">Forward</th>
                <th className="text-right py-1.5 pr-3 md:pr-0">Landing</th>
              </tr>
            </thead>
            <tbody className="text-inksoft">
              {(snapshot.families || []).map((f) => (
                <tr key={f.family} className="border-b border-rule/40">
                  <td className="py-1.5 pl-3 md:pl-0 text-ink font-semibold">
                    {f.family}
                  </td>
                  <td className="text-right py-1.5">{fmt$(f.actualToDate)}</td>
                  <td className="text-right py-1.5">{fmt$(f.dailyRate)}/d</td>
                  <td
                    className={`text-right py-1.5 font-semibold ${
                      f.growthPct > 0
                        ? "text-favorable"
                        : f.growthPct < 0
                        ? "text-unfavorable"
                        : ""
                    }`}
                  >
                    {f.growthPct > 0 ? "+" : ""}
                    {f.growthPct}%
                  </td>
                  <td className="text-right py-1.5">{fmt$(f.forward)}</td>
                  <td className="text-right py-1.5 pr-3 md:pr-0 text-ink font-semibold">
                    {fmt$(f.landing)}
                  </td>
                </tr>
              ))}
              {snapshot.familiesTotal && (
                <tr className="font-semibold text-ink">
                  <td className="py-1.5 pl-3 md:pl-0">Total</td>
                  <td className="text-right py-1.5">
                    {fmt$(snapshot.familiesTotal.actualToDate)}
                  </td>
                  <td className="text-right py-1.5">—</td>
                  <td className="text-right py-1.5">—</td>
                  <td className="text-right py-1.5">
                    {fmt$(snapshot.familiesTotal.forward)}
                  </td>
                  <td className="text-right py-1.5 pr-3 md:pr-0">
                    {fmt$(snapshot.familiesTotal.landing)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rep activity */}
      {snapshot.reps && (
        <div className="rounded-xl border border-rule bg-card p-3 md:p-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 className="font-display text-base md:text-lg font-semibold text-ink leading-tight">
              Rep new-account forecast
            </h3>
            <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted">
              {snapshot.reps.totalProjectedNewAccounts} accts total by{" "}
              {snapshot.endDate}
            </div>
          </div>
          <div className="overflow-x-auto -mx-3 md:-mx-0">
            <table className="w-full font-sans text-[12px] tabular-nums">
              <thead className="text-muted text-[10px] uppercase tracking-[0.14em]">
                <tr className="border-b border-rule">
                  <th className="text-left py-1.5 pl-3 md:pl-0">Rep</th>
                  <th className="text-right py-1.5">Trailing accts</th>
                  <th className="text-right py-1.5">Used rate</th>
                  <th className="text-right py-1.5 pr-3 md:pr-0">
                    Forecast accts
                  </th>
                </tr>
              </thead>
              <tbody className="text-inksoft">
                {(snapshot.reps.reps || [])
                  .filter((r) => r.trailingNewAccounts > 0 || r.usedRatePerDay > 0)
                  .slice(0, 12)
                  .map((r) => (
                    <tr key={r.rep} className="border-b border-rule/40">
                      <td className="py-1.5 pl-3 md:pl-0 text-ink truncate max-w-[160px]">
                        {r.rep}
                        {r.overrideApplied && (
                          <span
                            className="ml-1.5 text-[9px] uppercase text-brown bg-paper2 border border-tan rounded px-1 py-0.5"
                            title="Overridden in the assumptions panel"
                          >
                            Override
                          </span>
                        )}
                      </td>
                      <td className="text-right py-1.5">{fmtNum(r.trailingNewAccounts)}</td>
                      <td className="text-right py-1.5">
                        {r.usedRatePerDay.toFixed(2)}/d
                      </td>
                      <td className="text-right py-1.5 pr-3 md:pr-0 text-ink font-semibold">
                        {fmtNum(r.projectedNewAccounts)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Retention context */}
      {snapshot.retention && (
        <div className="rounded-xl border border-rule bg-card p-3 md:p-5">
          <h3 className="font-display text-base md:text-lg font-semibold text-ink leading-tight mb-1.5">
            Retention context
          </h3>
          <p className="font-sans text-[11px] text-muted leading-snug mb-2">
            {snapshot.retention.note}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <RetTile
              label="Latest bucket"
              b2b={snapshot.retention.latest?.B2B}
              dtc={snapshot.retention.latest?.DTC}
            />
            <RetTile
              label="Window average"
              b2b={snapshot.retention.windowAvg?.B2B}
              dtc={snapshot.retention.windowAvg?.DTC}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RetTile({ label, b2b, dtc }) {
  return (
    <div className="bg-paper2 border border-rule rounded-md px-3 py-2">
      <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-3 font-sans text-[13px] tabular-nums">
        <div>
          <span className="text-muted text-[10px] mr-1">B2B</span>
          <span className="text-ink font-semibold">
            {b2b == null ? "—" : `${b2b}%`}
          </span>
        </div>
        <div>
          <span className="text-muted text-[10px] mr-1">DTC</span>
          <span className="text-ink font-semibold">
            {dtc == null ? "—" : `${dtc}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="rounded-xl border border-rule bg-card p-4 md:p-5 animate-pulse">
      <div className="h-3 w-1/3 bg-paper2 rounded mb-3"></div>
      <div className="h-8 w-2/3 bg-paper2 rounded mb-2"></div>
      <div className="h-3 w-full bg-paper2 rounded"></div>
    </div>
  );
}
