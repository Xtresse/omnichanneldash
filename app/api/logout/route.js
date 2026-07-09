import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "../../../lib/auth.js";

export const runtime = "nodejs";

// Clear the session cookie and bounce to the login page.
function clear(req) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export async function GET(req) {
  return clear(req);
}
export async function POST(req) {
  return clear(req);
}
