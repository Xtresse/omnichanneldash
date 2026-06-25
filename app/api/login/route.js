import { NextResponse } from "next/server";
import { AUTH_COOKIE, COOKIE_MAX_AGE, expectedToken, checkPassword } from "../../../lib/auth.js";

export const runtime = "nodejs";

export async function POST(req) {
  let password = "";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const body = await req.json();
      password = body?.password || "";
    } else {
      const form = await req.formData();
      password = String(form.get("password") || "");
    }
  } catch {
    password = "";
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const token = await expectedToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // allow http on localhost
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
