#!/usr/bin/env node
// Daily digest agent — fetches the omnichannel dashboard's /api/dashboard
// endpoint and posts a Slack summary. Designed for GitHub Actions cron
// (see .github/workflows/daily-digest.yml) but also runs locally:
//
//   node scripts/daily-digest.mjs --dry-run
//   node scripts/daily-digest.mjs --date 2026-05-15
//   node scripts/daily-digest.mjs
//
// Env vars:
//   DASHBOARD_URL       — base URL, e.g. https://omnichanneldash.vercel.app
//   SLACK_WEBHOOK_URL   — required unless --dry-run
//
// The dashboard's own /api/dashboard route handles all the Windsor.ai
// aggregation, so this script only needs HTTP — no Windsor key, no
// imports from lib/, no package.json changes.

const DASHBOARD_URL =
  process.env.DASHBOARD_URL || "https://omnichanneldash.vercel.app";

// ---------- CLI ----------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dateArg = (() => {
  const i = args.indexOf("--date");
  if (i === -1) return null;
  const v = args[i + 1];
  return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
})();

// ---------- Date helpers (US/Eastern) ----------
const ET_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const todayET = () => ET_FMT.format(new Date());

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const firstOfMonth = (isoDate) => `${isoDate.slice(0, 7)}-01`;

function prettyDate(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function prettyRange(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00Z`);
  const b = new Date(`${toIso}T12:00:00Z`);
  const sameMonth =
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCFullYear() === b.getUTCFullYear();
  const aStr = a.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (sameMonth) return `${aStr}–${b.getUTCDate()}`;
  const bStr = b.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${aStr}–${bStr}`;
}

// ---------- Formatting ----------
const fmtUsd = (n) => {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(0)}K`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toLocaleString("en-US")}`;
};

