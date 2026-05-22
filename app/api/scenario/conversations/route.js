// List + create scenario-planning conversations. Mirrors
// /api/ask/conversations but scoped to kind="scenario".

import { NextResponse } from "next/server";
import {
  listConversations,
  createConversation,
  STORE_MODE,
} from "@/lib/store.js";

export async function GET() {
  try {
    const items = await listConversations("scenario");
    return NextResponse.json({ ok: true, mode: STORE_MODE, items });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  try {
    const conv = await createConversation({
      title: body?.title,
      kind: "scenario",
    });
    return NextResponse.json({ ok: true, conversation: conv });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
