// =============================================================================
// Ramp client — T&E spend per rep per day for the heat map.
// =============================================================================
// Status as of 2026-08-08, verified against the LIVE Ramp API end to end:
//
//   users:read         works — 34 users, 21 match the rep roster
//   transactions:read  works — the Ramp app "Ramp API"
//                      (ramp_id_R5fKvYWA…) already has this scope enabled
//   transaction shape  verified against real rows: amount is dollars,
//                      user_transaction_time is ISO, and the cardholder is
//                      card_holder.user_id (NOT a top-level user_id, which is
//                      undefined). page.next drives pagination.
//
// An earlier read of this was WRONG and is worth recording so nobody re-derives
// it: GET /transactions did return 403 DEVELOPER_7100 "These scopes are not
// allowed for this token: transactions:read" — but that was the TOKEN REQUEST's
// fault, not the app's. ~/.claude/ramp.env pins
//   RAMP_SCOPES="cards:read cards:write limits:read limits:write users:read business:read"
// which omits transactions:read, so the minted token genuinely lacked it. The
// Ramp app needed no change at all. Hence REQUIRED_SCOPES below: a stale
// RAMP_SCOPES in the environment must never be able to silently drop a scope
// this module depends on.
//
// The ONLY thing still missing is credentials on the deployment —
// omnichanneldash's Vercel project has no RAMP_* env vars, so the deployed app
// can't authenticate. Set RAMP_CLIENT_ID / RAMP_CLIENT_SECRET and spend
// populates with no code change.
//
// Until then the heat map renders the spend view in a "Connect Ramp" state
// rather than showing zeros, because zeros would be indistinguishable from
// "this rep spent nothing", which is exactly the signal Scott is looking for.

const TOKEN_URL = process.env.RAMP_TOKEN_URL || "https://api.ramp.com/developer/v1/token";
const API_BASE = process.env.RAMP_API_BASE || "https://api.ramp.com/developer/v1";
const CLIENT_ID = process.env.RAMP_CLIENT_ID;
const CLIENT_SECRET = process.env.RAMP_CLIENT_SECRET;

export const RAMP_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET);

// Scopes this module cannot work without. Unioned into whatever RAMP_SCOPES
// says rather than being overridden by it — see the header note: a stale
// RAMP_SCOPES that omits transactions:read is exactly what produced a 403 that
// looked like a missing app permission and wasn't.
const REQUIRED_SCOPES = ["users:read", "transactions:read", "business:read"];

const SCOPES = Array.from(
  new Set([
    ...String(process.env.RAMP_SCOPES || "").split(/\s+/).filter(Boolean),
    ...REQUIRED_SCOPES,
  ])
).join(" ");

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
