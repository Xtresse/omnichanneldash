// =============================================================================
// Ramp client — T&E spend per rep per day for the heat map.
// =============================================================================
// Status as of 2026-08-08 (verified against the live Ramp API):
//
//   users:read          GRANTED  — 34 users returned, 21 match the rep roster
//   transactions:read   NOT GRANTED — GET /transactions returns HTTP 403
//                       DEVELOPER_7100 "These scopes are not allowed for this
//                       token: transactions:read"
//
// AND the omnichanneldash Vercel project has no RAMP_* env vars at all, so the
// deployed app can't authenticate to Ramp in the first place.
//
// So spend is DARK until two things happen (see rampStatus()):
//   1. `transactions:read` is added to the Ramp OAuth app's scopes
//   2. RAMP_CLIENT_ID / RAMP_CLIENT_SECRET are added to Vercel production
//
// Everything below is written and wired so the panel lights up the moment both
// land — no code change needed. Until then the heat map renders the spend view
// in a "Connect Ramp" state rather than showing zeros, because zeros would be
// indistinguishable from "this rep spent nothing", which is exactly the signal
// Scott is looking for.
//
// CAVEAT worth stating plainly: the transaction-shape handling below could not
// be exercised against real data (403), only the auth and users paths could.
// It is defensive about field names for that reason.

const TOKEN_URL = process.env.RAMP_TOKEN_URL || "https://api.ramp.com/developer/v1/token";
const API_BASE = process.env.RAMP_API_BASE || "https://api.ramp.com/developer/v1";
const CLIENT_ID = process.env.RAMP_CLIENT_ID;
const CLIENT_SECRET = process.env.RAMP_CLIENT_SECRET;

export const RAMP_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET);

// Scopes we ASK for. transactions:read is included deliberately — once it's
// granted on the Ramp app this starts working with no code change. Requesting
// a scope that isn't granted yields a token without it rather than an error.
const SCOPES =
  process.env.RAMP_SCOPES || "users:read transactions:read business:read";

let cachedToken = null;

async function token() {
  if (!RAMP_CONFIGURED) throw new Error("Ramp not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) {
    throw new Error(`Ramp token failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 3600_000),
  };
  return cachedToken.value;
}

async function rampGet(path, params = {}) {
  const t = await token();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Ramp ${path} ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/** All Ramp users (id + display name). Requires users:read. */
export async function fetchRampUsers() {
  const out = [];
  let start = null;
  for (let page = 0; page < 10; page++) {
    const params = { page_size: 100 };
    if (start) params.start = start;
    const json = await rampGet("/users", params);
    for (const u of json.data || []) {
      out.push({
        id: u.id,
        name: `${u.first_name || ""} ${u.last_name || ""}`.trim(),
      });
    }
    start = json.page?.next && new URL(json.page.next, API_BASE).searchParams.get("start");
    if (!start) break;
  }
  return out;
}

/**
 * Transactions in [from, to] (inclusive dates, YYYY-MM-DD).
 * Requires transactions:read — currently NOT granted (403).
 */
export async function fetchRampTransactions(from, to) {
  const out = [];
  let start = null;
  for (let page = 0; page < 40; page++) {
    const params = {
      page_size: 100,
      from_date: `${from}T00:00:00Z`,
      to_date: `${to}T23:59:59Z`,
    };
    if (start) params.start = start;
    const json = await rampGet("/transactions", params);
    for (const t of json.data || []) {
      out.push({
        id: t.id,
        userId: t.card_holder?.user_id || t.user_id || null,
        // Ramp reports amounts in dollars on v1; fall back to a cents field if
        // present. Declines/reversals come through negative and should net.
        amount: Number(t.amount ?? (t.amount_cents != null ? t.amount_cents / 100 : 0)) || 0,
        at: t.user_transaction_time || t.settlement_date || null,
        merchant: t.merchant_name || t.merchant_descriptor || null,
      });
    }
    start = json.page?.next && new URL(json.page.next, API_BASE).searchParams.get("start");
    if (!start) break;
  }
  return out;
}

/**
 * What the UI needs to decide between "show spend" and "Connect Ramp".
 * Never throws — a broken Ramp must not take the heat map down.
 */
export async function rampStatus() {
  if (!RAMP_CONFIGURED) {
    return {
      connected: false,
      reason: "no-credentials",
      detail:
        "RAMP_CLIENT_ID / RAMP_CLIENT_SECRET are not set on this deployment.",
    };
  }
  try {
    await fetchRampUsers();
  } catch (e) {
    return { connected: false, reason: "auth-failed", detail: String(e.message || e) };
  }
  try {
    await rampGet("/transactions", { page_size: 1 });
    return { connected: true, reason: null, detail: null };
  } catch (e) {
    if (e.status === 403) {
      return {
        connected: false,
        reason: "missing-scope",
        detail:
          "Ramp OAuth app is missing the transactions:read scope (HTTP 403 DEVELOPER_7100). Users read fine; spend cannot.",
      };
    }
    return { connected: false, reason: "transactions-failed", detail: String(e.message || e) };
  }
}
