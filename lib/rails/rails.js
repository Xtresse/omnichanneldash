// The data rails. Each entry is a self-contained, parameterized accessor
// over the omnichannel dataset, with a JSON Schema describing inputs.
//
// The same registry powers two consumers:
//   1. The /ask Claude loop turns each rail into a tool definition.
//   2. The dashboard / future internal callers can call rails directly
//      via runRail(name, args, ctx) for a uniform contract.
//
// Design principles (Datarails-style):
//   - Every result carries a `period` block so the caller knows exactly
//     what window the numbers cover. No silent defaults.
//   - Every $ is rounded to whole dollars at the rail boundary. The UI
//     layer never has to second-guess decimals.
//   - Variances are first-class: get_variance returns a structured
//     {actual, base, deltaAbs, deltaPct, direction} for every comparable
//     metric, so the chat layer can format consistently.
//   - The rail layer NEVER calls Anthropic. It only reads + reshapes
//     dashboard data. Keeps test surface small.

import { resolvePeriod, periodLengthDays } from "./period.js";
import { loadPeriod, loadCompare, loadBudget } from "./dataset.js";
import {
  buildScenarioSnapshot,
  resolveHorizon,
  windowStartFor,
} from "./scenario.js";

const round0 = (n) => Math.round(Number(n) || 0);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

const periodBlock = (period) => ({
  from: period.from,
  to: period.to,
  preset: period.preset,
  days: periodLengthDays(period),
});

// Standard envelope. Keep it tight so token usage stays low when Claude
// chains 3-4 rails per turn.
const envelope = (period, payload) => ({
  period: periodBlock(period),
  ...payload,
});

// ---------- Period schema (shared) ----------
const PERIOD_SCHEMA = {
  type: "object",
  description:
    "Time window. Use a preset OR explicit from/to. Presets: mtd, qtd, ytd, last_7d, last_30d, last_3m, last_6m, last_12m, last_year, last_2years.",
  properties: {
    preset: { type: "string", description: "Named preset, e.g. 'mtd'" },
    from: { type: "string", description: "ISO start date YYYY-MM-DD" },
    to: { type: "string", description: "ISO end date YYYY-MM-DD" },
  },
};

// ============================================================
// Rails
// ============================================================

