// /api/cache-debug — proves whether the shared KV cache actually persists on
// this deployment. Does a real write-then-read round-trip through the same
// getCachedData/setCachedData path the dashboard uses, and reports:
//   { mode, hasKv, wrote, writeStatus, readBack, equal, error }
// If equal:true and wrote:true on prod, KV is round-tripping correctly and a
// second identical /api/dashboard call should return cached:true.
//
// Read-only / harmless: it writes a random throwaway key and deletes it.

import { NextResponse } from "next/server";
import { cacheSelfTest } from "@/lib/dataCache.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await cacheSelfTest();
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
