// Pull ALL Shopify orders (full history) via the Bulk Operations API and write a
// normalized JSON the report generator reads — no manual CSV export needed.
//
//   node pull_orders.mjs [out.json]      ->  default /tmp/xtresse_orders.json
//
// Creds (full-access custom app with read_all_orders) come from
// omnichanneldash/.env.local (or the environment):
//   SHOPIFY_ADMIN_API_TOKEN=shpat_...        (static token)  — OR —
//   SHOPIFY_CLIENT_ID=... / SHOPIFY_CLIENT_SECRET=...         (client-credentials grant)
//   SHOPIFY_STORE_DOMAIN=ace1d0-26.myshopify.com   (optional; this is the default)
//
// Then: python3 loyalty_report.py /tmp/xtresse_orders.json out.xlsx

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---- load .env.local ----
try {
  const p = new URL("../../.env.local", import.meta.url); // omnichanneldash/.env.local
  for (const line of readFileSync(fileURLToPath(p), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const STORE = process.env.SHOPIFY_STORE_DOMAIN || "ace1d0-26.myshopify.com";
const API = process.env.SHOPIFY_API_VERSION || "2025-01";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  const id = process.env.SHOPIFY_CLIENT_ID, sec = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing SHOPIFY_ADMIN_API_TOKEN or SHOPIFY_CLIENT_ID/SECRET in .env.local");
  const r = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: sec, grant_type: "client_credentials" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token exchange failed: " + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}
async function gql(q, tk) {
  const r = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": tk, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (j.errors) throw new Error("GraphQL: " + JSON.stringify(j.errors));
  return j.data;
}

// shop-local (America/Los_Angeles) date, to match the Admin CSV export
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
const localDate = (iso) => { try { return fmt.format(new Date(iso)); } catch { return (iso || "").slice(0, 10); } };

const BULK_QUERY = `{
  orders(query: "status:any") {
    edges { node {
      id name createdAt cancelledAt tags email
      totalPriceSet { shopMoney { amount } }
      shippingAddress { company name address1 address2 city provinceCode zip phone }
      billingAddress { phone }
      lineItems { edges { node { sku quantity name } } }
    } }
  }
}`;

async function run() {
  const tk = await token();
  console.error(`Starting bulk export from ${STORE} …`);
  const start = await gql(`mutation { bulkOperationRunQuery(query: ${JSON.stringify(BULK_QUERY)}) {
    bulkOperation { id status } userErrors { field message } } }`, tk);
  const ue = start.bulkOperationRunQuery.userErrors;
  if (ue && ue.length) throw new Error("bulk start: " + JSON.stringify(ue));
  // poll
  let url = null;
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    const c = (await gql(`{ currentBulkOperation { status errorCode objectCount url } }`, tk)).currentBulkOperation;
    if (i % 4 === 0) console.error(`  ${c.status} … objects=${c.objectCount || 0}`);
    if (c.status === "COMPLETED") { url = c.url; break; }
    if (["FAILED", "CANCELED"].includes(c.status)) throw new Error("bulk " + c.status + " " + (c.errorCode || ""));
  }
  if (!url) throw new Error("bulk timed out");

  console.error("Downloading JSONL …");
  const text = await (await fetch(url)).text();
  const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

  // stitch: order nodes have id starting gid://shopify/Order; line items carry __parentId
  const orders = new Map();
  for (const o of lines) {
    if (o.id && o.id.includes("/Order/")) {
      const a = o.shippingAddress || {};
      orders.set(o.id, {
        name: o.name, date: localDate(o.createdAt),
        tags: Array.isArray(o.tags) ? o.tags.join(",") : (o.tags || ""),
        cancelled: Boolean(o.cancelledAt), email: o.email || "",
        total: (o.totalPriceSet && o.totalPriceSet.shopMoney && o.totalPriceSet.shopMoney.amount) || "0",
        shipCo: a.company || "", shipName: a.name || "", addr1: a.address1 || "", addr2: a.address2 || "",
        city: a.city || "", prov: a.provinceCode || "", zip: a.zip || "", phone: a.phone || "",
        bphone: (o.billingAddress && o.billingAddress.phone) || "",
        lineItems: [],
      });
    }
  }
  for (const li of lines) {
    if (li.__parentId && orders.has(li.__parentId)) {
      orders.get(li.__parentId).lineItems.push({ sku: li.sku || "", name: li.name || "", qty: Number(li.quantity) || 0 });
    }
  }
  const out = process.argv[2] || "/tmp/xtresse_orders.json";
  writeFileSync(out, JSON.stringify([...orders.values()]));
  console.error(`WROTE ${out}  (${orders.size} orders)`);
}
run().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
