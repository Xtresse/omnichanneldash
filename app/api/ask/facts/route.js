// CRUD for the learned-facts store.

import { NextResponse } from "next/server";
import { listFacts, addFact, deleteFact } from "@/lib/store.js";

export async function GET() {
  try {
    const facts = await listFacts();
    return NextResponse.json({ ok: true, facts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const fact = await addFact({
      content: body?.content,
      source: body?.source || "user",
    });
    return NextResponse.json({ ok: true, fact });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 400 }
    );
  }
}

export async function DELETE(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }
  try {
    await deleteFact(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
