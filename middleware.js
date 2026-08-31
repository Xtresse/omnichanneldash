// =============================================================================
// Edge middleware — gates the WHOLE dashboard behind the shared password.
// =============================================================================
// Any request without a valid session cookie is redirected to /login (with the
// originally-requested path preserved in ?next=). A short allowlist keeps the
// login flow and the Vercel cron warmer reachable without a cookie.
//
// The matcher excludes Next internals and static assets so they load on the
// login page itself (logo, fonts, etc.).

import { NextResponse } from "next/server";
import { AUTH_COOKIE, expectedToken } from "./lib/auth.js";

// Paths that must work WITHOUT a session cookie.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/logout",
  "/api/warm", // Vercel cron warmer — no browser cookie
  "/api/tick", // Vercel cron live-refresher — no browser cookie
  "/api/tag-tick", // Vercel cron product-family tag corrector — no browser cookie
  "/api/territory-tick", // Vercel cron territory-map puller — no browser cookie
  "/api/box-tick", // Vercel cron branded-box packing corrector — no browser cookie
  // Shopify webhook receiver. Must be reachable without a session; it
  // authenticates itself by HMAC-SHA256 of the raw body against the app's
  // client secret and rejects anything unsigned before doing any work.
  "/api/shopify-webhook",
  // Next.js metadata routes (generated icons / manifest) — keep them reachable
  // so the login page renders its favicon + PWA manifest without redirecting.
  "/icon",
  "/apple-icon",
  "/favicon",
  "/manifest",
];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const expected = await expectedToken();
  if (cookie && cookie === expected) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname && pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything EXCEPT Next internals and static asset files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf)$).*)",
  ],
};