const RAILS = {
  // ----------------------------------------------------------
  list_rails: {
    description:
      "List every available data rail with its description and parameters. Call this first if you're unsure what data you can access.",
    input_schema: { type: "object", properties: {} },
    async run() {
      return Object.entries(RAILS).map(([name, def]) => ({
        name,
        description: def.description,
        params: Object.keys(def.input_schema?.properties || {}),
      }));
    },
  },

  // ----------------------------------------------------------
  get_kpis: {
    description:
      "Headline KPIs for a period: total net sales, B2B/ADCS/DTC splits with $ + share %, AOV per channel, total orders, total discounts, total returns. Net sales = subtotal (post-discount, pre-shipping/tax) minus refunds.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      const k = data.kpis;
      return envelope(period, {
        totals: {
          netSales: round0(k.totalNetSales),
          grossSales: round0(k.totalGrossSales),
          discounts: round0(k.totalDiscounts),
          returns: round0(k.totalReturns),
          orders: k.totalOrders,
        },
        channels: {
          B2B: {
            netSales: round0(k.b2bNetSales),
            orders: k.b2bOrders,
            aov: round0(k.b2bAOV),
            sharePct: pct(k.b2bNetSales, k.totalNetSales),
          },
          ADCS: {
            netSales: round0(k.adcsNetSales),
            orders: k.adcsOrders,
            aov: round0(k.adcsAOV),
            sharePct: pct(k.adcsNetSales, k.totalNetSales),
          },
          DTC: {
            netSales: round0(k.dtcNetSales),
            orders: k.dtcOrders,
            aov: round0(k.dtcAOV),
            sharePct: pct(k.dtcNetSales, k.totalNetSales),
          },
        },
      });
    },
  },

  // ----------------------------------------------------------
  get_time_series: {
    description:
      "Bucketed time series of net sales, order count, and AOV per channel. Granularity defaults to 'auto' (day for ≤14d, week for ≤70d, month otherwise). Use this for trend questions.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        granularity: {
          type: "string",
          enum: ["auto", "day", "week", "biweek", "month"],
        },
      },
    },
    async run({ period: rawPeriod = {}, granularity = "auto" }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        granularity: data.granularity,
        series: data.monthlySeries.map((b) => ({
          bucket: b.month,
          label: b.label,
          B2B: b.B2B,
          ADCS: b.ADCS,
          DTC: b.DTC,
          total: b.Total,
          B2B_orders: b.B2B_orders,
          DTC_orders: b.DTC_orders,
          ADCS_orders: b.ADCS_orders,
          B2B_aov: b.B2B_AOV,
          DTC_aov: b.DTC_AOV,
        })),
      });
    },
  },

  // ----------------------------------------------------------
  get_product_family: {
    description:
      "Net sales by product family (Gummies / Serum / XVIE / Sachets) split by channel for the period.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        families: data.productFamily,
        b2bFocus: data.b2bFocusByFamily,
      });
    },
  },

  // ----------------------------------------------------------
  get_top_skus: {
    description:
      "Top SKUs by net sales for the period, split by channel. Default limit 10.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    async run({ period: rawPeriod = {}, limit = 10 }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        skus: data.topSKUs.slice(0, limit),
      });
    },
  },

  // ----------------------------------------------------------
  get_revenue_by_state: {
    description:
      "Top states by net sales for the period, with channel splits. Default top 15.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    async run({ period: rawPeriod = {}, limit = 15 }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        states: data.revenueByState.slice(0, limit),
      });
    },
  },

  // ----------------------------------------------------------
  get_discount_usage: {
    description:
      "Top discount codes by order count for the period, with channel-split net sales for each.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    async run({ period: rawPeriod = {}, limit = 12 }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        codes: data.discountUsage.slice(0, limit),
      });
    },
  },

  // ----------------------------------------------------------
  get_fulfillment_split: {
    description:
      "Order count by 3PL fulfillment location (Scale3PL CA vs ShipBob GA), split by channel.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, { locations: data.fulfillmentSplit });
    },
  },

  // ----------------------------------------------------------
  get_customer_dynamics: {
    description:
      "New vs returning customer ORDER counts per channel per bucket, plus repeat-purchase rate %, plus DTC subscription vs one-time net sales mix.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, {
        granularity: data.granularity,
        newVsReturning: data.customerDynamics,
        repeatRatePct: data.repeatRate,
        dtcSubVsOneTime: data.subVsOneTime,
      });
    },
  },

  // ----------------------------------------------------------
  get_rep_performance: {
    description:
      "Rep-by-rep B2B performance grouped by territory (Existing / New / 1099). Each rep row includes net sales, order count, new-account count, and per-product-family new vs existing customer units + dollars.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        territory: {
          type: "string",
          enum: ["Existing", "New", "1099"],
          description: "Optional filter to a single territory",
        },
        rep: { type: "string", description: "Optional rep name filter" },
      },
    },
    async run({ period: rawPeriod = {}, territory, rep }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      let sections = data.repPerformance;
      if (territory) sections = sections.filter((s) => s.territory === territory);
      if (rep) {
        const lc = rep.toLowerCase();
        sections = sections
          .map((s) => ({
            ...s,
            rows: s.rows.filter((r) => r.rep.toLowerCase().includes(lc)),
          }))
          .filter((s) => s.rows.length);
      }
      return envelope(period, { territories: sections });
    },
  },

  // ----------------------------------------------------------
  get_budget_vs_actual: {
    description:
      "Budget vs Actual net sales by product family for the period. Includes month-by-month budget figures from the Google Sheet, the actuals computed from Windsor, and variance ($ + %) per family + per month. Returns mode='stub' if the budget sheet env vars aren't wired.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const [data, budgetWrap] = await Promise.all([
        loadPeriod(ctx, period),
        loadBudget(ctx),
      ]);

      // Months in window (YYYY-MM).
      const months = new Set();
      const cur = new Date(period.from + "T00:00:00Z");
      const end = new Date(period.to + "T00:00:00Z");
      while (cur <= end) {
        months.add(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
        cur.setUTCMonth(cur.getUTCMonth() + 1);
      }
      const monthList = [...months].sort();

      // Actuals per family per YYYY-MM. monthlySeries is bucketed by the
      // selected granularity, so to get reliable monthly actuals we sum
      // productFamily for the WHOLE window and prorate evenly across
      // months in window. (Per-month actuals would need a re-bucketed
      // pull; the proration is good enough for a vs-budget headline.)
      const familyTotals = {};
      for (const f of data.productFamily) {
        familyTotals[f.family] = (f.B2B || 0) + (f.ADCS || 0) + (f.DTC || 0);
      }
      const families = ["Gummies", "Serum", "XVIE", "Sachets"];

      const families_out = families.map((fam) => {
        const actual = round0(familyTotals[fam] || 0);
        const budget = monthList.reduce(
          (sum, m) => sum + (budgetWrap.budget?.[fam]?.[m] || 0),
          0
        );
        const deltaAbs = actual - round0(budget);
        const deltaPct = budget ? Math.round((deltaAbs / budget) * 1000) / 10 : null;
        return {
          family: fam,
          actual,
          budget: round0(budget),
          deltaAbs,
          deltaPct,
          direction: deltaAbs > 0 ? "favorable" : deltaAbs < 0 ? "unfavorable" : "flat",
        };
      });

      const totals = families_out.reduce(
        (acc, r) => ({
          actual: acc.actual + r.actual,
          budget: acc.budget + r.budget,
        }),
        { actual: 0, budget: 0 }
      );
      const totalDelta = totals.actual - totals.budget;
      return envelope(period, {
        mode: budgetWrap.mode,
        monthsInWindow: monthList,
        families: families_out,
        totals: {
          actual: totals.actual,
          budget: totals.budget,
          deltaAbs: totalDelta,
          deltaPct: totals.budget ? Math.round((totalDelta / totals.budget) * 1000) / 10 : null,
        },
      });
    },
  },

  // ----------------------------------------------------------
  get_variance: {
    description:
      "Datarails-style variance analysis. Compares the period vs a baseline ('prior' = same length immediately before, 'yoy' = same window last year, 'budget' = monthly budget sum from the sheet). Returns a flat list of metrics with actual, base, deltaAbs, deltaPct, direction.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        vs: {
          type: "string",
          enum: ["prior", "yoy", "budget"],
          description: "Baseline to compare against",
        },
      },
      required: ["vs"],
    },
    async run({ period: rawPeriod = {}, vs }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const cur = await loadPeriod(ctx, period);

      let baseLabel;
      let baseKpis;
      let baseFamily = {};
      if (vs === "budget") {
        // Re-derive the budget actual+budget split.
        const out = await RAILS.get_budget_vs_actual.run({ period: rawPeriod }, ctx);
        baseLabel = `budget ${out.period.from}…${out.period.to}`;
        const metrics = [
          {
            metric: "net_sales_total",
            actual: out.totals.actual,
            base: out.totals.budget,
            deltaAbs: out.totals.deltaAbs,
            deltaPct: out.totals.deltaPct,
            direction: out.totals.deltaAbs > 0 ? "favorable" : out.totals.deltaAbs < 0 ? "unfavorable" : "flat",
          },
          ...out.families.map((f) => ({
            metric: `net_sales_${f.family.toLowerCase()}`,
            actual: f.actual,
            base: f.budget,
            deltaAbs: f.deltaAbs,
            deltaPct: f.deltaPct,
            direction: f.direction,
          })),
        ];
        return envelope(period, { vs, baseline: baseLabel, mode: out.mode, metrics });
      }
      const compare = await loadCompare(ctx, period, vs);
      baseKpis = compare.kpis;
      for (const f of compare.productFamily || []) {
        baseFamily[f.family] = (f.B2B || 0) + (f.ADCS || 0) + (f.DTC || 0);
      }
      baseLabel = `${vs} window ${compare.window.from}…${compare.window.to}`;
      const families = ["Gummies", "Serum", "XVIE", "Sachets"];
      const familyTotalsCur = {};
      for (const f of cur.productFamily) {
        familyTotalsCur[f.family] = (f.B2B || 0) + (f.ADCS || 0) + (f.DTC || 0);
      }
      const mk = (metric, actual, base) => {
        const deltaAbs = round0(actual) - round0(base);
        const deltaPct = base ? Math.round((deltaAbs / base) * 1000) / 10 : null;
        return {
          metric,
          actual: round0(actual),
          base: round0(base),
          deltaAbs,
          deltaPct,
          direction: deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat",
        };
      };
      const metrics = [
        mk("net_sales_total", cur.kpis.totalNetSales, baseKpis.totalNetSales),
        mk("net_sales_b2b", cur.kpis.b2bNetSales, baseKpis.b2bNetSales),
        mk("net_sales_adcs", cur.kpis.adcsNetSales, baseKpis.adcsNetSales),
        mk("net_sales_dtc", cur.kpis.dtcNetSales, baseKpis.dtcNetSales),
        mk("orders_total", cur.kpis.totalOrders, baseKpis.totalOrders),
        mk("aov_b2b", cur.kpis.b2bAOV, baseKpis.b2bAOV),
        mk("aov_dtc", cur.kpis.dtcAOV, baseKpis.dtcAOV),
        ...families.map((f) =>
          mk(`net_sales_${f.toLowerCase()}`, familyTotalsCur[f] || 0, baseFamily[f] || 0)
        ),
      ];
      return envelope(period, { vs, baseline: baseLabel, metrics });
    },
  },

  // ----------------------------------------------------------
  get_reconciliation: {
    description:
      "Internal reconciliation panel: cross-checks that the headline KPI total matches every chart's sum. Use this to debug 'why don't these two numbers match?' style questions. Includes DTC tag-vs-SKU definition split.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      return envelope(period, { reconciliation: data.reconciliation });
    },
  },

  // ----------------------------------------------------------
  get_orders: {
    description:
      "Order-level drilldown. Returns up to `limit` orders sorted by date desc. Filters: channel (B2B/ADCS/DTC), rep, state, minNet. Use for 'show me the orders behind this number' questions. Default limit 25, max 200.",
    input_schema: {
      type: "object",
      properties: {
        period: PERIOD_SCHEMA,
        channel: { type: "string", enum: ["B2B", "ADCS", "DTC"] },
        rep: { type: "string" },
        state: { type: "string", description: "2-letter state code or full name" },
        minNet: { type: "number", description: "Filter to orders with net >= this" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    async run({ period: rawPeriod = {}, channel, rep, state, minNet, limit = 25 }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      let rows = data.orders;
      if (channel) rows = rows.filter((o) => o.channel === channel);
      if (rep) {
        const lc = rep.toLowerCase();
        rows = rows.filter((o) => o.rep && o.rep.toLowerCase().includes(lc));
      }
      if (state) {
        const u = state.toUpperCase();
        rows = rows.filter((o) => (o.state || "").toUpperCase() === u);
      }
      if (typeof minNet === "number") rows = rows.filter((o) => o.net >= minNet);
      const total = rows.length;
      rows = rows.slice(0, Math.min(limit, 200));
      return envelope(period, {
        totalMatching: total,
        returned: rows.length,
        orders: rows,
      });
    },
  },

  // ----------------------------------------------------------
  // Scenario planning rails
  // ----------------------------------------------------------
  get_pacing: {
    description:
      "Daily pacing snapshot for the current month / quarter / year. Returns actuals through yesterday (today excluded as in-flight), the daily run rate per channel, the linear extrapolation to the end of the horizon, completed and remaining days, and the trailing window dates used. Default horizon: 'eom'. Use this when the user asks 'how are we pacing', 'where will we land', 'what's the run rate'.",
    input_schema: {
      type: "object",
      properties: {
        horizon: {
          type: "string",
          enum: ["eom", "eoq", "eoy"],
          description:
            "End of: month (default), quarter, or year. The trailing actuals window auto-anchors to the start of that horizon.",
        },
      },
    },
    async run({ horizon = "eom" }, ctx) {
      const now = new Date();
      const start = windowStartFor(horizon, now);
      // Trailing window = horizon start → yesterday. On the 1st of the
      // window we still send today; the math layer will treat zero
      // completed days as a zero rate and just hand back zeros, which
      // is the right answer (no data to extrapolate from yet).
      const yest = new Date(now.getTime() - 86400000);
      const fromDate = start;
      // Clamp the upper bound to "yesterday OR start" — if today is the
      // 1st, fromDate already equals start and we still want to pull one
      // day so the API doesn't choke on inverted ranges.
      const toDate = yest >= start ? yest : start;
      const ymd = (d) => d.toISOString().slice(0, 10);
      const period = { from: ymd(fromDate), to: ymd(toDate), preset: null };
      const data = await loadPeriod(ctx, period);
      const snap = buildScenarioSnapshot({
        dashboardData: data,
        windowDates: period,
        horizon,
        now,
      });
      return envelope(period, {
        horizon: snap.horizon,
        endDate: snap.endDate,
        todayDate: snap.todayDate,
        completedDays: snap.completedDays,
        remainingDays: snap.remainingDays,
        channels: snap.channels,
        familiesTotal: snap.familiesTotal,
        note:
          "Linear pacing. Today is excluded from the divisor (treated as in-flight). Apply assumptions via run_scenario.",
      });
    },
  },

  // ----------------------------------------------------------
  run_scenario: {
    description:
      "Full scenario projection with user-tunable assumptions. Choose a horizon (eom/eoq/eoy/custom) and optionally override growth%, retention%, or per-rep new-accounts-per-day. Returns: channel landings ($B2B/$ADCS/$DTC + total), product-family landings (Gummies/Serum/XVIE/Sachets), rep new-account forecast, and the retention context. Use this for 'if we hold X% growth, where do we land', 'what if Amy opens 0.5 accounts/day for the rest of the month', etc.",
    input_schema: {
      type: "object",
      properties: {
        horizon: {
          type: "string",
          enum: ["eom", "eoq", "eoy", "custom"],
          description: "Forecast horizon. Default eom.",
        },
        endDate: {
          type: "string",
          description: "YYYY-MM-DD — required when horizon=custom.",
        },
        growthPct: {
          type: "object",
          description:
            "Per-channel growth applied to the FORWARD piece (trailing run rate × remaining days). Example: { B2B: 5, DTC: -10 } = '+5% B2B, -10% DTC' relative to run rate.",
          properties: {
            B2B: { type: "number" },
            ADCS: { type: "number" },
            DTC: { type: "number" },
          },
        },
        familyGrowthPct: {
          type: "object",
          description:
            "Optional per-product-family growth%. Keys: Gummies / Serum / XVIE / Sachets. Falls back to a channel-weighted blend if omitted.",
        },
        retentionPct: {
          type: "object",
          description:
            "Per-channel retention% override. Reported alongside landings for context; doesn't currently re-bucket the projection.",
        },
        repNewAccountsPerDay: {
          type: "object",
          description:
            "Per-rep override of expected new accounts/day. Keys are exact rep names from the roster.",
        },
        trailingDays: {
          type: "integer",
          minimum: 7,
          maximum: 180,
          description:
            "How many trailing days of actuals to anchor the run rate to. Default: from horizon start (MTD for eom, QTD for eoq, YTD for eoy).",
        },
      },
    },
    async run(
      {
        horizon = "eom",
        endDate,
        growthPct,
        familyGrowthPct,
        retentionPct,
        repNewAccountsPerDay,
        trailingDays,
      },
      ctx
    ) {
      const now = new Date();
      const ymd = (d) => d.toISOString().slice(0, 10);
      let fromDate, toDate;
      if (trailingDays) {
        const yest = new Date(now.getTime() - 86400000);
        const start = new Date(yest.getTime() - (trailingDays - 1) * 86400000);
        fromDate = start;
        toDate = yest;
      } else {
        const start = windowStartFor(horizon === "custom" ? "eom" : horizon, now);
        const yest = new Date(now.getTime() - 86400000);
        fromDate = start;
        toDate = yest >= start ? yest : start;
      }
      const period = { from: ymd(fromDate), to: ymd(toDate), preset: null };
      const data = await loadPeriod(ctx, period);
      const snap = buildScenarioSnapshot({
        dashboardData: data,
        windowDates: period,
        assumptions: {
          growthPct,
          familyGrowthPct,
          retentionPct,
          repNewAccountsPerDay,
        },
        horizon: horizon === "custom" && endDate ? "custom" : horizon,
        now,
      });
      // Re-resolve the horizon if custom so endDate is honored.
      const horizonResolved =
        horizon === "custom"
          ? resolveHorizon({ horizon: "custom", endDate, now })
          : resolveHorizon({ horizon, now });
      // Patch the snapshot's horizon block in case caller asked for custom.
      snap.horizon = horizonResolved.horizon;
      snap.endDate = horizonResolved.endDate;
      snap.remainingDays = horizonResolved.remainingDays;
      return envelope(period, snap);
    },
  },

  // ----------------------------------------------------------
  get_retention_metrics: {
    description:
      "Retention / repeat-purchase rate detail for a period. Returns per-bucket repeat-rate% for B2B and DTC, the window average, the new-vs-returning order counts that drive the rate, and DTC subscription-vs-one-time net-sales mix. Use this for 'what's our retention', 'is DTC retention slipping', 'sub vs one-time mix'.",
    input_schema: {
      type: "object",
      properties: { period: PERIOD_SCHEMA },
    },
    async run({ period: rawPeriod = {} }, ctx) {
      const period = resolvePeriod(rawPeriod);
      const data = await loadPeriod(ctx, period);
      const rep = data.repeatRate || [];
      const dyn = data.customerDynamics || [];
      const sub = data.subVsOneTime || [];
      const avg = (k) =>
        rep.length
          ? Math.round(rep.reduce((s, r) => s + (Number(r[k]) || 0), 0) / rep.length * 10) / 10
          : null;
      const latest = rep[rep.length - 1] || null;
      return envelope(period, {
        granularity: data.granularity,
        latest,
        windowAverage: { B2B: avg("B2B"), DTC: avg("DTC") },
        repeatRate: rep,
        newVsReturning: dyn,
        subscriptionVsOneTime: sub,
        note: "Repeat-rate% = returning-customer order count ÷ (new+returning) order count for the bucket. New = first-ever buyer for that channel.",
      });
    },
  },

  // ----------------------------------------------------------
  get_rep_activity: {
    description:
      "Daily-average new-account activity per rep over a trailing window. For each rep, returns trailing new-account count, daily rate, and a forecast for the chosen horizon (defaults to end of month, can be eom/eoq/eoy/custom). Used to project rep-driven B2B growth and to seed sliders in the scenario UI.",
    input_schema: {
      type: "object",
      properties: {
        trailingDays: {
          type: "integer",
          minimum: 7,
          maximum: 180,
          description: "Lookback for the daily-rate calculation. Default 30.",
        },
        horizon: {
          type: "string",
          enum: ["eom", "eoq", "eoy", "custom"],
        },
        endDate: { type: "string" },
      },
    },
    async run(
      { trailingDays = 30, horizon = "eom", endDate },
      ctx
    ) {
      const now = new Date();
      const ymd = (d) => d.toISOString().slice(0, 10);
      const yest = new Date(now.getTime() - 86400000);
      const start = new Date(yest.getTime() - (trailingDays - 1) * 86400000);
      const period = { from: ymd(start), to: ymd(yest), preset: null };
      const data = await loadPeriod(ctx, period);
      const snap = buildScenarioSnapshot({
        dashboardData: data,
        trailingData: {
          repNewAccountsMonthly: data.repNewAccountsMonthly,
          trailingDays,
        },
        windowDates: period,
        horizon: horizon === "custom" && endDate ? "custom" : horizon,
        now,
      });
      // For custom horizon, re-resolve to honor endDate.
      const horizonResolved =
        horizon === "custom"
          ? resolveHorizon({ horizon: "custom", endDate, now })
          : resolveHorizon({ horizon, now });
      return envelope(period, {
        trailingDays,
        horizon: horizonResolved.horizon,
        endDate: horizonResolved.endDate,
        remainingDays: horizonResolved.remainingDays,
        reps: snap.reps.reps,
        totalProjectedNewAccounts: snap.reps.totalProjectedNewAccounts,
        note:
          "New-account = first-order tagged B2B order containing a gummy line (matches the dashboard's New-gummy-accounts-by-rep chart).",
      });
    },
  },
};

// ============================================================
// Public API
// ============================================================

export const RAIL_NAMES = Object.keys(RAILS);

export function getRail(name) {
  return RAILS[name] || null;
}

export function railManifest() {
  return Object.entries(RAILS).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: def.input_schema,
  }));
}

/** Run a rail by name. ctx is the per-request memo token. */
export async function runRail(name, args, ctx) {
  const def = RAILS[name];
  if (!def) throw new Error(`Unknown rail: ${name}`);
  return def.run(args || {}, ctx);
}
