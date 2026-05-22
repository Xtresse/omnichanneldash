// Read or delete a single scenario conversation. Identical to the /ask
// equivalent — the underlying store doesn't care about kind for these
// operations, the kind tag only matters when LISTING.

import { NextResponse } from "next/server";
import { getConversation, deleteConversation } from "@/lib/store.js";

export async function GET(_request, { params }) {
  const { id } = params;
  try {
    const conv = await getConversation(id);
    if (!conv) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, conversation: conv });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function DELETE(_request, { params }) {
  const { id } = params;
  try {
    await deleteConversation(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
