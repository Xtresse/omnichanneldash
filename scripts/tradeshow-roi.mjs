#!/usr/bin/env node
// scripts/tradeshow-roi.mjs
//
// Regenerate data/tradeshow-roi.json from LIVE Shopify. This is the "Trade Show
// ROI" tab's source of truth (components/TradeShowRoi.jsx imports the JSON), so
// re-run it periodically the way scripts/materialize-history.mjs is re-run when
// a quarter closes — booth ROI keeps rising as recent shows mature.
//
//   node --env-file=.env.local scripts/tradeshow-roi.mjs            # write data/tradeshow-roi.json
//   node --env-file=.env.local scripts/tradeshow-roi.mjs --dry-run  # print, don't write
//
// Env: the same Shopify creds lib/xtresseCore.js uses — a static
//   SHOPIFY_ADMIN_API_TOKEN (or XVIE_INTERNAL_TOKEN), else a
//   SHOPIFY_CLIENT_ID/SECRET (or XVIE_INTERNAL_CLIENT_ID/SECRET) client-
//   credentials exchange. Optional SHOPIFY_STORE_DOMAIN (defaults to the store).
//   (adminGraphQL isn't exported from xtresseCore, so the client is replicated
//   here — token priority kept byte-identical to the core.)
//
// ── METHODOLOGY (reproduces the committed data/tradeshow-roi.json) ───────────
//   Inputs: data/tradeshow-leads.json (badge scans) + data/tradeshow-shows.json
//   (booth config: code, cost, start, leadShow).
//
//   1. CODE ORDERS — for every show with a booth `code`, pull
//      orders(query:"discount_code:<CODE>"). Every customer on such an order is
//      a conversion for that show (viaCode=true). We keep each order's
//      currentSubtotalPriceSet + the customer's numberOfOrders / amountSpent /
//      createdAt / tags.
//   2. LEAD CUSTOMERS — batch the scanned-lead emails through
//      customers(query:"email:a OR email:b ...") to read amountSpent / createdAt
//      / tags. A lead converts if it's a NEW B2B customer: tags include "b2b"
//      (case-insensitive), amountSpent > 0, and customer.createdAt >= the show's
//      start (viaCode=false).
//   3. ATTRIBUTION — each clinic is credited to ONE show. A code user → that
//      show (earliest order's show if it used several codes). Else a converting
//      lead → the earliest scanned show whose start <= the customer's createdAt.
//   4. REVENUE (post-show B2B) — a NEW clinic (createdAt >= show.start) counts
//      its lifetime amountSpent. An EXISTING customer who merely used the code
//      (createdAt < show.start) counts ONLY their post-show order subtotals
//      (orders with createdAt >= show.start), never lifetime. (e.g.
//      admin@ag-dermatology used DOCS4Hair1026 but has been a customer since
//      2025 → only the $1,518 post-show order counts, not the $13,972 lifetime.)
//   5. AGGREGATE per show — converts = distinct clinics, revenue = sum,
//      roi = revenue / cost, convPct = converts / leadCount. Status:
//      strong ≥2×, ok ≥1×, weak <1×; maturing if the show ran within ~7 weeks
//      of today AND has converts; none if 0 converts and past; upcoming if the
//      start is in the future; unmapped if the show has no code and no start.
//   Output is sorted by ROI desc (nulls last) — the same shape already on disk.
//
//   NOTE: leadCount = unique, syntactically-valid, de-duplicated scanned emails
//   per show. The committed file's counts can differ by 1-2 from a raw re-run
//   because a few junk/removed leads were pruned by hand originally; that only
//   nudges convPct, never converts / revenue / roi (those come from Shopify).
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DATA = path.join(REPO, "data");
const OUT = path.join(DATA, "tradeshow-roi.json");
const DRY = process.argv.includes("--dry-run");

const leads = JSON.parse(fs.readFileSync(path.join(DATA, "tradeshow-leads.json"), "utf8"));
const shows = JSON.parse(fs.readFileSync(path.join(DATA, "tradeshow-shows.json"), "utf8"));

// ── Shopify Admin client (replicated from lib/xtresseCore.js — same token
//    priority, since adminGraphQL is not exported) ────────────────────────────
const SHOP = process.env.SHOPIFY_STORE_DOMAIN || process.env.WINDSOR_ACCOUNT || "ace1d0-26.myshopify.com";
const API_VERSION = "2025-01";
let TOKEN = null;

async function getToken() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (process.env.XVIE_INTERNAL_TOKEN) return process.env.XVIE_INTERNAL_TOKEN;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.XVIE_INTERNAL_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.XVIE_INTERNAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("No Shopify creds — set SHOPIFY_ADMIN_API_TOKEN or SHOPIFY_CLIENT_ID/SECRET in .env.local");
  }
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("Shopify token exchange returned no access_token");
  return json.access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  TOKEN = TOKEN || (await getToken());
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; } // throttled — back off
    if (res.status === 401) { TOKEN = null; throw new Error("Shopify 401 — token rejected"); }
    if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const json = await res.json();
    if (json.errors) throw new Error("Shopify GraphQL errors: " + JSON.stringify(json.errors).slice(0, 300));
    await sleep(250); // gentle pacing under the cost bucket
    return json.data;
  }
  throw new Error("Shopify GraphQL: throttled after retries");
}

