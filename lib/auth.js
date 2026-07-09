// =============================================================================
// Shared-password gate — single password for the whole dashboard.
// =============================================================================
// The whole site sits behind ONE shared password (default "omnidash"). A
// correct password mints an HMAC token stored in an httpOnly cookie; the
// middleware verifies that token on every request. The password itself is
// never written to the cookie or shipped to the client.
//
// Override via env (optional):
//   DASHBOARD_PASSWORD      — the shared password (default "omnidash")
//   DASHBOARD_AUTH_SECRET   — HMAC secret (default a repo constant)
//
// Web Crypto is used (not node:crypto) so this one module runs unchanged in
// BOTH the Edge middleware runtime and the Node API routes.

const PASSWORD = process.env.DASHBOARD_PASSWORD || "omnidash";
const SECRET = process.env.DASHBOARD_AUTH_SECRET || "xtresse-omni-gate-v1";

export const AUTH_COOKIE = "omni_session";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Base64url-encode a byte array without Buffer (Edge runtime has no Buffer).
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

/** The opaque token a valid session cookie must equal. */
export async function expectedToken() {
  return hmac("omni-ok", SECRET);
}

/** Constant-ish password check. */
export function checkPassword(input) {
  return typeof input === "string" && input.length > 0 && input === PASSWORD;
}
