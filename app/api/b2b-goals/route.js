// /api/b2b-goals — B2B MTD status-bar goal storage.
//
// Goals are stored keyed by `${product}|${YYYY-MM}`. First write for a
// (product, year-month) creates the entry; subsequent writes are allowed
// (so Sam can correct typos via the small "edit" override in the UI) but
// the UI treats the goal as locked once entered.
//
// Persistence (hybrid):
//   - On Vercel (or anywhere KV_REST_API_URL + KV_REST_API_TOKEN are set):
//     stored in Vercel KV (Upstash Redis) under the single key "b2b-goals".
//     The Vercel serverless filesystem is read-only at runtime, so KV is
//     the only path that survives a deploy.
//   - Local dev (no KV env vars set): falls back to data/b2b-goals.json so
//     `next dev` keeps working without any cloud dependency.
//
// To enable KV on Vercel: create a KV store at
//   vercel.com → omnichanneldash → Storage → Create → KV
// Vercel auto-wires KV_REST_API_URL + KV_REST_API_TOKEN; redeploy.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Persisting JSON to the filesystem requires the Node.js runtime, not Edge.
export const runtime = "nodejs";
// Don't cache — goals change on user write and we want fresh reads.
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const GOALS_FILE = path.join(DATA_DIR, "b2b-goals.json");
const KV_KEY = "b2b-goals";

const PRODUCTS = new Set(["Serum", "XVIE", "Gummies"]);
const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Lazy import @vercel/kv so local dev (without the env vars) doesn't crash
// at module-load time if the package somehow isn't installed or fails to
// initialize. Only loaded when we actually need it.
async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

async function readGoalsFromKv() {
  const kv = await getKv();
  const data = await kv.get(KV_KEY);
  if (data && typeof data === "object" && data.goals) return data;
  return { goals: {} };
}

async function writeGoalsToKv(obj) {
  const kv = await getKv();
  await kv.set(KV_KEY, obj);
}

async function readGoalsFromFs() {
  try {
    const buf = await fs.readFile(GOALS_FILE, "utf8");
    const parsed = JSON.parse(buf);
    return parsed && typeof parsed === "object" && parsed.goals ? parsed : { goals: {} };
  } catch (err) {
    if (err?.code === "ENOENT") return { goals: {} };
    throw err;
  }
}

async function writeGoalsToFs(obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(GOALS_FILE, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function readGoals() {
  if (kvConfigured()) return readGoalsFromKv();
  return readGoalsFromFs();
}

async function writeGoals(obj) {
  if (kvConfigured()) return writeGoalsToKv(obj);
  return writeGoalsToFs(obj);
}

export async function GET() {
  try {
    const data = await readGoals();
    return NextResponse.json({
      ok: true,
      goals: data.goals || {},
      storage: kvConfigured() ? "kv" : "fs",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), goals: {} },
      { status: 200 } // graceful degrade — UI shows blank goals
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { product, yearMonth, goal } = body || {};

    if (!PRODUCTS.has(product)) {
      return NextResponse.json(
        { ok: false, error: `product must be one of Serum / XVIE / Gummies` },
        { status: 400 }
      );
    }
    if (typeof yearMonth !== "string" || !YYYY_MM.test(yearMonth)) {
      return NextResponse.json(
        { ok: false, error: `yearMonth must be YYYY-MM` },
        { status: 400 }
      );
    }
    const goalNum = Number(goal);
    if (!isFinite(goalNum) || goalNum < 0) {
      return NextResponse.json(
        { ok: false, error: `goal must be a non-negative number` },
        { status: 400 }
      );
    }

    const data = await readGoals();
    const key = `${product}|${yearMonth}`;
    data.goals[key] = {
      product,
      yearMonth,
      goal: Math.round(goalNum),
      updatedAt: new Date().toISOString(),
    };

    try {
      await writeGoals(data);
    } catch (writeErr) {
      // Surface persistence failures to the client. On Vercel this is the
      // single most common failure mode (read-only fs when KV isn't set up
      // yet) and the UI needs to know so it can show an error toast.
      const isVercel = process.env.VERCEL === "1";
      const hint = !kvConfigured() && isVercel
        ? " — Vercel filesystem is read-only at runtime. Create a Vercel KV store and redeploy."
        : "";
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to persist goal: ${String(writeErr?.message || writeErr)}${hint}`,
          storage: kvConfigured() ? "kv" : "fs",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      goals: data.goals,
      storage: kvConfigured() ? "kv" : "fs",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