const ORDERS_BY_CODE = `
query OrdersByCode($q: String!, $cursor: String) {
  orders(first: 100, query: $q, after: $cursor, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      currentSubtotalPriceSet { shopMoney { amount } }
      tags
      customer { email numberOfOrders amountSpent { amount } createdAt tags }
    }
  }
}`;

const CUSTOMERS_BY_EMAIL = `
query CustomersByEmail($q: String!, $cursor: String) {
  customers(first: 100, query: $q, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { email numberOfOrders amountSpent { amount } createdAt tags }
  }
}`;

async function paginate(query, baseVars, pick) {
  const out = [];
  let cursor = null;
  do {
    const data = await gql(query, { ...baseVars, cursor });
    const conn = pick(data);
    out.push(...(conn.nodes || []));
    cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const lc = (s) => String(s || "").toLowerCase().trim();
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");
const domainOf = (email) => lc(email).split("@")[1] || "";
const isB2B = (tags) => (tags || []).some((t) => /b2b/i.test(t));
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const todayMs = Date.now();
const WEEKS7 = 49 * 86400000; // "within ~7 weeks" maturing window

const showsByKey = Object.fromEntries(shows.map((s) => [s.key, s]));
// leadShow value → show config (the badge-scan shows)
const showByLeadShow = Object.fromEntries(shows.filter((s) => s.leadShow).map((s) => [s.leadShow, s]));

// lead lookup by email → { company, rep } (first row wins)
const leadByEmail = {};
for (const l of leads) {
  const e = lc(l.email);
  if (e && !leadByEmail[e]) leadByEmail[e] = l;
}
function companyRep(email) {
  const l = leadByEmail[lc(email)];
  if (l) return { company: l.company || domainOf(email), rep: l.rep || "" };
  return { company: domainOf(email), rep: "" };
}

// unique valid scanned emails per leadShow, and the list of scanned shows per email
const leadEmailsByShow = {}; // leadShow -> Set(email)
const showsScannedByEmail = {}; // email -> Set(showKey)
for (const l of leads) {
  const e = lc(l.email);
  if (!EMAIL_RE.test(e)) continue;
  (leadEmailsByShow[l.show] = leadEmailsByShow[l.show] || new Set()).add(e);
  const sc = showByLeadShow[l.show];
  if (sc) (showsScannedByEmail[e] = showsScannedByEmail[e] || new Set()).add(sc.key);
}

async function main() {
  console.log(`Shop: ${SHOP} · API ${API_VERSION}`);

  // 1. CODE ORDERS ------------------------------------------------------------
  const codeCust = {}; // email -> { amountSpent, createdAt, tags, orders:[{createdAt,subtotal,showKey}] }
  const codeShowByEmail = {}; // email -> [{showKey, createdAt}]  (for earliest-code attribution)
  for (const s of shows) {
    if (!s.code) continue;
    console.log(`  orders discount_code:${s.code} …`);
    const nodes = await paginate(ORDERS_BY_CODE, { q: `discount_code:${s.code}` }, (d) => d.orders);
    for (const o of nodes) {
      const email = lc(o.customer?.email);
      if (!email) continue;
      const created = day(o.createdAt);
      const subtotal = Number(o.currentSubtotalPriceSet?.shopMoney?.amount || 0);
      const rec = (codeCust[email] = codeCust[email] || {
        amountSpent: Number(o.customer?.amountSpent?.amount || 0),
        createdAt: day(o.customer?.createdAt),
        tags: o.customer?.tags || [],
        orders: [],
      });
      rec.orders.push({ createdAt: created, subtotal, showKey: s.key });
      (codeShowByEmail[email] = codeShowByEmail[email] || []).push({ showKey: s.key, createdAt: created });
    }
  }

  // 2. LEAD CUSTOMERS ---------------------------------------------------------
  const leadEmails = [...new Set(leads.map((l) => lc(l.email)).filter((e) => EMAIL_RE.test(e)))];
  const leadCust = {}; // email -> { amountSpent, createdAt, tags }
  const BATCH = 40; // Shopify caps the search string length — keep batches modest
  for (let i = 0; i < leadEmails.length; i += BATCH) {
    const chunk = leadEmails.slice(i, i + BATCH);
    const q = chunk.map((e) => `email:${e}`).join(" OR ");
    console.log(`  customers batch ${i / BATCH + 1} (${chunk.length}) …`);
    const nodes = await paginate(CUSTOMERS_BY_EMAIL, { q }, (d) => d.customers);
    for (const c of nodes) {
      const email = lc(c.email);
      if (!email) continue;
      leadCust[email] = {
        amountSpent: Number(c.amountSpent?.amount || 0),
        createdAt: day(c.createdAt),
        tags: c.tags || [],
      };
    }
  }

  // 3. ATTRIBUTION — each clinic → exactly one show --------------------------
  const attributed = {}; // email -> { showKey, viaCode }
  // 3a. code users → earliest code order's show
  for (const [email, list] of Object.entries(codeShowByEmail)) {
    const earliest = list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    attributed[email] = { showKey: earliest.showKey, viaCode: true };
  }
  // 3b. converting leads (not already code-attributed) → earliest scanned show
  //     whose start <= the customer's createdAt
  for (const email of leadEmails) {
    if (attributed[email]) continue;
    const c = leadCust[email];
    if (!c) continue;
    if (!(isB2B(c.tags) && c.amountSpent > 0)) continue; // must be a paying B2B customer
    const cands = [...(showsScannedByEmail[email] || [])]
      .map((k) => showsByKey[k])
      .filter((sc) => sc.start && sc.start <= c.createdAt) // new customer relative to that show
      .sort((a, b) => a.start.localeCompare(b.start));
    if (!cands.length) continue;
    attributed[email] = { showKey: cands[0].key, viaCode: false };
  }

  // 4. REVENUE per clinic -----------------------------------------------------
  const clinicsByShow = {}; // showKey -> [{email, company, rev, rep, viaCode}]
  for (const [email, att] of Object.entries(attributed)) {
    const show = showsByKey[att.showKey];
    if (!show) continue;
    const c = codeCust[email] || leadCust[email];
    const created = (codeCust[email]?.createdAt) || (leadCust[email]?.createdAt) || "";
    let rev;
    if (created && show.start && created < show.start) {
      // existing customer who used the code → post-show code-order subtotals only
      rev = (codeCust[email]?.orders || [])
        .filter((o) => o.createdAt >= show.start)
        .reduce((a, o) => a + o.subtotal, 0);
    } else {
      // new clinic → lifetime amountSpent
      rev = Number(c?.amountSpent || 0);
    }
    const { company, rep } = companyRep(email);
    (clinicsByShow[show.key] = clinicsByShow[show.key] || []).push({ email, company, rev: round2(rev), rep, viaCode: att.viaCode });
  }

  // 5. AGGREGATE per show -----------------------------------------------------
  const out = shows.map((s) => {
    const clinics = (clinicsByShow[s.key] || []).sort((a, b) => b.rev - a.rev);
    const converts = clinics.length;
    const revenue = round2(clinics.reduce((a, c) => a + c.rev, 0));
    const leadCount = s.leadShow ? (leadEmailsByShow[s.leadShow]?.size || 0) : null;
    const cost = s.cost != null ? s.cost : null;
    const roi = cost ? round2(revenue / cost) : null;
    const convPct = leadCount ? round1((converts / leadCount) * 100) : leadCount === 0 ? 0 : null;
    const status = statusFor(s, converts, roi);
    return {
      key: s.key, name: s.name, dates: s.dates, start: s.start || null, cost,
      leads: leadCount, converts, revenue, roi, convPct, status, clinics,
    };
  });

  // sort by ROI desc, nulls last; tie-break by start ascending (past before future)
  out.sort((a, b) => {
    const na = a.roi == null, nb = b.roi == null;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    if (b.roi !== a.roi) return b.roi - a.roi;
    const sa = a.start ? Date.parse(a.start) : Infinity, sb = b.start ? Date.parse(b.start) : Infinity;
    return sa - sb;
  });

  const result = { generatedAt: day(new Date().toISOString()), shows: out };
  const totals = out
    .filter((s) => s.status !== "upcoming" && s.status !== "unmapped" && s.cost != null)
    .reduce((a, s) => ({ clinics: a.clinics + s.converts, revenue: a.revenue + s.revenue, cost: a.cost + s.cost }), { clinics: 0, revenue: 0, cost: 0 });
  console.log(`\nCompleted-show totals: ${totals.clinics} clinics · $${Math.round(totals.revenue).toLocaleString()} · blended ROI ${(totals.revenue / totals.cost).toFixed(2)}×`);

  if (DRY) {
    console.log(JSON.stringify(result, null, 1));
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
  console.log(`Wrote ${OUT}`);
}

// Status precedence: unmapped → upcoming → none(0 converts) → maturing(recent) →
// strong/ok/weak by ROI. Reproduces the committed statuses exactly.
function statusFor(s, converts, roi) {
  const hasCode = !!s.code;
  const hasStart = !!s.start;
  if (!hasCode && !hasStart) return "unmapped";
  if (hasStart && Date.parse(s.start) > todayMs) return "upcoming";
  if (converts === 0) return "none";
  const age = hasStart ? todayMs - Date.parse(s.start) : Infinity;
  if (age <= WEEKS7) return "maturing";
  const r = roi || 0;
  return r >= 2 ? "strong" : r >= 1 ? "ok" : "weak";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
