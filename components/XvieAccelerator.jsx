"use client";

/**
 * XVIE Accelerator leaderboard (June 2026 comp promo).
 *
 * Ranks reps by progress toward the June accelerator: move >= 24 XVIE
 * VIALS in June 2026 — COMBINABLE across the two promo SKUs (2ML-006
 * case = 6 vials, 2ML-003 starter = 3 vials, any mix) — to earn +2pp on
 * the gummy (+sachets) commission rate. Data comes from
 * `data.xvieAccelerator` (lib/windsor.js buildXvieAccelerator) — pinned to
 * June 2026 from the all-time pull, so it doesn't move with the dashboard's
 * date window. Units are EXACT net of returns and XVIE50 promo orders are
 * excluded whole-order, matching the comp calc in
 * Sales-Rep-Dashboards (lib/compPlan.js + lib/repData.js).
 *
 * Qualification shown here is by VIALS ONLY — window Tier-4 W-2 reps don't
 * receive the bump even when they clear the vials (noted in the footer).
 */

const fmtSkuShort = (sku) => String(sku || "").replace(/^X-XVIE-/, "");

function ProgressBar({ pct, qualified }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 md:w-32 rounded-full bg-paper2 overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${qualified ? "bg-favorable" : "bg-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`tabular-nums text-[11px] ${qualified ? "text-favorable font-semibold" : "text-inksoft"}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function XvieAccelerator({ accelerator }) {
  if (!accelerator) return null;
  const {
    rows, qualifiedCount, sku006, sku003,
    vialsPer006 = 6, vialsPer003 = 3, vialsMin = 24,
  } = accelerator;

  return (
    <div className="bg-card border border-rule rounded-xl overflow-hidden">
      <div className="bg-browndeep text-paper px-4 py-2.5 md:px-5 md:py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-base md:text-lg font-semibold leading-tight">
          June 2026 Leaderboard
        </h3>
        <span className="font-sans text-[10px] md:text-xs uppercase tracking-[0.16em] opacity-80">
          {qualifiedCount} of {rows.length} reps qualified
        </span>
      </div>

      <div className="px-4 pt-3 md:px-5">
        <p className="font-sans text-[10px] md:text-[11px] leading-snug text-muted">
          Reach <span className="text-ink font-semibold">{vialsMin} XVIE vials</span> in June —{" "}
          <span className="text-ink font-semibold">{fmtSkuShort(sku006)} case = {vialsPer006} vials</span>,{" "}
          <span className="text-ink font-semibold">{fmtSkuShort(sku003)} starter = {vialsPer003} vials</span>,
          any mix, net of returns — to unlock{" "}
          <span className="text-ink font-semibold">+2pp on the gummy commission rate</span>.
          Orders with the XVIE50 promo code don&rsquo;t count.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-muted text-sm font-sans">
          No accelerator-SKU orders in June yet.
        </div>
      ) : (
        <div className="overflow-x-auto p-3 md:p-4">
          <table className="w-full text-xs font-sans border-collapse">
            <thead>
              <tr className="bg-paper2 text-left">
                <th className="px-2 py-1.5 font-semibold text-inksoft w-12">Rank</th>
                <th className="px-2 py-1.5 font-semibold text-inksoft">Rep</th>
                <th className="px-2 py-1.5 font-semibold text-inksoft w-16">Region</th>
                <th
                  className="px-2 py-1.5 font-semibold text-inksoft text-right"
                  title={`June net units of ${sku006} — each counts ${vialsPer006} vials`}
                >
                  {fmtSkuShort(sku006)}
                </th>
                <th
                  className="px-2 py-1.5 font-semibold text-inksoft text-right"
                  title={`June net units of ${sku003} — each counts ${vialsPer003} vials`}
                >
                  {fmtSkuShort(sku003)}
                </th>
                <th
                  className="px-2 py-1.5 font-semibold text-inksoft text-right"
                  title={`Combined vials — ${vialsMin} needed to qualify`}
                >
                  Vials
                </th>
                <th className="px-2 py-1.5 font-semibold text-inksoft">Progress</th>
                <th className="px-2 py-1.5 font-semibold text-inksoft text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rep} className="border-t border-rule/60">
                  <td className="px-2 py-1.5 tabular-nums text-inksoft">{r.rank}</td>
                  <td className="px-2 py-1.5 text-ink font-medium whitespace-nowrap">
                    {r.rep}
                    {r.territory === "1099" && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted">1099</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-inksoft">{r.region || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                    {r.units006}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink">
                    {r.units003}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.qualified ? "text-favorable font-semibold" : "text-ink"}`}>
                    {r.vials}
                    <span className="text-muted/70"> / {vialsMin}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <ProgressBar pct={r.progressPct} qualified={r.qualified} />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {r.qualified ? (
                      <span className="inline-block rounded-full bg-favorable/15 text-favorable font-semibold px-2 py-0.5 text-[10px] uppercase tracking-wide">
                        Qualified
                      </span>
                    ) : (
                      <span className="text-muted text-[11px]">{r.vialsToGo} vial{r.vialsToGo === 1 ? "" : "s"} to go</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 pb-3 md:px-5">
        <p className="font-sans text-[10px] leading-snug text-muted">
          Units are June-2026 only, exact net of returns, on rep-attributed B2B
          orders, excluding XVIE50 promo orders — same counting as the Sales
          Rep Dashboards commission calc. Reps with no accelerator-SKU units
          yet aren't listed. Note: W-2 reps whose window commission tier is
          Tier 4 don't receive the +2pp bump even when the vials qualify.
        </p>
      </div>
    </div>
  );
}