const fmtUsdExact = (n) =>
  `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

const fmtPct = (n, digits = 0) => {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
};

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

function delta(current, prior) {
  if (prior == null || !isFinite(prior) || prior === 0) {
    return current > 0
      ? { txt: "new", arrow: "▲" }
      : { txt: "—", arrow: "" };
  }
  const pct = (current - prior) / Math.abs(prior);
  const arrow = pct >= 0 ? "▲" : "▼";
  const sign = pct >= 0 ? "+" : "";
  return { txt: `${sign}${(pct * 100).toFixed(0)}%`, arrow };
}

// ---------- API ----------
async function fetchDashboard({ from, to, compare = "off" }) {
  const url = new URL("/api/dashboard", DASHBOARD_URL);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("granularity", "day");
  if (compare !== "off") url.searchParams.set("compare", compare);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `dashboard fetch failed: ${res.status} ${res.statusText} (${url})`
    );
  }
  const json = await res.json();
  if (!json.ok) throw new Error(`dashboard returned error: ${json.error}`);
  return json;
}

// ---------- Builders ----------
function topReps(repPerformance, n = 5) {
  const flat = [];
  for (const sec of repPerformance || []) {
    for (const r of sec.rows || []) {
      flat.push({
        rep: r.rep,
        territory: sec.territory,
        net: r.net || 0,
        orders: r.orders || 0,
      });
    }
  }
  flat.sort((a, b) => b.net - a.net);
  return flat.slice(0, n);
}

function buildMessage({ referenceDate, dayPrior, dayYoy, mtd, mtdFrom, mtdTo, priorMtdRange }) {
  // dayPrior, dayYoy, mtd are full /api/dashboard responses — `kpis` and
  // `repPerformance` live at the top level, `compare.kpis` carries the
  // comparison window's KPIs.
  const dayK = dayPrior.kpis;
  const priorK = dayPrior.compare?.kpis || {};
  const yoyK = dayYoy.compare?.kpis || {};
  const mtdK = mtd.kpis;
  const mtdPriorK = mtd.compare?.kpis || {};

  const dDayPrior = delta(dayK.totalNetSales, priorK.totalNetSales);
  const dDayYoy = delta(dayK.totalNetSales, yoyK.totalNetSales);
  const dMtdPrior = delta(mtdK.totalNetSales, mtdPriorK.totalNetSales);

  const reps = topReps(mtd.repPerformance, 5);
  const refundsYesterday = Math.abs(dayK.totalReturns || 0);
  const untaggedDollars = mtdK.b2bUntaggedNetSales || 0;
  const untaggedOrders = mtdK.b2bUntaggedOrders || 0;

  const lines = [];
  lines.push(
    `:chart_with_upwards_trend: *Xtressé daily digest — ${prettyDate(referenceDate)}*`
  );

  lines.push("");
  lines.push(`*Yesterday (${prettyDate(referenceDate)})*`);
  lines.push(
    `> Net sales: *${fmtUsdExact(dayK.totalNetSales)}*  ` +
      `· vs prior day ${dDayPrior.arrow} ${dDayPrior.txt}` +
      `  · YoY ${dDayYoy.arrow} ${dDayYoy.txt}`
  );
  lines.push(
    `> Orders: *${fmtInt(dayK.totalOrders)}*  ` +
      `(B2B ${fmtInt(dayK.b2bOrders)} · DTC ${fmtInt(dayK.dtcOrders)} · ADCS ${fmtInt(dayK.adcsOrders)})`
  );
  const blendedAOV = dayK.totalOrders
    ? dayK.totalNetSales / dayK.totalOrders
    : 0;
  lines.push(`> Blended AOV: ${fmtUsdExact(blendedAOV)}`);

  lines.push("");
  lines.push(`*Month to date (${prettyRange(mtdFrom, mtdTo)})*`);
  lines.push(
    `> Net sales: *${fmtUsd(mtdK.totalNetSales)}*  ` +
      `· vs ${prettyRange(priorMtdRange.from, priorMtdRange.to)} ${dMtdPrior.arrow} ${dMtdPrior.txt}`
  );
  lines.push(
    `> B2B: ${fmtUsd(mtdK.b2bNetSales)} (${fmtPct(mtdK.b2bShare)}) · ${fmtInt(mtdK.b2bOrders)} orders`
  );
  lines.push(
    `> DTC: ${fmtUsd(mtdK.dtcNetSales)} (${fmtPct(mtdK.dtcShare)}) · ${fmtInt(mtdK.dtcOrders)} orders`
  );
  if (mtdK.adcsNetSales > 0 || mtdK.adcsOrders > 0) {
    lines.push(
      `> ADCS: ${fmtUsd(mtdK.adcsNetSales)} (${fmtPct(mtdK.adcsShare)}) · ${fmtInt(mtdK.adcsOrders)} orders`
    );
  }

  if (reps.length > 0) {
    lines.push("");
    lines.push("*Top reps this month*");
    reps.forEach((r, i) => {
      lines.push(
        `${i + 1}. ${r.rep} — ${fmtUsd(r.net)} (${fmtInt(r.orders)} order${r.orders === 1 ? "" : "s"})`
      );
    });
  }

  const watch = [];
  if (untaggedDollars > 0 || untaggedOrders > 0) {
    watch.push(
      `:warning: ${fmtInt(untaggedOrders)} B2B order${untaggedOrders === 1 ? "" : "s"} (${fmtUsd(untaggedDollars)}) missing rep tag this month`
    );
  }
  if (refundsYesterday > 0) {
    watch.push(
      `:money_with_wings: ${fmtUsdExact(refundsYesterday)} in refunds yesterday`
    );
  }
  if (watch.length > 0) {
    lines.push("");
    lines.push("*Watch*");
    for (const w of watch) lines.push(w);
  }

  lines.push("");
  lines.push(`<${DASHBOARD_URL}|Open dashboard →>`);

  return lines.join("\n");
}

// ---------- Slack ----------
async function postToSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL not set");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mrkdwn: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
}

// ---------- Compare-window math (mirrors lib/windsor.js) ----------
function priorWindow(from, to) {
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  const dayMs = 86400000;
  const priorTo = new Date(fromD.getTime() - dayMs);
  const priorFrom = new Date(
    priorTo.getTime() - (toD.getTime() - fromD.getTime())
  );
  return {
    from: priorFrom.toISOString().slice(0, 10),
    to: priorTo.toISOString().slice(0, 10),
  };
}

// ---------- Main ----------
async function main() {
  const referenceDate = dateArg || shiftDays(todayET(), -1);
  console.error(`Building digest for ${referenceDate} (ET) via ${DASHBOARD_URL}`);

  const dayFrom = referenceDate;
  const dayTo = referenceDate;
  const mtdFrom = firstOfMonth(referenceDate);
  const mtdTo = referenceDate;
  const priorMtdRange = priorWindow(mtdFrom, mtdTo);

  const [dayPrior, dayYoy, mtd] = await Promise.all([
    fetchDashboard({ from: dayFrom, to: dayTo, compare: "prior" }),
    fetchDashboard({ from: dayFrom, to: dayTo, compare: "yoy" }),
    fetchDashboard({ from: mtdFrom, to: mtdTo, compare: "prior" }),
  ]);

  const text = buildMessage({
    referenceDate,
    dayPrior,
    dayYoy,
    mtd,
    mtdFrom,
    mtdTo,
    priorMtdRange,
  });

  if (dryRun) {
    console.log(text);
    return;
  }
  await postToSlack(text);
  console.error(`Posted digest for ${referenceDate} to Slack`);
}

main().catch((err) => {
  console.error(`daily-digest failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
