// /api/shopify-webhook — Shopify pushes order changes here.
//
// Push, don't poll (Sam, 2026-08-08). Shopify tells us the instant an order is
// created, edited, cancelled or refunded, so the dashboard doesn't have to
// guess by re-pulling on a timer.
//
// This handler does NO aggregation. It verifies the signature, records a
// "dirty since <date>" marker in KV, and returns 200 — a few milliseconds.
// Shopify retries anything slower than 5 s or non-2xx, and doing real work
// here would mean N recomputes for a burst of N orders. Instead /api/tick
// (every minute) coalesces: however many orders land, at most ONE refresh per
// minute, and none at all when nothing changed.
//
// Verification: HMAC-SHA256 of the RAW body with the app's client secret,
// compared in constant time. Unverified requests are rejected before any KV
// write, so this endpoint can't be used to force compute.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getCachedData, setCachedData } from "@/lib/dataCache.js";
import { shopLocalDate } from "@/lib/xtresseCore.js";
import { DIRTY_KEY, DIRTY_TTL_MS } from "@/lib/liveState.js";
import {
  TAG_DIRTY_CUSTOMERS_KEY,
  TAG_DIRTY_TTL_MS,
  TAG_RELEVANT_TOPICS,
} from "@/lib/liveTagState.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// A refund payload doesn't reliably carry the ORDER's date, only the refund's.
// Rather than guess, widen the delta this far back so the changed order is
// certainly inside it. Refunds are rare here (-$5k against $8.6M YTD), so the
// occasional wider re-pull costs far less than silently missing one.
const REFUND_LOOKBACK_DAYS = 90;

function verify(rawBody, header, secret) {
  if (!header || !secret) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(Buffer.from(rawBody, "utf8"))
    .digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const dayOf = (iso) => {
  try {
    return iso ? shopLocalDate(iso) : null;
  } catch {
    return null;
  }
};

const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return shopLocalDate(d.toISOString());
};

export async function POST(request) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic") || "unknown";

  // MUST read the raw text — re-serializing JSON changes bytes and breaks HMAC.
  const raw = await request.text();

  if (!verify(raw, hmac, secret)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* signature was valid; treat an unparseable body as a generic touch */
  }

  // Earliest order date this change could affect.
  let dirtyFrom =
    dayOf(payload.created_at) || dayOf(payload.order?.created_at) || null;
  if (topic.startsWith("refunds/") && !dayOf(payload.order?.created_at)) {
    dirtyFrom = daysAgo(REFUND_LOOKBACK_DAYS);
  }
  if (!dirtyFrom) dirtyFrom = daysAgo(1); // unknown date → yesterday forward

  try {
    const prev = (await getCachedData(DIRTY_KEY, DIRTY_TTL_MS))?.data || null;
    const merged = {
      // Keep the EARLIEST dirty date across everything since the last tick, so
      // one refresh covers every change in the batch.
      dirtyFrom:
        prev?.dirtyFrom && prev.dirtyFrom < dirtyFrom ? prev.dirtyFrom : dirtyFrom,
      pending: (prev?.pending || 0) + 1,
      lastTopic: topic,
      lastAt: new Date().toISOString(),
    };
    await setCachedData(DIRTY_KEY, merged);
  } catch {
    // Never fail the webhook on a cache hiccup — Shopify would retry, and the
    // 1-minute tick refreshes on its own schedule anyway.
  }

  // Product-family "First order" / "First Gummy" / "First Serum" / "First
  // XVIE" tag correction (lib/firstOrderTags.js) — queue the affected
  // customer for the separate tag-tick cron (/api/tag-tick) to pick up.
  // Kept OUT of the fast-path above on purpose: recomputing a customer's
  // full order history is real work, not a cache flag, and doesn't belong in
  // a handler budgeted for milliseconds.
  //
  // refunds/create payloads don't reliably carry customer.id (same caveat as
  // dirtyFrom above) — skipped here rather than adding a network fetch to
  // this handler; refunds are rare enough that the periodic backfill catches
  // any drift this misses.
  if (TAG_RELEVANT_TOPICS.has(topic)) {
    const customerId = payload.customer?.id ? String(payload.customer.id) : null;
    if (customerId) {
      try {
        const prev = (await getCachedData(TAG_DIRTY_CUSTOMERS_KEY, TAG_DIRTY_TTL_MS))?.data || null;
        const ids = new Set(prev?.ids || []);
        ids.add(customerId);
        await setCachedData(TAG_DIRTY_CUSTOMERS_KEY, {
          ids: [...ids],
          lastAt: new Date().toISOString(),
        });
      } catch {
        // Same tolerance as above — a missed enqueue here is caught by the
        // periodic backfill script, never worth failing the webhook over.
      }
    }
  }

  return NextResponse.json({ ok: true, topic, dirtyFrom });
}

// Shopify sends a GET to nothing here, but a health probe is handy.
export async function GET() {
  const configured = Boolean(
    process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET
  );
  return NextResponse.json({ ok: true, configured });
}
